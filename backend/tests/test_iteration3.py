"""Iteration 3 backend tests for Aura AI:
- Trial is now 14 days (fresh user has 13 or 14 days_left)
- Feature-level gating: CORE endpoints (goals CRUD, messages, generate-plan,
  today, task log, checkin, accountability partner + share) are FREE even for
  expired trial users. Only PREMIUM endpoints return 402 for expired users:
    POST /api/coach/sos, POST /api/voice/transcribe, POST /api/tts
- POST /api/settings/voice {voice_gender} persists on the user
- POST /api/tts {text} returns {url, voice} (onyx for male, nova for female)
- GET /api/tts/{key}.mp3 returns audio/mpeg bytes; caching works
- Empty/whitespace text to /api/tts returns 400 for entitled users
- Creator (email otmanchahy@gmail.com) bypasses paywall on all premium features
"""
import io
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

from .conftest import BASE_URL, MONGO_URL, DB_NAME

LLM_TIMEOUT = 120


def _seed_user(mongo, *, email, is_admin=False, has_sub=False,
               created_days_ago=0, partner_email="", voice_gender="female"):
    uid = f"user_it3_{uuid.uuid4().hex[:8]}"
    token = f"tok_{uuid.uuid4().hex[:16]}"
    created_at = datetime.now(timezone.utc) - timedelta(days=created_days_ago)
    mongo.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": f"Test {email}",
        "picture": "",
        "is_admin": is_admin,
        "has_active_subscription": has_sub,
        "partner_email": partner_email,
        "voice_gender": voice_gender,
        "created_at": created_at.isoformat(),
    })
    now = datetime.now(timezone.utc)
    mongo.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })
    return uid, token


@pytest.fixture(scope="module")
def mongo_client():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def users(mongo_client):
    created = []

    def factory(**kwargs):
        uid, token = _seed_user(mongo_client, **kwargs)
        created.append(uid)
        return uid, token

    yield factory

    for uid in created:
        mongo_client.user_sessions.delete_many({"user_id": uid})
        mongo_client.users.delete_many({"user_id": uid})
        mongo_client.goals.delete_many({"user_id": uid})
        mongo_client.messages.delete_many({"user_id": uid})
        mongo_client.task_logs.delete_many({"user_id": uid})
        mongo_client.checkins.delete_many({"user_id": uid})


