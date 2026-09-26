import os
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import List, Optional, Annotated, Any

from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator
import httpx

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
AI_MODEL = ("anthropic", "claude-sonnet-5")
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_str() -> str:
    return now_utc().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# System prompts (Italian)
# ---------------------------------------------------------------------------
INTERVIEW_SYSTEM = (
    "Sei un Personal Coach Virtuale basato su Intelligenza Artificiale, energico e motivante. "
    "Il tuo compito ORA è la Fase 1: intervista e profilazione iniziale. NON generare ancora nessun piano. "
    "Fai domande mirate, UNA o DUE alla volta, in modo conversazionale e amichevole, per raccogliere: "
    "1) Obiettivo principale (risultato finale esatto e misurabile), "
    "2) Tempistica desiderata (entro quale data/durata), "
    "3) Parametri fisici/personali rilevanti (es. altezza, peso, età, livello o situazione di partenza), "
    "4) Vincoli di budget e risorse (quanto può spendere), "
    "5) Disponibilità di tempo (ore/minuti al giorno o a settimana), "
    "6) Preferenze e limiti (alimentari, fisici, impegni). "
    "Adatta le domande al tipo di obiettivo (fitness, business, studio, lingue, ecc.). "
    "Quando hai raccolto TUTTE le informazioni necessarie, scrivi un breve riepilogo di ciò che hai capito, "
    "invita l'utente a generare il piano, e termina il messaggio ESATTAMENTE con il token [PRONTO] su una nuova riga. "
    "Non usare [PRONTO] finché non hai informazioni sufficienti. Rispondi sempre in italiano, in modo conciso."
)

PLAN_SYSTEM = (
    "Sei un Personal Coach AI esperto. In base alla conversazione di intervista fornita, genera un piano d'azione.\n"
    "Fase 2 - Fattibilità: valuta se l'obiettivo è realisticamente raggiungibile nel tempo indicato. "
    "Se è irrealistico, spiegalo nel campo feasibility_note e proponi il massimo risultato realistico, adattando la tempistica.\n"
    "Definisci tappe (milestones) settimanali concrete e misurabili.\n"
    "Fase 3 - Genera task giornaliere concrete con orari precisi, quantità e metriche verificabili.\n\n"
    "Rispondi SOLO con JSON valido, senza testo aggiuntivo, in questo schema esatto:\n"
    "{\n"
    '  "title": "titolo breve dell\'obiettivo",\n'
    '  "target_summary": "risultato finale con metrica",\n'
    '  "feasibility_note": "nota di fattibilità e tempistica realistica",\n'
    '  "duration_weeks": <intero>,\n'
    '  "start_value": "situazione di partenza (breve)",\n'
    '  "target_value": "valore obiettivo finale (breve)",\n'
    '  "milestones": [{"week": <intero>, "title": "...", "target": "valore misurabile"}],\n'
    '  "daily_tasks": [{"time": "07:00", "title": "...", "description": "azione concreta con quantità", "metric_label": "es. KM", "metric_target": <numero>, "metric_unit": "km"}]\n'
    "}\n"
    "Le daily_tasks sono il set di attività da svolgere ogni giorno (massimo 6). Ordina per orario. Tutto in italiano."
)

COACH_SYSTEM = (
    "Sei il Personal Coach AI dell'utente, energico, positivo e concreto. L'utente ha già un piano attivo. "
    "Rispondi alle sue domande, motivalo, offri consigli pratici e misurabili coerenti con il suo obiettivo. "
    "Rispondi sempre in italiano, in modo conciso e diretto."
)

CHECKIN_SYSTEM = (
    "Sei un Personal Coach AI (Fase 4: feedback e adattamento dinamico). "
    "L'utente ti fornisce il riepilogo della sua giornata, l'umore e gli ostacoli incontrati. "
    "Dai un feedback motivante e concreto: riconosci i progressi, affronta gli ostacoli con soluzioni pratiche, "
    "e suggerisci come proseguire nei prossimi giorni per raggiungere l'obiettivo nel minor tempo possibile. "
    "Rispondi in italiano, massimo 120 parole, tono energico."
)


async def call_llm(system_message: str, prompt: str, session_id: str) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model(*AI_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    return resp if isinstance(resp, str) else str(resp)


def parse_json_block(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1] if "```" in t[3:] else t
        t = t.replace("json", "", 1).strip("`").strip()
    # find first { and last }
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end != -1:
        t = t[start:end + 1]
    return json.loads(t)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
PyObjectId = Annotated[str, BeforeValidator(str)]


class SessionRequest(BaseModel):
    session_id: str


class GoalCreate(BaseModel):
    pass


class MessageCreate(BaseModel):
    content: str


class TaskLogUpdate(BaseModel):
    date: str
    completed: bool
    metric_value: Optional[float] = None


class CheckInCreate(BaseModel):
    date: str
    summary: str
    mood: str
    obstacles: Optional[str] = ""


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@api_router.post("/auth/session")
async def auth_session(body: SessionRequest):
    async with httpx.AsyncClient(timeout=30) as hc:
        r = await hc.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name", "")
    picture = data.get("picture", "")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Invalid session data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": now_utc().isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })

    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"user": user}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------
