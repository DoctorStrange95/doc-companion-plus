"""CommunityMed Pro — FastAPI backend (Supabase Postgres)."""

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import asyncio
import os
import json
import secrets
import smtplib
import ssl
import uuid
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Optional, Literal
from contextlib import asynccontextmanager
from types import SimpleNamespace

from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, or_, and_, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from database import get_db, engine, AsyncSessionLocal, Base
from models import User, Patient, FormDef, Submission, Share
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)


def _parse_dt(s: "str | None") -> datetime:
    """Parse an ISO-8601 string (including Z-suffix) to a naive UTC datetime.
    asyncpg requires datetime objects for TIMESTAMPTZ columns, not strings."""
    if not s:
        return datetime.utcnow()
    return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)


# ============================================================================
# Lifespan: create tables (Alembic-equivalent) + seed admin
# ============================================================================
async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@communitymed.app").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin12345")
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User).where(User.email == admin_email))
        existing = res.scalar_one_or_none()
        if existing is None:
            db.add(
                User(
                    email=admin_email,
                    password_hash=hash_password(admin_password),
                    name="Admin",
                    role="admin",
                )
            )
            await db.commit()
        elif not verify_password(admin_password, existing.password_hash):
            existing.password_hash = hash_password(admin_password)
            await db.commit()


async def ensure_user_profile_columns():
    # Keep existing Supabase databases compatible with newer auth fields.
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NOT NULL DEFAULT ''")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS best_suited_role VARCHAR(64) NOT NULL DEFAULT ''")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(16) NOT NULL DEFAULT 'free'")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128)")
        )


async def ensure_longitudinal_table():
    """Create longitudinal_submissions table if it doesn't exist."""
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS longitudinal_submissions (
                id TEXT PRIMARY KEY,
                form_id TEXT NOT NULL,
                owner_id UUID REFERENCES users(id),
                subject_key TEXT NOT NULL,
                fixed_data JSONB NOT NULL DEFAULT '{}',
                visits JSONB NOT NULL DEFAULT '[]',
                patient_id TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_long_subs_owner_id ON longitudinal_submissions(owner_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_long_subs_form_id ON longitudinal_submissions(form_id)"
        ))


async def ensure_form_extra_columns():
    """Add extra columns to forms table if missing (safe to run on every startup)."""
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active'"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS analytics_token VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS form_role VARCHAR(16) NOT NULL DEFAULT 'standalone'"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS parent_form_id VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS subject_identifier_field_id VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS parent_link_field_id VARCHAR(64)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_forms_share_token ON forms(share_token) WHERE share_token IS NOT NULL"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_forms_analytics_token ON forms(analytics_token) WHERE analytics_token IS NOT NULL"))
        await conn.execute(text("ALTER TABLE shares ADD COLUMN IF NOT EXISTS can_fill BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE shares ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE shares ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS allowed_filler_emails JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(256)"))
        await conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_patients_share_token ON patients(share_token) WHERE share_token IS NOT NULL"))
        # Composite index on shares(shared_with, resource_type) — replaces the
        # old single-column ix_shares_shared_with for the most common query pattern.
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_shares_shared_with_type "
            "ON shares(shared_with, resource_type)"
        ))


async def ensure_user_profile_columns_in_session(db: AsyncSession):
    # Fallback for environments where lifespan hooks may not run consistently.
    try:
        await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS best_suited_role VARCHAR(64) NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(16) NOT NULL DEFAULT 'free'"))
        await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE"))
        await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128)"))
        await db.commit()
    except Exception:
        await db.rollback()


async def fetch_user_legacy_by_email(db: AsyncSession, email: str):
    row = (
        await db.execute(
            text(
                "SELECT id, email, password_hash, name, role, "
                "COALESCE(phone, '') AS phone, "
                "COALESCE(best_suited_role, '') AS best_suited_role, "
                "COALESCE(email_verified, TRUE) AS email_verified, "
                "email_verification_token "
                "FROM users WHERE lower(email) = :email LIMIT 1"
            ),
            {"email": email.lower()},
        )
    ).mappings().first()
    if not row:
        return None
    return SimpleNamespace(
        id=str(row["id"]),
        email=row["email"],
        password_hash=row["password_hash"],
        name=row["name"] or "",
        role=row["role"] or "worker",
        phone=row["phone"] or "",
        best_suited_role=row["best_suited_role"] or "",
        email_verified=bool(row["email_verified"]),
        email_verification_token=row.get("email_verification_token"),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if missing (idempotent). Alembic migrations are the long-term path.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_user_profile_columns()
    try:
        await ensure_form_extra_columns()
    except Exception as e:
        print(f"[ensure_form_extra_columns] warning: {e}")
    try:
        await ensure_longitudinal_table()
    except Exception as e:
        print(f"[ensure_longitudinal_table] warning: {e}")
    try:
        await seed_admin()
    except Exception as e:  # noqa: BLE001
        print(f"[seed_admin] warning: {e}")
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT FALSE
                )
            """))
    except Exception as e:
        print(f"[password_reset_tokens] warning: {e}")
    yield


app = FastAPI(title="CommunityMed Pro API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened by ingress; client uses same-origin
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure unhandled 500 errors still carry CORS headers so the browser
# reports the actual HTTP status rather than a network error.
from fastapi.responses import JSONResponse
from fastapi import Request as _Request

@app.exception_handler(Exception)
async def _unhandled_exception_handler(_req: _Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers={"Access-Control-Allow-Origin": "*"},
    )


# ============================================================================
# Schemas
# ============================================================================
class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    phone: str
    best_suited_role: str
    role: str
    email_verified: bool = True

    model_config = {"from_attributes": True}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=32)
    best_suited_role: str = Field(default="", max_length=64)
    proof_token: Optional[str] = None  # OTP proof from /api/auth/verify-register-otp


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class GoogleAuthConfig(BaseModel):
    enabled: bool


def to_user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name or "",
        phone=getattr(user, "phone", "") or "",
        best_suited_role=getattr(user, "best_suited_role", "") or "",
        role=user.role or "worker",
        email_verified=bool(getattr(user, "email_verified", True)),
    )


class PatientIn(BaseModel):
    id: Optional[str] = None
    name: str
    dob: str
    sex: Literal["Male", "Female", "Other"]
    village: str
    phone: Optional[str] = None
    guardian_name: Optional[str] = None
    tags: list[str] = []
    status: str = "Active"


class PatientOut(PatientIn):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    shared: bool = False
    share_token: Optional[str] = None

    model_config = {"from_attributes": True}


class PublicPatientOut(BaseModel):
    id: str
    name: str
    dob: str
    sex: str
    guardian_name: Optional[str] = None
    village: str
    visits: list[dict]


class FormIn(BaseModel):
    id: Optional[str] = None
    name: str
    category: str
    description: Optional[str] = None
    fields: list[dict[str, Any]] = []
    longitudinal: bool = False
    status: str = "active"
    share_token: Optional[str] = None
    analytics_token: Optional[str] = None
    form_role: str = "standalone"
    parent_form_id: Optional[str] = None
    subject_identifier_field_id: Optional[str] = None
    parent_link_field_id: Optional[str] = None
    is_public: bool = True
    allowed_filler_emails: list[str] = []


class FormOut(FormIn):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    shared: bool = False
    can_edit: bool = False
    can_fill: bool = True
    can_view: bool = True

    model_config = {"from_attributes": True}


class PublicFormOut(BaseModel):
    id: str
    name: str
    category: str
    description: Optional[str] = None
    fields: list[dict[str, Any]] = []
    longitudinal: bool = False
    status: str
    is_public: bool = True
    allowed_filler_emails: list[str] = []
    require_respondent_info: bool = False
    require_respondent_id: bool = False
    fixed_field_ids: list[str] = []

    model_config = {"from_attributes": True}


class PublicSubmissionIn(BaseModel):
    respondent_name: Optional[str] = None
    respondent_email: Optional[str] = None
    respondent_id: Optional[str] = None
    data: dict[str, Any] = {}


class SubmissionIn(BaseModel):
    id: Optional[str] = None
    patient_id: str
    form_id: str
    form_name: str
    data: dict[str, Any] = {}


_MAX_FIELD_BYTES = 2048

def _strip_large_fields(data: dict) -> dict:
    """Remove base64 photos/files from submission data before sync.
    Large binary values are already stored on the server; stripping them
    from sync payloads reduces Supabase egress by orders of magnitude."""
    return {k: ("__binary_stripped__" if isinstance(v, str) and len(v) > _MAX_FIELD_BYTES else v)
            for k, v in data.items()}


class SubmissionOut(SubmissionIn):
    id: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):
        instance = super().model_validate(obj, **kwargs)
        instance.data = _strip_large_fields(instance.data)
        return instance


class ShareIn(BaseModel):
    resource_type: Literal["patient", "form"]
    resource_id: str
    email: EmailStr
    can_fill: bool = True
    can_view: bool = True
    can_edit: bool = False


class ShareOut(BaseModel):
    id: str
    resource_type: str
    resource_id: str
    shared_with_email: str
    can_fill: bool
    can_view: bool
    can_edit: bool

    model_config = {"from_attributes": True}


class ShareTokenIn(BaseModel):
    type: Literal["fill", "analytics"]


# ============================================================================
# Auth routes
# ============================================================================
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
OAUTH_STATE_COOKIE = "google_oauth_state"
OAUTH_RETURN_COOKIE = "google_oauth_return_to"
GOOGLE_USER_PASSWORD = "!google-oauth-user!"


def google_auth_enabled() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def google_redirect_uri(request: Request) -> str:
    configured = os.environ.get("GOOGLE_REDIRECT_URI")
    if configured:
        return configured
    return str(request.url_for("google_callback"))


def safe_return_to(value: Optional[str]) -> str:
    if not value:
        return os.environ.get("PUBLIC_APP_URL", "/")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return value
    if value.startswith("/"):
        return value
    return "/"


def fetch_google_json(url: str, *, data: Optional[dict[str, str]] = None, token: Optional[str] = None) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(data).encode() if data is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=encoded, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Google auth failed: {detail}") from e
    except urllib.error.URLError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Google auth: {e.reason}") from e


def google_success_page(token: str, user: User, return_to: str) -> HTMLResponse:
    payload = {
        "token": token,
        "user": to_user_out(user).model_dump(mode="json"),
        "returnTo": return_to,
    }
    script_payload = json.dumps(payload).replace("</", "<\\/")
    html = f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Signing in…</title></head>
  <body>
    <script>
      const auth = {script_payload};
      const destination = new URL("/login", auth.returnTo || window.location.origin);
      destination.hash = `access_token=${encodeURIComponent(auth.token)}`;
      window.location.replace(destination.toString());
    </script>
    <p>Signing you in…</p>
  </body>
</html>"""
    return HTMLResponse(html)


