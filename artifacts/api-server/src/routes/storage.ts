import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { authenticatedUserId, requireAuth } from '../middlewares/requireAuth';
import { ObjectPermission } from '../lib/objectAcl';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Returns a Supabase presigned upload URL so the browser can PUT the video
 * file directly to Supabase Storage (never goes through our server).
 */
router.post(
  '/storage/uploads/request-url',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      if (!contentType.startsWith('video/') || size > 2_147_483_647) {
        res.status(400).json({ error: 'Choose a video smaller than 2 GB' });
        return;
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serves private video files. Generates a short-lived Supabase signed URL
 * and redirects the browser to it — the video streams directly from Supabase CDN.
 * Requires the caller to be the authenticated owner.
 */
router.get(
  '/storage/objects/*path',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const userId = authenticatedUserId(req);

      // Verify the object exists
      await objectStorageService.getObjectEntityFile(objectPath);

      // ACL check — in single-owner mode, the authenticated user IS the owner
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId,
        objectOwnerId: userId, // single-owner: requester == owner
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const response = await objectStorageService.downloadObjectToResponse(
        objectPath,
        userId,
      );

      // Relay the redirect from Supabase (302 + Location header)
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      req.log.error({ err: error }, 'Error serving object');
      res.status(500).json({ error: 'Failed to serve object' });
    }
  },
);

export default router;
