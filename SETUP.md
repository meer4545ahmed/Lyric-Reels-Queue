# Lyric Reels Queue — Full Project Guide

This document explains everything about this project: what it does, what is already built, what still needs to be set up, and step-by-step instructions to get it fully running.

---

## What This App Does

This is a private website built for one creator (you). You upload your lyric videos, give each one a title and description, and the app automatically posts them to your Facebook Page as Reels every 3 hours — forever in a loop. When it reaches the last video it starts again from the first.

**The loop works like this:**
- You upload Video A, Video B, Video C
- App posts Video A → waits 3 hours → posts Video B → waits 3 hours → posts Video C → waits 3 hours → posts Video A again → and so on forever
- If you upload a new video it goes to the end of the queue and gets picked up automatically

---

## Tech Stack

| Part | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Backend | Express 5 + Node.js + TypeScript |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (email/password + Facebook OAuth login) |
| Video Storage | Supabase Storage (private bucket) |
| Facebook Auto-posting | Facebook Graph API v22.0 (Resumable Upload API) |
| ORM | Drizzle ORM |
| Package Manager | pnpm workspaces |

---

## Project File Structure

```
Lyric-Reels-Queue/
├── .env                         ← YOUR SECRETS (never commit this)
├── artifacts/
│   ├── api-server/              ← Express backend
│   │   └── src/
│   │       ├── index.ts         ← Server entry, starts scheduler
│   │       ├── app.ts           ← Express setup (no Clerk, no proxy)
│   │       ├── lib/
│   │       │   ├── autoPostScheduler.ts  ← Posts Reels every 3 hours
│   │       │   ├── objectStorage.ts      ← Supabase Storage wrapper
│   │       │   └── logger.ts
│   │       ├── middlewares/
│   │       │   └── requireAuth.ts        ← Supabase JWT verification
│   │       └── routes/
│   │           ├── facebook.ts  ← Facebook OAuth + page management
│   │           ├── videos.ts    ← Video CRUD + queue
│   │           ├── settings.ts  ← Schedule settings
│   │           ├── storage.ts   ← Upload URLs + file serving
│   │           └── health.ts
│   └── lyric-reels/             ← React frontend
│       └── src/
│           └── App.tsx          ← Entire frontend (Supabase Auth UI)
├── lib/
│   ├── db/                      ← Drizzle ORM + schema
│   └── api-client-react/        ← Generated API hooks + custom-fetch
├── SETUP.md                     ← This file
└── pnpm-workspace.yaml
```

---

## What Is Already Built (Code Complete)

### Auth
- ✅ Supabase Auth — email/password sign in + Facebook OAuth login
- ✅ Single-owner enforcement — first user to sign in claims the space
- ✅ Session token automatically sent with every API request via Bearer header

### Backend
- ✅ All video CRUD + queue rotation endpoints
- ✅ Facebook OAuth connect/callback/page-select/disconnect
- ✅ Auto-post scheduler (every 60s, posts when due)
- ✅ Supabase Storage for video upload/download/delete
- ✅ Schedule settings (3-hour interval, timezone, on/off)

### Frontend
- ✅ Landing page
- ✅ Sign In / Sign Up pages with Supabase Auth UI (includes Facebook login button)
- ✅ Dashboard (next video, auto-posting status)
- ✅ Library (upload, edit, delete, preview)
- ✅ Schedule page (enable schedule, connect Facebook Page)

---

## What Still Needs To Be Done Before The App Works

### STEP 1 — Set up Supabase Storage bucket

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/bludbzavbonfysdxiirw
2. Click **Storage** in the left sidebar
3. Click **New bucket**
4. Name it exactly: `lyric-videos`
5. Set it to **Private** (not public)
6. Click **Create bucket**

### STEP 2 — Get your database connection string

1. In Supabase dashboard → **Settings** → **Database**
2. Under **Connection string** → choose **URI**
3. Choose **Session pooler** (not direct connection)
4. Copy the string — it looks like:
   ```
   postgresql://postgres.bludbzavbonfysdxiirw:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with your Supabase database password

### STEP 3 — Fill in your .env file

Open the `.env` file in the root of this project and:
1. Replace `DATABASE_URL` with the connection string from Step 2
2. Replace `APP_BASE_URL` with your actual deployed URL (fill this in after you deploy)

The other values in `.env` are already filled in.

### STEP 4 — Enable Facebook as a login provider in Supabase

1. Go to Supabase dashboard → **Authentication** → **Providers**
2. Find **Facebook** and click to expand
3. Enter:
   - **Facebook App ID**: `1144368468562714`
   - **Facebook App Secret**: `b80dd640d48e7af3feb2b90bdcab7e56`
4. Copy the **Callback URL** shown (looks like `https://bludbzavbonfysdxiirw.supabase.co/auth/v1/callback`)
5. Go to https://developers.facebook.com/apps/1144368468562714 → **Facebook Login** → **Settings**
6. Add that callback URL to **Valid OAuth Redirect URIs**
7. Click **Save**

### STEP 5 — Run the database migration

In a terminal at the project root:
```bash
pnpm --filter @workspace/db run push
```

This creates all 4 database tables including the new `lyric_reels_facebook` table.

### STEP 6 — Install packages

```bash
pnpm install
```

### STEP 7 — Deploy

