# Lyric Reels Queue — Full Project Guide

This document explains everything about this project: what it does, what is already built, what still needs to be set up, and step-by-step instructions to get it fully running.

---

## What This App Does

This is a private website built for one creator (you). You upload your lyric videos, give each one a title and description, and the app automatically posts them to your Facebook Page as Reels every 3 hours — forever in a loop. When it reaches the last video it starts again from the first.

**The loop works like this:**
- You upload Video A, Video B, Video C
- App posts Video A → waits 3 hours → posts Video B → waits 3 hours → posts Video C → waits 3 hours → posts Video A again → and so on forever
- If you upload a new video it goes to the end of the queue and gets picked up automatically
- You can skip a video, mark one as posted manually, or pause the schedule any time

---

## Tech Stack (What the App is Built With)

| Part | Technology |
|---|---|
| Frontend (the website UI) | React 19 + Vite + TypeScript |
| Backend (the server) | Express 5 + Node.js + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Login / Auth | Clerk (email and password) |
| Video Storage | Google Cloud Storage (via Replit Object Storage) |
| Facebook Integration | Facebook Graph API v22.0 |
| Package Manager | pnpm (workspaces / monorepo) |

---

## Project File Structure

```
Lyric-Reels-Queue/
├── artifacts/
│   ├── api-server/          ← The backend Express server
│   │   └── src/
│   │       ├── index.ts     ← Server entry point, starts scheduler
│   │       ├── app.ts       ← Express app setup, middleware
│   │       ├── lib/
│   │       │   ├── autoPostScheduler.ts   ← THE AUTO-POSTER (runs every 60s)
│   │       │   ├── objectStorage.ts       ← Google Cloud Storage helpers
│   │       │   └── logger.ts
│   │       ├── middlewares/
│   │       │   ├── requireAuth.ts         ← Single-owner enforcement via Clerk
│   │       │   └── clerkProxyMiddleware.ts
│   │       └── routes/
│   │           ├── index.ts     ← Mounts all routers
│   │           ├── facebook.ts  ← Facebook OAuth + page management
│   │           ├── videos.ts    ← Video CRUD + queue logic
│   │           ├── settings.ts  ← Schedule settings
│   │           ├── storage.ts   ← File upload URLs + file serving
│   │           └── health.ts    ← Health check endpoint
│   └── lyric-reels/         ← The frontend React app
│       └── src/
│           └── App.tsx      ← ENTIRE frontend in one file (all pages + components)
├── lib/
│   ├── db/                  ← Database schema + Drizzle connection
│   │   └── src/schema/
│   │       └── lyric-reels.ts   ← All 4 database tables
│   ├── api-spec/
│   │   └── openapi.yaml     ← API contract (source of truth)
│   ├── api-zod/             ← Auto-generated Zod validators (from openapi.yaml)
│   └── api-client-react/    ← Auto-generated React Query hooks (from openapi.yaml)
├── SETUP.md                 ← This file
└── pnpm-workspace.yaml
```

---

## Database Tables

Four tables in PostgreSQL:

### `lyric_reels_owner`
Stores who owns this private space. Only ever has 1 row. The first person to sign in becomes the owner. No one else can access the app.

| Column | Purpose |
|---|---|
| id | Always 1 |
| owner_id | Clerk user ID of the owner |

### `lyric_reels_videos`
Every video you upload.

| Column | Purpose |
|---|---|
| id | Auto-increment |
| owner_id | Who uploaded it |
| title | The Reel title |
| description | The Reel caption |
| original_filename | Original file name |
| object_path | Where it's stored in GCS |
| mime_type | e.g. video/mp4 |
| size_bytes | File size |
| uploaded_at | When it was uploaded |
| last_posted_at | When it was last posted to Facebook |
| posted_count | How many times it has been posted |

### `lyric_reels_schedule_settings`
The posting schedule configuration.

| Column | Purpose |
|---|---|
| owner_id | Who this belongs to |
| enabled | Is auto-posting on or off |
| interval_hours | Hours between posts (default: 3) |
| timezone | Your local timezone |
| next_post_at | When the next post is due |
| last_posted_at | When the last post happened |
| next_video_id | Which video posts next |

### `lyric_reels_facebook` ← NEW (added in this session)
Your Facebook connection details.

| Column | Purpose |
|---|---|
| user_access_token | Long-lived Facebook user token (60 days) |
| page_access_token | Page-level token (never expires) |
| page_id | Your Facebook Page ID |
| page_name | Your Facebook Page name |
| view_insights_available | Whether insights permission was granted |
| auto_posting_enabled | Whether auto-posting is currently active |
| last_error | Last error message if a post failed |
| connected_at | When Facebook was connected |

---

## What Is Already Built (Code Complete)

