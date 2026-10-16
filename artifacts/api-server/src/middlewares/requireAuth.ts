import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, lyricReelsOwnerTable } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      authUserId?: string;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await db
    .insert(lyricReelsOwnerTable)
    .values({ id: 1, ownerId: userId })
    .onConflictDoNothing();
  const [owner] = await db
    .select()
    .from(lyricReelsOwnerTable)
    .where(eq(lyricReelsOwnerTable.id, 1))
    .limit(1);
  if (owner && owner.ownerId !== userId) {
    res.status(403).json({ error: "This private creator space is already claimed" });
    return;
  }
  req.authUserId = userId;
  next();
};

export function authenticatedUserId(req: Request): string {
  if (!req.authUserId) {
    throw new Error("Authenticated user is missing");
  }
  return req.authUserId;
}