@app.post("/api/auth/register", response_model=TokenOut)
async def register(body: RegisterIn, response: Response, db: AsyncSession = Depends(get_db)):
    await ensure_user_profile_columns_in_session(db)
    email = body.email.lower()

    # Check if the email was pre-verified via OTP flow
    pre_verified = False
    if body.proof_token:
        proof_row = (await db.execute(
            text("SELECT id FROM email_otps WHERE email=:e AND otp=:tok AND used=FALSE AND expires_at > now() LIMIT 1"),
            {"e": f"proof:{email}", "tok": body.proof_token},
        )).mappings().first()
        if proof_row:
            await db.execute(text("UPDATE email_otps SET used=TRUE WHERE id=:id"), {"id": str(proof_row["id"])})
            pre_verified = True

    verify_token = secrets.token_urlsafe(32) if not pre_verified else None
    try:
        res = await db.execute(select(User).where(User.email == email))
        if res.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Email already registered")
        user = User(
            email=email,
            password_hash=hash_password(body.password),
            name=body.name.strip() or email.split("@")[0],
            phone=body.phone.strip(),
            best_suited_role=body.best_suited_role.strip(),
            email_verified=pre_verified,
            email_verification_token=verify_token,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except Exception:
        await db.rollback()
        existing = await fetch_user_legacy_by_email(db, email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        new_id = str(uuid.uuid4())
        await db.execute(
            text(
                "INSERT INTO users (id, email, password_hash, name, role, email_verified, email_verification_token, created_at) "
                "VALUES (:id, :email, :password_hash, :name, :role, :ev, :vtok, now())"
            ),
            {
                "id": new_id,
                "email": email,
                "password_hash": hash_password(body.password),
                "name": body.name.strip() or email.split("@")[0],
                "role": "worker",
                "ev": pre_verified,
                "vtok": verify_token,
            },
        )
        await db.commit()
        user = await fetch_user_legacy_by_email(db, email)
        if not user:
            raise HTTPException(status_code=500, detail="Failed to create user")
    token = create_access_token(str(user.id), user.email)
    response.set_cookie(
        "access_token", token, httponly=True, secure=False, samesite="lax",
        max_age=60 * 60 * 24 * 7, path="/",
    )
    # Send verification email only if the email was NOT already verified via OTP
    if pre_verified or not verify_token:
        return TokenOut(access_token=token, user=to_user_out(user))
    verify_link = f"{FRONTEND_URL}/verify-email?token={verify_token}"
    verify_html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em">
        Verify your email
      </h2>
      <p>Hi {body.name.strip() or 'there'},</p>
      <p>Welcome to Vyasa Research! Please verify your email address to get full access.</p>
      <p style="margin:28px 0">
        <a href="{verify_link}"
           style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-size:13px">
          Verify email
        </a>
      </p>
      <p style="color:#666;font-size:12px">If you didn't sign up for Vyasa Research, you can ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:11px">Vyasa Research · research.vyasaa.com</p>
    </div>
    """
    try:
        await send_email(email, "Verify your Vyasa Research email", verify_html)
    except Exception as e:
        print(f"[register] verification email error: {e}")
    return TokenOut(access_token=token, user=to_user_out(user))


@app.post("/api/auth/login", response_model=TokenOut)
async def login(body: LoginIn, response: Response, db: AsyncSession = Depends(get_db)):
    await ensure_user_profile_columns_in_session(db)
    email = body.email.lower()
    try:
        res = await db.execute(select(User).where(User.email == email))
        user = res.scalar_one_or_none()
    except Exception:
        user = await fetch_user_legacy_by_email(db, email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user.id), user.email)
    response.set_cookie(
        "access_token", token, httponly=True, secure=False, samesite="lax",
        max_age=60 * 60 * 24 * 7, path="/",
    )
    return TokenOut(access_token=token, user=to_user_out(user))


@app.post("/api/auth/logout")
async def logout(response: Response, _: User = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@app.get("/api/auth/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return to_user_out(user)


class UpdateProfileIn(BaseModel):
    name: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=32)
    best_suited_role: str = Field(default="", max_length=64)


@app.patch("/api/auth/me", response_model=UserOut)
async def update_profile(body: UpdateProfileIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("UPDATE users SET name=:name, phone=:phone, best_suited_role=:role WHERE id=:id"),
        {"name": body.name.strip(), "phone": body.phone.strip(), "role": body.best_suited_role.strip(), "id": str(user.id)},
    )
    await db.commit()
    # Invalidate the in-process user cache so the next request re-fetches from DB.
    from auth import _cache_invalidate
    _cache_invalidate(str(user.id))
    user.name = body.name.strip()
    user.phone = body.phone.strip()  # type: ignore[assignment]
    user.best_suited_role = body.best_suited_role.strip()  # type: ignore[assignment]
    return to_user_out(user)


@app.delete("/api/auth/me", status_code=204)
async def delete_account(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = str(user.id)
    # Delete in dependency order
    await db.execute(text("DELETE FROM submissions WHERE owner_id=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM longitudinal_submissions WHERE owner_id=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM patients WHERE owner_id=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM forms WHERE owner_id=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM shares WHERE owner_id=:uid OR shared_with=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM password_reset_tokens WHERE user_id=:uid"), {"uid": uid})
    await db.execute(text("DELETE FROM users WHERE id=:uid"), {"uid": uid})
    await db.commit()


@app.get("/api/auth/verify-email")
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        text("SELECT id FROM users WHERE email_verification_token = :tok AND email_verified = FALSE"),
        {"tok": token},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="Link invalid or already used")
    await db.execute(
        text("UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = :uid"),
        {"uid": str(row["id"])},
    )
    await db.commit()
    from auth import _cache_invalidate
    _cache_invalidate(str(row["id"]))
    return {"ok": True}


@app.post("/api/auth/resend-verification")
async def resend_verification(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if getattr(user, "email_verified", True):
        return {"ok": True}  # already verified, nothing to do
    new_token = secrets.token_urlsafe(32)
    await db.execute(
        text("UPDATE users SET email_verification_token = :tok WHERE id = :uid"),
        {"tok": new_token, "uid": str(user.id)},
    )
    await db.commit()
    verify_link = f"{FRONTEND_URL}/verify-email?token={new_token}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em">Verify your email</h2>
      <p>Hi {user.name or 'there'},</p>
      <p>Click below to verify your email address.</p>
      <p style="margin:28px 0">
        <a href="{verify_link}" style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-size:13px">
          Verify email
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:11px">Vyasa Research · research.vyasaa.com</p>
    </div>
    """
    try:
        await send_email(user.email, "Verify your Vyasa Research email", html)
    except Exception as e:
        print(f"[resend_verification] email error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email — please try again.")
    return {"ok": True}


# ── Email helper ────────────────────────────────────────────────────────────

SMTP_HOST = os.environ.get("SMTP_HOST", "smtpout.secureserver.net")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "support@vyasaa.com")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://research.vyasaa.com")


# ── Pre-registration email OTP ───────────────────────────────────────────────

class SendOtpIn(BaseModel):
    email: EmailStr


class VerifyOtpIn(BaseModel):
    email: EmailStr
    otp: str


async def _ensure_otps_table():
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_otps (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                otp TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_email_otps_email ON email_otps (email)"))


@app.post("/api/auth/send-register-otp")
async def send_register_otp(body: SendOtpIn, db: AsyncSession = Depends(get_db)):
    """Step 1 of registration: send a 6-digit OTP to verify the email address."""
    email = body.email.lower()
    # Check not already registered
    row = (await db.execute(text("SELECT id FROM users WHERE lower(email) = :e LIMIT 1"), {"e": email})).first()
    if row:
        raise HTTPException(status_code=409, detail="Email already registered")
    await _ensure_otps_table()
    # Invalidate old OTPs for this email
    await db.execute(text("UPDATE email_otps SET used=TRUE WHERE email=:e AND used=FALSE"), {"e": email})
    otp = str(secrets.randbelow(900000) + 100000)  # 6-digit
    expires = datetime.utcnow() + timedelta(minutes=10)
    await db.execute(
        text("INSERT INTO email_otps (id, email, otp, expires_at) VALUES (:id, :e, :otp, :exp)"),
        {"id": str(uuid.uuid4()), "e": email, "otp": otp, "exp": expires},
    )
    await db.commit()
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em">
        Verify your email
      </h2>
      <p>Your Vyasa Research verification code is:</p>
      <div style="margin:28px 0;text-align:center">
        <span style="font-size:40px;font-weight:900;letter-spacing:0.15em;background:#000;color:#fff;padding:16px 28px;display:inline-block">
          {otp}
        </span>
      </div>
      <p style="color:#666;font-size:12px">This code expires in <strong>10 minutes</strong>. If you didn't request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:11px">Vyasa Research · research.vyasaa.com</p>
    </div>
    """
    try:
        await send_email(email, "Your Vyasa Research verification code", html)
    except Exception as e:
        print(f"[send_register_otp] email error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email. Please check the address and try again.")
    return {"ok": True}


@app.post("/api/auth/verify-register-otp")
async def verify_register_otp(body: VerifyOtpIn, db: AsyncSession = Depends(get_db)):
    """Step 2 of registration: confirm the OTP. Returns a short-lived proof token."""
    email = body.email.lower()
    await _ensure_otps_table()
    row = (await db.execute(
        text("SELECT id FROM email_otps WHERE email=:e AND otp=:otp AND used=FALSE AND expires_at > now() LIMIT 1"),
        {"e": email, "otp": body.otp.strip()},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    await db.execute(text("UPDATE email_otps SET used=TRUE WHERE id=:id"), {"id": str(row["id"])})
    await db.commit()
    # Issue a short-lived proof token so the register endpoint can trust this email
    proof = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(minutes=30)
    await db.execute(
        text("INSERT INTO email_otps (id, email, otp, expires_at) VALUES (:id, :e, :proof, :exp)"),
        {"id": str(uuid.uuid4()), "e": f"proof:{email}", "proof": proof, "exp": expires},
    )
    await db.commit()
    return {"proof_token": proof}


def _send_email_sync(to: str, subject: str, html: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"ResearchMed <{SMTP_USER}>"
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as s:
        s.login(SMTP_USER, SMTP_PASS)
        s.sendmail(SMTP_USER, to, msg.as_string())


async def send_email(to: str, subject: str, html: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to, subject, html)


# ── Forgot / reset password ──────────────────────────────────────────────────

class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    password: str = Field(min_length=6, max_length=128)


@app.post("/api/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    # Ensure table exists (create inline in case lifespan migration was skipped)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT FALSE
                )
            """))
    except Exception as e:
        print(f"[forgot_password] table ensure error: {e}")

    row = await db.execute(
        text("SELECT id, email, name FROM users WHERE lower(email) = :e LIMIT 1"),
        {"e": body.email.lower()},
    )
    user = row.mappings().first()
    # Always return 200 so we don't leak whether an email exists
    if not user:
        return {"ok": True}

    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=1)
    try:
        await db.execute(
            text("INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (:id, :uid, :tok, :exp)"),
            {"id": str(uuid.uuid4()), "uid": str(user["id"]), "tok": token, "exp": expires},
        )
        await db.commit()
    except Exception as e:
        print(f"[forgot_password] token insert error: {e}")
        return {"ok": True}

    reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em">
        Reset your password
      </h2>
      <p>Hi {user['name'] or 'there'},</p>
      <p>We received a request to reset your ResearchMed password. Click the button below — the link expires in <strong>1 hour</strong>.</p>
      <p style="margin:28px 0">
        <a href="{reset_link}"
           style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-size:13px">
          Reset password
        </a>
      </p>
      <p style="color:#666;font-size:12px">If you didn't request this, ignore this email — your password won't change.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:11px">ResearchMed · research.vyasaa.com</p>
    </div>
    """
    try:
        await send_email(user["email"], "Reset your ResearchMed password", html)
    except Exception as e:
        print(f"[forgot_password] email error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email. Please try again later.")

    return {"ok": True}


@app.post("/api/auth/reset-password")
async def reset_password(body: ResetPasswordIn, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = :tok LIMIT 1"),
        {"tok": body.token},
    )
    rec = row.mappings().first()
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
    if rec["used"]:
        raise HTTPException(status_code=400, detail="This reset link has already been used.")
    if rec["expires_at"].replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")

    await db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :uid"),
        {"h": hash_password(body.password), "uid": rec["user_id"]},
    )
    await db.execute(
        text("UPDATE password_reset_tokens SET used = TRUE WHERE id = :id"),
        {"id": rec["id"]},
    )
    await db.commit()
    return {"ok": True}


@app.get("/api/auth/google/config", response_model=GoogleAuthConfig)
async def google_config():
    return GoogleAuthConfig(enabled=google_auth_enabled())


@app.get("/api/auth/google/start")
async def google_start(request: Request, return_to: Optional[str] = None):
    if not google_auth_enabled():
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the backend.",
        )

    state = secrets.token_urlsafe(32)
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": google_redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    redirect = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}")
    redirect.set_cookie(OAUTH_STATE_COOKIE, state, httponly=True, secure=False, samesite="lax", max_age=600, path="/")
    redirect.set_cookie(OAUTH_RETURN_COOKIE, safe_return_to(return_to), httponly=True, secure=False, samesite="lax", max_age=600, path="/")
    return redirect


@app.get("/api/auth/google/callback", name="google_callback")
async def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    await ensure_user_profile_columns_in_session(db)
    if error:
        raise HTTPException(status_code=400, detail=f"Google sign-in was cancelled: {error}")
    if not code or not state or state != request.cookies.get(OAUTH_STATE_COOKIE):
        raise HTTPException(status_code=400, detail="Invalid Google sign-in state")
    if not google_auth_enabled():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    token_body = fetch_google_json(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": google_redirect_uri(request),
            "grant_type": "authorization_code",
        },
    )
    google_access_token = token_body.get("access_token")
    if not isinstance(google_access_token, str):
        raise HTTPException(status_code=502, detail="Google did not return an access token")

    profile = fetch_google_json(GOOGLE_USERINFO_URL, token=google_access_token)
    if not profile.get("email_verified"):
        raise HTTPException(status_code=403, detail="Google account email is not verified")
    email = str(profile.get("email", "")).lower()
    if not email:
        raise HTTPException(status_code=502, detail="Google did not return an email address")

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            password_hash=GOOGLE_USER_PASSWORD,
            name=str(profile.get("name") or email.split("@")[0]),
            phone="",
            best_suited_role="",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif not user.name and profile.get("name"):
        user.name = str(profile["name"])
        await db.commit()
        await db.refresh(user)

    app_token = create_access_token(str(user.id), user.email)
    return_to = safe_return_to(request.cookies.get(OAUTH_RETURN_COOKIE))
    html = google_success_page(app_token, user, return_to)
    html.set_cookie("access_token", app_token, httponly=True, secure=False, samesite="lax", max_age=60 * 60 * 24 * 7, path="/")
    html.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    html.delete_cookie(OAUTH_RETURN_COOKIE, path="/")
    return html


# ============================================================================
# Helpers — visibility & access checks
# ============================================================================
async def shared_resource_ids(
    db: AsyncSession, user_id: str, resource_type: str
) -> set[str]:
    res = await db.execute(
        select(Share.resource_id).where(
            and_(Share.shared_with == user_id, Share.resource_type == resource_type)
        )
    )
    return {row[0] for row in res.all()}


async def shared_resource_ids_both(
    db: AsyncSession, user_id: str
) -> tuple[set[str], set[str]]:
    """Return (patient_ids, form_ids) shared with user_id in a single query."""
    res = await db.execute(
        select(Share.resource_type, Share.resource_id).where(
            Share.shared_with == user_id
        )
    )
    patient_ids: set[str] = set()
    form_ids: set[str] = set()
    for rtype, rid in res.all():
        if rtype == "patient":
            patient_ids.add(rid)
        elif rtype == "form":
            form_ids.add(rid)
    return patient_ids, form_ids


async def can_write_resource(
    db: AsyncSession, user: Any, rtype: str, rid: str
) -> bool:
    res = await db.execute(
        select(Share).where(
            and_(
                Share.shared_with == str(user.id),
                Share.resource_type == rtype,
                Share.resource_id == str(rid),
            )
        )
    )
    sh = res.scalar_one_or_none()
    return sh is not None and bool(getattr(sh, "can_edit", False))


async def bulk_can_write(
    db: AsyncSession, user_id: str, rtype: str, resource_ids: list[str]
) -> set[str]:
    """Return the subset of resource_ids that user_id has can_edit access to."""
    if not resource_ids:
        return set()
    res = await db.execute(
        select(Share.resource_id).where(
            and_(
                Share.shared_with == user_id,
                Share.resource_type == rtype,
                Share.resource_id.in_(resource_ids),
                Share.can_edit == True,  # noqa: E712
            )
        )
    )
    return {row[0] for row in res.all()}


# ============================================================================
# Patient routes
# ============================================================================
@app.get("/api/patients", response_model=list[PatientOut])
async def list_patients(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shared = await shared_resource_ids(db, str(user.id), "patient")
    q = select(Patient).where(or_(Patient.owner_id == user.id, Patient.id.in_(shared)))
    res = await db.execute(q.order_by(Patient.created_at.desc()))
    rows = res.scalars().all()
    return [
        PatientOut(
            **{c.name: getattr(r, c.name) for c in r.__table__.columns},
            shared=(str(r.owner_id) != str(user.id)),
        )
        for r in rows
    ]


@app.post("/api/patients", response_model=PatientOut)
async def create_or_upsert_patient(
    body: PatientIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.id:
        res = await db.execute(select(Patient).where(Patient.id == body.id))
        existing = res.scalar_one_or_none()
        if existing:
            owner = str(existing.owner_id) == str(user.id)
            if not owner and not await can_write_resource(db, user, "patient", existing.id):
                raise HTTPException(403, "Forbidden")
            for k, v in body.model_dump(exclude={"id"}).items():
                setattr(existing, k, v)
            await db.commit()
            await db.refresh(existing)
            return PatientOut(
                **{c.name: getattr(existing, c.name) for c in existing.__table__.columns},
                shared=not owner,
            )

    p = Patient(
        id=body.id,
        owner_id=user.id,
        **body.model_dump(exclude={"id"}),
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return PatientOut(**{c.name: getattr(p, c.name) for c in p.__table__.columns}, shared=False)


@app.get("/api/patients/public/{token}", response_model=PublicPatientOut)
async def get_public_patient_growth(token: str, db: AsyncSession = Depends(get_db)):
    """Return patient growth data by share_token — no authentication required."""
    res = await db.execute(select(Patient).where(Patient.share_token == token))
    patient = res.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "Patient not found or this link has been revoked")
    res2 = await db.execute(
        select(Submission).where(
            and_(Submission.patient_id == str(patient.id), Submission.form_id == "__growth_visit__")
        ).order_by(Submission.created_at)
    )
    subs = res2.scalars().all()
    return PublicPatientOut(
        id=str(patient.id),
        name=patient.name,
        dob=patient.dob,
        sex=patient.sex,
        guardian_name=patient.guardian_name,
        village=patient.village,
        visits=[s.data for s in subs],
    )


@app.post("/api/patients/{pid}/share-token")
async def generate_patient_share_token(
    pid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Patient).where(Patient.id == pid))
    patient = res.scalar_one_or_none()
    if not patient or str(patient.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can generate links")
    token = f"pg_{secrets.token_urlsafe(16)}"
    patient.share_token = token
    await db.commit()
    return {"token": token}


@app.delete("/api/patients/{pid}/share-token")
async def revoke_patient_share_token(
    pid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Patient).where(Patient.id == pid))
    patient = res.scalar_one_or_none()
    if not patient or str(patient.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can revoke links")
    patient.share_token = None
    await db.commit()
    return {"ok": True}


@app.delete("/api/patients/{pid}")
async def delete_patient(pid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Patient).where(Patient.id == pid))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Not found")
    if str(p.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can delete")
    await db.delete(p)
    # Cascade delete submissions
    await db.execute(
        Submission.__table__.delete().where(Submission.patient_id == pid)
    )
    await db.commit()
    return {"ok": True}


# ============================================================================
# Form routes
# ============================================================================
@app.get("/api/forms", response_model=list[FormOut])
async def list_forms(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shared = await shared_resource_ids(db, str(user.id), "form")
    q = select(FormDef).where(or_(FormDef.owner_id == user.id, FormDef.id.in_(shared)))
    res = await db.execute(q.order_by(FormDef.created_at.desc()))
    rows = res.scalars().all()

    # Fetch per-form permissions for shared forms (single extra query)
    share_map: dict[str, "Share"] = {}
    if shared:
        sr = await db.execute(
            select(Share).where(
                and_(Share.shared_with == str(user.id), Share.resource_type == "form")
            )
        )
        share_map = {str(s.resource_id): s for s in sr.scalars().all()}

    result = []
    for r in rows:
        is_shared = str(r.owner_id) != str(user.id)
        sh = share_map.get(str(r.id))
        result.append(FormOut(
            **{c.name: getattr(r, c.name) for c in r.__table__.columns},
            shared=is_shared,
            can_edit=bool(sh.can_edit) if sh else False,
            can_fill=bool(sh.can_fill) if sh else True,
            can_view=bool(sh.can_view) if sh else True,
        ))
    return result


@app.post("/api/forms", response_model=FormOut)
async def create_or_upsert_form(
    body: FormIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.id:
        res = await db.execute(select(FormDef).where(FormDef.id == body.id))
        existing = res.scalar_one_or_none()
        if existing:
            owner = str(existing.owner_id) == str(user.id)
            if not owner and not await can_write_resource(db, user, "form", existing.id):
                raise HTTPException(403, "Forbidden")
            for k, v in body.model_dump(exclude={"id"}).items():
                if k in ("share_token", "analytics_token") and v is None:
                    continue
                setattr(existing, k, v)
            flag_modified(existing, "fields")
            flag_modified(existing, "allowed_filler_emails")
            await db.commit()
            await db.refresh(existing)
            return FormOut(
                **{c.name: getattr(existing, c.name) for c in existing.__table__.columns},
                shared=not owner,
            )

    f = FormDef(id=body.id, owner_id=user.id, **body.model_dump(exclude={"id"}))
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return FormOut(**{c.name: getattr(f, c.name) for c in f.__table__.columns}, shared=False)


@app.delete("/api/forms/{fid}")
async def delete_form(fid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(FormDef).where(FormDef.id == fid))
    f = res.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Not found")
    if str(f.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can delete")
    await db.delete(f)
    await db.commit()
    return {"ok": True}


# ============================================================================
# Submission routes
# ============================================================================
@app.get("/api/submissions", response_model=list[SubmissionOut])
async def list_submissions(
    form_id: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    shared_p = await shared_resource_ids(db, str(user.id), "patient")
    shared_f = await shared_resource_ids(db, str(user.id), "form")
    # Also include all submissions for forms this user owns, regardless of who submitted them.
    # Without this, collaborator submissions (owner_id=collab) are invisible to the form owner.
    owned_f_res = await db.execute(select(FormDef.id).where(FormDef.owner_id == user.id))
    owned_f = {str(row[0]) for row in owned_f_res.all()}
    visibility = or_(
        Submission.owner_id == user.id,
        Submission.patient_id.in_(shared_p),
        Submission.form_id.in_(shared_f),
        Submission.form_id.in_(owned_f),
    )
    q = select(Submission).where(
        and_(visibility, Submission.form_id == form_id) if form_id else visibility
    )
    res = await db.execute(q.order_by(Submission.created_at.desc()))
    rows = res.scalars().all()
    return [SubmissionOut.model_validate(r) for r in rows]


@app.post("/api/submissions", response_model=SubmissionOut)
async def create_submission(
    body: SubmissionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = Submission(id=body.id, owner_id=user.id, **body.model_dump(exclude={"id"}))
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return SubmissionOut.model_validate(s)


@app.delete("/api/submissions/{sid}", status_code=204)
async def delete_submission(
    sid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Submission).where(Submission.id == sid))
    s = res.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Submission not found")
    if str(s.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can delete")
    await db.delete(s)
    await db.commit()


# ============================================================================
# Ownership Transfer
# ============================================================================
class TransferIn(BaseModel):
    form_id: str
    new_owner_email: str


@app.post("/api/forms/transfer")
async def transfer_form_ownership(
    body: TransferIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(FormDef).where(FormDef.id == body.form_id))
    form = res.scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form not found")
    if str(form.owner_id) != str(user.id):
        raise HTTPException(403, "Only the current owner can transfer ownership")

    new_email = body.new_owner_email.lower().strip()
    if new_email == user.email.lower():
        raise HTTPException(400, "You already own this form")

    res2 = await db.execute(select(User).where(User.email == new_email))
    new_owner = res2.scalar_one_or_none()
    if not new_owner:
        raise HTTPException(404, f"No account found for {new_email}. They must sign up first.")

    form.owner_id = str(new_owner.id)
    await db.commit()
    return {"ok": True, "new_owner": new_email}


# ============================================================================
# Sharing
# ============================================================================
@app.post("/api/shares", response_model=ShareOut)
async def create_share(
    body: ShareIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_email = body.email.lower()
    if target_email == user.email:
        raise HTTPException(400, "Cannot share with yourself")

    # Verify ownership of the resource
    if body.resource_type == "patient":
        res = await db.execute(select(Patient).where(Patient.id == body.resource_id))
        owner_check = res.scalar_one_or_none()
    else:
        res = await db.execute(select(FormDef).where(FormDef.id == body.resource_id))
        owner_check = res.scalar_one_or_none()
    if not owner_check or str(owner_check.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can share")

    # Find target user
    res = await db.execute(select(User).where(User.email == target_email))
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(404, f"No user registered with email {target_email}")

    # Upsert share
    res = await db.execute(
        select(Share).where(
            and_(
                Share.resource_type == body.resource_type,
                Share.resource_id == body.resource_id,
                Share.shared_with == target.id,
            )
        )
    )
    sh = res.scalar_one_or_none()
    if sh:
        sh.can_fill = body.can_fill
        sh.can_view = body.can_view
        sh.can_edit = body.can_edit
    else:
        sh = Share(
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            owner_id=user.id,
            shared_with=target.id,
            can_fill=body.can_fill,
            can_view=body.can_view,
            can_edit=body.can_edit,
        )
        db.add(sh)
    await db.commit()
    await db.refresh(sh)
    return ShareOut(
        id=sh.id,
        resource_type=sh.resource_type,
        resource_id=sh.resource_id,
        shared_with_email=target.email,
        can_fill=sh.can_fill,
        can_view=sh.can_view,
        can_edit=sh.can_edit,
    )


@app.get("/api/shares", response_model=list[ShareOut])
async def list_my_shares(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Shares granted by the current user."""
    res = await db.execute(
        select(Share, User.email)
        .join(User, User.id == Share.shared_with)
        .where(Share.owner_id == user.id)
    )
    out = []
    for sh, email in res.all():
        out.append(
            ShareOut(
                id=sh.id,
                resource_type=sh.resource_type,
                resource_id=sh.resource_id,
                shared_with_email=email,
                can_fill=getattr(sh, "can_fill", True),
                can_view=getattr(sh, "can_view", True),
                can_edit=sh.can_edit,
            )
        )
    return out