### Backend
- ✅ `GET /api/facebook/status` — returns connection status, selected page, next post time, last error
- ✅ `POST /api/facebook/connect` — generates Facebook OAuth URL
- ✅ `GET /api/facebook/callback` — receives OAuth code, exchanges for long-lived token, saves to DB
- ✅ `PUT /api/facebook/page` — select which Facebook Page to post to
- ✅ `DELETE /api/facebook/connection` — disconnect Facebook, pause schedule
- ✅ `GET /api/videos` — list all videos in queue order
- ✅ `POST /api/videos` — add video to queue after upload
- ✅ `PATCH /api/videos/:id` — edit title/description
- ✅ `DELETE /api/videos/:id` — remove from queue and storage
- ✅ `POST /api/videos/:id/posted` — mark as posted, advance queue
- ✅ `POST /api/videos/:id/skip` — skip video for this cycle
- ✅ `GET /api/settings` — get schedule config
- ✅ `PUT /api/settings` — update schedule config
- ✅ `POST /api/storage/uploads/request-url` — get presigned upload URL
- ✅ Auto-poster scheduler (runs every 60 seconds, posts when due)
- ✅ Single-owner enforcement (only you can use the app)

### Frontend
- ✅ Landing page (public)
- ✅ Sign in / Sign up pages (Clerk)
- ✅ Dashboard (today's next video, auto-posting status, rhythm card)
- ✅ Library page (upload videos, set title/description, preview, delete, edit)
- ✅ Schedule page (enable/disable schedule, timezone, Facebook connect/disconnect/page select)
- ✅ Full Facebook connection UI (connect button, page picker, disconnect, error display)

### How the Auto-Poster Works
`artifacts/api-server/src/lib/autoPostScheduler.ts` runs every 60 seconds:
1. Finds the owner in the database
2. Checks if schedule is enabled AND current time is past `next_post_at`
3. Checks Facebook Page is connected
4. Downloads the next video from Google Cloud Storage into memory
5. Uploads it to Facebook using the Resumable Upload API (handles large files in chunks)
6. Marks it as posted in the database
7. Advances the queue pointer to the next video (wraps to start after last)
8. Sets `next_post_at = now + 3 hours`
9. If anything fails, saves the error message to `last_error` so you can see it on the Dashboard

---

## What Still Needs To Be Done

### BLOCKER 1 — Run the Database Migration
The new `lyric_reels_facebook` table has been added to the schema code but has NOT been created in the actual database yet. The app will crash when you try to connect Facebook until this is done.

**Command to run (once, in your terminal):**
```bash
pnpm --filter @workspace/db run push
```

### BLOCKER 2 — Set Environment Variables
These must be set on your deployment platform:

```
FACEBOOK_APP_ID=1144368468562714
FACEBOOK_APP_SECRET=b80dd640d48e7af3feb2b90bdcab7e56
APP_BASE_URL=https://your-deployed-url.com
```

The ones that should already be set (from before):
```
DATABASE_URL=your-postgres-connection-string
PORT=3000 (or whatever your platform assigns)
CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
PRIVATE_OBJECT_DIR=...
PUBLIC_OBJECT_SEARCH_PATHS=...
```

### BLOCKER 3 — Add Callback URL to Facebook Developer Console
1. Go to: https://developers.facebook.com/apps/1144368468562714
2. Click **Facebook Login** → **Settings**
3. Under **Valid OAuth Redirect URIs** add:
   ```
   https://your-deployed-url.com/api/facebook/callback
   ```
4. Save changes

### BLOCKER 4 — Set Facebook App to Live Mode
1. In the Facebook Developer Console
2. At the top of the page find the toggle that says **In development**
3. Switch it to **Live**
4. This is required so the OAuth flow works for real (not just for you as the developer)

---

## Step-by-Step Setup Guide (Simple Version)

### Step 1 — Deploy the App
You need a live URL. If you are on Replit:
1. Open your Replit workspace
2. Click the **Deploy** button (top right)
3. Choose **Autoscale** or **Reserved VM**
4. Wait for deployment — you'll get a URL like `https://lyric-reels-queue.yourname.repl.co`

### Step 2 — Set Environment Variables on Replit
1. In your Replit workspace click **Secrets** (the padlock icon on the left sidebar)
2. Add these one by one:
   - Name: `FACEBOOK_APP_ID` → Value: `1144368468562714`
   - Name: `FACEBOOK_APP_SECRET` → Value: `b80dd640d48e7af3feb2b90bdcab7e56`
   - Name: `APP_BASE_URL` → Value: your deployed URL (e.g. `https://lyric-reels-queue.yourname.repl.co`)

### Step 3 — Run the Database Migration
In the Replit Shell tab run:
```bash
pnpm --filter @workspace/db run push
```
You should see something like `✓ Changes applied`. This creates the Facebook connection table.

### Step 4 — Configure Facebook Developer Console
1. Go to: https://developers.facebook.com/apps/1144368468562714
2. On the left sidebar click **Facebook Login** → **Settings**
3. In the **Valid OAuth Redirect URIs** box paste:
   ```
   https://your-deployed-url.com/api/facebook/callback
   ```
   (replace with your actual URL from Step 1)
4. Click **Save Changes**
5. At the top of the page switch the app from **In development** to **Live**

### Step 5 — Connect Your Facebook Page in the App
1. Open your deployed app URL in the browser
2. Sign in (create an account with email and password — this is your Clerk account for the app, not Facebook)
3. Go to the **Schedule** page (click Schedule in the sidebar)
4. Click **Connect Facebook**
5. A Facebook popup will appear — log in and click **Allow/Continue**
6. Back in the app, your **Cwimisics** page should appear — select it
7. Turn the schedule **ON**
8. Save

### Step 6 — Upload Your Videos
1. Go to the **Library** page
2. Click **Add videos**
3. Select your lyric video files (up to 2 GB each, multiple at once)
4. Give each one a title and description (this becomes the Reel caption on Facebook)
5. Click **Upload**

### Step 7 — Done
The app will now post the first video to your Cwimisics Facebook Page, then wait 3 hours, then post the next one, and so on forever. When it reaches the last video it loops back to the first.

---

## Facebook Page Notes

- You are posting to your **Cwimisics** Facebook Page (not your personal profile)
- Facebook's API does not allow posting to personal profiles — Pages only (this is Facebook's rule, cannot be changed)
- Your personal profile (Livia Lyric) with 10k followers stays untouched
- Recommended: post once on your personal profile telling followers to follow the Cwimisics Page
- The Cwimisics Page is where all automated Reels will appear

