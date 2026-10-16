import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { db, scheduleSettingsTable } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

async function getOrCreateSettings(ownerId: string) {
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

function toResponse(row: typeof scheduleSettingsTable.$inferSelect) {
  return {
    enabled: row.enabled,
    intervalHours: row.intervalHours,
    timezone: row.timezone,
    nextPostAt: row.nextPostAt,
    lastPostedAt: row.lastPostedAt,
  };
}

router.get("/settings", async (req: Request, res: Response): Promise<void> => {
  const settings = await getOrCreateSettings(authenticatedUserId(req));
  res.json(GetSettingsResponse.parse(toResponse(settings)));
});

router.put("/settings", async (req: Request, res: Response): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: body.data.timezone });
  } catch {
    res.status(400).json({ error: "Choose a valid timezone" });
    return;
  }
  const ownerId = authenticatedUserId(req);
  const existing = await getOrCreateSettings(ownerId);
  const enabled = body.data.enabled;
  const nextPostAt = enabled
    ? existing.enabled && existing.nextPostAt
      ? existing.nextPostAt
      : new Date(Date.now() + body.data.intervalHours * 60 * 60 * 1000)
    : null;
  const [updated] = await db
    .update(scheduleSettingsTable)
    .set({
      enabled,
      intervalHours: body.data.intervalHours,
      timezone: body.data.timezone,
      nextPostAt,
      updatedAt: new Date(),
    })
    .where(eq(scheduleSettingsTable.ownerId, ownerId))
    .returning();
  res.json(UpdateSettingsResponse.parse(toResponse(updated)));
});

export default router;
