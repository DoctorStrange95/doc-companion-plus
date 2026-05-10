"""CommunityMed Pro — FastAPI backend (Supabase Postgres)."""

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import os
from datetime import datetime
from typing import Any, Optional, Literal
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, or_, and_
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if missing (idempotent). Alembic migrations are the long-term path.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
    role: str

    model_config = {"from_attributes": True}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=255)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


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


class FormOut(FormIn):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    shared: bool = False

    model_config = {"from_attributes": True}


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
    can_edit: bool = False


class ShareOut(BaseModel):
    id: str
    resource_type: str
    resource_id: str
    shared_with_email: str
    can_edit: bool

    model_config = {"from_attributes": True}


# ============================================================================
# Auth routes
# ============================================================================
@app.post("/api/auth/register", response_model=TokenOut)
async def register(body: RegisterIn, response: Response, db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    res = await db.execute(select(User).where(User.email == email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=email, password_hash=hash_password(body.password), name=body.name or email.split("@")[0])
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(str(user.id), user.email)
    response.set_cookie(
        "access_token", token, httponly=True, secure=False, samesite="lax",
        max_age=60 * 60 * 24 * 7, path="/",
    )
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@app.post("/api/auth/login", response_model=TokenOut)
async def login(body: LoginIn, response: Response, db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user.id), user.email)
    response.set_cookie(
        "access_token", token, httponly=True, secure=False, samesite="lax",
        max_age=60 * 60 * 24 * 7, path="/",
    )
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@app.post("/api/auth/logout")
async def logout(response: Response, _: User = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@app.get("/api/auth/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


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
        sh.can_edit = body.can_edit
    else:
        sh = Share(
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            owner_id=user.id,
            shared_with=target.id,
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


@app.get("/api/health")
async def health():
    return {"ok": True}