def clean_goal(g: dict) -> dict:
    g.pop("_id", None)
    return g


@api_router.post("/goals")
async def create_goal(user: dict = Depends(get_current_user)):
    goal_id = f"goal_{uuid.uuid4().hex[:12]}"
    goal = {
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "title": "Nuovo obiettivo",
        "status": "interviewing",
        "profile": {},
        "target_summary": "",
        "feasibility_note": "",
        "start_value": "",
        "target_value": "",
        "duration_weeks": 0,
        "milestones": [],
        "daily_tasks": [],
        "start_date": None,
        "target_date": None,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
        "deleted_at": None,
    }
    await db.goals.insert_one(dict(goal))

    greeting = (
        "Ciao! 💪 Sono il tuo Personal Coach. Sono qui per trasformare il tuo obiettivo in un piano d'azione "
        "quotidiano, concreto e misurabile. Per iniziare: qual è l'obiettivo che vuoi raggiungere? "
        "Sii il più preciso possibile (es. \"passare da 75 a 80 kg\", \"aumentare le vendite del 20%\", "
        "\"imparare lo spagnolo base\")."
    )
    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "role": "assistant",
        "content": greeting,
        "created_at": now_utc().isoformat(),
    }
    await db.messages.insert_one(dict(msg))
    msg.pop("_id", None)
    return {"goal": clean_goal(goal), "message": msg}


