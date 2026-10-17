/**
 * objectAcl.ts — simplified ACL for Supabase Storage
 *
 * With Supabase Storage + a private bucket, access control is handled by
 * Row Level Security policies on the storage.objects table.  We enforce
 * single-owner access at the application layer here: every protected object
 * is owned by the one registered owner, so we just verify the requesting
 * userId matches the stored ownerId.
 *
 * The ObjectAclPolicy, ObjectPermission, and ObjectNotFoundError types are
 * kept so the rest of the codebase (routes/storage.ts, routes/videos.ts)
 * does not need to change.
 */

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export function canAccessObjectByOwner({
  userId,
  policy,
  requestedPermission = ObjectPermission.READ,
}: {
  userId?: string;
  policy: ObjectAclPolicy | null;
  requestedPermission?: ObjectPermission;
}): boolean {
  if (!policy) return false;
  if (policy.visibility === "public" && requestedPermission === ObjectPermission.READ) {
    return true;
  }
  if (!userId) return false;
  return policy.owner === userId;
}