def _client(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


# =========================================================================
# Trial 14 days
# =========================================================================
class TestTrial14Days:
    def test_fresh_user_has_14_or_13_days_left(self, users):
        _, token = users(email=f"trial14_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        r = _client(token).get(f"{BASE_URL}/api/subscription/status", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["access"] == "trial"
        assert d["level"] == "trial"
        assert d["paywall"] is False
        assert d["days_left"] in (13, 14), f"expected 13 or 14, got {d['days_left']}"


# =========================================================================
# Feature-level gating: expired user -> CORE endpoints FREE
# =========================================================================
class TestExpiredCoreEndpointsFree:
    """Expired user (~20 days old, not admin, no sub) should still be able to
    use core coaching endpoints (goals, messages, plan, today, task log,
    check-in, accountability partner + share). Only premium features are gated.
    """

    def test_status_reports_paywall_true(self, users):
        _, token = users(email=f"exp_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20)
        r = _client(token).get(f"{BASE_URL}/api/subscription/status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["access"] == "locked"
        assert d["paywall"] is True
        assert d["days_left"] == 0

    def test_create_goal_free_for_expired(self, users):
        _, token = users(email=f"exp_goal_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20)
        c = _client(token)
        r = c.post(f"{BASE_URL}/api/goals", timeout=30)
        assert r.status_code == 200, f"expected 200 (FREE), got {r.status_code}: {r.text}"
        assert r.json()["goal"]["goal_id"].startswith("goal_")

    def test_full_core_flow_free_for_expired(self, users):
        _, token = users(email=f"exp_full_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20,
                         partner_email="delivered@resend.dev")
        c = _client(token)

        # goals -> messages -> generate-plan -> today -> log -> checkin -> share
        r = c.post(f"{BASE_URL}/api/goals", timeout=30)
        assert r.status_code == 200, r.text
        gid = r.json()["goal"]["goal_id"]

        for msg in [
            "Voglio correre 5km in meno di 30 minuti entro 6 settimane.",
            "Sono alto 175cm, peso 72kg, 30 anni, corro sporadicamente.",
            "Budget 30 euro/mese, 45 min al giorno 5 giorni a settimana. Puoi generare il piano ora.",
        ]:
            rr = c.post(f"{BASE_URL}/api/goals/{gid}/messages",
                        json={"content": msg}, timeout=LLM_TIMEOUT)
            assert rr.status_code == 200, f"messages 402? {rr.status_code} {rr.text}"

        rp = c.post(f"{BASE_URL}/api/goals/{gid}/generate-plan",
                    timeout=LLM_TIMEOUT)
        assert rp.status_code == 200, f"generate-plan 402? {rp.status_code} {rp.text}"
        goal = rp.json()["goal"]
        assert goal["status"] == "active"
        assert len(goal["daily_tasks"]) > 0

        rt = c.get(f"{BASE_URL}/api/goals/{gid}/today", timeout=15)
        assert rt.status_code == 200, rt.text
        today_data = rt.json()
        assert "tasks" in today_data

        first_task = today_data["tasks"][0] if today_data["tasks"] else None
        if first_task:
            rl = c.post(
                f"{BASE_URL}/api/goals/{gid}/tasks/{first_task['task_id']}/log",
                json={"date": today_data["date"], "completed": True,
                      "metric_value": 1.0},
                timeout=15,
            )
            assert rl.status_code == 200, rl.text

        rc = c.post(
            f"{BASE_URL}/api/goals/{gid}/checkin",
            json={"date": today_data["date"],
                  "summary": "Bene", "mood": "buono", "obstacles": ""},
            timeout=LLM_TIMEOUT,
        )
        assert rc.status_code == 200, f"checkin 402? {rc.status_code} {rc.text}"

        # accountability partner already set via seed
        rpartner = c.post(f"{BASE_URL}/api/accountability/partner",
                          json={"email": "delivered@resend.dev"}, timeout=15)
        assert rpartner.status_code == 200, rpartner.text

        rshare = c.post(f"{BASE_URL}/api/accountability/share", timeout=60)
        assert rshare.status_code == 200, f"share 402? {rshare.status_code} {rshare.text}"
        assert rshare.json()["ok"] is True


# =========================================================================
# Feature-level gating: expired user -> PREMIUM endpoints 402
# =========================================================================
class TestExpiredPremiumBlocked:
    def test_sos_premium_returns_402(self, users):
        _, token = users(email=f"exp_sos_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20)
        r = _client(token).post(f"{BASE_URL}/api/coach/sos",
                                 json={"issue": "help"}, timeout=15)
        assert r.status_code == 402, r.text

    def test_tts_premium_returns_402(self, users):
        _, token = users(email=f"exp_tts_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20)
        r = _client(token).post(f"{BASE_URL}/api/tts",
                                 json={"text": "Ciao"}, timeout=15)
        assert r.status_code == 402, r.text

    def test_voice_transcribe_premium_returns_402(self, users):
        _, token = users(email=f"exp_v_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=20)
        # premium check must run BEFORE reading body — sending empty file
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("empty.wav", b"", "audio/wav")},
            timeout=30,
        )
        assert r.status_code == 402, f"expected 402 (premium gate), got {r.status_code}: {r.text[:200]}"


# =========================================================================
# Creator bypass on premium features
# =========================================================================
class TestCreatorPremiumAccess:
    def test_creator_status_and_sos(self, users, mongo_client):
        mongo_client.users.delete_many({"email": "otmanchahy@gmail.com"})
        mongo_client.user_sessions.delete_many({})  # clean stray tokens
        _, token = users(email="otmanchahy@gmail.com", created_days_ago=30,
                         is_admin=False)
        c = _client(token)
        r = c.get(f"{BASE_URL}/api/subscription/status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["access"] == "full"
        assert d["level"] == "creator"

        rs = c.post(f"{BASE_URL}/api/coach/sos",
                    json={"issue": "Non ho voglia di iniziare oggi"},
                    timeout=LLM_TIMEOUT)
        assert rs.status_code == 200, rs.text
        assert isinstance(rs.json().get("coaching"), str)
        assert len(rs.json()["coaching"].strip()) > 20


# =========================================================================
# Voice settings + TTS
# =========================================================================
class TestVoiceSettingsAndTTS:
    def test_set_voice_male(self, users):
        _, token = users(email=f"vset_m_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        r = _client(token).post(f"{BASE_URL}/api/settings/voice",
                                 json={"voice_gender": "male"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["voice_gender"] == "male"

    def test_set_voice_female(self, users):
        _, token = users(email=f"vset_f_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        r = _client(token).post(f"{BASE_URL}/api/settings/voice",
                                 json={"voice_gender": "female"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["voice_gender"] == "female"

    def test_tts_male_uses_onyx_and_returns_playable_mp3(self, users):
        _, token = users(email=f"tts_m_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0, voice_gender="male")
        c = _client(token)
        # explicitly set to male via API too (redundant but reflects flow)
        rv = c.post(f"{BASE_URL}/api/settings/voice",
                    json={"voice_gender": "male"}, timeout=15)
        assert rv.status_code == 200, rv.text

        r = c.post(f"{BASE_URL}/api/tts",
                   json={"text": "Ciao, questo è un test"}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["voice"] == "onyx"
        url_path = body["url"]
        assert url_path.startswith("/api/tts/") and url_path.endswith(".mp3")

        # GET the audio
        r2 = c.get(f"{BASE_URL}{url_path}", timeout=60)
        assert r2.status_code == 200, r2.text[:200]
        assert r2.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r2.content) > 500, f"audio bytes too small: {len(r2.content)}"

    def test_tts_female_uses_nova(self, users):
        _, token = users(email=f"tts_f_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0, voice_gender="female")
        c = _client(token)
        rv = c.post(f"{BASE_URL}/api/settings/voice",
                    json={"voice_gender": "female"}, timeout=15)
        assert rv.status_code == 200

        r = c.post(f"{BASE_URL}/api/tts",
                   json={"text": "Ciao a tutti, benvenuti"}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["voice"] == "nova"

    def test_tts_cache_second_call_fast(self, users):
        _, token = users(email=f"tts_c_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0, voice_gender="female")
        c = _client(token)
        c.post(f"{BASE_URL}/api/settings/voice",
               json={"voice_gender": "female"}, timeout=15)
        text = "Testo di cache per Aura AI"
        r1 = c.post(f"{BASE_URL}/api/tts", json={"text": text},
                    timeout=LLM_TIMEOUT)
        assert r1.status_code == 200, r1.text
        url1 = r1.json()["url"]
        # second call
        import time
        t0 = time.time()
        r2 = c.post(f"{BASE_URL}/api/tts", json={"text": text}, timeout=30)
        elapsed = time.time() - t0
        assert r2.status_code == 200, r2.text
        assert r2.json()["url"] == url1
        # cache should make it clearly faster than typical TTS gen (<8s)
        assert elapsed < 8, f"second call too slow: {elapsed:.1f}s"

    def test_tts_empty_text_returns_400(self, users):
        _, token = users(email=f"tts_e_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        c = _client(token)
        r = c.post(f"{BASE_URL}/api/tts", json={"text": "   "}, timeout=15)
        assert r.status_code == 400, r.text

    def test_tts_whitespace_only_after_cleanup_returns_400(self, users):
        _, token = users(email=f"tts_ws_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        c = _client(token)
        # only emojis + markdown -> clean_for_tts strips everything
        r = c.post(f"{BASE_URL}/api/tts", json={"text": "🚀🎯 ***"}, timeout=15)
        assert r.status_code == 400, r.text

    def test_get_tts_404_for_unknown_key(self, users):
        _, token = users(email=f"tts_404_{uuid.uuid4().hex[:6]}@example.com",
                         created_days_ago=0)
        c = _client(token)
        r = c.get(f"{BASE_URL}/api/tts/deadbeef.mp3", timeout=15)
        assert r.status_code == 404, r.text