@api_router.get("/goals")
async def list_goals(user: dict = Depends(get_current_user)):
    goals = await db.goals.find(
        {"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"goals": goals}


@api_router.get("/goals/active")
async def active_goal(user: dict = Depends(get_current_user)):
    goal = await db.goals.find_one(
        {"user_id": user["user_id"], "deleted_at": None},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    return {"goal": goal}


async def _get_goal_or_404(goal_id: str, user: dict) -> dict:
    goal = await db.goals.find_one(
        {"goal_id": goal_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0}
    )
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


@api_router.get("/goals/{goal_id}")
async def get_goal(goal_id: str, user: dict = Depends(get_current_user)):
    return {"goal": await _get_goal_or_404(goal_id, user)}


@api_router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user: dict = Depends(get_current_user)):
    await _get_goal_or_404(goal_id, user)
    await db.goals.update_one(
        {"goal_id": goal_id, "user_id": user["user_id"]},
        {"$set": {"deleted_at": now_utc().isoformat()}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Messages / Coach chat
# ---------------------------------------------------------------------------
@api_router.get("/goals/{goal_id}/messages")
async def get_messages(goal_id: str, user: dict = Depends(get_current_user)):
    await _get_goal_or_404(goal_id, user)
    messages = await db.messages.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return {"messages": messages}


def build_transcript(messages: List[dict]) -> str:
    lines = []
    for m in messages:
        who = "Coach" if m["role"] == "assistant" else "Utente"
        lines.append(f"{who}: {m['content']}")
    return "\n".join(lines)


@api_router.post("/goals/{goal_id}/messages")
async def post_message(goal_id: str, body: MessageCreate, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Empty message")

    user_msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "role": "user",
        "content": content,
        "created_at": now_utc().isoformat(),
    }
    await db.messages.insert_one(dict(user_msg))
    user_msg.pop("_id", None)

    history = await db.messages.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    transcript = build_transcript(history)

    interviewing = goal["status"] == "interviewing"
    if interviewing:
        system = INTERVIEW_SYSTEM
        prompt = (
            f"Conversazione finora:\n{transcript}\n\n"
            "Continua l'intervista come coach rispondendo all'ultimo messaggio dell'utente."
        )
    else:
        system = COACH_SYSTEM + f"\n\nObiettivo dell'utente: {goal.get('target_summary','')}."
        prompt = (
            f"Conversazione finora:\n{transcript}\n\n"
            "Rispondi come coach all'ultimo messaggio dell'utente."
        )

    try:
        reply = await call_llm(system, prompt, session_id=goal_id)
    except Exception as e:
        logger.exception("LLM error")
        raise HTTPException(status_code=502, detail="AI non disponibile, riprova.")

    ready = False
    if "[PRONTO]" in reply:
        ready = True
        reply = reply.replace("[PRONTO]", "").strip()

    ai_msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "role": "assistant",
        "content": reply,
        "created_at": now_utc().isoformat(),
    }
    await db.messages.insert_one(dict(ai_msg))
    ai_msg.pop("_id", None)

    return {"message": ai_msg, "ready_to_generate": ready}


# ---------------------------------------------------------------------------
# Plan generation
# ---------------------------------------------------------------------------
@api_router.post("/goals/{goal_id}/generate-plan")
async def generate_plan(goal_id: str, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)

    history = await db.messages.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    transcript = build_transcript(history)

    prompt = (
        f"Conversazione di intervista:\n{transcript}\n\n"
        "Genera ora il piano completo in formato JSON secondo lo schema richiesto."
    )
    try:
        raw = await call_llm(PLAN_SYSTEM, prompt, session_id=f"{goal_id}-plan")
        plan = parse_json_block(raw)
    except Exception as e:
        logger.exception("Plan generation error")
        raise HTTPException(status_code=502, detail="Impossibile generare il piano, riprova.")

    daily_tasks = []
    for t in plan.get("daily_tasks", [])[:8]:
        daily_tasks.append({
            "task_id": f"task_{uuid.uuid4().hex[:8]}",
            "time": str(t.get("time", "")),
            "title": str(t.get("title", "")),
            "description": str(t.get("description", "")),
            "metric_label": str(t.get("metric_label", "")),
            "metric_target": t.get("metric_target"),
            "metric_unit": str(t.get("metric_unit", "")),
        })

    milestones = []
    for i, m in enumerate(plan.get("milestones", [])):
        milestones.append({
            "milestone_id": f"ms_{uuid.uuid4().hex[:8]}",
            "week": m.get("week", i + 1),
            "title": str(m.get("title", "")),
            "target": str(m.get("target", "")),
            "done": False,
        })

    duration_weeks = int(plan.get("duration_weeks", 4) or 4)
    start = now_utc()
    target_date = (start + timedelta(weeks=duration_weeks)).strftime("%Y-%m-%d")

    update = {
        "title": str(plan.get("title", goal["title"])),
        "status": "active",
        "target_summary": str(plan.get("target_summary", "")),
        "feasibility_note": str(plan.get("feasibility_note", "")),
        "start_value": str(plan.get("start_value", "")),
        "target_value": str(plan.get("target_value", "")),
        "duration_weeks": duration_weeks,
        "milestones": milestones,
        "daily_tasks": daily_tasks,
        "start_date": start.strftime("%Y-%m-%d"),
        "target_date": target_date,
        "updated_at": now_utc().isoformat(),
    }
    await db.goals.update_one({"goal_id": goal_id, "user_id": user["user_id"]}, {"$set": update})

    # coach summary message
    summary_msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "role": "assistant",
        "content": (
            f"🎯 Il tuo piano è pronto! {update['target_summary']}\n\n"
            f"{update['feasibility_note']}\n\n"
            "Trovi le tue attività di oggi nella schermata Piano. Forza, si comincia! 🚀"
        ),
        "created_at": now_utc().isoformat(),
    }
    await db.messages.insert_one(dict(summary_msg))

    goal.update(update)
    return {"goal": clean_goal(goal)}


# ---------------------------------------------------------------------------
# Daily tasks
# ---------------------------------------------------------------------------
async def build_today(goal: dict, user_id: str, day: str) -> List[dict]:
    logs = await db.task_logs.find(
        {"goal_id": goal["goal_id"], "user_id": user_id, "date": day}, {"_id": 0}
    ).to_list(100)
    log_map = {l["task_id"]: l for l in logs}
    result = []
    for t in goal.get("daily_tasks", []):
        log = log_map.get(t["task_id"])
        result.append({
            **t,
            "completed": bool(log["completed"]) if log else False,
            "metric_value": log["metric_value"] if log else None,
        })
    return result


@api_router.get("/goals/{goal_id}/today")
async def get_today(goal_id: str, date: Optional[str] = None, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    day = date or today_str()
    tasks = await build_today(goal, user["user_id"], day)
    completed = sum(1 for t in tasks if t["completed"])
    return {"date": day, "tasks": tasks, "completed": completed, "total": len(tasks)}


@api_router.post("/goals/{goal_id}/tasks/{task_id}/log")
async def log_task(goal_id: str, task_id: str, body: TaskLogUpdate, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    if not any(t["task_id"] == task_id for t in goal.get("daily_tasks", [])):
        raise HTTPException(status_code=404, detail="Task not found")
    await db.task_logs.update_one(
        {"goal_id": goal_id, "user_id": user["user_id"], "task_id": task_id, "date": body.date},
        {"$set": {
            "completed": body.completed,
            "metric_value": body.metric_value,
            "updated_at": now_utc().isoformat(),
        }, "$setOnInsert": {
            "log_id": f"log_{uuid.uuid4().hex[:10]}",
            "created_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------
@api_router.get("/goals/{goal_id}/progress")
async def get_progress(goal_id: str, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    total_tasks = len(goal.get("daily_tasks", []))

    # last 14 days completion series
    series = []
    today = now_utc().date()
    day_logs = await db.task_logs.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(5000)
    by_date: dict = {}
    for l in day_logs:
        by_date.setdefault(l["date"], []).append(l)

    for i in range(13, -1, -1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        logs = by_date.get(d, [])
        done = sum(1 for l in logs if l.get("completed"))
        pct = round((done / total_tasks) * 100) if total_tasks else 0
        series.append({"date": d, "completed": done, "total": total_tasks, "pct": pct})

    # streak: consecutive days (ending today or yesterday) with all tasks done
    streak = 0
    if total_tasks:
        i = 0
        while True:
            d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
            logs = by_date.get(d, [])
            done = sum(1 for l in logs if l.get("completed"))
            if done >= total_tasks and total_tasks > 0:
                streak += 1
                i += 1
            else:
                break

    total_done = sum(1 for l in day_logs if l.get("completed"))
    active_days = len([d for d, logs in by_date.items() if any(l.get("completed") for l in logs)])

    return {
        "goal": clean_goal(goal),
        "series": series,
        "streak": streak,
        "total_completed": total_done,
        "active_days": active_days,
        "milestones": goal.get("milestones", []),
    }


@api_router.post("/goals/{goal_id}/milestones/{milestone_id}/toggle")
async def toggle_milestone(goal_id: str, milestone_id: str, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    milestones = goal.get("milestones", [])
    found = False
    for m in milestones:
        if m["milestone_id"] == milestone_id:
            m["done"] = not m.get("done", False)
            found = True
    if not found:
        raise HTTPException(status_code=404, detail="Milestone not found")
    await db.goals.update_one(
        {"goal_id": goal_id, "user_id": user["user_id"]},
        {"$set": {"milestones": milestones, "updated_at": now_utc().isoformat()}},
    )
    return {"milestones": milestones}


# ---------------------------------------------------------------------------
# Check-in
# ---------------------------------------------------------------------------
@api_router.post("/goals/{goal_id}/checkin")
async def create_checkin(goal_id: str, body: CheckInCreate, user: dict = Depends(get_current_user)):
    goal = await _get_goal_or_404(goal_id, user)
    tasks = await build_today(goal, user["user_id"], body.date)
    completed = sum(1 for t in tasks if t["completed"])

    prompt = (
        f"Obiettivo: {goal.get('target_summary','')}\n"
        f"Task completate oggi: {completed}/{len(tasks)}\n"
        f"Riepilogo dell'utente: {body.summary}\n"
        f"Umore: {body.mood}\n"
        f"Ostacoli: {body.obstacles or 'nessuno'}\n\n"
        "Dai il tuo feedback di coach e i consigli per i prossimi giorni."
    )
    try:
        feedback = await call_llm(CHECKIN_SYSTEM, prompt, session_id=f"{goal_id}-checkin")
    except Exception:
        logger.exception("Checkin LLM error")
        feedback = "Ottimo lavoro per esserti fermato a riflettere! Continua così, ogni piccolo passo conta. 💪"

    checkin = {
        "checkin_id": f"chk_{uuid.uuid4().hex[:10]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "date": body.date,
        "summary": body.summary,
        "mood": body.mood,
        "obstacles": body.obstacles or "",
        "completed": completed,
        "total": len(tasks),
        "ai_feedback": feedback,
        "created_at": now_utc().isoformat(),
    }
    await db.checkins.insert_one(dict(checkin))
    checkin.pop("_id", None)

    # store feedback also in coach chat
    await db.messages.insert_one({
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "goal_id": goal_id,
        "user_id": user["user_id"],
        "role": "assistant",
        "content": f"📋 Check-in del {body.date}:\n{feedback}",
        "created_at": now_utc().isoformat(),
    })

    return {"checkin": checkin}


@api_router.get("/goals/{goal_id}/checkins")
async def list_checkins(goal_id: str, user: dict = Depends(get_current_user)):
    await _get_goal_or_404(goal_id, user)
    checkins = await db.checkins.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return {"checkins": checkins}


@api_router.get("/")
async def root():
    return {"message": "AI Personal Coach API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.goals.create_index("user_id")
    await db.messages.create_index("goal_id")
    await db.task_logs.create_index([("goal_id", 1), ("date", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
