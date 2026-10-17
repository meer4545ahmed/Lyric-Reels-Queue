/**
 * objectStorage.ts — Supabase Storage backend
 *
 * Replaces the previous Replit/GCS implementation.
 * All videos are stored in a private Supabase Storage bucket.
 *
 * Env vars required:
 *   SUPABASE_URL              – e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY – service role key (never sent to browser)
 *   SUPABASE_STORAGE_BUCKET   – bucket name, e.g. "lyric-videos"
 */

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ObjectPermission,
  type ObjectAclPolicy,
  canAccessObjectByOwner,
} from "./objectAcl";

export { ObjectPermission };
export type { ObjectAclPolicy };

// ─── Supabase admin client (service role — backend only) ─────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getBucket(): string {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!bucket) throw new Error("SUPABASE_STORAGE_BUCKET must be set");
  return bucket;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────
// objectPath stored in DB:  /objects/uploads/<uuid>
// Supabase storage path:    uploads/<uuid>
// Public assets path:       public/<filename>

function toStoragePath(objectPath: string): string {
  // Strip leading /objects/ to get the Supabase storage path
  if (objectPath.startsWith("/objects/")) {
    return objectPath.slice("/objects/".length);
  }
  return objectPath;
}

function toObjectPath(storagePath: string): string {
  if (storagePath.startsWith("/objects/")) return storagePath;
  return `/objects/${storagePath}`;
}

// ─── ObjectStorageService ─────────────────────────────────────────────────────

export class ObjectStorageService {
  /**
   * Generate a presigned upload URL so the browser can PUT a video directly
   * to Supabase Storage without going through our server.
   * Returns the upload URL and the objectPath to store in the DB.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const supabase = getSupabase();
    const bucket = getBucket();
    const objectId = randomUUID();
    const storagePath = `uploads/${objectId}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw new Error(`Failed to create upload URL: ${error?.message}`);
    }

    // Return the full signed upload URL — the frontend XHRs a PUT to this
    return data.signedUrl;
  }

  /**
   * Convert a raw GCS/presigned URL or storage path into the canonical
   * /objects/<path> format stored in the DB.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    // If it's already a /objects/... path, leave it
    if (rawPath.startsWith("/objects/")) return rawPath;

    // If it's a Supabase storage URL, extract the path after the bucket name
    try {
      const url = new URL(rawPath);
      // Supabase URLs look like: .../storage/v1/object/sign/<bucket>/<path>?token=...
      // or: .../storage/v1/object/<bucket>/<path>
      const match = url.pathname.match(/\/object(?:\/sign)?\/[^/]+\/(.+)/);
      if (match) return `/objects/${match[1]}`;
    } catch {
      // not a URL
    }

    return `/objects/${rawPath}`;
  }

  /**
   * Verify an object exists in Supabase Storage and return its storage path.
   * Throws ObjectNotFoundError if not found.
   */
  async getObjectEntityFile(objectPath: string): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const supabase = getSupabase();
    const bucket = getBucket();
    const storagePath = toStoragePath(objectPath);

    const { data, error } = await supabase.storage
      .from(bucket)
      .list(storagePath.split("/").slice(0, -1).join("/"), {
        search: storagePath.split("/").pop(),
      });

    if (error || !data || data.length === 0) {
      throw new ObjectNotFoundError();
    }

    return storagePath;
  }

  /**
   * Download an object and return it as a Node.js Buffer.
   * Used by the auto-post scheduler to load videos for Facebook upload.
   */
  async downloadObjectAsBuffer(objectPath: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const supabase = getSupabase();
    const bucket = getBucket();
    const storagePath = toStoragePath(objectPath);

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(storagePath);

    if (error || !data) {
      throw new Error(`Failed to download object: ${error?.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: data.type || "video/mp4",
    };
  }

  /**
   * Stream an object to an Express response.
   * Used by GET /storage/objects/* to serve videos to the browser.
   */
  async downloadObjectToResponse(objectPath: string, ownerId: string): Promise<Response> {
    const supabase = getSupabase();
    const bucket = getBucket();
    const storagePath = toStoragePath(objectPath);

    // Generate a short-lived signed URL (5 min) and redirect to it
    // This avoids buffering the entire video through our server
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 300); // 5 minute expiry

    if (error || !data) {
      throw new ObjectNotFoundError();
    }

    // Return a redirect response — browser follows it directly to Supabase CDN
    return new Response(null, {
      status: 302,
      headers: { Location: data.signedUrl },
    });
  }

  /**
   * ACL policy stub — in Supabase the bucket is private so only service-role
   * can access it.  We enforce ownership at the application layer via ownerId.
   * This method exists so routes/videos.ts doesn't need to change.
   */
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    // With Supabase Storage + private bucket, no per-object ACL metadata needed.
    // Ownership is tracked in the videos table (ownerId column).
    return this.normalizeObjectEntityPath(rawPath);
  }

  /**
   * Check whether a userId can access an object.
   * For a single-owner private app, we just verify the userId matches the DB owner.
   * The ownerId is passed in because we no longer read it from object metadata.
   */
  async canAccessObjectEntity({
    userId,
    objectOwnerId,
    requestedPermission = ObjectPermission.READ,
  }: {
    userId?: string;
    objectOwnerId: string;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObjectByOwner({
      userId,
      policy: { owner: objectOwnerId, visibility: "private" },
      requestedPermission,
    });
  }

  /**
   * Delete an object from Supabase Storage.
   */
  async deleteObjectEntity(rawPath: string): Promise<void> {
    const supabase = getSupabase();
    const bucket = getBucket();
    const storagePath = toStoragePath(this.normalizeObjectEntityPath(rawPath));

    const { error } = await supabase.storage
      .from(bucket)
      .remove([storagePath]);

    if (error) {
      throw new Error(`Failed to delete object: ${error.message}`);
    }
  }
}
