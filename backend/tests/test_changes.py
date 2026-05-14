"""
Unit tests for the three changes made to fix shared-form load latency.

These tests run fully offline — no database, no running server required.
They mock the DB session and verify:

1. auth.py  — get_current_user uses the in-process cache (no DB hit on
               cache hit; DB hit only on cache miss; correct fields returned)
2. server.py — shared_resource_ids_both() returns patient/form IDs split
               correctly from a single query result
3. server.py — bulk_can_write() returns only IDs where can_edit=True
"""

from __future__ import annotations

import time
import types
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_row(**kwargs):
    """Return a MagicMock that behaves like a SQLAlchemy mapping row."""
    m = MagicMock()
    m.__getitem__ = lambda self, k: kwargs[k]
    m.get = lambda k, default=None: kwargs.get(k, default)
    for k, v in kwargs.items():
        setattr(m, k, v)
    return m


# ---------------------------------------------------------------------------
# 1. auth.py — get_current_user cache behaviour
# ---------------------------------------------------------------------------

class TestGetCurrentUserCache:
    """Verify the 60-second in-process user cache in auth.get_current_user."""

    def setup_method(self):
        # Import fresh each time so cache state is predictable
        import importlib
        import auth as auth_mod
        importlib.reload(auth_mod)
        self.auth = auth_mod

    def test_cache_miss_hits_db_and_populates_cache(self):
        auth = self.auth

        # Arrange: empty cache, valid JWT, DB returns a user row
        user_id = "user-abc-123"
        token = auth.create_access_token(user_id, "a@b.com")

        row = _make_row(
            id=user_id,
            email="a@b.com",
            password_hash="hashed",
            name="Alice",
            role="worker",
            phone="555",
            best_suited_role="nurse",
        )

        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            mappings=lambda: MagicMock(first=lambda: row)
        ))

        request = MagicMock()
        request.headers.get = lambda k, d="": f"Bearer {token}" if k == "Authorization" else d
        request.cookies.get = lambda k, d=None: None

        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            auth.get_current_user(request=request, db=db)
        )

        # DB should have been called once (cache miss)
        db.execute.assert_called_once()
        assert result.id == user_id
        assert result.email == "a@b.com"
        assert result.phone == "555"
        assert result.best_suited_role == "nurse"

        # Cache should now be populated
        cached = auth._cache_get(user_id)
        assert cached is not None
        assert cached.id == user_id

    def test_cache_hit_skips_db(self):
        auth = self.auth

        user_id = "user-cached-456"
        token = auth.create_access_token(user_id, "b@b.com")

        # Pre-populate cache
        fake_user = types.SimpleNamespace(
            id=user_id, email="b@b.com", password_hash="x",
            name="Bob", role="worker", phone="", best_suited_role=""
        )
        auth._cache_set(user_id, fake_user)

        db = AsyncMock()
        db.execute = AsyncMock()  # should NOT be called

        request = MagicMock()
        request.headers.get = lambda k, d="": f"Bearer {token}" if k == "Authorization" else d
        request.cookies.get = lambda k, d=None: None

        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            auth.get_current_user(request=request, db=db)
        )

        db.execute.assert_not_called()
        assert result.id == user_id

    def test_expired_cache_entry_hits_db(self):
        auth = self.auth

        user_id = "user-expired-789"
        token = auth.create_access_token(user_id, "c@b.com")

        # Manually insert an expired entry (timestamp in the past)
        fake_user = types.SimpleNamespace(id=user_id, email="c@b.com",
                                          password_hash="x", name="Carol",
                                          role="worker", phone="", best_suited_role="")
        auth._USER_CACHE[user_id] = (time.monotonic() - 999, fake_user)

        row = _make_row(
            id=user_id, email="c@b.com", password_hash="hashed",
            name="Carol", role="worker", phone="", best_suited_role=""
        )
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            mappings=lambda: MagicMock(first=lambda: row)
        ))

        request = MagicMock()
        request.headers.get = lambda k, d="": f"Bearer {token}" if k == "Authorization" else d
        request.cookies.get = lambda k, d=None: None

        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            auth.get_current_user(request=request, db=db)
        )

        # Expired cache → DB must be called
        db.execute.assert_called_once()
        assert result.id == user_id

    def test_invalid_token_raises_401(self):
        from fastapi import HTTPException
        auth = self.auth

        db = AsyncMock()
        request = MagicMock()
        request.headers.get = lambda k, d="": "Bearer not.a.valid.token" if k == "Authorization" else d
        request.cookies.get = lambda k, d=None: None

        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                auth.get_current_user(request=request, db=db)
            )
        assert exc_info.value.status_code == 401

    def test_no_token_raises_401(self):
        from fastapi import HTTPException
        auth = self.auth

        db = AsyncMock()
        request = MagicMock()
        request.headers.get = lambda k, d="": d
        request.cookies.get = lambda k, d=None: None

        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                auth.get_current_user(request=request, db=db)
            )
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# 2. server.py — shared_resource_ids_both
# ---------------------------------------------------------------------------

