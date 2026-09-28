import os
import re
import json
import uuid
import hashlib
import logging
import tempfile
import ipaddress
from html import escape as html_escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import List, Optional, Annotated, Any

from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, File, UploadFile
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, EmailStr
import httpx

from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText

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

CREATOR_EMAIL = os.environ.get("CREATOR_EMAIL", "otmanchahy@gmail.com").lower()
TRIAL_DAYS = 14

# TTS
from emergentintegrations.llm.openai import OpenAITextToSpeech
tts_client = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY) if EMERGENT_LLM_KEY else None
VOICE_MAP = {"male": "onyx", "female": "nova"}

# Email (Emergent-managed Resend)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "AI Personal Coach")

stt_client = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY) if EMERGENT_LLM_KEY else None

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

SOS_SYSTEM = (
    "Sei il Coach di Emergenza (modalità SOS 2 minuti). L'utente è bloccato, demotivato o in difficoltà ADESSO. "
    "Dai una micro-sessione di coaching iper-focalizzata e immediatamente attuabile: "
    "1) una frase che normalizza/riconosce, 2) UNA singola azione da fare nei prossimi 2 minuti, "
    "3) una frase di spinta finale. Massimo 90 parole, tono deciso e caldo, in italiano. Niente elenchi lunghi."
)

SENTIMENT_SYSTEM = (
    "Analizza il sentiment del testo dell'utente. Rispondi con UNA sola parola tra: "
    "positivo, neutro, negativo. Nient'altro."
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
    is_admin = email.lower() == CREATOR_EMAIL
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "is_admin": is_admin}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "is_admin": is_admin,
            "has_active_subscription": False,
            "partner_email": "",
            "voice_gender": "female",
            "created_at": now_utc().isoformat(),
        })

    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "created_at": now_utc(),
            "expires_at": now_utc() + timedelta(days=7),
        }},
        upsert=True,
    )

    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"user": user, "access": compute_access(user)}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


def days_since(created_at: Any) -> int:
    if isinstance(created_at, str):
        try:
            dt = datetime.fromisoformat(created_at)
        except ValueError:
            return 0
    elif isinstance(created_at, datetime):
        dt = created_at
    else:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (now_utc() - dt).days


def compute_access(user: dict) -> dict:
    if user.get("is_admin") or user.get("email", "").lower() == CREATOR_EMAIL:
        return {"access": "full", "level": "creator", "days_left": None, "paywall": False}
    if user.get("has_active_subscription"):
        return {"access": "full", "level": "premium", "days_left": None, "paywall": False}
    used = days_since(user.get("created_at"))
    left = TRIAL_DAYS - used
    if left > 0:
        return {"access": "trial", "level": "trial", "days_left": left, "paywall": False}
    return {"access": "locked", "level": "expired", "days_left": 0, "paywall": True, "price": "9.99€/mese"}


async def require_premium(user: dict = Depends(get_current_user)) -> dict:
    acc = compute_access(user)
    if acc["paywall"]:
        raise HTTPException(status_code=402, detail="Prova gratuita terminata. Passa a Premium per usare questa funzione.")
    return user


@api_router.get("/subscription/status")
async def subscription_status(user: dict = Depends(get_current_user)):
    return compute_access(user)


@api_router.post("/subscription/activate-demo")
async def activate_demo(user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"has_active_subscription": True}})
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


# ---------------------------------------------------------------------------
# Gamification
# ---------------------------------------------------------------------------
async def _stats_for_goal(goal: dict, user_id: str) -> dict:
    total_tasks = len(goal.get("daily_tasks", []))
    day_logs = await db.task_logs.find(
        {"goal_id": goal["goal_id"], "user_id": user_id}, {"_id": 0}
    ).to_list(5000)
    by_date: dict = {}
    for l in day_logs:
        by_date.setdefault(l["date"], []).append(l)
    today = now_utc().date()
    streak = 0
    if total_tasks:
        i = 0
        while True:
            d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
            logs = by_date.get(d, [])
            done = sum(1 for l in logs if l.get("completed"))
            if done >= total_tasks:
                streak += 1
                i += 1
            else:
                break
    total_completed = sum(1 for l in day_logs if l.get("completed"))
    active_days = len([d for d, logs in by_date.items() if any(l.get("completed") for l in logs)])
    return {"streak": streak, "total_completed": total_completed, "active_days": active_days}