---

## How the Queue / Loop Works

Videos are ordered by when they were uploaded (oldest first). The queue pointer (`next_video_id`) advances after each post:

```
Upload order:  Video 1 → Video 2 → Video 3 → Video 4
Post order:    Video 1 → Video 2 → Video 3 → Video 4 → Video 1 → Video 2 → ...
                                                         (loops back)
```

If you upload a new video while the loop is running, it goes to the end and gets picked up on the next cycle.

If you skip a video, the pointer moves forward without posting it.

If you delete a video, the pointer automatically moves to the next available one.

---

## What Happens If a Post Fails

If the Facebook upload fails for any reason (network issue, token expired, etc.):
- The error message is saved to the database
- It shows up on the Dashboard under the rhythm card as a red error message
- The queue pointer does NOT advance — it will retry the same video on the next tick (60 seconds later)
- Common fix: go to Schedule page, disconnect Facebook, reconnect it (refreshes the token)

---

## Facebook Token Expiry

- The user access token lasts **60 days**
- The page access token **never expires** as long as you don't revoke it
- If the user token expires you'll see an error on the Dashboard
- Fix: go to Schedule → Disconnect Facebook → Connect Facebook again

---

## For the Next AI / Developer

### What was built in the last session
1. `lib/db/src/schema/lyric-reels.ts` — added `facebookConnectionTable`
2. `artifacts/api-server/src/routes/facebook.ts` — new file, all Facebook OAuth + page endpoints
3. `artifacts/api-server/src/lib/autoPostScheduler.ts` — new file, the background posting engine
4. `artifacts/api-server/src/routes/index.ts` — added `facebookRouter`
5. `artifacts/api-server/src/index.ts` — added `startAutoPostScheduler()` call after server starts
6. `artifacts/lyric-reels/src/App.tsx` — Dashboard updated to show auto-posting status

### What the next developer needs to know
- The DB migration (`pnpm --filter @workspace/db run push`) has NOT been run yet — this is the first thing to do
- The Facebook app credentials and `APP_BASE_URL` env vars are not set yet
- The Facebook app is likely still in Development mode in the Meta Developer Console
- The `autoPostScheduler` uses the Facebook Resumable Upload API for large files — this is correct for 600 MB videos
- The scheduler runs as a `setInterval` inside the Node.js process — it is NOT a separate cron job or worker
- All Facebook API calls use Graph API v22.0
- The app is single-owner by design — the first person to sign in claims the space
- `requireAuth` middleware enforces this — any second user gets a 403
- The frontend entire app is in one file: `artifacts/lyric-reels/src/App.tsx`
- API types are generated from `lib/api-spec/openapi.yaml` using Orval — run `pnpm --filter @workspace/api-spec run codegen` after changing the spec

### Known issues / pre-existing
- `artifacts/api-server/src/routes/videos.ts` lines 53 and 61 have a pre-existing `TS7006` implicit-any TypeScript warning — not introduced by our changes, not a blocker
- TypeScript `TS6305` errors when running `tsc` locally are because `lib/db` and `lib/api-zod` are source-only packages that need to be built first — not a real error, everything works on Replit

---

## Summary

| Item | Status |
|---|---|
| Video upload and library | ✅ Complete |
| Queue rotation (FIFO, infinite loop) | ✅ Complete |
| 3-hour auto-post scheduler | ✅ Complete |
| Facebook OAuth connect flow | ✅ Complete |
| Facebook Page selection | ✅ Complete |
| Auto-post Reels to Facebook | ✅ Complete |
| Dashboard auto-posting status | ✅ Complete |
| Database migration run | ❌ Needs to be done |
| Environment variables set | ❌ Needs to be done |
| Facebook callback URL registered | ❌ Needs to be done |
| Facebook app set to Live mode | ❌ Needs to be done |
| App deployed to live URL | ❌ Needs to be done |