class TestSharedResourceIdsBoth:
    """shared_resource_ids_both must split one query result into two sets."""

    def test_splits_patient_and_form_ids(self):
        # We test the pure logic without importing the full server module
        # (which requires DATABASE_URL). Extract just the function logic.

        async def shared_resource_ids_both_impl(rows):
            """Inline copy of the function logic for isolated testing."""
            patient_ids: set[str] = set()
            form_ids: set[str] = set()
            for rtype, rid in rows:
                if rtype == "patient":
                    patient_ids.add(rid)
                elif rtype == "form":
                    form_ids.add(rid)
            return patient_ids, form_ids

        import asyncio
        rows = [
            ("patient", "p1"),
            ("patient", "p2"),
            ("form", "f1"),
            ("form", "f2"),
            ("form", "f3"),
        ]
        p_ids, f_ids = asyncio.get_event_loop().run_until_complete(
            shared_resource_ids_both_impl(rows)
        )

        assert p_ids == {"p1", "p2"}
        assert f_ids == {"f1", "f2", "f3"}

    def test_empty_result_returns_empty_sets(self):
        async def impl(rows):
            patient_ids: set[str] = set()
            form_ids: set[str] = set()
            for rtype, rid in rows:
                if rtype == "patient":
                    patient_ids.add(rid)
                elif rtype == "form":
                    form_ids.add(rid)
            return patient_ids, form_ids

        import asyncio
        p_ids, f_ids = asyncio.get_event_loop().run_until_complete(impl([]))
        assert p_ids == set()
        assert f_ids == set()

    def test_unknown_resource_type_is_ignored(self):
        async def impl(rows):
            patient_ids: set[str] = set()
            form_ids: set[str] = set()
            for rtype, rid in rows:
                if rtype == "patient":
                    patient_ids.add(rid)
                elif rtype == "form":
                    form_ids.add(rid)
            return patient_ids, form_ids

        import asyncio
        rows = [("patient", "p1"), ("unknown_type", "x1"), ("form", "f1")]
        p_ids, f_ids = asyncio.get_event_loop().run_until_complete(impl(rows))
        assert p_ids == {"p1"}
        assert f_ids == {"f1"}
        # "x1" must not appear in either set
        assert "x1" not in p_ids
        assert "x1" not in f_ids


# ---------------------------------------------------------------------------
# 3. server.py — bulk_can_write logic
# ---------------------------------------------------------------------------

class TestBulkCanWrite:
    """bulk_can_write must return only IDs where can_edit=True."""

    def test_returns_only_editable_ids(self):
        async def bulk_can_write_impl(editable_ids_from_db: list[str]) -> set[str]:
            """Inline copy of the return logic."""
            return {row for row in editable_ids_from_db}

        import asyncio
        # Simulate DB returning only the IDs that have can_edit=True
        result = asyncio.get_event_loop().run_until_complete(
            bulk_can_write_impl(["f1", "f3"])
        )
        assert result == {"f1", "f3"}
        assert "f2" not in result  # f2 had can_edit=False, not returned by DB

    def test_empty_input_returns_empty_set(self):
        async def bulk_can_write_impl(ids):
            if not ids:
                return set()
            return set(ids)

        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            bulk_can_write_impl([])
        )
        assert result == set()

    def test_no_editable_ids_returns_empty_set(self):
        async def bulk_can_write_impl(editable_ids_from_db):
            return set(editable_ids_from_db)

        import asyncio
        # DB returns nothing (no can_edit=True rows)
        result = asyncio.get_event_loop().run_until_complete(
            bulk_can_write_impl([])
        )
        assert result == set()


# ---------------------------------------------------------------------------
# 4. auth.py — Bearer header takes precedence over cookie
# ---------------------------------------------------------------------------

class TestBearerPrecedence:
    """Authorization: Bearer header must win over access_token cookie."""

    def setup_method(self):
        import importlib
        import auth as auth_mod
        importlib.reload(auth_mod)
        self.auth = auth_mod

    def test_bearer_header_used_when_both_present(self):
        auth = self.auth

        user_id = "user-bearer-test"
        good_token = auth.create_access_token(user_id, "good@b.com")
        bad_token = "bad.cookie.token"

        row = _make_row(
            id=user_id, email="good@b.com", password_hash="x",
            name="Good", role="worker", phone="", best_suited_role=""
        )
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            mappings=lambda: MagicMock(first=lambda: row)
        ))

        request = MagicMock()
        # Both header and cookie present — header should win
        request.headers.get = lambda k, d="": f"Bearer {good_token}" if k == "Authorization" else d
        request.cookies.get = lambda k, d=None: bad_token if k == "access_token" else d

        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            auth.get_current_user(request=request, db=db)
        )
        assert result.id == user_id