Deploy to any platform that supports Node.js (Railway, Render, Fly.io, etc).  
Set all the environment variables from `.env` on your deployment platform.  
Update `APP_BASE_URL` in your env vars to the actual deployed URL.

Then add your deployed URL to the Facebook app's **Valid OAuth Redirect URIs**:
```
https://your-deployed-url.com/api/facebook/callback
```

### STEP 8 — First use

1. Open your deployed app URL
2. Click **Sign in with Facebook** (or email/password)
3. Go to **Schedule** → **Connect Facebook**
4. Select your **Cwimisics** page (or whatever your Facebook Page is named)
5. Turn schedule **ON**
6. Go to **Library** → upload your lyric videos with titles and descriptions
7. Done — the app will post every 3 hours automatically forever

---

## How Facebook Login Works (Important)

There are TWO separate Facebook connections in this app:

| What | Purpose |
|---|---|
| **Facebook login (Sign in with Facebook)** | Logs you into the Reelkeeper website. Handled by Supabase Auth. |
| **Facebook Page connection (on Schedule page)** | Grants permission to post Reels to your Page. Handled by our Facebook OAuth routes. |

You need BOTH. The login gets you into the website. The Page connection lets the auto-poster publish your videos.

---

## Environment Variables Reference

| Variable | Where to get it | Used by |
|---|---|---|
| `SUPABASE_URL` | Supabase dashboard → Settings → API | Backend |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API | Backend |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API | Backend (JWT verification) |
| `SUPABASE_STORAGE_BUCKET` | The bucket name you created (lyric-videos) | Backend |
| `DATABASE_URL` | Supabase dashboard → Settings → Database | Backend (Drizzle ORM) |
| `VITE_SUPABASE_URL` | Same as SUPABASE_URL | Frontend (Vite build) |
| `VITE_SUPABASE_ANON_KEY` | Same as SUPABASE_ANON_KEY | Frontend (Vite build) |
| `PORT` | Set to 3000 or whatever your host assigns | Backend |
| `BASE_PATH` | Set to / | Both |
| `APP_BASE_URL` | Your deployed URL | Backend (Facebook OAuth callback) |
| `FACEBOOK_APP_ID` | Facebook Developer Console | Backend |
| `FACEBOOK_APP_SECRET` | Facebook Developer Console | Backend |

---

## For the Next AI / Developer

### Migration completed in this project
The entire codebase was migrated FROM Clerk + Replit/GCS TO Supabase Auth + Supabase Storage.

**What changed:**
1. `artifacts/api-server/package.json` — removed `@clerk/express`, `@clerk/shared`, `@google-cloud/storage`, `google-auth-library`, `http-proxy-middleware`; added `@supabase/supabase-js`
2. `artifacts/lyric-reels/package.json` — removed `@clerk/react`, `@clerk/themes`; added `@supabase/supabase-js`, `@supabase/auth-ui-react`, `@supabase/auth-ui-shared`
3. `artifacts/api-server/src/middlewares/requireAuth.ts` — uses `supabase.auth.getUser(token)` to verify Bearer tokens
4. `artifacts/api-server/src/app.ts` — no Clerk middleware, no proxy, plain Express
5. `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` — DELETED
6. `artifacts/api-server/src/lib/objectStorage.ts` — full rewrite using Supabase Storage SDK (createSignedUploadUrl, createSignedUrl, download, remove)
7. `artifacts/api-server/src/lib/objectAcl.ts` — simplified, no GCS metadata, just owner-match check
8. `artifacts/api-server/src/routes/storage.ts` — updated for new objectStorage API
9. `artifacts/api-server/src/lib/autoPostScheduler.ts` — uses `downloadObjectAsBuffer` instead of GCS stream
10. `artifacts/lyric-reels/src/App.tsx` — full rewrite: Supabase Auth, `@supabase/auth-ui-react` for sign-in/sign-up, `useAuth()` context instead of `useUser()`/`useClerk()`
11. `artifacts/lyric-reels/vite.config.ts` — removed all Replit plugins, simplified

**Auth flow:**
- Frontend: Supabase JS client handles sign-in/sign-up (incl. Facebook OAuth via Supabase)
- On every API request: `setAuthTokenGetter` in custom-fetch sends `Authorization: Bearer <supabase-session-token>`
- Backend: `requireAuth.ts` calls `supabase.auth.getUser(token)` with the service role key
- Single-owner claim: stored in `lyric_reels_owner` table (id=1, ownerId=supabase-user-uuid)

**Storage flow:**
- Upload: frontend calls `POST /api/storage/uploads/request-url` → gets Supabase signed upload URL → XHRs directly to Supabase
- Serve: `GET /api/storage/objects/*` → generates a 5-minute signed URL → 302 redirect to Supabase CDN
- Scheduler download: `ObjectStorageService.downloadObjectAsBuffer()` uses `supabase.storage.from(bucket).download(path)`

### Known pending items (not yet done by any AI)
1. **Supabase Storage bucket** — must be created manually in the Supabase dashboard (bucket name: `lyric-videos`, private)
2. **DATABASE_URL** — must be filled in `.env` with the actual Supabase connection string
3. **DB migration** — `pnpm --filter @workspace/db run push` not yet run
4. **Facebook provider in Supabase** — must be enabled in Supabase Auth dashboard
5. **Facebook app Live mode** — must be switched from Development to Live in Meta Developer Console
6. **APP_BASE_URL** — must be set to actual deployed URL after deployment
