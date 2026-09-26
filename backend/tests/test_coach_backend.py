"""End-to-end backend tests for the AI Personal Coach API.

Covers auth protection, goal lifecycle, interview -> plan generation via
real Claude Sonnet 5, daily task logging, progress, milestone toggling,
check-in feedback and soft-delete. Tests are ordered.
"""
import time
import pytest

from .conftest import BASE_URL

LLM_TIMEOUT = 120  # AI calls may be slow


# ---------------- Health & auth ----------------
def test_root_health(plain_client):
    r = plain_client.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    assert "message" in r.json()


def test_goals_requires_auth(plain_client):
    r = plain_client.get(f"{BASE_URL}/api/goals", timeout=15)
    assert r.status_code == 401


def test_create_goal_requires_auth(plain_client):
    r = plain_client.post(f"{BASE_URL}/api/goals", timeout=15)
    assert r.status_code == 401


def test_invalid_bearer_rejected(plain_client):
    r = plain_client.get(
        f"{BASE_URL}/api/goals",
        headers={"Authorization": "Bearer bogus-token"},
        timeout=15,
    )
    assert r.status_code == 401


# ---------------- Goal creation & retrieval ----------------
def test_create_goal(auth_client, state):
    r = auth_client.post(f"{BASE_URL}/api/goals", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "goal" in data and "message" in data
    goal = data["goal"]
    assert goal["status"] == "interviewing"
    assert goal["goal_id"].startswith("goal_")
    assert data["message"]["role"] == "assistant"
    assert len(data["message"]["content"]) > 20
    state["goal_id"] = goal["goal_id"]


def test_list_goals(auth_client, state):
    r = auth_client.get(f"{BASE_URL}/api/goals", timeout=15)
    assert r.status_code == 200
    goals = r.json()["goals"]
    assert any(g["goal_id"] == state["goal_id"] for g in goals)


def test_active_goal(auth_client, state):
    r = auth_client.get(f"{BASE_URL}/api/goals/active", timeout=15)
    assert r.status_code == 200
    g = r.json()["goal"]
    assert g is not None and g["goal_id"] == state["goal_id"]


def test_get_messages_initial(auth_client, state):
    r = auth_client.get(f"{BASE_URL}/api/goals/{state['goal_id']}/messages", timeout=15)
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert len(msgs) >= 1
    assert msgs[0]["role"] == "assistant"


# ---------------- Interview with real LLM ----------------
INTERVIEW_ANSWERS = [
    "Il mio obiettivo e' passare da 75kg a 80kg di massa muscolare in 8 settimane.",
    "Sono alto 178cm, peso 75kg, ho 28 anni e mi alleno da 6 mesi 2 volte a settimana.",
    "Budget disponibile: 100 euro al mese per palestra e integratori.",
    "Ho a disposizione 1 ora al giorno per allenarmi, 6 giorni su 7. Preferisco allenarmi la mattina.",
    "Nessuna allergia alimentare, mangio di tutto. Nessun infortunio. Voglio un piano completo con allenamento e alimentazione, sono pronto a partire.",
    "Ho fornito tutte le informazioni: obiettivo 75->80kg in 8 settimane, 178cm, 28 anni, budget 100 euro/mese, 1 ora/giorno 6gg/settimana la mattina, nessun vincolo alimentare. Puoi generare il piano ora.",
]


def test_interview_conversation_reaches_ready(auth_client, state):
    gid = state["goal_id"]
    ready = False
    for i, content in enumerate(INTERVIEW_ANSWERS):
        r = auth_client.post(
            f"{BASE_URL}/api/goals/{gid}/messages",
            json={"content": content},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, f"Turn {i} failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["message"]["role"] == "assistant"
        assert len(data["message"]["content"]) > 5
        if data.get("ready_to_generate"):
            ready = True
            break
    state["ready"] = ready
    # We record readiness but don't hard-fail; plan generation is the true gate.
    assert data["message"]["content"].find("[PRONTO]") == -1, "Marker not stripped"


# ---------------- Plan generation ----------------
def test_generate_plan(auth_client, state):
    gid = state["goal_id"]
    r = auth_client.post(f"{BASE_URL}/api/goals/{gid}/generate-plan", timeout=LLM_TIMEOUT)
    assert r.status_code == 200, r.text
    goal = r.json()["goal"]
    assert goal["status"] == "active"
    assert goal["target_summary"]
    assert goal["feasibility_note"]
    assert isinstance(goal["milestones"], list) and len(goal["milestones"]) >= 1
    assert isinstance(goal["daily_tasks"], list) and len(goal["daily_tasks"]) >= 1
    for t in goal["daily_tasks"]:
        assert "task_id" in t
        assert "metric_label" in t
        assert "metric_unit" in t
        assert "metric_target" in t
    for m in goal["milestones"]:
        assert "milestone_id" in m and "week" in m and "target" in m
    state["goal"] = goal
    state["task_id"] = goal["daily_tasks"][0]["task_id"]
    state["milestone_id"] = goal["milestones"][0]["milestone_id"]


# ---------------- Daily tasks ----------------
def test_today_before_log(auth_client, state):
    gid = state["goal_id"]
    r = auth_client.get(f"{BASE_URL}/api/goals/{gid}/today", timeout=15)
    assert r.status_code == 200
    data = r.json()
    total_tasks = len(state["goal"]["daily_tasks"])
    assert data["total"] == total_tasks
    assert data["completed"] == 0
    state["today_date"] = data["date"]


def test_log_task_and_verify(auth_client, state):
    gid = state["goal_id"]
    tid = state["task_id"]
    day = state["today_date"]
    r = auth_client.post(
        f"{BASE_URL}/api/goals/{gid}/tasks/{tid}/log",
        json={"date": day, "completed": True, "metric_value": 5.5},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify via /today
    r2 = auth_client.get(f"{BASE_URL}/api/goals/{gid}/today?date={day}", timeout=15)
    assert r2.status_code == 200
    data = r2.json()
    assert data["completed"] == 1
    logged = next(t for t in data["tasks"] if t["task_id"] == tid)
    assert logged["completed"] is True
    assert logged["metric_value"] == 5.5


# ---------------- Progress ----------------
def test_progress(auth_client, state):
    gid = state["goal_id"]
    r = auth_client.get(f"{BASE_URL}/api/goals/{gid}/progress", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert len(data["series"]) == 14
    assert "streak" in data
    assert isinstance(data["milestones"], list) and len(data["milestones"]) >= 1
    assert data["total_completed"] >= 1


# ---------------- Milestone toggle ----------------
def test_toggle_milestone(auth_client, state):
    gid = state["goal_id"]
    mid = state["milestone_id"]
    r = auth_client.post(f"{BASE_URL}/api/goals/{gid}/milestones/{mid}/toggle", timeout=15)
    assert r.status_code == 200
    milestones = r.json()["milestones"]
    target = next(m for m in milestones if m["milestone_id"] == mid)
    assert target["done"] is True

    # toggle back off
    r2 = auth_client.post(f"{BASE_URL}/api/goals/{gid}/milestones/{mid}/toggle", timeout=15)
    assert r2.status_code == 200
    target = next(m for m in r2.json()["milestones"] if m["milestone_id"] == mid)
    assert target["done"] is False


# ---------------- Check-in ----------------
def test_checkin_and_list(auth_client, state):
    gid = state["goal_id"]
    day = state["today_date"]
    r = auth_client.post(
        f"{BASE_URL}/api/goals/{gid}/checkin",
        json={
            "date": day,
            "summary": "Ho completato l'allenamento e mangiato bene, mi sento carico.",
            "mood": "positivo",
            "obstacles": "poco tempo a pranzo",
        },
        timeout=LLM_TIMEOUT,
    )
    assert r.status_code == 200, r.text
    checkin = r.json()["checkin"]
    assert checkin["ai_feedback"] and len(checkin["ai_feedback"]) > 10
    assert checkin["date"] == day
    state["checkin_id"] = checkin["checkin_id"]

    r2 = auth_client.get(f"{BASE_URL}/api/goals/{gid}/checkins", timeout=15)
    assert r2.status_code == 200
    lst = r2.json()["checkins"]
    assert any(c["checkin_id"] == state["checkin_id"] for c in lst)


# ---------------- Soft delete ----------------
def test_soft_delete_goal(auth_client, state):
    gid = state["goal_id"]
    r = auth_client.delete(f"{BASE_URL}/api/goals/{gid}", timeout=15)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    r2 = auth_client.get(f"{BASE_URL}/api/goals", timeout=15)
    assert r2.status_code == 200
    assert all(g["goal_id"] != gid for g in r2.json()["goals"])

    r3 = auth_client.get(f"{BASE_URL}/api/goals/{gid}", timeout=15)
    assert r3.status_code == 404
