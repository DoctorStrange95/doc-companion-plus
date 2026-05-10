"""CommunityMed Pro — FastAPI backend (Supabase Postgres)."""

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import os
import json
import secrets
import uuid
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime
from typing import Any, Optional, Literal
from contextlib import asynccontextmanager
from types import SimpleNamespace

from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, or_, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, engine, AsyncSessionLocal, Base
from models import User, Patient, FormDef, Submission, Share
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)


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
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS best_suited_role VARCHAR(64) NOT NULL DEFAULT ''"
            )
        )


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


async def ensure_user_profile_columns_in_session(db: AsyncSession):
    # Fallback for environments where lifespan hooks may not run consistently.
    try:
        await db.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NOT NULL DEFAULT ''")
        )
        await db.execute(
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS best_suited_role VARCHAR(64) NOT NULL DEFAULT ''"
            )
        )
        await db.commit()
    except Exception:
        await db.rollback()


async def fetch_user_legacy_by_email(db: AsyncSession, email: str):
    row = (
        await db.execute(
            text(
                "SELECT id, email, password_hash, name, role FROM users WHERE lower(email) = :email LIMIT 1"
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
        phone="",
        best_suited_role="",
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
        await seed_admin()
    except Exception as e:  # noqa: BLE001
        print(f"[seed_admin] warning: {e}")
    yield


app = FastAPI(title="CommunityMed Pro API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened by ingress; client uses same-origin
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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

    model_config = {"from_attributes": True}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=32)
    best_suited_role: str = Field(default="", max_length=64)


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
    )


class PatientIn(BaseModel):
    id: Optional[str] = None
    name: str
    dob: str
    sex: Literal["Male", "Female", "Other"]
    village: str
    phone: Optional[str] = None
    tags: list[str] = []
    status: str = "Active"


class PatientOut(PatientIn):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    shared: bool = False

    model_config = {"from_attributes": True}


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


class FormOut(FormIn):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    shared: bool = False

    model_config = {"from_attributes": True}


class PublicFormOut(BaseModel):
    id: str
    name: str
    category: str
    description: Optional[str] = None
    fields: list[dict[str, Any]] = []
    longitudinal: bool = False
    status: str
    require_respondent_info: bool = False
    require_respondent_id: bool = False

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


class SubmissionOut(SubmissionIn):
    id: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


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
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except Exception:
        await db.rollback()
        existing = await fetch_user_legacy_by_email(db, email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        await db.execute(
            text(
                "INSERT INTO users (id, email, password_hash, name, role, created_at) "
                "VALUES (:id, :email, :password_hash, :name, :role, now())"
            ),
            {
                "id": str(uuid.uuid4()),
                "email": email,
                "password_hash": hash_password(body.password),
                "name": body.name.strip() or email.split("@")[0],
                "role": "worker",
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


async def can_write_resource(
    db: AsyncSession, user: User, rtype: str, rid: str
) -> bool:
    res = await db.execute(
        select(Share).where(
            and_(
                Share.shared_with == user.id,
                Share.resource_type == rtype,
                Share.resource_id == rid,
                Share.can_edit.is_(True),
            )
        )
    )
    return res.scalar_one_or_none() is not None


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
    return [
        FormOut(
            **{c.name: getattr(r, c.name) for c in r.__table__.columns},
            shared=(str(r.owner_id) != str(user.id)),
        )
        for r in rows
    ]


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
                setattr(existing, k, v)
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
async def list_submissions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shared_p = await shared_resource_ids(db, str(user.id), "patient")
    shared_f = await shared_resource_ids(db, str(user.id), "form")
    q = select(Submission).where(
        or_(
            Submission.owner_id == user.id,
            Submission.patient_id.in_(shared_p),
            Submission.form_id.in_(shared_f),
        )
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
# Bulk sync (used by the offline-first client to push queued ops at once)
# ============================================================================
class SyncIn(BaseModel):
    patients: list[PatientIn] = []
    forms: list[FormIn] = []
    submissions: list[SubmissionIn] = []


@app.post("/api/sync/push")
async def sync_push(
    body: SyncIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    out = {"patients": 0, "forms": 0, "submissions": 0}
    for p in body.patients:
        if p.id:
            res = await db.execute(select(Patient).where(Patient.id == p.id))
            existing = res.scalar_one_or_none()
            if existing and (str(existing.owner_id) == str(user.id) or await can_write_resource(db, user, "patient", existing.id)):
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
            if existing and (str(existing.owner_id) == str(user.id) or await can_write_resource(db, user, "form", existing.id)):
                for k, v in f.model_dump(exclude={"id"}).items():
                    setattr(existing, k, v)
                out["forms"] += 1
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

    await db.commit()
    return out


@app.get("/api/sync/pull")
async def sync_pull(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Returns the user's full visible dataset for cache hydration."""
    patients = await list_patients(user=user, db=db)
    forms = await list_forms(user=user, db=db)
    submissions = await list_submissions(user=user, db=db)
    return {"patients": patients, "forms": forms, "submissions": submissions}


# ============================================================================
# Public form endpoints (no auth required)
# ============================================================================

@app.get("/api/forms/public/{share_token}", response_model=PublicFormOut)
async def get_public_form(share_token: str, db: AsyncSession = Depends(get_db)):
    """Return a form definition by share_token — no authentication required."""
    res = await db.execute(select(FormDef).where(FormDef.share_token == share_token))
    form = res.scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form not found")
    if getattr(form, "status", "active") == "closed":
        raise HTTPException(410, "This form is closed and no longer accepting responses")
    if getattr(form, "status", "active") == "draft":
        raise HTTPException(403, "This form is not yet published")
    fields = form.fields if isinstance(form.fields, list) else []
    return PublicFormOut(
        id=str(form.id),
        name=form.name,
        category=form.category,
        description=form.description,
        fields=fields,
        longitudinal=form.longitudinal,
        status=getattr(form, "status", "active"),
    )


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
