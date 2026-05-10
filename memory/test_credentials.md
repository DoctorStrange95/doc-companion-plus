# CommunityMed Pro — Test Credentials

## Admin (auto-seeded on backend startup)
- **Email**: `admin@communitymed.app`
- **Password**: `admin12345`
- **Role**: `admin`

## Test user (created via API during smoke tests)
- **Email**: `chw1@example.com`
- **Password**: `pass1234`
- **Role**: `worker`

## Auth endpoints
- POST `/api/auth/register` — `{email, password, name}`
- POST `/api/auth/login`    — `{email, password}` → `{access_token, user}`
- POST `/api/auth/logout`   — clears cookie (auth required)
- GET  `/api/auth/me`       — current user (auth required)

## Resource endpoints (auth required)
- GET/POST/DELETE `/api/patients[/{id}]`
- GET/POST/DELETE `/api/forms[/{id}]`
- GET/POST `/api/submissions`
- GET/POST/DELETE `/api/shares[/{share_id}]`  — share patient/form by email
- POST `/api/sync/push` — bulk upsert (offline queue drain)
- GET  `/api/sync/pull` — full visible snapshot

## Tokens
JWT access tokens are valid for 7 days. The frontend stores them under
`localStorage` key `communitymed_pro_token_v1` and sends them via the
`Authorization: Bearer <token>` header on every API call.

## Database
Supabase Postgres (Transaction Pooler, port 6543). Tables: `users`,
`patients`, `forms`, `submissions`, `shares`. Created automatically by
SQLAlchemy `Base.metadata.create_all` on backend startup.
