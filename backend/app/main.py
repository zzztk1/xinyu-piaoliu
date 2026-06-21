from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

load_dotenv()

APP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = APP_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("XINYU_DB_PATH", DATA_DIR / "xinyu-piaoliu.sqlite"))

DIMENSIONS = ["calm", "energy", "social", "stress", "openness", "clarity"]
DIMENSION_LABELS = {
    "calm": "平静",
    "energy": "能量",
    "social": "社交",
    "stress": "压力",
    "openness": "开放",
    "clarity": "清晰",
}

THEMES = {
    "excited": {"label": "朝阳漂流", "atmosphere": "暖金海面和轻快光粒", "accent": "暖金", "motion": "轻快上扬"},
    "sad": {"label": "雨夜漂流", "atmosphere": "蓝紫雨幕和远处孤灯", "accent": "雾紫", "motion": "慢波纹"},
    "anxious": {"label": "雾中雷达", "atmosphere": "冷青雾和低频扫描", "accent": "冷青", "motion": "慢扫描"},
    "tired": {"label": "月白静港", "atmosphere": "月白灰蓝和安静停靠", "accent": "月白", "motion": "慢漂浮"},
    "angry": {"label": "暗红潮汐", "atmosphere": "低饱和红潮和短促脉冲", "accent": "珊瑚", "motion": "稳住潮线"},
    "lonely": {"label": "星空漂流", "atmosphere": "深蓝紫星空和远处灯点", "accent": "星白", "motion": "远灯靠近"},
    "mixed": {"label": "星空漂流", "atmosphere": "多束远灯和漂流轨迹", "accent": "微光青", "motion": "轻微游移"},
    "neutral": {"label": "夜航漂流", "atmosphere": "安静深海和舱灯", "accent": "冷青", "motion": "平稳"},
}

BLOCKED_TERMS = ["微信", "加我", "约出来", "自杀方法", "裸照", "转账", "银行卡"]
waiting_pool: list[dict[str, Any]] = []
typing_until: dict[str, float] = {}
matched_results: dict[str, dict[str, Any]] = {}

