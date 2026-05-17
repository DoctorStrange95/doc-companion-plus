# CommunityMed Pro — Handover Document

**Date:** 14 May 2026
**Stack:** React + TypeScript SPA (Vercel) · FastAPI (Render free tier) · Supabase (Postgres) · Offline-first localStorage

---

## Architecture Overview

```
Browser (Vercel SPA)
  └── TanStack Router
  └── localStorage store (key: communitymed_pro_v2)
       ├── patients, forms, submissions, worker, queue
       ├── syncing / pulling flags  →  SyncIndicator bar
       └── initDone  →  controls global loading screen
  └── Sync engine (src/lib/store.ts)
       ├── drain()          push queue  →  POST /api/sync/push
       └── pullSnapshot()   GET /api/sync/pull  →  overwrite cache

Backend (Render free tier — cold-starts after ~15 min idle)
  └── FastAPI + Supabase Postgres
  └── /api/auth/*
  └── /api/sync/push  ·  /api/sync/pull
  └── /api/forms/{id}/share-token  ·  /api/forms/{id}/analytics-token
  └── GET /f/{token}  (public form, Cache-Control: max-age=60, must-revalidate)
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Entire offline-first state, sync engine, localStorage persistence |
| `src/lib/auth.tsx` | Auth provider, token management, keep-alive ping |
| `src/lib/api.ts` | Fetch wrapper, token header injection, ApiError class |
| `src/routes/__root.tsx` | Root layout, SyncIndicator bar, AuthShell, loading gate |
| `src/components/AuthGate.tsx` | useAuthGate (action-level sheet) + AuthRequired (page-level inline) |
| `src/routes/f.$token.tsx` | Public form filler with draft caching |
| `src/routes/forms.$id.tsx` | Form detail + share / analytics token management |
| `src/routes/forms.new.tsx` | Form builder with auth-gated save |
| `src/routes/patients.index.tsx` | Patient list — auth-required page |
| `src/routes/patients.$id.tsx` | Patient detail + longitudinal growth charts |
| `src/routes/settings.tsx` | User settings — auth-required page |
| `backend/server.py` | FastAPI: auth, sync push/pull, token endpoints |

---

## What Was Done

### Offline-First Store
- **Seed recovery guard** — if the server returns 0 forms (cold start / network blip), local state is never wiped.
- **Deduplication on load** — forms, patients, submissions are deduplicated by ID on every localStorage read to self-heal accumulated duplicates.
- **Queue collapse** — duplicate upsert ops for the same form/patient ID are collapsed to 1 entry so the queue never bloats.
- **Smart pull-after-drain** — `executeDrain()` only calls `pullSnapshot()` when the batch contains new items (no `ownerId`). Editing an existing record no longer triggers a full pull, reducing API calls by ~2/3 on every save.
- **Three-tier localStorage persist fallback** — on quota exceeded: (1) full write, (2) strip binary strings > 2 KB from submissions, (3) drop submissions entirely. Queue is always preserved.
- **Binary data stripping** — server-synced submissions strip base64 photo/file strings on merge to prevent quota exhaustion.
- **`pulling` flag** — tracks when `pullSnapshot()` is in-flight, separate from `syncing` (push). Both feed the SyncIndicator loading bar.
- **`pulling = !!getToken()` on init** — bar shows from the very first render if a token exists, not only after `/api/auth/me` returns.
- **Full seed reset on logout** — `clearForLogout()` resets to complete seed state so no previous user's data is ever visible on the logged-out home screen.

### Auth & Navigation
- **Instant cached user** — `AuthProvider` initialises from localStorage immediately; no loading screen for returning users.
- **Background token verify** — `/api/auth/me` runs in background; only 401 forces logout, all other errors keep the cached session.
- **Keep-alive ping** — hits `/api/health` every 10 minutes to prevent Render free-tier cold starts while the app is open.
- **Logout redirect** — signing out from any protected page redirects to `/` home.
- **Anonymous access** — tools and form library are fully accessible without login. No blanket redirect for logged-out users.
- **Per-page auth guards** — `patients/`, `patients/$id`, and `settings` show an inline "Sign in required" card with Sign In / Create Account buttons.
- **`forms/new`** — open to all for building; the Save button shows the auth gate sheet if not logged in.

### Loading Bar (SyncIndicator)
- Thin animated bar pinned to the very top of every authenticated page.
- Shows when `store.syncing || store.pulling` is true.
- Dark charcoal color so it is visible on both white pages and the yellow home-page header.
- Appears from the very first render on page load (not after the first API call returns).

### Public Forms
- **Draft caching** — answers auto-save to localStorage with 800 ms debounce. "Resuming from last time" banner on return. Draft cleared on successful submit.
- **Cache header fix** — changed from `stale-while-revalidate=600` to `must-revalidate` so the public filler always sees the latest form version within 60 seconds.

### Form Save Flow
- Eliminated double push on save — replaced separate `sync.pushForm()` with awaiting `sync.drain()`. One network round-trip instead of two.

### Share Link
- Share dialog proactively pushes the form before generating a token, eliminating the 403 → retry loop for seed forms with no `ownerId`.
- Actual server error messages are surfaced in the dialog.
- Background pull after token generation syncs the server-assigned `ownerId`.

### Backend
- Resolved merge conflict in the `sync_pull` endpoint — kept the upstream version using `asyncio.gather` and `shared_resource_ids_both` for concurrent DB queries.
- Fixed `share_token` nullification bug on form update.

---

## Known Limitations

| Area | Notes |
|------|-------|
| **Render cold starts** | Keep-alive ping helps but first load after ~15 min idle can still take 15–30 s. Consider upgrading to a paid Render instance or migrating to Railway / Fly.io. |
| **No periodic background sync** | Data syncs on page load, on every mutation, and on explicit user actions. There is no `setInterval` pull. Open tabs do not auto-refresh. Add a 5-min interval pull if real-time collaboration is needed. |
| **Anonymous user data** | Tools and form library work offline but results are not persisted for anonymous users. |
| **Offline deletion queue** | Patient and form deletes are queued and retried. Submission deletes are fire-and-forget and are not retried if offline. |
| **Binary uploads in local cache** | Photo/file field data > 2 KB is stripped from localStorage after server sync. The server copy is intact but the local preview will show `__binary_stripped__`. |
| **`render.yaml` uncommitted change** | `git status` shows `M render.yaml` — review and commit or discard before the next deployment. |

---

## Suggested Next Steps

1. **Upgrade Render** — free-tier cold starts are the biggest remaining UX pain point.
2. **Periodic background sync** — add a 5-minute `setInterval` pull so open tabs stay fresh without a manual refresh.
3. **Guest / anonymous sessions** — let unregistered users try tools and save results locally, then prompt to create an account to persist data.
4. **Push notifications** — notify the user when a background sync brings in new data.
5. **Test suite expansion** — unit tests for store sync logic; integration tests for the full push/pull cycle.