@api_router.get("/gamification")
async def gamification(user: dict = Depends(get_current_user)):
    goal = await db.goals.find_one(
        {"user_id": user["user_id"], "deleted_at": None, "status": "active"},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not goal:
        stats = {"streak": 0, "total_completed": 0, "active_days": 0}
        checkins_count = 0
    else:
        stats = await _stats_for_goal(goal, user["user_id"])
        checkins_count = await db.checkins.count_documents(
            {"goal_id": goal["goal_id"], "user_id": user["user_id"]}
        )
    points = stats["total_completed"] * 10 + checkins_count * 20
    badges = [
        {"title": "Primo Passo", "emoji": "👣", "desc": "Completa la prima attività", "unlocked": stats["total_completed"] >= 1},
        {"title": "Costanza", "emoji": "💪", "desc": "3 giorni attivi", "unlocked": stats["active_days"] >= 3},
        {"title": "Settimana di Fuoco", "emoji": "🏆", "desc": "7 giorni di fila", "unlocked": stats["streak"] >= 7},
        {"title": "Riflessivo", "emoji": "📋", "desc": "5 check-in completati", "unlocked": checkins_count >= 5},
        {"title": "Centurione", "emoji": "⭐", "desc": "Raggiungi 100 punti", "unlocked": points >= 100},
    ]
    return {"points": points, **stats, "checkins": checkins_count, "badges": badges}


# ---------------------------------------------------------------------------
# Emergency Coach (SOS)
# ---------------------------------------------------------------------------
class SosRequest(BaseModel):
    issue: str


@api_router.post("/coach/sos")
async def coach_sos(body: SosRequest, user: dict = Depends(require_premium)):
    issue = body.issue.strip()
    if not issue:
        raise HTTPException(status_code=400, detail="Descrivi cosa ti blocca.")
    try:
        coaching = await call_llm(SOS_SYSTEM, f"Situazione dell'utente: {issue}", session_id=f"sos-{user['user_id']}")
    except Exception:
        logger.exception("SOS LLM error")
        raise HTTPException(status_code=502, detail="Coach non disponibile, riprova.")
    return {"coaching": coaching}


# ---------------------------------------------------------------------------
# Voice check-in transcription (Whisper) + sentiment
# ---------------------------------------------------------------------------
@api_router.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), user: dict = Depends(require_premium)):
    if stt_client is None:
        raise HTTPException(status_code=503, detail="Trascrizione non configurata.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio vuoto.")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande.")
    suffix = Path(file.filename or "rec.m4a").suffix.lower()
    if suffix not in {".m4a", ".mp4", ".mp3", ".wav", ".webm", ".ogg", ".mpeg", ".mpga"}:
        suffix = ".webm" if "webm" in (file.content_type or "") else ".m4a"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            temp_path = tmp.name
        result = await stt_client.transcribe(temp_path)
        text = result if isinstance(result, str) else (result.get("text", "") if isinstance(result, dict) else str(result))
    except Exception:
        logger.exception("Whisper error")
        raise HTTPException(status_code=502, detail="Trascrizione fallita, riprova.")
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass

    sentiment = "neutro"
    if text.strip():
        try:
            s = await call_llm(SENTIMENT_SYSTEM, text, session_id=f"sent-{user['user_id']}")
            s = s.strip().lower()
            for k in ("positivo", "negativo", "neutro"):
                if k in s:
                    sentiment = k
                    break
        except Exception:
            pass
    return {"text": text, "sentiment": sentiment}


# ---------------------------------------------------------------------------
# Accountability partner (Resend email)
# ---------------------------------------------------------------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls = set(), []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms in email")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError("Email links must be https")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError("Unsafe URL in email")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    async with httpx.AsyncClient(timeout=30) as hc:
        resp = await hc.post(
            f"{EMAIL_BASE_URL}/api/v1/email/send",
            headers={"X-Email-Key": EMAIL_KEY},
            json=payload,
        )
    resp.raise_for_status()
    return resp.json().get("id")


class PartnerRequest(BaseModel):
    email: EmailStr


@api_router.get("/accountability/partner")
async def get_partner(user: dict = Depends(get_current_user)):
    return {"partner_email": user.get("partner_email", "")}


@api_router.post("/accountability/partner")
async def set_partner(body: PartnerRequest, user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user["user_id"]}, {"$set": {"partner_email": str(body.email)}}
    )
    return {"partner_email": str(body.email)}