@app.delete("/api/shares/{share_id}")
async def revoke_share(share_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Share).where(Share.id == share_id))
    sh = res.scalar_one_or_none()
    if not sh or str(sh.owner_id) != str(user.id):
        raise HTTPException(404, "Share not found")
    await db.delete(sh)
    await db.commit()
    return {"ok": True}


# ============================================================================
# Per-form share management
# ============================================================================
@app.get("/api/forms/{fid}/shares", response_model=list[ShareOut])
async def list_form_shares(
    fid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(FormDef).where(FormDef.id == fid))
    form = res.scalar_one_or_none()
    if not form or str(form.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can view shares")
    rows = await db.execute(
        select(Share, User.email)
        .join(User, User.id == Share.shared_with)
        .where(and_(Share.resource_type == "form", Share.resource_id == fid, Share.owner_id == user.id))
    )
    return [
        ShareOut(
            id=sh.id,
            resource_type=sh.resource_type,
            resource_id=sh.resource_id,
            shared_with_email=email,
            can_fill=getattr(sh, "can_fill", True),
            can_view=getattr(sh, "can_view", True),
            can_edit=sh.can_edit,
        )
        for sh, email in rows.all()
    ]


@app.post("/api/forms/{fid}/share-token")
async def generate_share_token(
    fid: str,
    body: ShareTokenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(FormDef).where(FormDef.id == fid))
    form = res.scalar_one_or_none()
    if not form or str(form.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can generate links")
    token = f"{'sh' if body.type == 'fill' else 'an'}_{secrets.token_urlsafe(16)}"
    if body.type == "fill":
        form.share_token = token
    else:
        form.analytics_token = token
    await db.commit()
    return {"token": token}


@app.delete("/api/forms/{fid}/share-token")
async def revoke_share_token(
    fid: str,
    type: Literal["fill", "analytics"],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(FormDef).where(FormDef.id == fid))
    form = res.scalar_one_or_none()
    if not form or str(form.owner_id) != str(user.id):
        raise HTTPException(403, "Only the owner can revoke links")
    if type == "fill":
        form.share_token = None
    else:
        form.analytics_token = None
    await db.commit()
    return {"ok": True}


# ============================================================================
# Plan limits
# ============================================================================
PLAN_LIMITS: dict[str, dict[str, int]] = {
    "free": {"forms": 5, "submissions_per_month": 500},
    "pro":  {"forms": 100, "submissions_per_month": 10_000},
    "max":  {"forms": 999_999, "submissions_per_month": 50_000},
}

async def get_plan_usage(db: AsyncSession, user_id: str) -> tuple[str, int, int]:
    """Return (plan, owned_form_count, submissions_this_month) for a user."""
    plan_row = (await db.execute(
        text("SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = :uid"),
        {"uid": user_id},
    )).mappings().first()
    plan = (plan_row["plan"] if plan_row else "free") or "free"

    form_count_row = (await db.execute(
        text("SELECT COUNT(*) AS n FROM forms WHERE owner_id = :uid"),
        {"uid": user_id},
    )).mappings().first()
    form_count = int(form_count_row["n"]) if form_count_row else 0

    sub_count_row = (await db.execute(
        text("""
            SELECT COUNT(*) AS n FROM submissions
            WHERE owner_id = :uid
              AND created_at >= date_trunc('month', now())
        """),
        {"uid": user_id},
    )).mappings().first()
    sub_count = int(sub_count_row["n"]) if sub_count_row else 0

    return plan, form_count, sub_count


# ============================================================================
# Bulk sync (used by the offline-first client to push queued ops at once)
# ============================================================================
class SyncIn(BaseModel):
    patients: list[PatientIn] = []
    forms: list[FormIn] = []
    submissions: list[SubmissionIn] = []
    longitudinal_submissions: list[dict[str, Any]] = []


@app.post("/api/sync/push")
async def sync_push(
    body: SyncIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    out: dict = {"patients": 0, "forms": 0, "submissions": 0, "denied_forms": [], "limit_exceeded": None}

    # Enforce plan limits for non-admin users
    is_admin = getattr(user, "role", "worker") == "admin"
    if not is_admin:
        new_forms = [f for f in body.forms if not f.id or not (await db.execute(select(FormDef).where(FormDef.id == f.id))).scalar_one_or_none()]
        new_subs  = [s for s in body.submissions if not s.id or not (await db.execute(select(Submission).where(Submission.id == s.id))).scalar_one_or_none()]
        if new_forms or new_subs:
            plan, form_count, sub_count = await get_plan_usage(db, str(user.id))
            limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
            if new_forms and (form_count + len(new_forms)) > limits["forms"]:
                out["limit_exceeded"] = "form_limit"
                out["denied_forms"] = [f.id for f in body.forms if f.id]
                return out
            if new_subs and (sub_count + len(new_subs)) > limits["submissions_per_month"]:
                out["limit_exceeded"] = "submission_limit"
                return out

    # Pre-fetch edit permissions for all incoming IDs in two bulk queries
    # instead of one per item (eliminates N+1 on shared resources).
    patient_ids_in = [p.id for p in body.patients if p.id]
    form_ids_in = [f.id for f in body.forms if f.id]
    editable_patients = await bulk_can_write(db, str(user.id), "patient", patient_ids_in)
    editable_forms = await bulk_can_write(db, str(user.id), "form", form_ids_in)

    for p in body.patients:
        if p.id:
            res = await db.execute(select(Patient).where(Patient.id == p.id))
            existing = res.scalar_one_or_none()
            if existing and (str(existing.owner_id) == str(user.id) or p.id in editable_patients):
                for k, v in p.model_dump(exclude={"id"}).items():
                    setattr(existing, k, v)
                out["patients"] += 1
                continue
        db.add(Patient(id=p.id, owner_id=user.id, **p.model_dump(exclude={"id"})))
        out["patients"] += 1

    for f in body.forms:
        if f.id:
            res = await db.execute(select(FormDef).where(FormDef.id == f.id))
            existing = res.scalar_one_or_none()
            if existing:
                # Form already exists: update only if owner or collaborator with edit access.
                # If neither, signal denial — never INSERT with same ID (PK conflict).
                if str(existing.owner_id) == str(user.id) or f.id in editable_forms:
                    for k, v in f.model_dump(exclude={"id"}).items():
                        # Never overwrite share_token / analytics_token with null from the
                        # bulk-sync endpoint — token management uses dedicated endpoints.
                        # Client may send null when it doesn't know the current token value.
                        if k in ("share_token", "analytics_token") and v is None:
                            continue
                        setattr(existing, k, v)
                    flag_modified(existing, "fields")
                    flag_modified(existing, "allowed_filler_emails")
                    out["forms"] += 1
                else:
                    out["denied_forms"].append(f.id)
                continue
        db.add(FormDef(id=f.id, owner_id=user.id, **f.model_dump(exclude={"id"})))
        out["forms"] += 1

    for s in body.submissions:
        if s.id:
            res = await db.execute(select(Submission).where(Submission.id == s.id))
            if res.scalar_one_or_none():
                continue  # immutable: skip duplicates
        db.add(Submission(id=s.id, owner_id=user.id, **s.model_dump(exclude={"id"})))
        out["submissions"] += 1

    for sub in body.longitudinal_submissions:
        sub_id = sub.get("id")
        if not sub_id:
            continue
        existing_row = (await db.execute(
            text("SELECT visits FROM longitudinal_submissions WHERE id = :id"),
            {"id": sub_id}
        )).mappings().first()
        if existing_row:
            # merge visits
            existing_visits = existing_row["visits"] if isinstance(existing_row["visits"], list) else []
            visit_map = {v["visitId"]: v for v in existing_visits}
            for v in sub.get("visits", []):
                visit_map[v["visitId"]] = v
            merged_visits = sorted(visit_map.values(), key=lambda v: v.get("timestamp", ""))
            await db.execute(
                text("""
                    UPDATE longitudinal_submissions
                    SET visits = CAST(:visits AS jsonb), updated_at = :updated_at
                    WHERE id = :id
                """),
                {
                    "id": sub_id,
                    "visits": json.dumps(merged_visits),
                    "updated_at": _parse_dt(sub.get("updatedAt")),
                }
            )
        else:
            owner_id_val = str(user.id) if user else None
            await db.execute(
                text("""
                    INSERT INTO longitudinal_submissions
                        (id, form_id, owner_id, subject_key, fixed_data, visits, patient_id, created_at, updated_at)
                    VALUES
                        (:id, :form_id, CAST(:owner_id AS uuid), :subject_key, CAST(:fixed_data AS jsonb), CAST(:visits AS jsonb),
                         :patient_id, :created_at, :updated_at)
                    ON CONFLICT (id) DO NOTHING
                """),
                {
                    "id": sub_id,
                    "form_id": sub.get("formId", ""),
                    "owner_id": owner_id_val,
                    "subject_key": sub.get("subjectKey", ""),
                    "fixed_data": json.dumps(sub.get("fixedData", {})),
                    "visits": json.dumps(sub.get("visits", [])),
                    "patient_id": sub.get("patientId"),
                    "created_at": _parse_dt(sub.get("createdAt")),
                    "updated_at": _parse_dt(sub.get("updatedAt")),
                }
            )

    await db.commit()
    return out


@app.get("/api/sync/pull")
async def sync_pull(
    since: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns the user's visible dataset for cache hydration.

    When `since` is provided (ISO-8601 timestamp from the client's last sync),
    only records modified after that time are returned. This makes incremental
    pulls cheap and dramatically reduces egress on repeated polls.
    """
    since_dt: Optional[datetime] = _parse_dt(since) if since else None

    # One query to get all shared IDs for both resource types at once.
    shared_p, shared_f = await shared_resource_ids_both(db, str(user.id))

    # Fetch owned form IDs (needed by list_submissions) in parallel with the
    # patient and form queries.
    async def _patients():
        base = or_(Patient.owner_id == user.id, Patient.id.in_(shared_p))
        q = select(Patient).where(base if since_dt is None else and_(base, Patient.updated_at > since_dt))
        res = await db.execute(q.order_by(Patient.created_at.desc()))
        rows = res.scalars().all()
        return [
            PatientOut(
                **{c.name: getattr(r, c.name) for c in r.__table__.columns},
                shared=(str(r.owner_id) != str(user.id)),
            )
            for r in rows
        ]

    async def _forms():
        base = or_(FormDef.owner_id == user.id, FormDef.id.in_(shared_f))
        q = select(FormDef).where(base if since_dt is None else and_(base, FormDef.updated_at > since_dt))
        res = await db.execute(q.order_by(FormDef.created_at.desc()))
        rows = res.scalars().all()

        share_map: dict[str, Share] = {}
        if shared_f:
            sr = await db.execute(
                select(Share).where(
                    and_(Share.shared_with == str(user.id), Share.resource_type == "form")
                )
            )
            share_map = {str(s.resource_id): s for s in sr.scalars().all()}

        result = []
        for r in rows:
            is_shared = str(r.owner_id) != str(user.id)
            sh = share_map.get(str(r.id))
            result.append(FormOut(
                **{c.name: getattr(r, c.name) for c in r.__table__.columns},
                shared=is_shared,
                can_edit=bool(sh.can_edit) if sh else False,
                can_fill=bool(sh.can_fill) if sh else True,
                can_view=bool(sh.can_view) if sh else True,
            ))
        return result

    async def _submissions():
        owned_f_res = await db.execute(select(FormDef.id).where(FormDef.owner_id == user.id))
        owned_f = {str(row[0]) for row in owned_f_res.all()}
        base = or_(
            Submission.owner_id == user.id,
            Submission.patient_id.in_(shared_p),
            Submission.form_id.in_(shared_f),
            Submission.form_id.in_(owned_f),
        )
        q = select(Submission).where(
            base if since_dt is None else and_(base, Submission.created_at > since_dt)
        )
        res = await db.execute(q.order_by(Submission.created_at.desc()).limit(2000))
        rows = res.scalars().all()
        return [SubmissionOut.model_validate(r) for r in rows]

    # asyncio.gather runs the three coroutines concurrently on the same event
    # loop.  SQLAlchemy's AsyncSession is safe here because asyncio is
    # single-threaded — coroutines interleave at await points rather than
    # running in parallel threads, so there is no concurrent session access.
    # The main win is eliminating the two extra shared_resource_ids round-trips
    # that the individual list handlers would otherwise make.
    patients, forms, submissions = await asyncio.gather(
        _patients(), _forms(), _submissions()
    )

    # Fetch longitudinal submissions owned by this user OR belonging to shared forms.
    # Apply since filter (updated_at) and cap at 1000 rows to bound egress.
    _long_params: dict = {"owner_id": str(user.id)}
    _long_where = "owner_id = :owner_id"
    if shared_f:
        _placeholders = ", ".join(f":_sfid_{i}" for i in range(len(shared_f)))
        _long_where = f"(owner_id = :owner_id OR form_id IN ({_placeholders}))"
        for i, fid in enumerate(shared_f):
            _long_params[f"_sfid_{i}"] = str(fid)
    if since_dt is not None:
        _long_where += " AND updated_at > :since_dt"
        _long_params["since_dt"] = since_dt
    long_subs_rows = (await db.execute(
        text(f"SELECT * FROM longitudinal_submissions WHERE {_long_where} ORDER BY updated_at DESC LIMIT 1000"),
        _long_params
    )).mappings().all()
    longitudinal_submissions = [
        {
            "id": s["id"],
            "type": "longitudinal",
            "formId": s["form_id"],
            "subjectKey": s["subject_key"],
            "fixedData": s["fixed_data"] if isinstance(s["fixed_data"], dict) else {},
            "visits": s["visits"] if isinstance(s["visits"], list) else [],
            "patientId": s.get("patient_id"),
            "createdAt": s["created_at"].isoformat() if hasattr(s["created_at"], "isoformat") else str(s["created_at"]),
            "updatedAt": s["updated_at"].isoformat() if hasattr(s["updated_at"], "isoformat") else str(s["updated_at"]),
            "ownerId": str(s["owner_id"]) if s.get("owner_id") else None,
        }
        for s in long_subs_rows
    ]

    return {
        "patients": patients,
        "forms": forms,
        "submissions": submissions,
        "longitudinal_submissions": longitudinal_submissions,
    }


# ============================================================================
# Public form endpoints (no auth required)
# ============================================================================

@app.get("/api/forms/public/{share_token}", response_model=PublicFormOut)
async def get_public_form(share_token: str, response: Response, db: AsyncSession = Depends(get_db)):
    """Return a form definition by share_token — no authentication required."""
    res = await db.execute(select(FormDef).where(FormDef.share_token == share_token))
    form = res.scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form not found")
    if getattr(form, "status", "active") == "closed":
        raise HTTPException(410, "This form is closed and no longer accepting responses")
    if getattr(form, "status", "active") == "draft":
        raise HTTPException(403, "This form is not yet published")
    # Cache form definition for 60 seconds to reduce cold-start round-trips.
    # must-revalidate ensures browsers never serve stale content after max-age expires.
    response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
    fields = form.fields if isinstance(form.fields, list) else []
    return PublicFormOut(
        id=str(form.id),
        name=form.name,
        category=form.category,
        description=form.description,
        fields=fields,
        longitudinal=form.longitudinal,
        status=getattr(form, "status", "active"),
        is_public=getattr(form, "is_public", True),
        allowed_filler_emails=getattr(form, "allowed_filler_emails", []) or [],
        fixed_field_ids=[f["id"] for f in fields if isinstance(f, dict) and f.get("longitudinalRole") == "fixed"],
    )


@app.get("/api/forms/public/{share_token}/subjects")
async def search_public_subjects(
    share_token: str,
    q: str = "",
    db: AsyncSession = Depends(get_db),
):
    """Return existing subjects for a longitudinal form — no auth required."""
    res = await db.execute(select(FormDef).where(FormDef.share_token == share_token))
    form = res.scalar_one_or_none()
    if not form or not getattr(form, "longitudinal", False):
        return []

    rows = (await db.execute(
        text("""
            SELECT id, subject_key, fixed_data, visits, created_at, updated_at
            FROM longitudinal_submissions
            WHERE form_id = :form_id
            ORDER BY updated_at DESC
            LIMIT 200
        """),
        {"form_id": str(form.id)}
    )).mappings().all()

    q_lower = q.strip().lower()
    results = []
    for row in rows:
        fixed_data = row["fixed_data"] if isinstance(row["fixed_data"], dict) else {}
        if q_lower and not any(q_lower in str(v).lower() for v in fixed_data.values()):
            continue
        visits = row["visits"] if isinstance(row["visits"], list) else []
        results.append({
            "id": row["id"],
            "type": "longitudinal",
            "formId": str(form.id),
            "subjectKey": row["subject_key"],
            "fixedData": fixed_data,
            "visits": visits,
            "createdAt": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            "updatedAt": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
        })
        if len(results) >= 20:
            break

    return results


class PublicLongitudinalSubmitIn(BaseModel):
    fixed_data: dict[str, Any] = {}
    visit_data: dict[str, Any] = {}
    fixed_field_ids: list[str] = []


@app.post("/api/forms/public/{share_token}/longitudinal-submit")
async def submit_public_longitudinal(
    share_token: str,
    body: PublicLongitudinalSubmitIn,
    db: AsyncSession = Depends(get_db),
):
    """Accept a public longitudinal form visit — no authentication required."""
    res = await db.execute(select(FormDef).where(FormDef.share_token == share_token))
    form = res.scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form not found")
    if getattr(form, "status", "active") == "closed":
        raise HTTPException(410, "This form is closed")
    if getattr(form, "status", "active") == "draft":
        raise HTTPException(403, "This form is not yet published")

    fixed_ids = sorted(body.fixed_field_ids)
    subject_key = "|".join(str(body.fixed_data.get(fid, "")).strip().lower() for fid in fixed_ids)
    sub_id = f"longsub_{form.id}_{subject_key}"
    now_dt = datetime.utcnow()
    now_str = now_dt.isoformat()

    existing_row = (await db.execute(
        text("SELECT visits FROM longitudinal_submissions WHERE id = :id"),
        {"id": sub_id}
    )).mappings().first()

    if existing_row:
        existing_visits = existing_row["visits"] if isinstance(existing_row["visits"], list) else []
        visit_id = f"v{len(existing_visits) + 1}"
        merged_visits = existing_visits + [{"visitId": visit_id, "timestamp": now_str, "data": body.visit_data}]
        await db.execute(
            text("UPDATE longitudinal_submissions SET visits = CAST(:visits AS jsonb), updated_at = :updated_at WHERE id = :id"),
            {"id": sub_id, "visits": json.dumps(merged_visits), "updated_at": now_dt},
        )
    else:
        await db.execute(
            text("""
                INSERT INTO longitudinal_submissions
                    (id, form_id, owner_id, subject_key, fixed_data, visits, created_at, updated_at)
                VALUES
                    (:id, :form_id, CAST(:owner_id AS uuid), :subject_key, CAST(:fixed_data AS jsonb), CAST(:visits AS jsonb),
                     :created_at, :updated_at)
                ON CONFLICT (id) DO NOTHING
            """),
            {
                "id": sub_id,
                "form_id": str(form.id),
                "owner_id": str(form.owner_id),
                "subject_key": subject_key,
                "fixed_data": json.dumps(body.fixed_data),
                "visits": json.dumps([{"visitId": "v1", "timestamp": now_str, "data": body.visit_data}]),
                "created_at": now_dt,
                "updated_at": now_dt,
            },
        )

    await db.commit()
    return {"ok": True, "id": sub_id}


@app.post("/api/forms/public/{share_token}/submit")
async def submit_public_form(
    share_token: str,
    body: PublicSubmissionIn,
    db: AsyncSession = Depends(get_db),
):
    """Accept a public form submission — no authentication required."""
    res = await db.execute(select(FormDef).where(FormDef.share_token == share_token))
    form = res.scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form not found")
    if getattr(form, "status", "active") == "closed":
        raise HTTPException(410, "This form is closed")
    if getattr(form, "status", "active") == "draft":
        raise HTTPException(403, "This form is not yet published")

    submission_data = dict(body.data)
    if body.respondent_name:
        submission_data["__respondent_name"] = body.respondent_name
    if body.respondent_email:
        submission_data["__respondent_email"] = body.respondent_email
    if body.respondent_id:
        submission_data["__respondent_id"] = body.respondent_id

    sub = Submission(
        owner_id=form.owner_id,
        patient_id="",
        form_id=str(form.id),
        form_name=form.name,
        data=submission_data,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return {"ok": True, "id": str(sub.id)}


@app.get("/api/health")
async def health():
    return {"ok": True}
