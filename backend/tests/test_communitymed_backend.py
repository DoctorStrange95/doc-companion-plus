"""End-to-end backend tests for CommunityMed Pro.

Covers:
- /api/health
- /api/auth/{register,login,me}
- /api/patients (CRUD + visibility)
- /api/forms (CRUD + JSONB roundtrip)
- /api/submissions (JSONB roundtrip)
- /api/shares (create / 404 unknown email / 403 non-owner)
- /api/sync/push (idempotent) + /api/sync/pull
"""

from __future__ import annotations

import os
import time
import uuid
import requests
import pytest

BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@communitymed.app"
ADMIN_PASSWORD = "admin12345"

# Unique-per-run emails to avoid collision with prior runs
_RUN = uuid.uuid4().hex[:8]
USER_A_EMAIL = f"test_a_{_RUN}@example.com"
USER_B_EMAIL = f"test_b_{_RUN}@example.com"
TEST_PASSWORD = "pass1234"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _new_session() -> requests.Session:
    """Always isolate cookie jars so Bearer header is the only auth signal."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def session():
    # Generic session for unauthenticated/health calls. Cookies are stripped
    # after each register/login to avoid the cookie-precedence cross-talk in
    # /app/backend/auth.py (cookie wins over Authorization header).
    return _new_session()


@pytest.fixture(autouse=True)
def _clear_session_cookies(session):
    """Defensive: keep the shared session cookie-free so Bearer headers
    are the only auth signal (auth.py prefers cookies over Authorization)."""
    session.cookies.clear()
    yield
    session.cookies.clear()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(email: str, name: str) -> dict:
    s = _new_session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": TEST_PASSWORD, "name": name})
    assert r.status_code == 200, f"register {email} failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="session")
def admin_token():
    s = _new_session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_a():
    return _register(USER_A_EMAIL, "User A")


@pytest.fixture(scope="session")
def user_b():
    return _register(USER_B_EMAIL, "User B")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
class TestHealth:
    def test_health(self, session):
        r = session.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class TestAuth:
    def test_register_returns_token_and_user(self, user_a):
        assert user_a["token"]
        assert isinstance(user_a["token"], str) and len(user_a["token"]) > 20
        assert user_a["user"]["email"] == USER_A_EMAIL
        assert user_a["user"]["role"] in ("worker", "admin")
        assert "id" in user_a["user"]

    def test_register_duplicate_returns_409(self, session, user_a):
        r = session.post(f"{BASE_URL}/api/auth/register",
                         json={"email": USER_A_EMAIL, "password": TEST_PASSWORD, "name": "Dup"})
        assert r.status_code == 409, r.text

    def test_login_valid(self, user_a):
        s = _new_session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": USER_A_EMAIL, "password": TEST_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == USER_A_EMAIL
        assert body["access_token"]

    def test_login_invalid(self):
        s = _new_session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": USER_A_EMAIL, "password": "wrong-pass"})
        assert r.status_code == 401, r.text

    def test_me_without_auth_returns_401(self, session):
        # Use a fresh client so cookie jar from prior register/login can't leak
        bare = requests.Session()
        r = bare.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401, r.text

    def test_me_with_bearer(self, session, user_a):
        r = session.get(f"{BASE_URL}/api/auth/me", headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == USER_A_EMAIL
        assert body["id"] == user_a["user"]["id"]


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def patient_a(session, user_a):
    payload = {
        "name": f"TEST Patient {_RUN}",
        "dob": "1990-01-01",
        "sex": "Male",
        "village": "Testville",
        "phone": "555-0100",
        "tags": ["pilot", "TEST"],
        "status": "Active",
    }
    r = session.post(f"{BASE_URL}/api/patients", json=payload,
                     headers=_bearer(user_a["token"]))
    assert r.status_code == 200, r.text
    return r.json()


class TestPatients:
    def test_create_patient_owner_id_is_current_user(self, patient_a, user_a):
        assert patient_a["owner_id"] == user_a["user"]["id"]
        assert patient_a["name"].startswith("TEST Patient")
        assert patient_a["sex"] == "Male"
        assert patient_a["tags"] == ["pilot", "TEST"]
        assert patient_a["shared"] is False
        assert "id" in patient_a

    def test_list_patients_includes_own(self, session, user_a, patient_a):
        r = session.get(f"{BASE_URL}/api/patients", headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        ids = [p["id"] for p in r.json()]
        assert patient_a["id"] in ids

    def test_list_patients_excludes_other_users_until_shared(
        self, session, user_b, patient_a
    ):
        r = session.get(f"{BASE_URL}/api/patients", headers=_bearer(user_b["token"]))
        assert r.status_code == 200, r.text
        ids = [p["id"] for p in r.json()]
        assert patient_a["id"] not in ids


# ---------------------------------------------------------------------------
# Forms (JSONB roundtrip + longitudinal flag)
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def form_a(session, user_a):
    payload = {
        "name": f"TEST Form {_RUN}",
        "category": "intake",
        "description": "round trip jsonb",
        "fields": [
            {"key": "bp_sys", "type": "number", "label": "BP Systolic"},
            {"key": "notes", "type": "text", "label": "Notes"},
        ],
        "longitudinal": True,
    }
    r = session.post(f"{BASE_URL}/api/forms", json=payload,
                     headers=_bearer(user_a["token"]))
    assert r.status_code == 200, r.text
    return r.json()


class TestForms:
    def test_create_form_roundtrip(self, form_a, user_a):
        assert form_a["owner_id"] == user_a["user"]["id"]
        assert form_a["longitudinal"] is True
        assert isinstance(form_a["fields"], list) and len(form_a["fields"]) == 2
        assert form_a["fields"][0]["key"] == "bp_sys"

    def test_list_forms_includes_own(self, session, user_a, form_a):
        r = session.get(f"{BASE_URL}/api/forms", headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        # find ours
        match = [f for f in r.json() if f["id"] == form_a["id"]]
        assert match, "created form not in list"
        assert match[0]["longitudinal"] is True
        assert match[0]["fields"] == form_a["fields"]


# ---------------------------------------------------------------------------
# Submissions (JSONB roundtrip)
# ---------------------------------------------------------------------------
class TestSubmissions:
    def test_create_submission_roundtrip(self, session, user_a, patient_a, form_a):
        body = {
            "patient_id": patient_a["id"],
            "form_id": form_a["id"],
            "form_name": form_a["name"],
            "data": {"bp_sys": 128, "notes": "TEST jsonb roundtrip"},
        }
        r = session.post(f"{BASE_URL}/api/submissions", json=body,
                         headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        sub = r.json()
        assert sub["owner_id"] == user_a["user"]["id"]
        assert sub["data"]["bp_sys"] == 128
        assert sub["data"]["notes"] == "TEST jsonb roundtrip"

        # GET to verify persistence
        r = session.get(f"{BASE_URL}/api/submissions",
                        headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        match = [s for s in r.json() if s["id"] == sub["id"]]
        assert match, "submission not persisted"
        assert match[0]["data"]["bp_sys"] == 128


# ---------------------------------------------------------------------------
# Shares
# ---------------------------------------------------------------------------
class TestShares:
    def test_share_to_unregistered_email_returns_404(
        self, session, user_a, patient_a
    ):
        r = session.post(
            f"{BASE_URL}/api/shares",
            json={
                "resource_type": "patient",
                "resource_id": patient_a["id"],
                "email": f"never_exists_{_RUN}@example.com",
            },
            headers=_bearer(user_a["token"]),
        )
        assert r.status_code == 404, r.text

    def test_share_resource_not_owned_returns_403(
        self, session, user_b, patient_a
    ):
        # user_b tries to share user_a's patient
        r = session.post(
            f"{BASE_URL}/api/shares",
            json={
                "resource_type": "patient",
                "resource_id": patient_a["id"],
                "email": ADMIN_EMAIL,
            },
            headers=_bearer(user_b["token"]),
        )
        assert r.status_code == 403, r.text

    def test_share_patient_to_user_b_appears_in_b_list(
        self, session, user_a, user_b, patient_a
    ):
        r = session.post(
            f"{BASE_URL}/api/shares",
            json={
                "resource_type": "patient",
                "resource_id": patient_a["id"],
                "email": USER_B_EMAIL,
                "can_edit": False,
            },
            headers=_bearer(user_a["token"]),
        )
        assert r.status_code == 200, r.text
        sh = r.json()
        assert sh["resource_type"] == "patient"
        assert sh["resource_id"] == patient_a["id"]
        assert sh["shared_with_email"] == USER_B_EMAIL

        # GET /api/patients as B should now contain patient with shared:true
        r = session.get(f"{BASE_URL}/api/patients", headers=_bearer(user_b["token"]))
        assert r.status_code == 200, r.text
        match = [p for p in r.json() if p["id"] == patient_a["id"]]
        assert match, "shared patient not visible to user B"
        assert match[0]["shared"] is True


# ---------------------------------------------------------------------------
# Delete (only owner)
# ---------------------------------------------------------------------------
class TestDelete:
    def test_non_owner_cannot_delete(self, session, user_a, user_b, patient_a):
        # B has shared read access → should get 403, not 200/204
        r = session.delete(
            f"{BASE_URL}/api/patients/{patient_a['id']}",
            headers=_bearer(user_b["token"]),
        )
        assert r.status_code == 403, r.text

    def test_owner_can_delete_then_404(self, session, user_a):
        # create a throwaway patient and delete it
        body = {
            "name": f"TEST Delete {_RUN}",
            "dob": "1985-05-05",
            "sex": "Female",
            "village": "Trash",
        }
        r = session.post(f"{BASE_URL}/api/patients", json=body,
                         headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        r = session.delete(f"{BASE_URL}/api/patients/{pid}",
                           headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Subsequent delete returns 404
        r = session.delete(f"{BASE_URL}/api/patients/{pid}",
                           headers=_bearer(user_a["token"]))
        assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# Sync push/pull (idempotency)
# ---------------------------------------------------------------------------
class TestSync:
    def test_sync_push_idempotent_and_pull(self, session, user_a, patient_a, form_a):
        sub_id = str(uuid.uuid4())
        new_patient_id = str(uuid.uuid4())
        new_form_id = str(uuid.uuid4())
        payload = {
            "patients": [
                {
                    "id": new_patient_id,
                    "name": f"TEST Sync Patient {_RUN}",
                    "dob": "2000-02-02",
                    "sex": "Other",
                    "village": "Syncville",
                    "tags": [],
                }
            ],
            "forms": [
                {
                    "id": new_form_id,
                    "name": f"TEST Sync Form {_RUN}",
                    "category": "sync",
                    "fields": [{"key": "x", "type": "text"}],
                    "longitudinal": False,
                }
            ],
            "submissions": [
                {
                    "id": sub_id,
                    "patient_id": patient_a["id"],
                    "form_id": form_a["id"],
                    "form_name": form_a["name"],
                    "data": {"k": "v"},
                }
            ],
        }
        # First push
        r1 = session.post(f"{BASE_URL}/api/sync/push", json=payload,
                          headers=_bearer(user_a["token"]))
        assert r1.status_code == 200, r1.text

        # Second push should be idempotent — submission count for sub_id should not duplicate
        r2 = session.post(f"{BASE_URL}/api/sync/push", json=payload,
                          headers=_bearer(user_a["token"]))
        assert r2.status_code == 200, r2.text

        # Pull and assert the IDs appear exactly once
        r = session.get(f"{BASE_URL}/api/sync/pull",
                        headers=_bearer(user_a["token"]))
        assert r.status_code == 200, r.text
        snapshot = r.json()
        pat_ids = [p["id"] for p in snapshot["patients"]]
        form_ids = [f["id"] for f in snapshot["forms"]]
        sub_ids = [s["id"] for s in snapshot["submissions"]]
        assert pat_ids.count(new_patient_id) == 1, "patient duplicated by sync push"
        assert form_ids.count(new_form_id) == 1, "form duplicated by sync push"
        assert sub_ids.count(sub_id) == 1, "submission duplicated by sync push"
