import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db, lyricReelsOwnerTable } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      authUserId?: string;
    }
  }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Extracts the Bearer token from the Authorization header.
 * The Supabase JS client sends the session access token as a Bearer token
 * with every request when configured with the custom fetch wrapper.
 */
function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Verify the JWT with Supabase — this also returns the user object
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = data.user.id;

  // Single-owner claim: first user to authenticate becomes the permanent owner.
  // onConflictDoNothing means any second user just gets the existing row back.
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
