# CommunityMed Pro — PRD

## Original problem statements (chronological)
1. "in the form builder we cant add options for select one / select multiple / skip logic / location input / longitudinal tracking. 2nd in the growth chart include MUAC, also add other types of growth charts mentioned in prd."
2. "within preformed forms allow user to add new patient / search from already saved patients, in any preformed forms available."
3. "integrate with a database to save user data" — **Supabase Postgres**, login auth, hybrid offline-first sync, per-user accounts with sharing capability.

## Stack
- **Frontend**: TanStack Start + React + Vite + Tailwind v4 + Recharts (Cloudflare Worker target).
- **Backend**: FastAPI on `:8001` (supervisor) + SQLAlchemy async + asyncpg.
- **DB**: Supabase Postgres (Transaction Pooler, port 6543).
- **Auth**: custom email/password + JWT (7-day access tokens, Bearer header).
- **Sync**: hybrid — every mutation written to localStorage cache and queued to `/api/sync/push`; queue auto-drains when `online` event fires AND a JWT is present.

## Implemented (2026-01)

### Form builder
- New field types: **Select One** (radio), **Select Many** (multiselect), **Location** (GPS via `navigator.geolocation`).
- Per-form **Longitudinal tracking** flag (form is repeatable; surfaces "prior visits" pill-row in the fill view).
- Per-field **Skip logic** with multi-rule evaluation (mode `all`/`any`; ops `eq`/`neq`/`gt`/`lt`/`contains`).
- Hidden fields are excluded from validation and submission payload.

### Patient picker (in every preformed form)
- Searchable list (name / village / phone / tags) with most-recent first.
- Inline "Add new patient" mini-form (name, DOB, sex, village, phone) → auto-selects on save.
- Replaces the prior plain `<select>`.

### Growth chart
- Six tabs: **Weight-for-age**, **Height/Length-for-age**, **Weight-for-height**, **BMI-for-age (5–19y)**, **MUAC-for-age**, **Head-circumference-for-age**.
- Per-chart inputs and points retained per tab; sex toggle (boys/girls).
- Chart-specific classifications (incl. MUAC SAM <11.5 / MAM <12.5, stunting, micro/macrocephaly).
- WHO reference data centralised in `/app/src/lib/who-growth.ts` (approximated for MVP).

### Auth + database
- Tables: `users`, `patients`, `forms`, `submissions`, `shares` (auto-created via SQLAlchemy on lifespan).
- Endpoints:
  - `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`.
  - `GET/POST/DELETE /api/patients[/{id}]`, `/api/forms[/{id}]`, `GET/POST /api/submissions`.
  - `POST /api/shares` (share by email; resource type = `patient` or `form`; `can_edit` flag) · `GET /api/shares` · `DELETE /api/shares/{id}`.
  - `POST /api/sync/push` (bulk upsert), `GET /api/sync/pull` (full visible snapshot).
- Owner-only delete; sharing grants read by default and write iff `can_edit=true`.
- Auth precedence: **Authorization: Bearer** header beats stale cookies (fixed in iteration 1).
- Supabase Transaction Pooler stability fixes in `/app/backend/database.py`: `NullPool` + `prepared_statement_cache_size=0` + randomized prepared-statement names.

### Frontend wiring
- `/app/src/lib/api.ts` — `fetch` wrapper, base URL via `VITE_BACKEND_URL` (otherwise same-origin via Vite dev proxy → `:8001`).
- `/app/src/lib/auth.tsx` — React context: `user`, `login`, `register`, `logout`. Hydrates `/api/auth/me` on mount.
- `/app/src/lib/store.ts` — REWRITTEN: localStorage cache + queued mutation sync. Pulls server snapshot on login and on `online` event.
- `/app/src/routes/login.tsx` — sign-in / register form.
- `/app/src/routes/__root.tsx` — wraps app in `AuthProvider`; redirects unauthenticated users to `/login`.
- `/app/src/routes/settings.tsx` — sync status, "Sync now" button, signed-in panel with sign-out.

## Test coverage
- 19/19 backend pytest tests passing (`/app/backend/tests/test_communitymed_backend.py`).
- Manual frontend e2e verified via screenshots: login → snapshot pulled → settings shows synced state.

## Backlog / Next
- P1 Front-end "Share" UI on patient & form detail pages (backend already supports it).
- P1 Conflict resolution if same row is edited offline by both owner and shared editor.
- P2 Plot longitudinal-form submissions as per-patient trend mini-chart.
- P2 Replace approximated WHO bands with full LMS-based exact z-scores.
- P2 Move from `Base.metadata.create_all` to Alembic migrations.
- P2 Proper 201/204 status codes; remove unused cookie path now that Bearer is canonical.