app = FastAPI(title="心屿漂流 API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterBody(BaseModel):
    cabinName: str
    passcode: str = ""
    profile: dict[str, Any] | None = None


class LoginBody(BaseModel):
    cabinName: str
    passcode: str = ""


class AnalyzeBody(BaseModel):
    text: str
    accountId: str | None = None
    moodChips: dict[str, list[str]] | None = None


class IntakeAnswerBody(BaseModel):
    entryId: str
    questionId: str
    answer: str
    userId: str | None = None


class MatchBody(BaseModel):
    user: dict[str, Any]
    entryId: str | None = None
    accountId: str | None = None


class MessageBody(BaseModel):
    roomId: str
    viewerId: str
    text: str


class EchoBody(BaseModel):
    roomId: str
    accountId: str | None = None
    viewerId: str | None = None
    entryId: str | None = None


class ReportBody(BaseModel):
    accountId: str | None = None
    roomId: str
    reason: str


class LeaveBody(BaseModel):
    roomId: str
    viewerId: str | None = None


class ProfileBody(BaseModel):
    accountId: str
    profile: dict[str, Any] = Field(default_factory=dict)


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
              id TEXT PRIMARY KEY,
              cabin_name TEXT UNIQUE NOT NULL,
              passcode_hash TEXT NOT NULL,
              profile_json TEXT NOT NULL DEFAULT '{}',
              avatar_theme TEXT,
              created_at INTEGER NOT NULL,
              last_seen_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS emotion_entries (
              id TEXT PRIMARY KEY,
              account_id TEXT,
              raw_text TEXT NOT NULL,
              analysis_json TEXT NOT NULL,
              mood_chips_json TEXT NOT NULL DEFAULT '{}',
              intake_answers_json TEXT NOT NULL DEFAULT '{}',
              signal_strength INTEGER NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rooms (
              id TEXT PRIMARY KEY,
              viewer_account_id TEXT,
              partner_profile_json TEXT NOT NULL,
              match_basis_json TEXT NOT NULL,
              participant_ids_json TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_activity_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              room_id TEXT NOT NULL,
              sender_id TEXT,
              sender_type TEXT NOT NULL,
              sender_alias TEXT NOT NULL,
              text TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS echo_cards (
              id TEXT PRIMARY KEY,
              account_id TEXT,
              room_id TEXT NOT NULL,
              snapshot_json TEXT NOT NULL,
              saved INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reports (
              id TEXT PRIMARY KEY,
              account_id TEXT,
              room_id TEXT NOT NULL,
              reason TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            """
        )


init_db()


def pass_hash(passcode: str) -> str:
    salt = os.getenv("XINYU_PASSCODE_SALT", "xinyu-local-demo")
    return hashlib.sha256(f"{salt}:{passcode}".encode("utf-8")).hexdigest()


def as_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def from_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def account_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "cabinName": row["cabin_name"],
        "profile": from_json(row["profile_json"], {}),
        "avatarTheme": row["avatar_theme"] or "night",
        "createdAt": row["created_at"],
        "lastSeenAt": row["last_seen_at"],
        "updatedAt": row["updated_at"],
    }


def detect_theme(text: str) -> str:
    source = text.lower()
    groups = [
        ("excited", ["开心", "高兴", "兴奋", "快乐", "惊喜", "庆祝", "顺利", "期待"]),
        ("sad", ["难过", "低落", "想哭", "委屈", "失落", "崩溃", "伤心"]),
        ("anxious", ["焦虑", "紧张", "担心", "慌", "压力", "睡不着", "害怕"]),
        ("tired", ["累", "疲惫", "低电量", "困", "不想动", "耗尽"]),
        ("angry", ["生气", "愤怒", "烦死", "不爽", "火大", "吵架"]),
        ("lonely", ["孤独", "一个人", "没人", "空", "说不清", "混乱", "迷茫"]),
    ]
    scores = {key: sum(1 for word in words if word in source) for key, words in groups}
    key, score = max(scores.items(), key=lambda item: item[1])
    return key if score else "mixed"


def clamp(value: int) -> int:
    return max(0, min(100, int(value)))


def base_dimensions(theme: str) -> dict[str, int]:
    presets = {
        "excited": {"calm": 58, "energy": 86, "social": 78, "stress": 28, "openness": 76, "clarity": 62},
        "sad": {"calm": 36, "energy": 24, "social": 34, "stress": 70, "openness": 48, "clarity": 42},
        "anxious": {"calm": 26, "energy": 58, "social": 56, "stress": 84, "openness": 52, "clarity": 36},
        "tired": {"calm": 52, "energy": 18, "social": 30, "stress": 62, "openness": 40, "clarity": 44},
        "angry": {"calm": 20, "energy": 72, "social": 46, "stress": 88, "openness": 54, "clarity": 46},
        "lonely": {"calm": 42, "energy": 38, "social": 22, "stress": 66, "openness": 62, "clarity": 40},
        "mixed": {"calm": 44, "energy": 48, "social": 52, "stress": 64, "openness": 56, "clarity": 38},
        "neutral": {"calm": 50, "energy": 50, "social": 50, "stress": 50, "openness": 50, "clarity": 45},
    }
    return presets.get(theme, presets["mixed"]).copy()


QUESTION_BANK = {
    "excited": [
        ("energy", "这份开心最想被怎么接住？", ["有人一起庆祝", "想讲完整经过", "轻轻分享就好", "还在兴奋里"]),
        ("social", "你现在更想把这份好消息给谁听？", ["陌生人也可以", "想找懂的人", "只想短聊一下", "想热闹一点"]),
    ],
    "sad": [
        ("calm", "刚才那段里，最让你沉下去的是哪一块？", ["一句话", "一个人", "一个结果", "说不清"]),
        ("openness", "今晚你希望对方靠近到什么程度？", ["安静听我说", "别问太深", "可以问一点", "先陪着就好"]),
    ],
    "anxious": [
        ("clarity", "现在脑子里最吵的是哪一类事？", ["怕结果不好", "时间来不及", "关系变化", "身体也紧"]),
        ("calm", "如果先停一秒，哪个念头最难停下来？", ["反复预演", "担心搞砸", "怕被误会", "不知道怎么办"]),
    ],
    "tired": [
        ("energy", "今晚还剩多少聊天力气？", ["低电量", "能认真聊", "只想短句", "想被安静陪着"]),
        ("social", "你希望对方怎么靠近？", ["慢一点", "别太热情", "轻松说两句", "可以多聊点"]),
    ],
    "angry": [
        ("stress", "这股火更像哪一种？", ["被冒犯了", "被误解了", "忍太久了", "事情太离谱"]),
        ("openness", "你今晚想怎么处理这口气？", ["先吐槽", "别劝我", "帮我理一下", "聊点别的"]),
    ],
    "lonely": [
        ("social", "这份空更像什么？", ["没人回应", "想被看见", "不知道找谁", "只是安静"]),
        ("openness", "如果有人停靠，你愿意说到哪里？", ["浅浅聊", "可以深入一点", "先试试看", "不聊隐私"]),
    ],
    "mixed": [
        ("clarity", "这团感受里，哪个最明显？", ["烦", "空", "慌", "期待", "累"]),
        ("calm", "现在最需要被放慢的是哪一部分？", ["脑子", "身体", "关系", "计划"]),
    ],
}


def build_question(theme: str, answered: dict[str, str]) -> dict[str, Any] | None:
    questions = QUESTION_BANK.get(theme, QUESTION_BANK["mixed"]) + QUESTION_BANK["mixed"]
    for index, (dimension, prompt, options) in enumerate(questions):
        qid = f"{dimension}-{index}"
        if qid not in answered:
            return {
                "id": qid,
                "dimension": dimension,
                "prompt": prompt,
                "options": [{"label": option} for option in options],
            }
    return None


def answer_delta(question_id: str, answer: str) -> dict[str, int]:
    dimension = question_id.split("-")[0]
    delta = {key: 0 for key in DIMENSIONS}
    delta[dimension] = 12
    if any(word in answer for word in ["低电量", "困", "累", "安静"]):
        delta["energy"] -= 10
        delta["calm"] += 6
    if any(word in answer for word in ["庆祝", "热闹", "多聊", "陌生人"]):
        delta["energy"] += 12
        delta["social"] += 10
        delta["openness"] += 6
    if any(word in answer for word in ["怕", "担心", "搞砸", "误会", "来不及"]):
        delta["stress"] += 12
        delta["clarity"] -= 4
    if any(word in answer for word in ["别问", "不聊隐私", "短聊", "浅浅"]):
        delta["openness"] -= 10
        delta["social"] -= 4
    if any(word in answer for word in ["理一下", "完整", "深入", "问一点"]):
        delta["clarity"] += 12
        delta["openness"] += 8
    return delta


def make_analysis(text: str, theme: str, dimensions: dict[str, int] | None = None) -> dict[str, Any]:
    dims = dimensions or base_dimensions(theme)
    keywords = {
        "excited": ["高亮", "分享欲", "庆祝"],
        "sad": ["低落", "轻声", "陪伴"],
        "anxious": ["焦虑", "降速", "理清"],
        "tired": ["低电量", "慢聊", "停靠"],
        "angry": ["不爽", "边界", "吐槽"],
        "lonely": ["孤独", "有人在", "靠近"],
        "mixed": ["混合", "说不清", "校准"],
    }.get(theme, ["夜航", "停靠"])
    return {
        "id": new_id("analysis"),
        "primaryEmotion": theme,
        "label": THEME_LABEL(theme),
        "intensity": clamp(60 + dims["stress"] // 4),
        "valence": 70 if theme == "excited" else 35 if theme in ["sad", "angry"] else 48,
        "arousal": dims["energy"],
        "dimensions": dims,
        "keywords": keywords,
        "matchStyle": "节奏互补" if theme in ["anxious", "angry"] else "同频停靠",
        "supportNeed": "短暂停靠，保持边界",
        "rationale": f"这段实时心情带着{THEME_LABEL(theme)}的信号，需要一个不催促的停靠点。",
        "safetyFlag": "normal",
        "emotionTheme": theme_payload(theme),
    }


def THEME_LABEL(theme: str) -> str:
    return {
        "excited": "兴奋/高兴",
        "sad": "难过/低落",
        "anxious": "焦虑",
        "tired": "疲惫",
        "angry": "愤怒/委屈",
        "lonely": "孤独",
        "mixed": "混合情绪",
        "neutral": "夜航",
    }.get(theme, "混合情绪")


def theme_payload(theme: str) -> dict[str, str]:
    return {"key": theme, **THEMES.get(theme, THEMES["mixed"])}


def entry_from_row(row: sqlite3.Row) -> dict[str, Any]:
    analysis = from_json(row["analysis_json"], {})
    return {
        "id": row["id"],
        "rawText": row["raw_text"],
        "analysis": analysis,
        "moodChips": from_json(row["mood_chips_json"], {}),
        "intakeAnswers": from_json(row["intake_answers_json"], {}),
        "signalStrength": row["signal_strength"],
        "createdAt": row["created_at"],
    }


def make_identity(theme: str, account: dict[str, Any] | None = None) -> dict[str, str]:
    names = {
        "excited": ["晨光拾贝者", "晴岸来信", "朝阳小艇"],
        "sad": ["雨港听潮", "旧伞停靠", "蓝夜守灯"],
        "anxious": ["雾灯校准员", "慢频夜航", "冷雾看守"],
        "tired": ["月白停靠", "浅眠航员", "静港旅人"],
        "angry": ["红潮收束者", "暗礁守线", "风口停泊"],
        "lonely": ["远星来客", "星港夜巡", "孤灯回声"],
        "mixed": ["夜航来信", "漂流拾音", "半醒舱灯"],
    }
    alias = account["cabinName"] if account else random.choice(names.get(theme, names["mixed"]))
    return {"alias": alias, "title": THEME_LABEL(theme), "cabinSignal": theme_payload(theme)["label"]}


def make_user(account_id: str | None, entry_id: str, analysis: dict[str, Any], signal_strength: int, account: dict[str, Any] | None = None) -> dict[str, Any]:
    theme = analysis.get("emotionTheme", {}).get("key", "mixed")
    identity = make_identity(theme, account)
    return {
        "id": account_id or new_id("guest"),
        "alias": identity["alias"],
        "avatar": identity["alias"][:2],
        "avatarTone": theme,
        "role": "human",
        "selfIntro": account.get("profile", {}).get("selfIntro") if account else "",
        "profile": account.get("profile", {}) if account else {},
        "analysis": analysis,
        "accountId": account_id,
        "entryId": entry_id,
        "signalStrength": signal_strength,
        "roomId": None,
    }


def match_basis(user_analysis: dict[str, Any], partner_analysis: dict[str, Any], signal_strength: int) -> dict[str, Any]:
    user_dims = user_analysis.get("dimensions", {})
    partner_dims = partner_analysis.get("dimensions", {})
    gaps = []
    for key in DIMENSIONS:
        gaps.append({"key": key, "gap": abs(int(user_dims.get(key, 50)) - int(partner_dims.get(key, 50)))})
    gaps.sort(key=lambda item: item["gap"])
    shared = clamp(100 - sum(item["gap"] for item in gaps[:4]) // 4)
    return {
        "mode": "短暂停靠",
        "reason": f"你们在{DIMENSION_LABELS[gaps[0]['key']]}、{DIMENSION_LABELS[gaps[1]['key']]}附近同频，另外两处保留差异，不会太像。",
        "sharedFrequency": max(shared, 68),
        "signalStrength": signal_strength,
        "safetyBoundary": "保持匿名距离，不交换隐私；不舒服可以举报或暂时离开。",
        "contrastDimensions": gaps[-2:],
        "topicSuggestions": ["刚才那段里最想被听见的一句是什么", "今晚适合聊浅一点还是深一点", "要不要先说一个很小的片段"],
    }


def public_partner_for(theme: str) -> dict[str, Any]:
    partner_theme = theme if theme != "neutral" else "mixed"
    dims = base_dimensions(partner_theme)
    for key in random.sample(DIMENSIONS, 2):
        dims[key] = clamp(dims[key] + random.choice([-24, 22]))
    analysis = make_analysis("一段匿名漂流信号", partner_theme, dims)
    alias = random.choice({
        "excited": ["晴岸来信", "晨光拾贝者", "朝阳小艇"],
        "sad": ["雨港听潮", "蓝夜守灯", "旧伞停靠"],
        "anxious": ["雾灯校准员", "慢频夜航", "冷雾看守"],
        "tired": ["月白停靠", "静港旅人", "浅眠航员"],
        "angry": ["暗礁守线", "红潮收束者", "风口停泊"],
        "lonely": ["远星来客", "星港夜巡", "孤灯回声"],
        "mixed": ["夜航来信", "漂流拾音", "半醒舱灯"],
    }.get(partner_theme, ["夜航来信"]))
    return {
        "id": new_id("partner"),
        "alias": alias,
        "avatar": alias[:2],
        "avatarTone": partner_theme,
        "role": "companion",
        "selfIntro": "今晚也只是短暂停靠一下。",
        "profile": {},
        "analysis": analysis,
        "signalStrength": 82,
        "roomId": None,
    }


def room_from_row(row: sqlite3.Row, viewer_id: str | None = None) -> dict[str, Any]:
    partner = from_json(row["partner_profile_json"], {})
    match = from_json(row["match_basis_json"], {})
    participants = from_json(row["participant_ids_json"], [])
    return {
        "id": row["id"],
        "viewerId": viewer_id or (participants[0] if participants else ""),
        "partner": partner,
        "participantIds": participants,
        "status": row["status"],
        "partnerStatus": "left" if row["status"] == "left" else "online",
        "lastActivityAt": row["last_activity_at"],
        "matchBasis": match,
    }


def room_for_viewer(row: sqlite3.Row, viewer: dict[str, Any], partner: dict[str, Any]) -> dict[str, Any]:
    room = room_from_row(row, viewer.get("id"))
    room["partner"] = {**partner, "roomId": row["id"]}
    room["viewerId"] = viewer.get("id")
    room["participantIds"] = [viewer.get("id"), partner.get("id")]
    return room


def messages_for_room(room_id: str, viewer_id: str | None = None) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM messages WHERE room_id=? ORDER BY created_at ASC", (room_id,)).fetchall()
    messages = []
    for row in rows:
        sender_id = row["sender_id"]
        messages.append(
            {
                "id": row["id"],
                "roomId": row["room_id"],
                "senderId": sender_id,
                "senderType": row["sender_type"],
                "senderAlias": row["sender_alias"],
                "text": row["text"],
                "createdAt": row["created_at"],
                "mine": bool(viewer_id and sender_id == viewer_id),
            }
        )
    return messages


def blocked_reason(text: str) -> str | None:
    for term in BLOCKED_TERMS:
        if term in text:
            return "这句话可能越过匿名边界，先换一种更安全的说法吧。"
    return None


def short_reply(user_text: str, theme: str) -> str:
    if re.fullmatch(r"[\s你妳好嗨哈喂在吗呀。！!？?]{1,6}", user_text):
        return random.choice(["嗨，在。", "嗯，我在。", "你好呀。"])
    if "刚刚" in user_text or "做什么" in user_text:
        return random.choice(["刚刷了会儿视频，有点困。", "在收拾桌子，没干什么大事。", "刚洗完澡，头发还没干。"])
    if "真人" in user_text:
        return "你就当我是今晚在这边的人吧。"
    if "微信" in user_text or "联系" in user_text:
        return "不了，我们就在这里聊一会儿吧。"
    by_theme = {
        "excited": ["听起来挺亮的，想先讲哪一段？", "这个可以庆祝一下。"],
        "sad": ["嗯，今晚像是有点沉。", "那一刻是不是挺难受的？"],
        "anxious": ["先别急，你最卡哪一步？", "我在，你慢点说。"],
        "tired": ["那就短短说两句也行。", "听着像是真的累了。"],
        "angry": ["这事确实容易上火。", "要不要先吐槽一句？"],
        "lonely": ["嗯，我在这边。", "今晚不用说得很完整。"],
        "mixed": ["我听到了，先挑一个点说。", "那你现在最想说哪句？"],
    }
    return random.choice(by_theme.get(theme, by_theme["mixed"]))


async def model_chat(messages: list[dict[str, str]], style: str = "openai") -> dict[str, Any]:
    api_key = os.getenv("STEPFUN_API_KEY") or os.getenv("STEP_API_KEY")
    model = os.getenv("STEPFUN_MODEL", "step-3.7-flash")
    if not api_key:
        return {"ok": False, "mode": "fallback", "message": "missing key"}
    try:
        if style == "anthropic":
            url = os.getenv("STEPFUN_ANTHROPIC_BASE_URL", "https://api.stepfun.com").rstrip("/") + "/v1/messages"
            payload = {
                "model": model,
                "max_tokens": 120,
                "messages": [{"role": item["role"], "content": item["content"]} for item in messages if item["role"] != "system"],
                "system": next((item["content"] for item in messages if item["role"] == "system"), ""),
            }
        else:
            url = os.getenv("STEPFUN_OPENAI_BASE_URL", "https://api.stepfun.com/v1").rstrip("/") + "/chat/completions"
            payload = {"model": model, "messages": messages, "temperature": 0.7}
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}"})
        return {"ok": response.status_code < 400, "status": response.status_code, "style": style}
    except Exception as exc:
        return {"ok": False, "style": style, "message": str(exc)}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "xinyu-piaoliu-fastapi", "stack": {"frontend": "Next.js", "backend": "FastAPI"}, "time": now_ms()}


@app.post("/api/auth/register")
def register(body: RegisterBody) -> dict[str, Any]:
    cabin = body.cabinName.strip()
    if len(cabin) < 2:
        return {"ok": False, "errorType": "validation", "message": "舱号至少需要两个字。"}
    ts = now_ms()
    account_id = new_id("acct")
    profile = body.profile or {}
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO accounts(id,cabin_name,passcode_hash,profile_json,avatar_theme,created_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (account_id, cabin, pass_hash(body.passcode), as_json(profile), "night", ts, ts, ts),
            )
            row = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        return {"ok": True, "errorType": None, "account": account_from_row(row)}
    except sqlite3.IntegrityError:
        return {"ok": False, "errorType": "duplicate", "message": "这个舱号已经有人点亮了，换一个名字吧。"}


@app.post("/api/auth/login")
def login(body: LoginBody) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE cabin_name=?", (body.cabinName.strip(),)).fetchone()
        if not row or row["passcode_hash"] != pass_hash(body.passcode):
            return {"ok": False, "errorType": "auth", "message": "舱号或临时口令不对。"}
        conn.execute("UPDATE accounts SET last_seen_at=? WHERE id=?", (now_ms(), row["id"]))
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (row["id"],)).fetchone()
    return {"ok": True, "errorType": None, "account": account_from_row(row)}


@app.get("/api/me")
def me(accountId: str = Query("")) -> dict[str, Any]:
    with db() as conn:
        account_row = conn.execute("SELECT * FROM accounts WHERE id=?", (accountId,)).fetchone()
        if not account_row:
            return {"ok": False, "errorType": "missing", "message": "没有找到这个舱号。"}
        echo_rows = conn.execute("SELECT * FROM echo_cards WHERE account_id=? ORDER BY created_at DESC", (accountId,)).fetchall()
        entry_rows = conn.execute("SELECT * FROM emotion_entries WHERE account_id=? ORDER BY created_at DESC LIMIT 20", (accountId,)).fetchall()
    echo_cards = [{"id": row["id"], "roomId": row["room_id"], "snapshot": from_json(row["snapshot_json"], {}), "createdAt": row["created_at"]} for row in echo_rows]
    return {"ok": True, "errorType": None, "account": account_from_row(account_row), "echoCards": echo_cards, "emotionTrail": [entry_from_row(row) for row in entry_rows]}


@app.patch("/api/profile")
def update_profile(body: ProfileBody) -> dict[str, Any]:
    with db() as conn:
        conn.execute("UPDATE accounts SET profile_json=?, updated_at=? WHERE id=?", (as_json(body.profile), now_ms(), body.accountId))
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (body.accountId,)).fetchone()
    if not row:
        return {"ok": False, "errorType": "missing", "message": "没有找到这个舱号。"}
    me_payload = me(body.accountId)
    return {"ok": True, "errorType": None, "account": account_from_row(row), "echoCards": me_payload.get("echoCards", []), "emotionTrail": me_payload.get("emotionTrail", [])}


@app.post("/api/analyze")
def analyze(body: AnalyzeBody) -> dict[str, Any]:
    text = body.text.strip()
    if len(text) < 4:
        return {"ok": False, "errorType": "validation", "message": "再写一点此刻感受，信号会更清楚。"}
    theme = detect_theme(text)
    analysis = make_analysis(text, theme)
    signal = 35
    answered: dict[str, str] = {}
    entry_id = new_id("entry")
    account = None
    with db() as conn:
        if body.accountId:
            row = conn.execute("SELECT * FROM accounts WHERE id=?", (body.accountId,)).fetchone()
            account = account_from_row(row) if row else None
        conn.execute(
            "INSERT INTO emotion_entries(id,account_id,raw_text,analysis_json,mood_chips_json,intake_answers_json,signal_strength,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (entry_id, body.accountId, text, as_json(analysis), as_json(body.moodChips or {}), as_json(answered), signal, now_ms()),
        )
    question = build_question(theme, answered)
    user = make_user(body.accountId, entry_id, analysis, signal, account)
    return {
        "ok": True,
        "errorType": None,
        "entry": {"id": entry_id, "rawText": text, "analysis": analysis, "moodChips": body.moodChips or {}, "intakeAnswers": {}, "signalStrength": signal, "createdAt": now_ms()},
        "analysis": analysis,
        "user": user,
        "driftIdentity": make_identity(theme, account),
        "signalTags": analysis["keywords"],
        "followUpQuestions": [question] if question else [],
        "nextQuestion": question,
        "emotionTheme": theme_payload(theme),
        "safetyBoundary": "保持匿名距离，不交换隐私；任何时候都可以离开或举报。",
        "clarityScore": signal,
    }


@app.post("/api/intake/answer")
def intake_answer(body: IntakeAnswerBody) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM emotion_entries WHERE id=?", (body.entryId,)).fetchone()
        if not row:
            return {"ok": False, "errorType": "missing", "message": "这段信号已经散了，请重新写一次。"}
        entry = entry_from_row(row)
        answers = entry["intakeAnswers"]
        answers[body.questionId] = body.answer
        analysis = entry["analysis"]
        dims = analysis.get("dimensions", base_dimensions("mixed"))
        delta = answer_delta(body.questionId, body.answer)
        for key in DIMENSIONS:
            dims[key] = clamp(int(dims.get(key, 50)) + delta.get(key, 0))
        theme = detect_theme(f"{row['raw_text']} {body.answer}")
        analysis = make_analysis(row["raw_text"], theme, dims)
        analysis["dimensionChanges"] = delta
        signal = clamp(row["signal_strength"] + 18 + max(0, delta.get("clarity", 0) // 2))
        question = build_question(theme, answers) if signal < 80 else None
        conn.execute(
            "UPDATE emotion_entries SET analysis_json=?, intake_answers_json=?, signal_strength=? WHERE id=?",
            (as_json(analysis), as_json(answers), signal, body.entryId),
        )
    user = make_user(body.userId, body.entryId, analysis, signal)
    return {
        "ok": True,
        "errorType": None,
        "entry": {**entry, "analysis": analysis, "intakeAnswers": answers, "signalStrength": signal},
        "analysis": analysis,
        "user": user,
        "signalStrength": signal,
        "clarityScore": signal,
        "signalTags": analysis["keywords"],
        "followUpQuestions": [question] if question else [],
        "nextQuestion": question,
        "questionHistory": answers,
        "emotionTheme": theme_payload(theme),
        "safetyBoundary": "保持匿名距离，不交换隐私；不舒服可以举报或暂时离开。",
        "readyToMatch": signal >= 80,
    }


def create_room(viewer: dict[str, Any], partner: dict[str, Any], entry_id: str | None = None) -> dict[str, Any]:
    room_id = new_id("room")
    ts = now_ms()
    basis = match_basis(viewer["analysis"], partner["analysis"], int(viewer.get("signalStrength") or 80))
    participants = [viewer["id"], partner["id"]]
    partner_for_viewer = {**partner, "roomId": room_id}
    with db() as conn:
        conn.execute(
            "INSERT INTO rooms(id,viewer_account_id,partner_profile_json,match_basis_json,participant_ids_json,status,created_at,last_activity_at) VALUES(?,?,?,?,?,?,?,?)",
            (room_id, viewer.get("accountId") or viewer["id"], as_json(partner_for_viewer), as_json(basis), as_json(participants), "open", ts, ts),
        )
        conn.execute(
            "INSERT INTO messages(id,room_id,sender_id,sender_type,sender_alias,text,created_at) VALUES(?,?,?,?,?,?,?)",
            (new_id("msg"), room_id, partner["id"], partner.get("role", "companion"), partner["alias"], short_reply("你好", partner["analysis"].get("emotionTheme", {}).get("key", "mixed")), ts + 250),
        )
        row = conn.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
    typing_until[room_id] = time.time() + 1.5
    return room_from_row(row, viewer["id"])


def create_human_room(user_a: dict[str, Any], user_b: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    room_id = new_id("room")
    ts = now_ms()
    basis = match_basis(user_a["analysis"], user_b["analysis"], int(user_a.get("signalStrength") or 80))
    participants = [user_a["id"], user_b["id"]]
    with db() as conn:
        conn.execute(
            "INSERT INTO rooms(id,viewer_account_id,partner_profile_json,match_basis_json,participant_ids_json,status,created_at,last_activity_at) VALUES(?,?,?,?,?,?,?,?)",
            (room_id, user_a.get("accountId") or user_a["id"], as_json({**user_b, "roomId": room_id}), as_json(basis), as_json(participants), "open", ts, ts),
        )
        row = conn.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
    return room_for_viewer(row, user_a, user_b), room_for_viewer(row, user_b, user_a)


@app.post("/api/match/request")
def match_request(body: MatchBody) -> dict[str, Any]:
    viewer = body.user
    viewer["accountId"] = body.accountId or viewer.get("accountId")
    for pending in list(waiting_pool):
        other = pending["user"]
        if other.get("id") != viewer.get("id") and other.get("accountId") != viewer.get("accountId"):
            waiting_pool.remove(pending)
            room_for_other, room_for_viewer_payload = create_human_room(other, viewer)
            matched_results[other.get("id")] = room_for_other
            return {"ok": True, "errorType": None, "status": "matched", "room": room_for_viewer_payload}
    waiting_pool.append({"user": viewer, "entryId": body.entryId, "createdAt": time.time()})
    return {"ok": True, "errorType": None, "status": "waiting"}


@app.get("/api/match/status")
def match_status(userId: str = Query("")) -> dict[str, Any]:
    if userId in matched_results:
        return {"ok": True, "errorType": None, "status": "matched", "room": matched_results.pop(userId)}
    for pending in list(waiting_pool):
        if pending["user"].get("id") == userId:
            if time.time() - pending["createdAt"] >= 5:
                waiting_pool.remove(pending)
                theme = pending["user"].get("analysis", {}).get("emotionTheme", {}).get("key", "mixed")
                room = create_room(pending["user"], public_partner_for(theme), pending.get("entryId"))
                return {"ok": True, "errorType": None, "status": "matched", "room": room}
            return {"ok": True, "errorType": None, "status": "waiting"}
    return {"ok": True, "errorType": None, "status": "waiting"}


@app.get("/api/echo-cards")
def echo_cards(accountId: str = Query("")) -> dict[str, Any]:
    payload = me(accountId)
    if not payload.get("ok"):
        return payload
    return {"ok": True, "errorType": None, "echoCards": payload.get("echoCards", []), "emotionTrail": payload.get("emotionTrail", [])}


@app.post("/api/match/rematch")
def rematch(body: MatchBody) -> dict[str, Any]:
    theme = body.user.get("analysis", {}).get("emotionTheme", {}).get("key", "mixed")
    room = create_room(body.user, public_partner_for(theme), body.entryId)
    return {"ok": True, "errorType": None, "status": "matched", "room": room}


@app.get("/api/messages")
def get_messages(roomId: str = Query(""), viewerId: str = Query("")) -> dict[str, Any]:
    with db() as conn:
        room = conn.execute("SELECT * FROM rooms WHERE id=?", (roomId,)).fetchone()
    if not room:
        return {"ok": False, "errorType": "missing", "message": "这次停靠已经结束。"}
    return {
        "ok": True,
        "errorType": None,
        "messages": messages_for_room(roomId, viewerId),
        "typing": typing_until.get(roomId, 0) > time.time(),
        "partnerStatus": "left" if room["status"] == "left" else "online",
        "lastActivityAt": room["last_activity_at"],
    }


@app.post("/api/messages")
def post_message(body: MessageBody) -> dict[str, Any]:
    reason = blocked_reason(body.text)
    if reason:
        return {"ok": False, "errorType": "safety", "message": reason}
    ts = now_ms()
    with db() as conn:
        room_row = conn.execute("SELECT * FROM rooms WHERE id=?", (body.roomId,)).fetchone()
        if not room_row:
            return {"ok": False, "errorType": "missing", "message": "这次停靠已经结束。"}
        partner = from_json(room_row["partner_profile_json"], {})
        sender_alias = body.viewerId[:6] if body.viewerId else "我"
        msg_id = new_id("msg")
        conn.execute(
            "INSERT INTO messages(id,room_id,sender_id,sender_type,sender_alias,text,created_at) VALUES(?,?,?,?,?,?,?)",
            (msg_id, body.roomId, body.viewerId, "self", sender_alias, body.text, ts),
        )
        conn.execute("UPDATE rooms SET last_activity_at=? WHERE id=?", (ts, body.roomId))
        if partner.get("role") != "human":
            reply = short_reply(body.text, partner.get("analysis", {}).get("emotionTheme", {}).get("key", "mixed"))
            conn.execute(
                "INSERT INTO messages(id,room_id,sender_id,sender_type,sender_alias,text,created_at) VALUES(?,?,?,?,?,?,?)",
                (new_id("msg"), body.roomId, partner.get("id"), "companion", partner.get("alias", "远处信号"), reply, ts + random.randint(1200, 2400)),
            )
            typing_until[body.roomId] = time.time() + 1.4
    return {"ok": True, "errorType": None, "message": {"id": msg_id, "roomId": body.roomId, "senderId": body.viewerId, "senderType": "self", "senderAlias": sender_alias, "text": body.text, "createdAt": ts, "mine": True}}


@app.post("/api/echo-card")
def echo_card(body: EchoBody) -> dict[str, Any]:
    if not body.roomId:
        return {"ok": False, "errorType": "validation", "message": "回声瓶没有收好，请再试一次。"}
    with db() as conn:
        room_row = conn.execute("SELECT * FROM rooms WHERE id=?", (body.roomId,)).fetchone()
        if not room_row:
            return {"ok": False, "errorType": "missing", "message": "回声瓶没有找到这次停靠。"}
        messages = messages_for_room(body.roomId, body.viewerId)
        match = from_json(room_row["match_basis_json"], {})
        partner = from_json(room_row["partner_profile_json"], {})
        snapshot = {
            "partnerAlias": partner.get("alias", "远处信号"),
            "partnerEcho": next((msg["text"] for msg in reversed(messages) if not msg["mine"]), ""),
            "messages": [{k: msg[k] for k in ["id", "senderType", "senderId", "senderAlias", "text", "createdAt"] if k in msg} for msg in messages],
            "sharedFrequency": match.get("sharedFrequency"),
            "matchReason": match.get("reason"),
            "signalTags": [],
            "createdAt": now_ms(),
        }
        card_id = new_id("echo")
        conn.execute(
            "INSERT INTO echo_cards(id,account_id,room_id,snapshot_json,saved,created_at) VALUES(?,?,?,?,?,?)",
            (card_id, body.accountId or body.viewerId, body.roomId, as_json(snapshot), 1, now_ms()),
        )
        cards = conn.execute("SELECT * FROM echo_cards WHERE account_id=? ORDER BY created_at DESC", (body.accountId or body.viewerId,)).fetchall()
        entries = conn.execute("SELECT * FROM emotion_entries WHERE account_id=? ORDER BY created_at DESC LIMIT 20", (body.accountId or body.viewerId,)).fetchall()
    echo = {"id": card_id, "roomId": body.roomId, "snapshot": snapshot, "createdAt": snapshot["createdAt"]}
    return {"ok": True, "errorType": None, "echoCard": echo, "echoCards": [{"id": row["id"], "roomId": row["room_id"], "snapshot": from_json(row["snapshot_json"], {}), "createdAt": row["created_at"]} for row in cards], "emotionTrail": [entry_from_row(row) for row in entries]}


@app.post("/api/report")
def report(body: ReportBody) -> dict[str, Any]:
    with db() as conn:
        conn.execute("INSERT INTO reports(id,account_id,room_id,reason,created_at) VALUES(?,?,?,?,?)", (new_id("report"), body.accountId, body.roomId, body.reason, now_ms()))
    return {"ok": True, "errorType": None, "message": "已收到，这次停靠会被标记。"}


@app.post("/api/rooms/leave")
def leave(body: LeaveBody) -> dict[str, Any]:
    ts = now_ms()
    with db() as conn:
        conn.execute("UPDATE rooms SET status='left', last_activity_at=? WHERE id=?", (ts, body.roomId))
    return {"ok": True, "errorType": None, "roomStatus": "left", "partnerStatus": "left", "lastActivityAt": ts}


@app.post("/api/provider-check")
async def provider_check() -> dict[str, Any]:
    messages = [
        {"role": "system", "content": "只返回一句短中文。"},
        {"role": "user", "content": "测试接口。"},
    ]
    openai = await model_chat(messages, "openai")
    anthropic = await model_chat(messages, "anthropic")
    return {"ok": True, "errorType": None, "openaiCompatible": openai, "anthropicCompatible": anthropic}


@app.exception_handler(Exception)
async def json_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"ok": False, "errorType": "server", "message": f"信号台暂时不稳：{type(exc).__name__}"},
    )
