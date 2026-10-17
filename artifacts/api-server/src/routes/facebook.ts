/**
 * Facebook OAuth + Reels publishing routes
 *
 * Endpoints:
 *   GET  /facebook/status          – current connection state
 *   POST /facebook/connect         – start OAuth flow, returns authorization URL
 *   GET  /facebook/callback        – OAuth redirect target, exchanges code for token
 *   PUT  /facebook/page            – choose which Page to publish to
 *   DELETE /facebook/connection    – revoke & wipe stored tokens
 *
 * Facebook app credentials are read from environment variables:
 *   FACEBOOK_APP_ID     – your App ID   (1679645707039140)
 *   FACEBOOK_APP_SECRET – your App Secret
 *
 * The OAuth callback URL must be registered in the Facebook app's
 * "Valid OAuth Redirect URIs" list.  It is constructed as:
 *   <APP_BASE_URL>/api/facebook/callback
 * where APP_BASE_URL is set via the APP_BASE_URL environment variable.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  GetFacebookStatusResponse,
  SelectFacebookPageBody,
  SelectFacebookPageResponse,
  StartFacebookConnectResponse,
  DisconnectFacebookResponse,
} from "@workspace/api-zod";
import {
  db,
  facebookConnectionTable,
  scheduleSettingsTable,
  lyricReelsOwnerTable,
} from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

function appId(): string {
  return process.env.FACEBOOK_APP_ID ?? "";
}
function appSecret(): string {
  return process.env.FACEBOOK_APP_SECRET ?? "";
}
function appBaseUrl(req: Request): string {
  // Prefer explicit env var; fall back to request origin
  return (
    process.env.APP_BASE_URL ??
    `${req.protocol}://${req.get("host")}`
  );
}
function callbackUrl(req: Request): string {
  return `${appBaseUrl(req)}/api/facebook/callback`;
}
function isAppConfigured(): boolean {
  return Boolean(appId() && appSecret());
}

/** Fetch a JSON resource from the Facebook Graph API */
async function graphGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v22.0${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Graph API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Exchange a short-lived user token for a long-lived one (60-day TTL) */
async function exchangeForLongLivedToken(shortToken: string): Promise<string> {
  const data = await graphGet<{ access_token: string }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: appId(),
      client_secret: appSecret(),
      fb_exchange_token: shortToken,
    },
  );
  return data.access_token;
}

interface PageData {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
}

/** Get all Pages the user manages, including their page-level tokens */
async function getUserPages(userToken: string): Promise<PageData[]> {
  const data = await graphGet<{ data: PageData[] }>("/me/accounts", {
    access_token: userToken,
    fields: "id,name,access_token,tasks",
  });
  return data.data ?? [];
}

/** Check whether a page token has the pages_read_engagement permission */
async function checkInsightsAccess(pageAccessToken: string, pageId: string): Promise<boolean> {
  try {
    await graphGet(`/${pageId}/insights`, {
      access_token: pageAccessToken,
      metric: "page_impressions",
      period: "day",
      limit: "1",
    });
    return true;
  } catch {
    return false;
  }
}

/** Read the single Facebook connection row (or null) */
async function getConnection(ownerId: string) {
  const [row] = await db
    .select()
    .from(facebookConnectionTable)
    .where(eq(facebookConnectionTable.ownerId, ownerId))
    .limit(1);
  return row ?? null;
}

/** Build the FacebookStatus response object */
function buildStatus(
  req: Request,
  conn: typeof facebookConnectionTable.$inferSelect | null,
  pages: { pageId: string; pageName: string; selected: boolean }[] = [],
  scheduleNextPostAt: Date | null = null,
) {
  const connected = Boolean(conn?.pageAccessToken && conn?.pageId);
  return GetFacebookStatusResponse.parse({
    appConfigured: isAppConfigured(),
    connected,
    callbackUrl: callbackUrl(req),
    pages,
    selectedPageId: conn?.pageId ?? null,
    selectedPageName: conn?.pageName ?? null,
    viewInsightsAvailable: conn?.viewInsightsAvailable ?? false,
    viewInsightsMessage: conn?.viewInsightsAvailable
      ? "Page view counts will be tracked when available."
      : "View insights are optional. Posting will continue without them.",
    autoPostingEnabled: conn?.autoPostingEnabled ?? false,
    nextPostAt: scheduleNextPostAt,
    lastError: conn?.lastError ?? null,
  });
}

