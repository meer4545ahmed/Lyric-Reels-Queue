/**
 * autoPostScheduler.ts
 *
 * Runs a setInterval every 60 seconds.  On each tick it:
 *   1. Finds the single owner of the space.
 *   2. Checks that auto-posting is enabled, a Facebook Page is connected,
 *      and the current time is at or past nextPostAt.
 *   3. Downloads the next video from GCS.
 *   4. Uploads it to Facebook as a Reel via the Resumable Upload API.
 *   5. Marks the video as posted in the DB and advances the queue pointer.
 *   6. Sets nextPostAt = now + intervalHours.
 *   7. On any failure it writes the error message into facebookConnectionTable.lastError
 *      and leaves the queue pointer unchanged so it retries next tick.
 *
 * The scheduler is intentionally simple — one owner, one queue, one loop.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import {
  db,
  facebookConnectionTable,
  lyricReelsOwnerTable,
  scheduleSettingsTable,
  videosTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

// ─── Facebook Graph API helpers ───────────────────────────────────────────────

const GRAPH_BASE = "https://graph.facebook.com/v22.0";

/** Simple Graph GET with JSON response */
async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Graph API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Upload a video to a Facebook Page as a Reel using the
 * Resumable Upload API (required for large files > 1 MB).
 *
 * Flow:
 *   Step 1 – start_upload session  →  upload_session_id, start_offset, end_offset
 *   Step 2 – upload binary chunks  →  repeat until start_offset === end_offset
 *   Step 3 – finish upload         →  video_id
 *   Step 4 – publish as Reel       →  post_id
 */
