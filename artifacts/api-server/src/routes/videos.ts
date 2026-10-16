import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  CreateVideoBody,
  CreateVideoResponse,
  DeleteVideoParams,
  GetVideoFileUrlParams,
  GetVideoFileUrlResponse,
  ListVideosResponse,
  MarkVideoPostedParams,
  MarkVideoPostedResponse,
  SkipVideoParams,
  SkipVideoResponse,
  UpdateVideoBody,
  UpdateVideoParams,
  UpdateVideoResponse,
} from "@workspace/api-zod";
import {
  db,
  scheduleSettingsTable,
  videosTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { authenticatedUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
router.use(requireAuth);

async function ensureSettings(ownerId: string) {
  await db
    .insert(scheduleSettingsTable)
    .values({ ownerId })
    .onConflictDoNothing();
  const [settings] = await db
    .select()
    .from(scheduleSettingsTable)
    .where(eq(scheduleSettingsTable.ownerId, ownerId))
    .limit(1);
  return settings;
}

async function listForOwner(ownerId: string) {
  const [settings, videos] = await Promise.all([
    ensureSettings(ownerId),
    db
      .select()
      .from(videosTable)
      .where(eq(videosTable.ownerId, ownerId))
      .orderBy(asc(videosTable.id)),
  ]);
  let nextVideoId = settings.nextVideoId;
  if (videos.length && !videos.some((video) => video.id === nextVideoId)) {
    nextVideoId = videos[0].id;
    await db
      .update(scheduleSettingsTable)
      .set({ nextVideoId, updatedAt: new Date() })
      .where(eq(scheduleSettingsTable.ownerId, ownerId));
  }
  return ListVideosResponse.parse({
    videos: videos.map((video) => ({ ...video, isNext: video.id === nextVideoId })),
  });
}

async function nextIdAfter(ownerId: string, currentId: number) {
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

router.get("/videos", async (req: Request, res: Response): Promise<void> => {
  res.json(await listForOwner(authenticatedUserId(req)));
});

router.post("/videos", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = authenticatedUserId(req);
  if (!parsed.data.objectPath.startsWith("/objects/uploads/")) {
    res.status(400).json({ error: "Invalid uploaded video path" });
    return;
  }
  try {
    const normalizedPath = await objectStorage.trySetObjectEntityAclPolicy(
      parsed.data.objectPath,
      { owner: ownerId, visibility: "private" },
    );
    const [video] = await db
      .insert(videosTable)
      .values({ ...parsed.data, objectPath: normalizedPath, ownerId })
      .returning();
    const settings = await ensureSettings(ownerId);
    if (settings.nextVideoId == null) {
      await db
        .update(scheduleSettingsTable)
        .set({ nextVideoId: video.id, updatedAt: new Date() })
        .where(eq(scheduleSettingsTable.ownerId, ownerId));
    }
    res.status(201).json(
      CreateVideoResponse.parse({ ...video, isNext: settings.nextVideoId == null }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Failed to add uploaded video");
    res.status(400).json({ error: "The uploaded file could not be verified" });
  }
});

router.patch("/videos/:id", async (req: Request, res: Response): Promise<void> => {
  const params = UpdateVideoParams.safeParse(req.params);
  const body = UpdateVideoBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid video update" });
    return;
  }
  if (!Object.keys(body.data).length) {
    res.status(400).json({ error: "Provide a title or description to update" });
    return;
  }
  const [video] = await db
    .update(videosTable)
    .set(body.data)
    .where(and(eq(videosTable.id, params.data.id), eq(videosTable.ownerId, authenticatedUserId(req))))
    .returning();
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const [settings] = await db
    .select()
    .from(scheduleSettingsTable)
    .where(eq(scheduleSettingsTable.ownerId, video.ownerId))
    .limit(1);
  res.json(UpdateVideoResponse.parse({ ...video, isNext: settings?.nextVideoId === video.id }));
});

router.delete("/videos/:id", async (req: Request, res: Response): Promise<void> => {
  const params = DeleteVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = authenticatedUserId(req);
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, params.data.id), eq(videosTable.ownerId, ownerId)))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  try {
    await objectStorage.deleteObjectEntity(video.objectPath);
    await db.delete(videosTable).where(eq(videosTable.id, video.id));
    const [settings] = await db
      .select()
      .from(scheduleSettingsTable)
      .where(eq(scheduleSettingsTable.ownerId, ownerId))
      .limit(1);
    if (settings?.nextVideoId === video.id) {
      const replacement = await nextIdAfter(ownerId, video.id);
      await db
        .update(scheduleSettingsTable)
        .set({ nextVideoId: replacement, updatedAt: new Date() })
        .where(eq(scheduleSettingsTable.ownerId, ownerId));
    }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error, videoId: video.id }, "Failed to delete video file");
    res.status(500).json({ error: "Could not remove the video file" });
  }
});

router.post("/videos/:id/posted", async (req: Request, res: Response): Promise<void> => {
  const params = MarkVideoPostedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = authenticatedUserId(req);
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, params.data.id), eq(videosTable.ownerId, ownerId)))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const [settings] = await db
    .select()
    .from(scheduleSettingsTable)
    .where(eq(scheduleSettingsTable.ownerId, ownerId))
    .limit(1);
  if (settings?.nextVideoId !== video.id) {
    res.status(409).json({ error: "Only the next video can be marked as posted" });
    return;
  }
  const now = new Date();
  await db
    .update(videosTable)
    .set({ lastPostedAt: now, postedCount: video.postedCount + 1 })
    .where(eq(videosTable.id, video.id));
  const nextVideoId = await nextIdAfter(ownerId, video.id);
  await db
    .update(scheduleSettingsTable)
    .set({
      lastPostedAt: now,
      nextPostAt: settings?.enabled
        ? new Date(now.getTime() + (settings.intervalHours ?? 3) * 60 * 60 * 1000)
        : null,
      nextVideoId,
      updatedAt: now,
    })
    .where(eq(scheduleSettingsTable.ownerId, ownerId));
  res.json(MarkVideoPostedResponse.parse(await listForOwner(ownerId)));
});

router.post("/videos/:id/skip", async (req: Request, res: Response): Promise<void> => {
  const params = SkipVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = authenticatedUserId(req);
  const [video] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(eq(videosTable.id, params.data.id), eq(videosTable.ownerId, ownerId)))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const nextVideoId = await nextIdAfter(ownerId, video.id);
  await ensureSettings(ownerId);
  await db
    .update(scheduleSettingsTable)
    .set({ nextVideoId, updatedAt: new Date() })
    .where(eq(scheduleSettingsTable.ownerId, ownerId));
  res.json(SkipVideoResponse.parse(await listForOwner(ownerId)));
});

router.get("/videos/:id/file", async (req: Request, res: Response): Promise<void> => {
  const params = GetVideoFileUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, params.data.id), eq(videosTable.ownerId, authenticatedUserId(req))))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const url = `/api/storage${video.objectPath}`;
  res.json(GetVideoFileUrlResponse.parse({ url }));
});

export default router;