/** Get the owner's schedule settings row */
async function getScheduleSettings(ownerId: string) {
  const [row] = await db
    .select()
    .from(scheduleSettingsTable)
    .where(eq(scheduleSettingsTable.ownerId, ownerId))
    .limit(1);
  return row ?? null;
}

// ─── routes (all require auth) ───────────────────────────────────────────────

router.use(requireAuth);

/**
 * GET /facebook/status
 * Returns the current Facebook connection state for the authenticated owner.
 */
router.get("/facebook/status", async (req: Request, res: Response): Promise<void> => {
  const ownerId = authenticatedUserId(req);
  const conn = await getConnection(ownerId);
  const schedule = await getScheduleSettings(ownerId);

  // Build a page list from what we stored (we only store the selected page)
  const pages =
    conn?.pageId && conn?.pageName
      ? [{ pageId: conn.pageId, pageName: conn.pageName, selected: true }]
      : [];

  res.json(buildStatus(req, conn, pages, schedule?.nextPostAt ?? null));
});

/**
 * POST /facebook/connect
 * Generates a Facebook OAuth authorization URL and returns it to the client.
 * The client then redirects the user to that URL.
 */
router.post("/facebook/connect", async (req: Request, res: Response): Promise<void> => {
  if (!isAppConfigured()) {
    res.status(503).json({ error: "Facebook app credentials are not configured" });
    return;
  }

  // We need these permissions to:
  //   pages_show_list           – list managed pages
  //   pages_read_engagement     – optional view insights
  //   pages_manage_posts        – publish Reels / videos to the page
  //   publish_video             – upload videos / reels to the page timeline
  const scope = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "publish_video",
  ].join(",");

  const cb = callbackUrl(req);
  const authUrl = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  authUrl.searchParams.set("client_id", appId());
  authUrl.searchParams.set("redirect_uri", cb);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("response_type", "code");
  // Embed the owner ID in state so we can look it up in the callback
  authUrl.searchParams.set("state", authenticatedUserId(req));

  res.json(StartFacebookConnectResponse.parse({ authorizationUrl: authUrl.toString() }));
});

/**
 * GET /facebook/callback
 * Facebook redirects here after the user grants/denies permission.
 * Exchanges the code for tokens, fetches page list, saves to DB, and
 * redirects the browser to the /schedule page.
 */
router.get("/facebook/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state: ownerId, error: fbError } = req.query as Record<string, string>;
  const redirectBase = appBaseUrl(req);

  if (fbError) {
    logger.warn({ fbError }, "Facebook OAuth denied by user");
    res.redirect(`${redirectBase}/schedule?fb=denied`);
    return;
  }

  if (!code || !ownerId) {
    res.redirect(`${redirectBase}/schedule?fb=error`);
    return;
  }

  // Verify the ownerId in state actually owns this space
  const [owner] = await db
    .select()
    .from(lyricReelsOwnerTable)
    .where(eq(lyricReelsOwnerTable.ownerId, ownerId))
    .limit(1);
  if (!owner) {
    res.redirect(`${redirectBase}/schedule?fb=error`);
    return;
  }

  try {
    // 1. Exchange the short-lived code for a short-lived user token
    const tokenUrl = new URL("https://graph.facebook.com/v22.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId());
    tokenUrl.searchParams.set("client_secret", appSecret());
    tokenUrl.searchParams.set("redirect_uri", callbackUrl(req));
    tokenUrl.searchParams.set("code", code);
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: { message: string } };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message ?? "No access_token in response");
    }

    // 2. Exchange the short-lived token for a long-lived 60-day token
    const longLivedToken = await exchangeForLongLivedToken(tokenData.access_token);

    // 3. Fetch pages the user manages
    const pages = await getUserPages(longLivedToken);

    // 4. If there's exactly one page, auto-select it; otherwise save without a page
    //    (the user will pick from the UI on /schedule)
    const autoPage = pages.length === 1 ? pages[0] : null;

    let pageInsights = false;
    if (autoPage) {
      pageInsights = await checkInsightsAccess(autoPage.access_token, autoPage.id);
    }

    // 5. Upsert the facebook connection row
    await db
      .insert(facebookConnectionTable)
      .values({
        id: 1,
        ownerId,
        userAccessToken: longLivedToken,
        pageAccessToken: autoPage?.access_token ?? null,
        pageId: autoPage?.id ?? null,
        pageName: autoPage?.name ?? null,
        viewInsightsAvailable: pageInsights,
        autoPostingEnabled: false,
        lastError: null,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: facebookConnectionTable.id,
        set: {
          ownerId,
          userAccessToken: longLivedToken,
          pageAccessToken: autoPage?.access_token ?? null,
          pageId: autoPage?.id ?? null,
          pageName: autoPage?.name ?? null,
          viewInsightsAvailable: pageInsights,
          autoPostingEnabled: false,
          lastError: null,
          connectedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    logger.info({ ownerId, pageId: autoPage?.id ?? "none" }, "Facebook connected");
    res.redirect(`${redirectBase}/schedule?fb=connected`);
  } catch (err) {
    logger.error({ err }, "Facebook OAuth callback failed");
    res.redirect(`${redirectBase}/schedule?fb=error`);
  }
});

