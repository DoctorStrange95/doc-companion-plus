"""SQLAlchemy models for CommunityMed Pro."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False, default="")
    role = Column(String(32), nullable=False, default="worker")
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class Patient(Base):
    __tablename__ = "patients"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    owner_id = Column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    dob = Column(String(32), nullable=False)
    sex = Column(String(16), nullable=False)
    village = Column(String(255), nullable=False)
    phone = Column(String(64), nullable=True)
    tags = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    status = Column(String(16), nullable=False, default="Active")
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=now_utc, onupdate=now_utc
    )


class FormDef(Base):
    __tablename__ = "forms"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    owner_id = Column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    category = Column(String(64), nullable=False)
    description = Column(String(2048), nullable=True)
    fields = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    longitudinal = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=now_utc, onupdate=now_utc
    )


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    owner_id = Column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    patient_id = Column(String(64), nullable=False, index=True)
    form_id = Column(String(64), nullable=False, index=True)
    form_name = Column(String(255), nullable=False)
    data = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)


class Share(Base):
    """Grants another user access to a patient or form owned by the granter."""

    __tablename__ = "shares"
    __table_args__ = (
        UniqueConstraint(
            "resource_type", "resource_id", "shared_with", name="uq_share_user_res"
        ),
        Index("ix_shares_shared_with", "shared_with"),
    )

    id = Column(String(64), primary_key=True, default=gen_uuid)
    resource_type = Column(String(16), nullable=False)  # 'patient' | 'form'
    resource_id = Column(String(64), nullable=False)
    owner_id = Column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shared_with = Column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    can_edit = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now_utc)