async function uploadReelToPage({
  pageId,
  pageAccessToken,
  videoBuffer,
  videoSizeBytes,
  mimeType,
  title,
  description,
}: {
  pageId: string;
  pageAccessToken: string;
  videoBuffer: Buffer;
  videoSizeBytes: number;
  mimeType: string;
  title: string;
  description: string;
}): Promise<string> {
  // ── Step 1: Start upload session ──────────────────────────────────────────
  const startRes = await fetch(
    `${GRAPH_BASE}/${pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(pageAccessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", file_size: videoSizeBytes }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!startRes.ok) {
    const t = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`Reel upload start failed (${startRes.status}): ${t}`);
  }
  const startData = (await startRes.json()) as {
    upload_session_id: string;
    video_id: string;
    start_offset: string;
    end_offset: string;
  };
  const { upload_session_id, video_id } = startData;
  let startOffset = parseInt(startData.start_offset, 10);
  let endOffset = parseInt(startData.end_offset, 10);

  // ── Step 2: Upload chunks ─────────────────────────────────────────────────
  while (startOffset < endOffset) {
    const chunk = videoBuffer.slice(startOffset, endOffset);

    const chunkRes = await fetch(
      `https://rupload.facebook.com/video-upload/v22.0/${upload_session_id}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(chunk.length),
          "X-Entity-Length": String(videoSizeBytes),
          "X-Entity-Name": "reel_video",
          "X-Entity-Type": mimeType || "video/mp4",
          offset: String(startOffset),
        },
        body: chunk,
        signal: AbortSignal.timeout(600_000), // 10 min per chunk
      },
    );
    if (!chunkRes.ok) {
      const t = await chunkRes.text().catch(() => chunkRes.statusText);
      throw new Error(`Reel chunk upload failed (${chunkRes.status}): ${t}`);
    }
    const chunkData = (await chunkRes.json()) as {
      start_offset: string;
      end_offset: string;
    };
    startOffset = parseInt(chunkData.start_offset, 10);
    endOffset = parseInt(chunkData.end_offset, 10);
  }

  // ── Step 3: Finish / publish the Reel ────────────────────────────────────
  const finishUrl = new URL(`${GRAPH_BASE}/${pageId}/video_reels`);
  finishUrl.searchParams.set("access_token", pageAccessToken);
  finishUrl.searchParams.set("upload_phase", "finish");
  finishUrl.searchParams.set("video_id", video_id);
  finishUrl.searchParams.set("title", title.slice(0, 255));
  finishUrl.searchParams.set("description", description.slice(0, 5000));
  finishUrl.searchParams.set("upload_phase", "finish");
  // published = true makes it live immediately
  finishUrl.searchParams.set("video_state", "PUBLISHED");

  const finishRes = await fetch(finishUrl.toString(), {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  if (!finishRes.ok) {
    const t = await finishRes.text().catch(() => finishRes.statusText);
    throw new Error(`Reel finish/publish failed (${finishRes.status}): ${t}`);
  }
  const finishData = (await finishRes.json()) as { success?: boolean; post_id?: string };
  return finishData.post_id ?? video_id;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getOwner() {
  const [row] = await db.select().from(lyricReelsOwnerTable).limit(1);
  return row ?? null;
}

async function nextIdAfter(ownerId: string, currentId: number): Promise<number | null> {
  const [next] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(eq(videosTable.ownerId, ownerId), gt(videosTable.id, currentId)))
    .orderBy(asc(videosTable.id))
    .limit(1);
  if (next) return next.id;
  const [first] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(eq(videosTable.ownerId, ownerId))
    .orderBy(asc(videosTable.id))
    .limit(1);
  return first?.id ?? null;
}

/** Record a posting error in the facebook connection row */
async function recordError(ownerId: string, message: string) {
  await db
    .update(facebookConnectionTable)
    .set({ lastError: message, updatedAt: new Date() })
    .where(eq(facebookConnectionTable.ownerId, ownerId));
}

// ─── Core tick ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  // 1. Find the owner
  const owner = await getOwner();
  if (!owner) return;
  const ownerId = owner.ownerId;

  // 2. Check schedule: must be enabled and past due
  const [schedule] = await db
    .select()
    .from(scheduleSettingsTable)
    .where(eq(scheduleSettingsTable.ownerId, ownerId))
    .limit(1);
  if (!schedule?.enabled) return;
  if (!schedule.nextPostAt) return;
  if (new Date(schedule.nextPostAt) > new Date()) return;

  // 3. Check Facebook connection
  const [fbConn] = await db
    .select()
    .from(facebookConnectionTable)
    .where(eq(facebookConnectionTable.ownerId, ownerId))
    .limit(1);
  if (!fbConn?.pageAccessToken || !fbConn?.pageId) {
    await recordError(ownerId, "No Facebook Page is connected. Connect a Page on the Schedule page.");
    return;
  }

  // 4. Get the next video to post
  if (!schedule.nextVideoId) {
    logger.info({ ownerId }, "Scheduler: no video in rotation yet");
    return;
  }
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, schedule.nextVideoId), eq(videosTable.ownerId, ownerId)))
    .limit(1);
  if (!video) {
    logger.warn({ ownerId, nextVideoId: schedule.nextVideoId }, "Scheduler: next video not found, resetting pointer");
    const [first] = await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .where(eq(videosTable.ownerId, ownerId))
      .orderBy(asc(videosTable.id))
      .limit(1);
    if (first) {
      await db
        .update(scheduleSettingsTable)
        .set({ nextVideoId: first.id, updatedAt: new Date() })
        .where(eq(scheduleSettingsTable.ownerId, ownerId));
    }
    return;
  }

  logger.info({ ownerId, videoId: video.id, title: video.title }, "Scheduler: posting Reel");

  // 5. Download the video from Supabase Storage into memory
  let videoBuffer: Buffer;
  let mimeType: string;
  try {
    const objectStorage = new ObjectStorageService();
    const result = await objectStorage.downloadObjectAsBuffer(video.objectPath);
    videoBuffer = result.buffer;
    mimeType = result.mimeType || video.mimeType || "video/mp4";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, videoId: video.id }, "Scheduler: failed to download video from storage");
    await recordError(ownerId, `Video download failed: ${msg}`);
    return;
  }

  // 6. Upload to Facebook as a Reel
  let postId: string;
  try {
    postId = await uploadReelToPage({
      pageId: fbConn.pageId,
      pageAccessToken: fbConn.pageAccessToken,
      videoBuffer,
      videoSizeBytes: video.sizeBytes,
      mimeType,
      title: video.title,
      description: video.description,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, videoId: video.id }, "Scheduler: Facebook upload failed");
    await recordError(ownerId, `Facebook upload failed: ${msg}`);
    return;
  }

  logger.info({ ownerId, videoId: video.id, postId }, "Scheduler: Reel posted successfully");

  // 7. Mark video as posted in DB and advance the queue
  const now = new Date();
  await db
    .update(videosTable)
    .set({ lastPostedAt: now, postedCount: video.postedCount + 1 })
    .where(eq(videosTable.id, video.id));

  const nextVideoId = await nextIdAfter(ownerId, video.id);
  const nextPostAt = new Date(now.getTime() + (schedule.intervalHours ?? 3) * 60 * 60 * 1000);

  await db
    .update(scheduleSettingsTable)
    .set({ lastPostedAt: now, nextPostAt, nextVideoId, updatedAt: now })
    .where(eq(scheduleSettingsTable.ownerId, ownerId));

  // 8. Clear any previous error and confirm auto-posting is active
  await db
    .update(facebookConnectionTable)
    .set({ autoPostingEnabled: true, lastError: null, updatedAt: now })
    .where(eq(facebookConnectionTable.ownerId, ownerId));
}

// ─── Public API ───────────────────────────────────────────────────────────────

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/** Start the scheduler — call once at server startup */
export function startAutoPostScheduler(): void {
  if (schedulerHandle) return; // already running

  logger.info("Auto-post scheduler started (60 s interval)");

  // Run once immediately on startup (catches any missed posts after a restart)
  tick().catch((err) => logger.error({ err }, "Scheduler: tick error"));

  schedulerHandle = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Scheduler: tick error"));
  }, 60_000);

  // Let Node exit normally even if the interval is still live
  if (schedulerHandle.unref) schedulerHandle.unref();
}

/** Stop the scheduler (useful in tests) */
export function stopAutoPostScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