/**
 * PUT /facebook/page
 * Lets the owner choose which Facebook Page to publish Reels to.
 * Fetches a fresh page-level token from the stored user token.
 */
router.put("/facebook/page", async (req: Request, res: Response): Promise<void> => {
  const parsed = SelectFacebookPageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pageId" });
    return;
  }
  const ownerId = authenticatedUserId(req);
  const conn = await getConnection(ownerId);
  if (!conn?.userAccessToken) {
    res.status(404).json({ error: "Facebook is not connected" });
    return;
  }

  try {
    const pages = await getUserPages(conn.userAccessToken);
    const chosen = pages.find((p) => p.id === parsed.data.pageId);
    if (!chosen) {
      res.status(404).json({ error: "That Page is not connected to this account" });
      return;
    }

    const insights = await checkInsightsAccess(chosen.access_token, chosen.id);

    await db
      .update(facebookConnectionTable)
      .set({
        pageAccessToken: chosen.access_token,
        pageId: chosen.id,
        pageName: chosen.name,
        viewInsightsAvailable: insights,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(facebookConnectionTable.ownerId, ownerId));

    const updatedConn = await getConnection(ownerId);
    const schedule = await getScheduleSettings(ownerId);
    const pageList = pages.map((p) => ({
      pageId: p.id,
      pageName: p.name,
      selected: p.id === chosen.id,
    }));

    res.json(SelectFacebookPageResponse.parse(
      buildStatus(req, updatedConn, pageList, schedule?.nextPostAt ?? null)
    ));
  } catch (err) {
    logger.error({ err }, "Failed to select Facebook page");
    res.status(500).json({ error: "Could not select that Page. Try again." });
  }
});

/**
 * DELETE /facebook/connection
 * Disconnects Facebook — wipes stored tokens, pauses auto-posting.
 */
router.delete("/facebook/connection", async (req: Request, res: Response): Promise<void> => {
  const ownerId = authenticatedUserId(req);
  const conn = await getConnection(ownerId);

  if (conn?.userAccessToken) {
    // Best-effort revoke — Facebook docs recommend this but failure is acceptable
    try {
      await graphGet("/me/permissions", {
        access_token: conn.userAccessToken,
        method: "delete",
      });
    } catch {
      // ignore — we still wipe locally
    }
  }

  // Wipe all token data but keep the row (so autoPostingEnabled stays false)
  await db
    .update(facebookConnectionTable)
    .set({
      userAccessToken: null,
      pageAccessToken: null,
      pageId: null,
      pageName: null,
      viewInsightsAvailable: false,
      autoPostingEnabled: false,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(facebookConnectionTable.ownerId, ownerId));

  // Also pause the schedule when disconnecting
  await db
    .update(scheduleSettingsTable)
    .set({ enabled: false, nextPostAt: null, updatedAt: new Date() })
    .where(eq(scheduleSettingsTable.ownerId, ownerId));

  logger.info({ ownerId }, "Facebook disconnected");
  res.json(DisconnectFacebookResponse.parse(
    buildStatus(req, null, [], null)
  ));
});

export default router;