@api_router.post("/accountability/share")
async def share_progress(user: dict = Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    partner = (fresh or {}).get("partner_email", "").strip()
    if not partner:
        raise HTTPException(status_code=400, detail="Aggiungi prima l'email del tuo partner.")
    goal = await db.goals.find_one(
        {"user_id": user["user_id"], "deleted_at": None, "status": "active"},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not goal:
        raise HTTPException(status_code=400, detail="Nessun obiettivo attivo da condividere.")
    stats = await _stats_for_goal(goal, user["user_id"])
    today = await build_today(goal, user["user_id"], today_str())
    done_today = sum(1 for t in today if t["completed"])

    name = html_escape(user.get("name") or "Il tuo amico")
    title = html_escape(goal.get("title", ""))
    target = html_escape(goal.get("target_summary", ""))

    html = (
        f'<table role="presentation" width="100%" style="max-width:560px"><tr><td '
        f'style="padding:24px;font-family:Arial,sans-serif;color:#111418">'
        f'<h2 style="color:#FF6B35;margin:0 0 8px">Progressi di {name} 🚀</h2>'
        f'<p style="margin:0 0 16px">Obiettivo: <strong>{title}</strong><br>{target}</p>'
        f'<table role="presentation" width="100%" style="border-collapse:collapse">'
        f'<tr><td style="padding:12px;background:#FFE3D8;border-radius:8px">'
        f'🔥 <strong>{stats["streak"]}</strong> giorni di fila &nbsp;|&nbsp; '
        f'✅ <strong>{done_today}/{len(today)}</strong> attività oggi &nbsp;|&nbsp; '
        f'📈 <strong>{stats["total_completed"]}</strong> task totali</td></tr></table>'
        f'<p style="margin:16px 0 0">Fai un tifo per {name}! 💪</p>'
        f'<p style="font-size:12px;color:#888;margin-top:24px">Inviato tramite AI Personal Coach. '
        f'Non chiediamo mai password o dati di pagamento via email.</p>'
        f'</td></tr></table>'
    )
    try:
        email_id = await send_email(to=partner, subject=f"I progressi di {user.get('name') or 'un amico'} su AI Personal Coach", html=html)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Email share error")
        raise HTTPException(status_code=502, detail="Invio email fallito, riprova.")
    return {"ok": True, "email_id": email_id, "partner": partner}


# ---------------------------------------------------------------------------
# Settings & Text-to-Speech
# ---------------------------------------------------------------------------
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2190-\u21FF\u2B00-\u2BFF\u2700-\u27BF]",
    flags=re.UNICODE,
)


def clean_for_tts(text: str) -> str:
    text = _EMOJI_RE.sub("", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|`]", "", text)
    return re.sub(r"\s+", " ", text).strip()[:4000]


class VoiceSetting(BaseModel):
    voice_gender: str  # "male" | "female"


@api_router.post("/settings/voice")
async def set_voice(body: VoiceSetting, user: dict = Depends(get_current_user)):
    gender = body.voice_gender if body.voice_gender in VOICE_MAP else "female"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"voice_gender": gender}})
    return {"voice_gender": gender}


class TtsRequest(BaseModel):
    text: str


@api_router.post("/tts")
async def create_tts(body: TtsRequest, user: dict = Depends(require_premium)):
    if tts_client is None:
        raise HTTPException(status_code=503, detail="Voce non configurata.")
    text = clean_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="Testo vuoto.")
    gender = user.get("voice_gender") or "female"
    voice = VOICE_MAP.get(gender, "nova")
    key = hashlib.sha256(f"{text}|{voice}|tts-1|mp3".encode()).hexdigest()

    existing = await db.tts_cache.find_one({"key": key}, {"_id": 0, "key": 1})
    if not existing:
        try:
            audio = await tts_client.generate_speech(text=text, model="tts-1", voice=voice, response_format="mp3")
        except Exception:
            logger.exception("TTS error")
            raise HTTPException(status_code=502, detail="Sintesi vocale fallita, riprova.")
        await db.tts_cache.update_one(
            {"key": key},
            {"$set": {"key": key, "audio": audio, "created_at": now_utc().isoformat()}},
            upsert=True,
        )
    return {"url": f"/api/tts/{key}.mp3", "voice": voice}


@api_router.get("/tts/{key}.mp3")
async def get_tts(key: str):
    from fastapi import Response
    doc = await db.tts_cache.find_one({"key": key}, {"_id": 0, "audio": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Audio non trovato.")
    return Response(content=bytes(doc["audio"]), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000"})


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
