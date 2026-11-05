import os
import json
import re
import random
import base64
import hashlib
import secrets
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from groq import Groq
from groq import BadRequestError
import yaml
from cryptography.fernet import Fernet, InvalidToken
from vocab_data import get_static_vocab

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY missing. Copy .env.example to .env and add your key.")

groq_client = Groq(api_key=GROQ_API_KEY)
groq_model = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
groq_review_model = os.getenv("GROQ_REVIEW_MODEL", "openai/gpt-oss-120b")
BEALINGO_MODE = os.getenv("BEALINGO_MODE", "local").strip().lower()
PRIVATE_PROXY_SECRET = os.getenv("PRIVATE_PROXY_SECRET", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
UPSTASH_REDIS_REST_URL = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
UPSTASH_REDIS_REST_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
CREDENTIAL_ENCRYPTION_KEY = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")

CHATGPT_AUTH_URL = "https://auth.openai.com/api/accounts/authorize"
CHATGPT_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
CHATGPT_JWKS_URL = "https://auth.openai.com/.well-known/jwks.json"
CHATGPT_RESOURCE = "https://api.openai.com/v1"
CHATGPT_REDIRECT_URI = os.getenv("CHATGPT_REDIRECT_URI", "http://127.0.0.1:8010/api/chatgpt/callback")
BEALINGO_FRONTEND_URL = os.getenv("BEALINGO_FRONTEND_URL", "http://127.0.0.1:5180")
CHATGPT_DIR = Path.home() / ".config" / "bealingo"
CHATGPT_CREDENTIALS_PATH = CHATGPT_DIR / "chatgpt.json"
CHATGPT_HOST_PATH = CHATGPT_DIR / "chatgpt-host.json"
chatgpt_oauth_transactions: dict[str, dict[str, str]] = {}

app = FastAPI(title="BeaLingo API")


@app.middleware("http")
async def require_private_proxy(request, call_next):
    """Keep deployed Render services inaccessible without the Vercel proxy."""
    if (
        BEALINGO_MODE in {"personal", "demo"}
        and request.url.path != "/api/health"
        and (
            not PRIVATE_PROXY_SECRET
            or not secrets.compare_digest(
                request.headers.get("x-bealingo-proxy-secret", ""),
                PRIVATE_PROXY_SECRET,
            )
        )
    ):
        from fastapi.responses import JSONResponse

        return JSONResponse({"error": "Not authorized"}, status_code=401)
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


def format_language(profile: dict) -> str:
    parts = [profile.get("language"), profile.get("languageVariant"), profile.get("languageRegion")]
    return " · ".join([p for p in parts if p]) or "the target language"


def get_variant_instruction(profile: dict) -> str:
    language = (profile.get("language") or "").strip().lower()
    variant = (profile.get("languageVariant") or "").strip().lower()
    region = (profile.get("languageRegion") or "").strip().lower()

    if language == "portuguese":
        if "european" in variant:
            return (
                "Use European Portuguese only. Do not use Brazilian Portuguese vocabulary, spelling, or phrasing. "
                "Prefer forms natural in Portugal, for example 'autocarro', 'telemovel', 'fixe', and European Portuguese verb usage. "
                "Write like a native speaker in Portugal. Avoid sentence structures that feel directly translated from English."
            )
        if "brazilian" in variant:
            return (
                "Use Brazilian Portuguese only. Do not use European Portuguese vocabulary, spelling, or phrasing. "
                "Prefer forms natural in Brazil, for example 'onibus', 'celular', and Brazilian Portuguese verb usage. "
                "Write like a native speaker in Brazil. Avoid sentence structures that feel directly translated from English."
            )

    if language == "english":
        if "british" in variant:
            return "Use British English only. Avoid American spellings and vocabulary."
        if "american" in variant:
            return "Use American English only. Avoid British spellings and vocabulary."
        if "australian" in variant:
            return "Use Australian English only. Avoid American-only or British-only wording where possible."

    if language == "spanish":
        if "spain" in variant:
            return "Use Spain Spanish only. Avoid Latin American regional wording."
        if "latin american" in variant:
            return "Use Latin American Spanish only. Avoid Spain-only wording."

    if language == "french":
        if "france" in variant:
            return "Use France French only. Avoid Canadian French or African regional wording."
        if "canadian" in variant:
            return "Use Canadian French only. Avoid France-only wording where it differs."
        if "african" in variant:
            return "Use African French only. Avoid France-only or Canadian-only regional wording where it differs."

    if language == "german":
        if "germany" in variant:
            return "Use Germany German only. Avoid Austrian or Swiss regional wording."
        if "austrian" in variant:
            return "Use Austrian German only. Avoid Germany-only or Swiss-only regional wording."
        if "swiss" in variant:
            return "Use Swiss German conventions where possible. Avoid Germany-only or Austrian-only wording and avoid eszett where Swiss usage would not use it."

    if language == "arabic":
        if "modern standard" in variant:
            return "Use Modern Standard Arabic only. Do not switch into regional dialect phrasing."
        if "egyptian" in variant:
            return "Use Egyptian Arabic only. Do not switch into Modern Standard Arabic or other dialects unless absolutely necessary."
        if "levantine" in variant:
            return "Use Levantine Arabic only. Do not switch into Modern Standard Arabic or other dialects unless absolutely necessary."
        if "gulf" in variant:
            return "Use Gulf Arabic only. Do not switch into Modern Standard Arabic or other dialects unless absolutely necessary."
        if "maghrebi" in variant:
            return "Use Maghrebi Arabic only. Do not switch into Modern Standard Arabic or other dialects unless absolutely necessary."

    if language == "malay":
        if "malaysia" in variant:
            return "Use Malay as used in Malaysia only. Avoid Indonesian wording where it differs."
        if "indonesian" in variant:
            return "Use Indonesian only. Avoid Malay-from-Malaysia wording where it differs."

    if language == "norwegian":
        if "bokmal" in variant:
            return "Use Norwegian Bokmal only. Do not switch into Nynorsk forms."
        if "nynorsk" in variant:
            return "Use Norwegian Nynorsk only. Do not switch into Bokmal forms."

    if language == "chinese":
        if "traditional" in variant:
            if region == "hong kong":
                return (
                    "Use Traditional Chinese for Hong Kong usage only. Prefer Hong Kong vocabulary, phrasing, and characters natural in Hong Kong. "
                    "Do not sound like Taiwan Mandarin or Mainland Mandarin written directly in Traditional characters. "
                    "Avoid direct translation from English and prefer naturally used Hong Kong wording."
                )
            if region == "taiwan":
                return (
                    "Use Traditional Chinese for Taiwan usage only. Prefer Taiwan vocabulary, phrasing, and characters natural in Taiwan. "
                    "Do not sound like Hong Kong usage or Mainland Mandarin written in Traditional characters. "
                    "Avoid direct translation from English and prefer naturally used Taiwan wording."
                )
            return "Use Traditional Chinese only."
        if "simplified" in variant:
            return "Use Simplified Chinese only. Avoid direct translation from English and prefer naturally used native phrasing."

    return ""


def format_style_amount(profile: dict) -> str:
    primary = profile.get("primaryStyle")
    settings = profile.get("styleSettings") or {}
    if primary and settings.get(primary):
        return settings[primary]
    return primary or "2 sentences"


def _write_private_json(path: Path, value: dict) -> None:
    if _upstash_secret_storage_enabled():
        _write_upstash_secret(path.name, value)
        return
    if _supabase_secret_storage_enabled():
        _write_supabase_secret(path.name, value)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)


def _read_private_json(path: Path) -> dict | None:
    if _upstash_secret_storage_enabled():
        return _read_upstash_secret(path.name)
    if _supabase_secret_storage_enabled():
        return _read_supabase_secret(path.name)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _upstash_secret_storage_enabled() -> bool:
    configured = bool(UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN and CREDENTIAL_ENCRYPTION_KEY)
    partially_configured = any((UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN))
    if partially_configured and not configured:
        raise RuntimeError("Upstash secret storage requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and CREDENTIAL_ENCRYPTION_KEY")
    return configured


def _upstash_request(command: list[Any]) -> Any:
    response = httpx.post(
        UPSTASH_REDIS_REST_URL,
        headers={
            "Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}",
            "Content-Type": "application/json",
        },
        json=command,
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"Upstash rejected BeaLingo secret storage: {payload['error']}")
    return payload.get("result")


def _write_upstash_secret(key: str, value: dict) -> None:
    plaintext = json.dumps(value, ensure_ascii=False).encode("utf-8")
    encrypted_value = _credential_cipher().encrypt(plaintext).decode("utf-8")
    _upstash_request(["SET", f"bealingo:secret:{key}", encrypted_value])


def _read_upstash_secret(key: str) -> dict | None:
    encrypted_value = _upstash_request(["GET", f"bealingo:secret:{key}"])
    if not encrypted_value:
        return None
    try:
        plaintext = _credential_cipher().decrypt(str(encrypted_value).encode("utf-8"))
        parsed = json.loads(plaintext.decode("utf-8"))
    except (InvalidToken, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"Stored BeaLingo secret '{key}' could not be decrypted") from exc
    return parsed if isinstance(parsed, dict) else None


def _supabase_secret_storage_enabled() -> bool:
    configured = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and CREDENTIAL_ENCRYPTION_KEY)
    partially_configured = any((SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY))
    if partially_configured and not configured:
        raise RuntimeError("Supabase secret storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CREDENTIAL_ENCRYPTION_KEY")
    return configured


def _credential_cipher() -> Fernet:
    try:
        return Fernet(CREDENTIAL_ENCRYPTION_KEY.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY must be a valid Fernet key") from exc


def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _write_supabase_secret(key: str, value: dict) -> None:
    plaintext = json.dumps(value, ensure_ascii=False).encode("utf-8")
    encrypted_value = _credential_cipher().encrypt(plaintext).decode("utf-8")
    response = httpx.post(
        f"{SUPABASE_URL}/rest/v1/bealingo_secrets?on_conflict=key",
        headers={**_supabase_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
        json={"key": key, "encrypted_value": encrypted_value},
        timeout=20,
    )
    response.raise_for_status()


def _read_supabase_secret(key: str) -> dict | None:
    response = httpx.get(
        f"{SUPABASE_URL}/rest/v1/bealingo_secrets",
        headers=_supabase_headers(),
        params={"key": f"eq.{key}", "select": "encrypted_value", "limit": "1"},
        timeout=20,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return None
    try:
        plaintext = _credential_cipher().decrypt(rows[0]["encrypted_value"].encode("utf-8"))
        parsed = json.loads(plaintext.decode("utf-8"))
    except (InvalidToken, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"Stored BeaLingo secret '{key}' could not be decrypted") from exc
    return parsed if isinstance(parsed, dict) else None


def _chatgpt_plan_enabled() -> bool:
    return BEALINGO_MODE != "demo"


def _get_chatgpt_host_id() -> str:
    stored = _read_private_json(CHATGPT_HOST_PATH)
    if stored and stored.get("ext_agent_host_id"):
        return str(stored["ext_agent_host_id"])
    host_id = f"urn:uuid:{uuid.uuid4()}"
    _write_private_json(CHATGPT_HOST_PATH, {"ext_agent_host_id": host_id})
    return host_id


def _chatgpt_credentials() -> dict | None:
    if not _chatgpt_plan_enabled():
        return None
    credentials = _read_private_json(CHATGPT_CREDENTIALS_PATH)
    if not credentials or "chatgpt.tokens.use.direct" not in credentials.get("scopes", []):
        return None
    return credentials


def _refresh_chatgpt_credentials(credentials: dict) -> dict:
    saved_at = float(credentials.get("saved_at_epoch") or 0)
    expires_in = int(credentials.get("expires_in") or 3600)
    if time.time() < saved_at + expires_in - 120:
        return credentials
    response = httpx.post(
        CHATGPT_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": credentials["client_id"],
            "refresh_token": credentials["refresh_token"],
            "resource": CHATGPT_RESOURCE,
        },
        timeout=20,
    )
    response.raise_for_status()
    refreshed = response.json()
    updated = {
        **credentials,
        **refreshed,
        "scopes": str(refreshed.get("scope") or " ".join(credentials.get("scopes", []))).split(),
        "saved_at": datetime.utcnow().isoformat() + "Z",
        "saved_at_epoch": time.time(),
    }
    _write_private_json(CHATGPT_CREDENTIALS_PATH, updated)
    return updated


def _chatgpt_model(access_token: str) -> str:
    configured = os.getenv("CHATGPT_MODEL")
    if configured:
        return configured
    response = httpx.get(
        f"{CHATGPT_RESOURCE}/models",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    models = payload.get("models") or payload.get("data") or []
    visible = [model.get("slug") or model.get("id") for model in models if model.get("visibility", "list") == "list"]
    for preferred in ("gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"):
        if preferred in visible:
            return preferred
    if not visible:
        raise RuntimeError("No ChatGPT-plan models are available for this account")
    return visible[0]


def _call_with_chatgpt_plan(instructions: str, user_input: str, response_schema: dict | None = None) -> str:
    credentials = _chatgpt_credentials()
    if not credentials:
        raise RuntimeError("ChatGPT plan is not connected")
    credentials = _refresh_chatgpt_credentials(credentials)
    access_token = credentials["access_token"]
    model = _chatgpt_model(access_token)
    schema_instruction = ""
    if response_schema:
        schema_instruction = f"\nReturn JSON matching this schema exactly:\n{json.dumps(response_schema, ensure_ascii=False)}"
    request_body = {
        "model": model,
        "instructions": f"{instructions}{schema_instruction}",
        "input": [{"role": "user", "content": user_input}],
        "store": False,
        "stream": True,
    }
    chunks: list[str] = []
    completed = False
    with httpx.stream(
        "POST",
        f"{CHATGPT_RESOURCE}/responses",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json=request_body,
        timeout=90,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            event_type = event.get("type")
            if event_type == "response.output_text.delta":
                chunks.append(str(event.get("delta") or ""))
            elif event_type == "response.completed":
                completed = True
            elif event_type in {"response.failed", "response.incomplete", "error"}:
                raise RuntimeError(f"ChatGPT plan request failed: {event.get('error') or event_type}")
    if not completed:
        raise RuntimeError("ChatGPT plan stream ended before completion")
    return "".join(chunks)


PARTS_OF_SPEECH = ("noun", "verb", "adjective")


def _call_json_with_groq(system_msg: str, user_msg: str, *, temperature: float = 0.5, max_tokens: int = 900, response_schema: dict | None = None, model: str | None = None) -> str:
    if _chatgpt_credentials():
        try:
            return _call_with_chatgpt_plan(system_msg, user_msg, response_schema)
        except Exception:
            pass
    response_format = {"type": "json_object"}
    if response_schema:
        response_format = {"type": "json_schema", "json_schema": {"name": "bealingo_lesson", "strict": True, "schema": response_schema}}
    request = {
        "model": model or groq_model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": response_format,
    }
    try:
        resp = groq_client.chat.completions.create(**request)
    except BadRequestError as exc:
        error_code = ((getattr(exc, "body", None) or {}).get("error") or {}).get("code")
        is_schema_generation_failure = error_code == "json_validate_failed" or "json_validate_failed" in str(exc)
        if not response_schema or not is_schema_generation_failure:
            raise
        # Some Groq generations fail their strict-schema decoder before returning
        # any content. Keep the explicit POS prompt and use JSON mode for that retry;
        # BeaLingo still normalizes and validates the returned vocabulary afterward.
        request["response_format"] = {"type": "json_object"}
        resp = groq_client.chat.completions.create(**request)
    return resp.choices[0].message.content


def _call_chat_with_groq(messages: list[dict[str, str]], *, temperature: float = 0.5, max_tokens: int = 700):
    if _chatgpt_credentials():
        try:
            instructions = "\n".join(message["content"] for message in messages if message.get("role") == "system")
            conversation = "\n".join(
                f"{message.get('role', 'user')}: {message.get('content', '')}"
                for message in messages
                if message.get("role") != "system"
            )
            text = _call_with_chatgpt_plan(instructions or "You are a helpful language coach.", conversation)
            return type("ChatGPTPlanResponse", (), {
                "choices": [type("Choice", (), {"message": type("Message", (), {"content": text})()})()]
            })()
        except Exception:
            pass
    return groq_client.chat.completions.create(
        model=groq_model,
        messages=[
            *messages,
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )


def _extract_json_block(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def _parse_model_json(raw: str) -> Any:
    cleaned = _extract_json_block(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Gemini sometimes returns JSON-like content with slight formatting drift.
        parsed = yaml.safe_load(cleaned)
        if parsed is None:
            raise ValueError("Model returned empty structured content")
        return parsed


def _collect_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        strings: list[str] = []
        for nested in value.values():
            strings.extend(_collect_strings(nested))
        return strings
    if isinstance(value, list):
        strings: list[str] = []
        for nested in value:
            strings.extend(_collect_strings(nested))
        return strings
    return []


def _find_variant_mismatches(profile: dict, content: Any) -> list[str]:
    language = (profile.get("language") or "").strip().lower()
    variant = (profile.get("languageVariant") or "").strip().lower()
    region = (profile.get("languageRegion") or "").strip().lower()
    text = "\n".join(_collect_strings(content)).lower()

    def matches(markers: list[str]) -> list[str]:
        return [marker for marker in markers if marker in text]

    if language == "portuguese":
        if "european" in variant:
            return matches(["ônibus", "onibus", "celular", "trem", "você", "vocês", "legal", "café da manhã"])
        if "brazilian" in variant:
            return matches(["autocarro", "telemóvel", "telemovel", "comboio", "fixe", "pequeno-almoço", "pequeno almoco"])

    if language == "english":
        if "british" in variant:
            return matches(["apartment", "vacation", "elevator", "color", "favorite", "organize", "center"])
        if "american" in variant:
            return matches(["flat", "holiday", "lift", "colour", "favourite", "organise", "centre"])

    if language == "spanish":
        if "spain" in variant:
            return matches(["carro", "computadora", "celular", "manejar", "ustedes"])
        if "latin american" in variant:
            return matches(["coche", "ordenador", "móvil", "conducir", "vosotros"])

    if language == "french":
        if "france" in variant:
            return matches(["char", "courriel", "fin de semaine", "magasiner"])
        if "canadian" in variant:
            return matches(["voiture", "e-mail", "week-end"])

    if language == "german":
        if "germany" in variant:
            return matches(["jänner", "sackerl", "paradeiser", "grüezi", "gruezi", "velo", "billet"])
        if "austrian" in variant:
            return matches(["grüezi", "gruezi", "velo", "billet"])
        if "swiss" in variant:
            return matches(["straße", "strasse", "jänner", "sackerl", "paradeiser"])

    if language == "arabic":
        if "modern standard" in variant:
            return matches(["عايز", "عاوز", "شو", "شلون", "وايد", "برشا"])

    if language == "malay":
        if "malaysia" in variant:
            return matches(["anda", "kereta api", "kantor"])
        if "indonesian" in variant:
            return matches(["awak", "bas", "telefon bimbit"])

    if language == "norwegian":
        if "bokmal" in variant:
            return matches(["ikkje", "eg", "kva", "me"])
        if "nynorsk" in variant:
            return matches(["ikke", "jeg", "hva", "vi"])

    if language == "chinese":
        simplified_markers = ["这", "学", "会", "车", "气", "东", "欢"]
        traditional_markers = ["這", "學", "會", "車", "氣", "東", "歡"]
        if "traditional" in variant:
            mismatches = matches(simplified_markers)
            if region == "hong kong":
                mismatches.extend(matches(["裡"]))
            return mismatches
        if "simplified" in variant:
            return matches(traditional_markers)

    return []


def _estimate_expected_focus_vocab_count(text: str) -> int:
    tokens = [token for token in re.split(r"\s+", (text or "").strip()) if token]
    token_count = len(tokens)
    if token_count >= 10:
        return 4
    if token_count >= 6:
        return 3
    if token_count >= 3:
        return 2
    return 1


def _normalize_focus_vocab(entries: Any) -> list[dict]:
    if not isinstance(entries, list):
        return []
    normalized: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        front = str(entry.get("front") or "").strip()
        back = str(entry.get("back") or "").strip()
        if not front:
            continue
        key = (front.lower(), back.lower())
        if key in seen:
            continue
        seen.add(key)
        normalized.append({
            "front": front,
            "back": back,
            "note": str(entry.get("note") or "").strip(),
            "partOfSpeech": _normalize_part_of_speech(entry.get("partOfSpeech") or entry.get("category")),
        })
    return normalized


def _normalize_part_of_speech(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("_", " ").replace("-", " ")
    aliases = {"n": "noun", "nouns": "noun", "v": "verb", "verbs": "verb", "adj": "adjective", "adjectives": "adjective"}
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in PARTS_OF_SPEECH else "noun"


def _normalize_lesson_vocabulary(content: Any) -> Any:
    if not isinstance(content, dict):
        return content
    if isinstance(content.get("vocabulary"), list):
        content["vocabulary"] = _normalize_focus_vocab(content["vocabulary"])
    for sentence in content.get("sentences") or []:
        if isinstance(sentence, dict) and "focusVocabulary" in sentence:
            sentence["focusVocabulary"] = _normalize_focus_vocab(sentence["focusVocabulary"])
    scenario = content.get("scenario") or {}
    for exchange in scenario.get("exchanges") or []:
        if isinstance(exchange, dict) and "focusVocabulary" in exchange:
            exchange["focusVocabulary"] = _normalize_focus_vocab(exchange["focusVocabulary"])
    for question in content.get("questions") or []:
        if isinstance(question, dict) and "focusVocabulary" in question:
            question["focusVocabulary"] = _normalize_focus_vocab(question["focusVocabulary"])
    return content


def _find_focus_vocab_gaps(content: Any) -> list[str]:
    gaps: list[str] = []

    lesson_vocab = _normalize_focus_vocab((content or {}).get("vocabulary")) if isinstance(content, dict) else []
    if lesson_vocab:
        return []

    sentences = content.get("sentences") if isinstance(content, dict) else None
    if isinstance(sentences, list):
        for index, sentence in enumerate(sentences, 1):
            if not isinstance(sentence, dict):
                continue
            target = str(sentence.get("target") or "").strip()
            focus_vocab = _normalize_focus_vocab(sentence.get("focusVocabulary"))
            expected = _estimate_expected_focus_vocab_count(target)
            if len(focus_vocab) < expected:
                gaps.append(f"sentence {index} needs at least {expected} meaningful focusVocabulary chunks")

    exchanges = ((content.get("scenario") or {}).get("exchanges")) if isinstance(content, dict) else None
    if isinstance(exchanges, list):
        for index, exchange in enumerate(exchanges, 1):
            if not isinstance(exchange, dict):
                continue
            target = str(exchange.get("lineTarget") or "").strip()
            focus_vocab = _normalize_focus_vocab(exchange.get("focusVocabulary"))
            expected = _estimate_expected_focus_vocab_count(target)
            if len(focus_vocab) < expected:
                gaps.append(f"dialogue line {index} needs at least {expected} meaningful focusVocabulary chunks")

    questions = content.get("questions") if isinstance(content, dict) else None
    if isinstance(questions, list):
        for index, question in enumerate(questions, 1):
            if not isinstance(question, dict):
                continue
            text = f"{question.get('prompt') or ''} {question.get('answer') or ''}".strip()
            focus_vocab = _normalize_focus_vocab(question.get("focusVocabulary"))
            expected = max(1, _estimate_expected_focus_vocab_count(text) - 1)
            if len(focus_vocab) < expected:
                gaps.append(f"question {index} needs at least {expected} meaningful focusVocabulary chunks")

    return gaps


def _find_practice_quality_gaps(content: Any) -> list[str]:
    practice = content.get("practice") if isinstance(content, dict) else None
    if not isinstance(practice, list) or len(practice) < 3:
        return ["lesson needs at least 3 grounded practice questions"]
    gaps: list[str] = []
    for index, question in enumerate(practice, 1):
        if not isinstance(question, dict):
            gaps.append(f"practice {index} is not an object")
            continue
        prompt = str(question.get("prompt") or "").strip()
        answer = str(question.get("answer") or "").strip()
        explanation = str(question.get("explanation") or "").strip()
        options = [str(option).strip() for option in question.get("options", []) if str(option).strip()]
        placeholders = [option for option in options if re.fullmatch(r"option\s*[a-z0-9]+", option, re.IGNORECASE)]
        if not prompt or not explanation:
            gaps.append(f"practice {index} needs a real prompt and explanation")
        if len(options) != 4 or len(set(options)) != 4:
            gaps.append(f"practice {index} needs 4 unique options")
        if not answer or answer not in options:
            gaps.append(f"practice {index} answer must exactly match an option")
        if placeholders:
            gaps.append(f"practice {index} contains placeholder options")
    return gaps


def _generate_validated_json(
    system_msg: str,
    user_msg: str,
    profile: dict,
    *,
    temperature: float,
    max_tokens: int,
    attempts: int = 3,
    response_schema: dict | None = None,
) -> Any:
    retry_note = ""
    last_mismatches: list[str] = []
    last_focus_vocab_gaps: list[str] = []
    last_parse_error = ""

    for _ in range(attempts):
        raw = _call_json_with_groq(system_msg, f"{user_msg}{retry_note}", temperature=temperature, max_tokens=max_tokens, response_schema=response_schema)
        try:
            parsed = _parse_model_json(raw)
        except Exception as exc:
            last_parse_error = str(exc)
            retry_note = (
                "\n\nIMPORTANT RETRY RULE:\n"
                "The previous attempt returned malformed or incomplete JSON. "
                "Return one complete valid JSON object only. "
                "Do not truncate arrays or objects. "
                "Do not include markdown fences, commentary, or trailing text."
            )
            continue
        mismatches = _find_variant_mismatches(profile, parsed)
        focus_vocab_gaps = _find_focus_vocab_gaps(parsed) + _find_practice_quality_gaps(parsed)
        if not mismatches and not focus_vocab_gaps:
            return _normalize_lesson_vocabulary(parsed)
        last_mismatches = mismatches
        last_focus_vocab_gaps = focus_vocab_gaps
        retry_reasons = []
        if mismatches:
            retry_reasons.append(
                f"The previous attempt used forbidden variety markers: {', '.join(sorted(set(mismatches))[:8])}."
            )
        if focus_vocab_gaps:
            retry_reasons.append(
                f"The previous attempt under-filled focusVocabulary: {'; '.join(focus_vocab_gaps[:8])}."
            )
        retry_note = (
            "\n\nIMPORTANT RETRY RULE:\n"
            + " ".join(retry_reasons)
            + " Regenerate the full response, strictly obey the requested language variety, and include fuller meaningful focusVocabulary chunks for every item."
        )

    failure_reasons = []
    if last_parse_error:
        failure_reasons.append(f"json parsing failed: {last_parse_error[:160]}")
    if last_mismatches:
        failure_reasons.append(f"variant validation failed: {', '.join(sorted(set(last_mismatches))[:8])}")
    if last_focus_vocab_gaps:
        failure_reasons.append(f"focus vocabulary incomplete: {'; '.join(last_focus_vocab_gaps[:8])}")
    raise ValueError(" / ".join(failure_reasons) or "Lesson validation failed after retries")


def _review_lesson_quality(content: Any, profile: dict, response_schema: dict) -> Any:
    """Run one editorial pass, falling back to the valid draft on any failure."""
    if not isinstance(content, dict):
        return content

    ctx = _profile_context(profile)
    system_msg = (
        "You are BeaLingo's senior language editor and assessment designer. "
        "Audit and rewrite the supplied lesson, then return the complete corrected JSON object only. "
        "Do not praise, explain, or comment on the draft outside the JSON."
    )
    user_msg = f"""Review this generated {ctx['target']} lesson for a {ctx['level']} learner.

Required editorial checks:
- Enforce this exact variety rule: {ctx['variant_instruction']}
- Make every target-language line sound natural to a native speaker in the requested region.
- Remove literal English calques, awkward collocations, invented wording, and mismatched register.
- Verify every English translation preserves the target sentence's full meaning and implied subject.
- Keep all material appropriate for the learner's level, goals ({ctx['goals']}), and interests ({ctx['interests']}).
- Classify each vocabulary item by the grammatical role of the TARGET-LANGUAGE item: noun, verb, or adjective.
- A multi-word noun phrase is noun; a verb phrase is verb; an adjective phrase is adjective.
- Every practice question must test only material explicitly taught in this lesson.
- Every practice question must have unique, genuine, plausible options; never use placeholder options.
- The answer must exactly match one option, and the explanation must genuinely justify it.
- For fill-in-the-blank questions, the blank must replace a taught word or chunk in a complete natural sentence.
- Preserve the JSON structure and return the entire improved lesson, not a list of suggested edits.

Draft lesson:
{json.dumps(content, ensure_ascii=False)}
"""

    try:
        raw = _call_json_with_groq(
            system_msg,
            user_msg,
            temperature=0.2,
            max_tokens=900,
            response_schema=response_schema,
            model=groq_review_model,
        )
        reviewed = _normalize_lesson_vocabulary(_parse_model_json(raw))
        if _find_variant_mismatches(profile, reviewed) or _find_focus_vocab_gaps(reviewed) or _find_practice_quality_gaps(reviewed):
            return content
        return reviewed
    except Exception:
        return content


def _normalize_level(level: str) -> str:
    normalized = (level or "beginner").strip().lower()
    if normalized == "advanced":
        return "advanced"
    if normalized == "intermediate":
        return "intermediate"
    return "beginner"


def _difficulty_order(level: str) -> list[str]:
    normalized = _normalize_level(level)
    if normalized == "advanced":
        return ["advanced", "intermediate", "beginner"]
    if normalized == "intermediate":
        return ["intermediate", "beginner"]
    return ["beginner"]


def _apply_vocab_variant_overrides(profile: dict, word: str, translation: str) -> tuple[str, str]:
    language = (profile.get("language") or "").strip().lower()
    variant = (profile.get("languageVariant") or "").strip().lower()

    if language == "portuguese":
        if "european" in variant:
            replacements = {
                "ola": "olá",
                "agua": "água",
                "autocarro": "autocarro",
            }
            return replacements.get(word.lower(), word), translation
        if "brazilian" in variant:
            replacements = {
                "ola": "olá",
                "agua": "água",
                "ônibus": "ônibus",
            }
            return replacements.get(word.lower(), word), translation

    return word, translation


def _classify_static_vocab_item(item: dict) -> str:
    translation = str(item.get("translation") or "").strip().lower()
    if translation.startswith("to "):
        return "verb"
    if translation in {"sustainable"}:
        return "adjective"
    if translation in {"hello", "thank you", "yes", "one"}:
        return "noun"
    return "noun"


def _build_structured_flashcards(profile: dict, count: int) -> list[dict]:
    vocab = get_static_vocab(format_language(profile))
    if not vocab:
        return []

    excluded = {
        str(item).strip().casefold()
        for item in (profile.get("excludeItems") or [])
        if str(item).strip()
    }

    allowed_difficulties = set(_difficulty_order(profile.get("level") or profile.get("assessedLevel") or "beginner"))
    eligible = [
        item for item in vocab
        if item.get("difficulty", "beginner") in allowed_difficulties
        and str(item.get("word") or "").strip().casefold() not in excluded
    ]
    if len(eligible) < count:
        eligible = [
            item for item in vocab
            if str(item.get("word") or "").strip().casefold() not in excluded
        ]

    rotation_seed = sum(ord(ch) for ch in datetime.utcnow().strftime("%Y-%m-%d"))
    if eligible:
        offset = rotation_seed % len(eligible)
        ordered = eligible[offset:] + eligible[:offset]
    else:
        ordered = []

    selected = ordered[:count]
    flashcards = []
    for item in selected:
        front, back = _apply_vocab_variant_overrides(profile, item["word"], item["translation"])
        flashcards.append({
            "front": front,
            "back": back,
            "note": f"{item.get('difficulty', 'beginner').capitalize()} core vocabulary",
            "exampleTarget": "",
            "exampleSource": "",
            "partOfSpeech": _classify_static_vocab_item(item),
        })
    return flashcards


def _build_structured_quiz_questions(profile: dict, count: int) -> list[dict]:
    flashcards = _build_structured_flashcards(profile, max(count + 3, 6))
    if not flashcards:
        return []

    questions: list[dict] = []
    is_advanced = _normalize_level(profile.get("level") or profile.get("assessedLevel") or "beginner") == "advanced"
    answer_pool = [card["back"] for card in flashcards if card.get("back")]
    front_pool = [card["front"] for card in flashcards if card.get("front")]

    for index, card in enumerate(flashcards[:count]):
        front = card.get("front", "").strip()
        back = card.get("back", "").strip()
        if not front or not back:
            continue

        if is_advanced and index % 2 == 1:
            question = {
                "prompt": f"Write the English meaning of: {front}",
                "answer": back,
                "type": "short_answer",
            }
        else:
            if index % 2 == 0:
                question = {
                    "prompt": f"Choose the correct meaning of: {front}",
                    "options": _build_multiple_choice_options(back, answer_pool, card.get("note", "").strip()),
                    "answer": back,
                    "type": "meaning",
                }
            else:
                prompt = f"Complete the phrase: ____ = {back}"
                question = {
                    "prompt": prompt,
                    "options": _build_fill_blank_options(front, front_pool),
                    "answer": front,
                    "type": "fill_blank",
                }

        question["focusVocabulary"] = [
            {
                "front": front,
                "back": back,
                "note": card.get("note", ""),
                "partOfSpeech": card.get("partOfSpeech", "other"),
            }
        ]
        questions.append(question)

    return questions[:count]


def _build_rule_based_practice(lesson_content: dict, count: int) -> list[dict]:
    questions: list[dict] = []
    sentence_targets = [s.get("target", "").strip() for s in lesson_content.get("sentences", []) or [] if s.get("target")]
    flashcard_backs = [f.get("back", "").strip() for f in lesson_content.get("flashcards", []) or [] if f.get("back")]
    vocab_pool = _collect_focus_vocab_pool(lesson_content)

    for sentence in lesson_content.get("sentences", []) or []:
        target = sentence.get("target", "").strip()
        source = sentence.get("source", "").strip()
        focus_vocab = _normalize_focus_vocab(sentence.get("focusVocabulary"))
        if target and source:
            questions.append({
                "prompt": f"Which target-language sentence matches: {source}",
                "options": _build_multiple_choice_options(target, sentence_targets, sentence.get("exampleTarget", "").strip()),
                "answer": target,
                "type": "multiple_choice",
            })
        blank_question = _build_focus_vocab_blank_question(
            target,
            focus_vocab,
            vocab_pool,
            prompt_prefix="Fill in the blank in the target-language sentence",
        )
        if blank_question:
            questions.append(blank_question)

    for flashcard in lesson_content.get("flashcards", []) or []:
        front = flashcard.get("front", "").strip()
        back = flashcard.get("back", "").strip()
        example_target = flashcard.get("exampleTarget", "").strip()
        if front and back:
            questions.append({
                "prompt": f"Choose the correct meaning of: {front}",
                "options": _build_multiple_choice_options(back, flashcard_backs, flashcard.get("note", "").strip()),
                "answer": back,
                "type": "multiple_choice",
            })
        if front and example_target:
            blank_question = _build_flashcard_blank_question(front, example_target, vocab_pool)
            if blank_question:
                questions.append(blank_question)

    for exchange in (lesson_content.get("scenario") or {}).get("exchanges", []) or []:
        line_target = exchange.get("lineTarget", "").strip()
        line_source = exchange.get("lineSource", "").strip()
        focus_vocab = _normalize_focus_vocab(exchange.get("focusVocabulary"))
        if line_target and line_source:
            questions.append({
                "prompt": f"Which target-language line matches: {line_source}",
                "options": _build_multiple_choice_options(line_target, sentence_targets, exchange.get("note", "").strip()),
                "answer": line_target,
                "type": "multiple_choice",
            })
        blank_question = _build_focus_vocab_blank_question(
            line_target,
            focus_vocab,
            vocab_pool,
            prompt_prefix="Fill in the blank in the dialogue line",
        )
        if blank_question:
            questions.append(blank_question)

    for quiz in lesson_content.get("questions", []) or []:
        prompt = quiz.get("prompt", "").strip()
        answer = quiz.get("answer", "").strip()
        options = quiz.get("options")
        if prompt and answer:
            question = {
                "prompt": prompt,
                "answer": answer,
                "type": quiz.get("type", "multiple_choice"),
            }
            if isinstance(options, list) and len(options) > 0:
                question["options"] = options[:4]
            else:
                question["options"] = _build_text_options(answer)
            questions.append(question)

    deduped: list[dict] = []
    seen_prompts: set[str] = set()
    for question in questions:
        prompt = question.get("prompt", "")
        if not prompt or prompt in seen_prompts:
            continue
        seen_prompts.add(prompt)
        options = question.get("options") or []
        normalized_options = []
        seen_options: set[str] = set()
        for option in options:
            if option and option not in seen_options:
                normalized_options.append(option)
                seen_options.add(option)
        answer = question.get("answer", "")
        if answer and answer not in seen_options:
            normalized_options.append(answer)
        question["options"] = normalized_options[:4]
        if len(question["options"]) < 2:
            question.pop("options", None)
            question["type"] = "short_answer"
        else:
            if answer and answer not in question["options"]:
                question["options"][-1] = answer
            random.shuffle(question["options"])
        deduped.append(question)

    return deduped[:count]


def _collect_focus_vocab_pool(lesson_content: dict) -> list[str]:
    pool: list[str] = []

    for sentence in lesson_content.get("sentences", []) or []:
        for vocab in _normalize_focus_vocab(sentence.get("focusVocabulary")):
            if vocab.get("front"):
                pool.append(vocab["front"])

    for exchange in (lesson_content.get("scenario") or {}).get("exchanges", []) or []:
        for vocab in _normalize_focus_vocab(exchange.get("focusVocabulary")):
            if vocab.get("front"):
                pool.append(vocab["front"])

    for question in lesson_content.get("questions", []) or []:
        for vocab in _normalize_focus_vocab(question.get("focusVocabulary")):
            if vocab.get("front"):
                pool.append(vocab["front"])

    for flashcard in lesson_content.get("flashcards", []) or []:
        front = (flashcard.get("front") or "").strip()
        if front:
            pool.append(front)

    deduped: list[str] = []
    seen: set[str] = set()
    for item in pool:
        lowered = item.lower()
        if lowered not in seen:
            seen.add(lowered)
            deduped.append(item)
    return deduped


def _replace_first_occurrence(text: str, needle: str, replacement: str = "____") -> str:
    if not text or not needle:
        return text
    pattern = re.compile(re.escape(needle), re.IGNORECASE)
    return pattern.sub(replacement, text, count=1)


def _build_focus_vocab_blank_question(
    text: str,
    focus_vocab: list[dict],
    vocab_pool: list[str],
    *,
    prompt_prefix: str,
) -> dict[str, Any] | None:
    if not text:
        return None

    answer = ""
    for vocab in focus_vocab:
        candidate = (vocab.get("front") or "").strip()
        if candidate and len(candidate) > 1 and candidate.lower() in text.lower():
            answer = candidate
            break

    if not answer:
        words = [part for part in text.split() if len(part.strip(".,!?")) > 2]
        answer = words[-1].strip(".,!?") if words else ""

    if not answer:
        return None

    prompt = _replace_first_occurrence(text, answer)
    if prompt == text:
        return None

    return {
        "prompt": f"{prompt_prefix}: {prompt}",
        "options": _build_fill_blank_options(answer, vocab_pool),
        "answer": answer,
        "type": "fill_blank",
    }


def _build_flashcard_blank_question(front: str, example_target: str, vocab_pool: list[str]) -> dict[str, Any] | None:
    if not front or not example_target or front.lower() not in example_target.lower():
        return None
    prompt = _replace_first_occurrence(example_target, front)
    if prompt == example_target:
        return None
    return {
        "prompt": f"Fill in the blank in the target-language example: {prompt}",
        "options": _build_fill_blank_options(front, vocab_pool),
        "answer": front,
        "type": "fill_blank",
    }


def _build_fill_blank_options(answer: str, pool: list[str] | None = None) -> list[str]:
    options = [answer]
    for item in pool or []:
        candidate = (item or "").strip()
        if candidate and candidate.lower() != answer.lower() and candidate not in options:
            options.append(candidate)
        if len(options) == 4:
            break
    random.shuffle(options)
    return options[:4]


def _build_text_options(answer: str) -> list[str]:
    return [answer]


def _build_multiple_choice_options(answer: str, pool: list[str], fallback: str = "") -> list[str]:
    options = [answer]
    for item in pool:
        if item and item != answer and item not in options:
            options.append(item)
        if len(options) == 4:
            return options
    if fallback and fallback not in options:
        options.append(fallback)
    options = options[:4]
    random.shuffle(options)
    return options


@app.get("/api/chatgpt/status")
def chatgpt_status() -> dict[str, Any]:
    credentials = _chatgpt_credentials()
    return {
        "connected": bool(credentials),
        "email": credentials.get("email") if credentials else None,
        "provider": "ChatGPT plan" if credentials else "Groq free tier",
        "mode": BEALINGO_MODE,
    }


@app.get("/api/chatgpt/connect")
def chatgpt_connect():
    if not _chatgpt_plan_enabled():
        from fastapi.responses import JSONResponse

        return JSONResponse({"error": "ChatGPT connection is disabled in the public demo"}, status_code=403)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    existing = _read_private_json(CHATGPT_CREDENTIALS_PATH)
    client_id = str(existing.get("client_id")) if existing and existing.get("client_id") else "dynamic_agent_client"
    transaction = {
        "nonce": nonce,
        "verifier": verifier,
        "client_id": client_id,
        "created_at": str(time.time()),
    }
    chatgpt_oauth_transactions[state] = transaction
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": CHATGPT_REDIRECT_URI,
        "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        "resource": CHATGPT_RESOURCE,
        "state": state,
        "nonce": nonce,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "ext_agent_host_id": _get_chatgpt_host_id(),
    }
    if client_id == "dynamic_agent_client":
        params["agent_name_hint"] = "BeaLingo"
    elif existing:
        if existing.get("id_token"):
            params["id_token_hint"] = existing["id_token"]
        if existing.get("email"):
            params["login_hint"] = existing["email"]
    return RedirectResponse(f"{CHATGPT_AUTH_URL}?{urlencode(params)}")


@app.get("/api/chatgpt/callback")
def chatgpt_callback(code: str = "", state: str = "", client_id: str = "", error: str = ""):
    transaction = chatgpt_oauth_transactions.pop(state, None)
    if error or not transaction or not code:
        return RedirectResponse(f"{BEALINGO_FRONTEND_URL}/?chatgpt=error")
    if time.time() - float(transaction["created_at"]) > 600:
        return RedirectResponse(f"{BEALINGO_FRONTEND_URL}/?chatgpt=expired")
    expected_client_id = transaction["client_id"]
    issued_client_id = client_id or expected_client_id
    if expected_client_id != "dynamic_agent_client" and issued_client_id != expected_client_id:
        return RedirectResponse(f"{BEALINGO_FRONTEND_URL}/?chatgpt=client-mismatch")
    try:
        token_response = httpx.post(
            CHATGPT_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": issued_client_id,
                "code": code,
                "code_verifier": transaction["verifier"],
                "redirect_uri": CHATGPT_REDIRECT_URI,
                "resource": CHATGPT_RESOURCE,
            },
            timeout=20,
        )
        token_response.raise_for_status()
        tokens = token_response.json()
        id_token = str(tokens.get("id_token") or "")
        signing_key = PyJWKClient(CHATGPT_JWKS_URL, timeout=5).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=issued_client_id,
            issuer="https://auth.openai.com",
            leeway=5,
            options={"require": ["sub", "exp", "iat"]},
        )
        if claims.get("nonce") != transaction["nonce"]:
            raise ValueError("OpenAI ID-token nonce did not match")
        scopes = str(tokens.get("scope") or "").split()
        if "chatgpt.tokens.use.direct" not in scopes:
            raise PermissionError("ChatGPT plan usage was not granted")
        credentials = {
            **tokens,
            "client_id": issued_client_id,
            "ext_agent_host_id": _get_chatgpt_host_id(),
            "email": claims.get("email"),
            "subject": claims["sub"],
            "issuer": claims["iss"],
            "scopes": scopes,
            "saved_at": datetime.utcnow().isoformat() + "Z",
            "saved_at_epoch": time.time(),
        }
        _write_private_json(CHATGPT_CREDENTIALS_PATH, credentials)
        return RedirectResponse(f"{BEALINGO_FRONTEND_URL}/?chatgpt=connected")
    except Exception:
        return RedirectResponse(f"{BEALINGO_FRONTEND_URL}/?chatgpt=error")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": BEALINGO_MODE}


# ---------- Vocab list for level assessment ----------

class VocabListRequest(BaseModel):
    targetLanguage: str


@app.post("/api/vocab-list")
def vocab_list(req: VocabListRequest) -> dict[str, Any]:
    words = get_static_vocab(req.targetLanguage)
    if not words:
        return {"error": f"No vocab list available for '{req.targetLanguage}'. Supported: Chinese, Japanese, Korean, Spanish, French, Portuguese, German, Italian, Arabic, Russian, Thai, Vietnamese, Turkish, Hindi, Malay."}
    return {"words": words}


class SentenceAssessmentRequest(BaseModel):
    targetLanguage: str
    nativeLanguage: str = "English"
    sentence: str


SENTENCE_ASSESSMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["correct", "imperfect", "wrong_language", "not_meaningful"]},
        "level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
        "feedback": {"type": "string"},
        "correction": {"type": "string"},
    },
    "required": ["verdict", "level", "feedback", "correction"],
    "additionalProperties": False,
}


@app.post("/api/assess-sentence")
def assess_sentence(req: SentenceAssessmentRequest) -> dict[str, Any]:
    sentence = req.sentence.strip()
    if not sentence:
        return {"verdict": "not_meaningful", "level": "beginner", "feedback": "Please try writing a sentence.", "correction": ""}

    system_msg = (
        "You are a concise, encouraging language-placement assessor. "
        "Assess only the single learner sentence supplied. Return valid JSON only."
    )
    user_msg = f"""Target language: {req.targetLanguage}
Learner's explanation language: {req.nativeLanguage}
Sentence: {sentence}

Choose exactly one verdict:
- correct: meaningful target-language sentence with no important grammar error
- imperfect: clearly understandable target-language sentence with grammar or word-choice errors
- wrong_language: primarily not in the requested target language or regional written standard
- not_meaningful: random characters/words or meaning cannot reasonably be understood

Rules:
- Accept normal learner mistakes as imperfect; do not demand native-level writing.
- Judge grammar and meaning, not length alone.
- For imperfect, give one short encouraging explanation in the learner's explanation language and provide a natural corrected target-language sentence.
- For correct, keep feedback brief and correction identical to the submitted sentence.
- For wrong_language or not_meaningful, briefly explain what to retry and leave correction empty.
- Estimate beginner/intermediate/advanced from the demonstrated grammar and vocabulary, not sentence length alone."""
    try:
        raw = _call_json_with_groq(
            system_msg,
            user_msg,
            temperature=0.1,
            max_tokens=180,
            response_schema=SENTENCE_ASSESSMENT_SCHEMA,
        )
        result = _parse_model_json(raw)
        if result.get("verdict") not in {"correct", "imperfect", "wrong_language", "not_meaningful"}:
            raise ValueError("Invalid sentence assessment verdict")
        return result
    except Exception as exc:
        return {"error": f"Sentence assessment unavailable: {type(exc).__name__}"}


# ---------- Sentence generation ----------

class LessonRequest(BaseModel):
    profile: dict
    style: str = "daily sentences"
    count: int = 2


class PracticeRequest(BaseModel):
    profile: dict
    lessonContent: dict
    count: int = 3


def _profile_context(profile: dict) -> dict:
    target = format_language(profile)
    native = profile.get("nativeLanguage") or "English"
    goals = profile.get("goals") or profile.get("goal") or "everyday communication"
    if isinstance(goals, list):
        goals = ", ".join(goals)
    level = profile.get("assessedLevel") or profile.get("level") or "beginner"
    interests = profile.get("interests")
    if isinstance(interests, list):
        interests = ", ".join(interests)
    variant_instruction = get_variant_instruction(profile)
    return {
        "target": target,
        "native": native,
        "goals": goals,
        "level": level,
        "interests": interests or "general topics",
        "correction": profile.get("correctionStyle") or "balanced",
        "variant_instruction": variant_instruction or "Use the requested language variety consistently.",
    }


NATIVE_QUALITY_RULES = """Quality rules:
- The target-language text must sound like something a native speaker would naturally say.
- Do NOT translate English sentence structure literally.
- Start from a natural target-language expression first, then write the English gloss.
- If a direct translation from English sounds unnatural, rewrite it into the most natural native phrasing.
- Keep beginner material simple, but still idiomatic and locally natural.
- Avoid textbook-English calques, awkward word order, and unnatural collocations.
- Teach one coherent real-life situation rather than unrelated sample sentences.
- Match the stated level: useful and stretching, but never needlessly complicated.
- Verify every translation preserves the actual meaning, tone, and implied subject.
"""

VOCAB_ITEM_SCHEMA = {
    "type": "object",
    "properties": {"front": {"type": "string"}, "back": {"type": "string"}, "note": {"type": "string"}, "partOfSpeech": {"type": "string", "enum": list(PARTS_OF_SPEECH)}},
    "required": ["front", "back", "note", "partOfSpeech"],
    "additionalProperties": False,
}
FLASHCARD_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "front": {"type": "string"},
        "back": {"type": "string"},
        "note": {"type": "string"},
        "exampleTarget": {"type": "string"},
        "exampleSource": {"type": "string"},
        "partOfSpeech": {"type": "string", "enum": list(PARTS_OF_SPEECH)},
    },
    "required": ["front", "back", "note", "exampleTarget", "exampleSource", "partOfSpeech"],
    "additionalProperties": False,
}
PRACTICE_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "prompt": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "answer": {"type": "string"},
        "type": {"type": "string", "enum": ["multiple_choice", "fill_blank"]},
        "explanation": {"type": "string"},
    },
    "required": ["prompt", "options", "answer", "type", "explanation"],
    "additionalProperties": False,
}
FLASHCARD_LESSON_SCHEMA = {
    "type": "object",
    "properties": {
        "flashcards": {"type": "array", "items": FLASHCARD_ITEM_SCHEMA},
        "practice": {"type": "array", "items": PRACTICE_ITEM_SCHEMA},
    },
    "required": ["flashcards", "practice"],
    "additionalProperties": False,
}
SENTENCE_LESSON_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": {"type": "object", "properties": {"source": {"type": "string"}, "target": {"type": "string"}, "meaning": {"type": "string"}, "exampleTarget": {"type": "string"}, "exampleSource": {"type": "string"}}, "required": ["source", "target", "meaning", "exampleTarget", "exampleSource"], "additionalProperties": False}},
        "vocabulary": {"type": "array", "items": VOCAB_ITEM_SCHEMA},
        "practice": {"type": "array", "items": PRACTICE_ITEM_SCHEMA},
    },
    "required": ["sentences", "vocabulary", "practice"], "additionalProperties": False,
}
CONVERSATION_LESSON_SCHEMA = {
    "type": "object",
    "properties": {
        "scenario": {"type": "object", "properties": {"setup": {"type": "string"}, "exchanges": {"type": "array", "items": {"type": "object", "properties": {"speaker": {"type": "string"}, "lineTarget": {"type": "string"}, "lineSource": {"type": "string"}, "note": {"type": "string"}}, "required": ["speaker", "lineTarget", "lineSource", "note"], "additionalProperties": False}}}, "required": ["setup", "exchanges"], "additionalProperties": False},
        "vocabulary": {"type": "array", "items": VOCAB_ITEM_SCHEMA},
        "practice": {"type": "array", "items": PRACTICE_ITEM_SCHEMA},
    },
    "required": ["scenario", "vocabulary", "practice"], "additionalProperties": False,
}


SENTENCE_PROMPT = """Generate {count} NEW {target} sentences for a learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Pick content matching the learner's level, goal, and interests.
{native_quality_rules}

Also return a lesson-level "vocabulary" list:
- Include the important learnable words or short phrases from the whole lesson.
- Prefer meaningful chunks over single isolated words.
- Good example: "I", "have to go", "eat", "an apple".
- Bad example: "have", "to", "go", "an" as separate entries.
- Exclude low-value standalone function words unless they are useful on their own for the learner.
- Keep each item short, natural, and worth reviewing later.

Also create 4 practice questions grounded strictly in this lesson:
- Every option must be a genuine, natural target-language or English answer—not a placeholder.
- Distractors must be plausible but clearly wrong for the specific prompt.
- The answer must match one option exactly.
- A fill-in-the-blank must contain a real sentence with one taught word or chunk removed.
- Never use labels such as "Option A", "Option 1", "something else", or "not this one".

Return JSON:
{{
  "sentences": [
    {{
      "source": "<sentence in English>",
      "target": "<sentence in {target}>",
      "meaning": "<short explanation covering why this is naturally phrased this way, usage, register, or grammar>",
      "exampleTarget": "<a different natural example using the same key word/structure, in {target}>",
      "exampleSource": "<that example rendered into natural English>"
    }}
  ],
  "vocabulary": [
    {{
      "front": "<important target-language word or short phrase from the lesson>",
      "back": "<English meaning>",
      "note": "<short usage note or context>",
      "partOfSpeech": "<noun | verb | adjective>"
    }}
  ],
  "practice": [
    {{
      "prompt": "<a clear question testing only material taught above>",
      "options": ["<real plausible answer>", "<real plausible distractor>", "<real plausible distractor>", "<real plausible distractor>"],
      "answer": "<exactly one of the options>",
      "type": "<multiple_choice | fill_blank>",
      "explanation": "<brief explanation of why the answer is correct>"
    }}
  ]
}}"""

FLASHCARD_PROMPT = """Generate exactly {count} NEW vocabulary flashcards in {target} for a learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Pick useful words or natural short chunks matching the learner's level, goals, and interests.
Use a balanced mix of nouns, verbs, and adjectives. Do not use greetings or ultra-basic filler unless the learner is a true beginner.
{native_quality_rules}

Also create exactly 3 short practice questions using only these flashcards. Each question must have exactly 4 unique, genuine options, and its answer must match one option exactly.

Return JSON:
{{
  "flashcards": [
    {{
      "front": "<word or short phrase in {target}>",
      "back": "<natural English meaning>",
      "note": "<one-line usage tip, grammar note, or example context>",
      "exampleTarget": "<a short natural example sentence using this word, in {target}>",
      "exampleSource": "<that example in natural English>",
      "partOfSpeech": "<noun | verb | adjective>"
    }}
  ],
  "practice": [
    {{
      "prompt": "<a clear question testing one of the flashcards>",
      "options": ["<real option>", "<real distractor>", "<real distractor>", "<real distractor>"],
      "answer": "<exactly one of the options>",
      "type": "<multiple_choice | fill_blank>",
      "explanation": "<brief explanation>"
    }}
  ]
}}"""

CONVERSATION_PROMPT = """Generate a short conversation scenario in {target} for a learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Create a realistic everyday scenario with {count} exchanges (back and forth). Include a setup line in English, then the dialogue in both {target} and English.
{native_quality_rules}

Also return a lesson-level "vocabulary" list:
- Include the important learnable words or short phrases from the whole dialogue.
- Prefer meaningful chunks over single isolated words.
- Group words into natural review units when they belong together.
- Exclude low-value standalone function words unless they are useful on their own for the learner.
- Keep each item short, natural, and worth reviewing later.

Also create 4 practice questions grounded strictly in this dialogue:
- Every option must be a genuine, natural target-language or English answer—not a placeholder.
- Distractors must be plausible but clearly wrong for the specific prompt.
- The answer must match one option exactly.
- A fill-in-the-blank must contain a real dialogue line with one taught word or chunk removed.
- Never use labels such as "Option A", "Option 1", "something else", or "not this one".

Return JSON:
{{
  "scenario": {{
    "setup": "<one-line situation description in English>",
    "exchanges": [
      {{
        "speaker": "<role, e.g. 'you', 'waiter', 'friend'>",
        "lineTarget": "<what they say in {target}>",
        "lineSource": "<natural English rendering>",
        "note": "<optional grammar/vocab tip, including if the wording is especially local or idiomatic>"
      }}
    ]
  }},
  "vocabulary": [
    {{
      "front": "<important target-language word or short phrase from the dialogue>",
      "back": "<English meaning>",
      "note": "<short usage note or context>",
      "partOfSpeech": "<noun | verb | adjective>"
    }}
  ],
  "practice": [
    {{
      "prompt": "<a clear question testing only material taught above>",
      "options": ["<real plausible answer>", "<real plausible distractor>", "<real plausible distractor>", "<real plausible distractor>"],
      "answer": "<exactly one of the options>",
      "type": "<multiple_choice | fill_blank>",
      "explanation": "<brief explanation of why the answer is correct>"
    }}
  ]
}}"""

QUIZ_PROMPT_BEGINNER = """Generate {count} multiple-choice quiz questions in {target} for a beginner/intermediate learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Mix question types: translation, fill-in-the-blank, and meaning. Each must have exactly 4 options with one correct answer.
For fill-in-the-blank: put the blank in the sentence, list 4 options. Never reveal the answer next to the blank.
{native_quality_rules}

For each question's "focusVocabulary":
- Include the important learnable words or short phrases used in that specific question.
- Prefer meaningful chunks over single isolated words.
- Group words into natural review units when they belong together.
- Exclude low-value standalone function words unless they are useful on their own for the learner.
- Keep each item short, natural, and worth reviewing later.

Return JSON:
{{
  "questions": [
    {{
      "prompt": "<the question>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "answer": "<the correct option, must match one of the options exactly>",
      "type": "<translate | fill_blank | meaning>",
      "focusVocabulary": [
        {{
          "front": "<important target-language word or short phrase used in this question>",
          "back": "<English meaning>",
          "note": "<short usage note or context>"
        }}
      ]
    }}
  ]
}}"""

QUIZ_PROMPT_ADVANCED = """Generate {count} open-ended quiz questions in {target} for an advanced learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Mix question types: translation, fill-in-the-blank, and short answer. Each must have a clear correct answer. No multiple choice — the learner types their own answer.
{native_quality_rules}

For each question's "focusVocabulary":
- Include the important learnable words or short phrases used in that specific question.
- Prefer meaningful chunks over single isolated words.
- Group words into natural review units when they belong together.
- Exclude low-value standalone function words unless they are useful on their own for the learner.
- Keep each item short, natural, and worth reviewing later.

Return JSON:
{{
  "questions": [
    {{
      "prompt": "<the question>",
      "answer": "<the correct answer>",
      "type": "<translate | fill_blank | short_answer>",
      "focusVocabulary": [
        {{
          "front": "<important target-language word or short phrase used in this question>",
          "back": "<English meaning>",
          "note": "<short usage note or context>"
        }}
      ]
    }}
  ]
}}"""

PRACTICE_PROMPT = """Generate {count} short practice questions based only on the lesson content below.

Learner profile:
- Target language: {target}
- Level: {level}
- Variety rule: {variant_instruction}

Today's lesson content:
{lesson_content}

Rules:
- Use only words, phrases, sentence patterns, or dialogue content that appeared in today's lesson.
- Help the learner practice using what they just learned, not brand-new material.
- Mix multiple-choice and fill-in-the-blank questions.
- Every question must have exactly 4 options and 1 correct answer.
- For fill-in-the-blank questions, do not reveal the answer in the prompt.

Return JSON:
{{
  "questions": [
    {{
      "prompt": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "answer": "<the correct option, matching one option exactly>",
      "type": "<multiple_choice | fill_blank>"
    }}
  ]
}}"""


@app.post("/api/generate-lesson")
def generate_lesson(req: LessonRequest) -> dict[str, Any]:
    ctx = _profile_context(req.profile)
    style = req.style.lower().strip()

    if "quiz" in style:
        questions = _build_structured_quiz_questions(req.profile, req.count)
        return {"style": style, "content": {"questions": questions}}

    system_msg = (
        "You are a careful, friendly language coach. You generate learning material "
        "for a student. Respond ONLY with valid JSON — no markdown, no commentary."
    )

    if "flashcard" in style:
        safe_count = min(max(req.count, 1), 10)
        user_msg = FLASHCARD_PROMPT.format(count=safe_count, native_quality_rules=NATIVE_QUALITY_RULES, **ctx)
        response_schema = FLASHCARD_LESSON_SCHEMA
    elif "conversation" in style:
        user_msg = CONVERSATION_PROMPT.format(count=req.count, native_quality_rules=NATIVE_QUALITY_RULES, **ctx)
        response_schema = CONVERSATION_LESSON_SCHEMA
    else:
        user_msg = SENTENCE_PROMPT.format(count=req.count, native_quality_rules=NATIVE_QUALITY_RULES, **ctx)
        response_schema = SENTENCE_LESSON_SCHEMA

    user_msg += "\n\nPart-of-speech rule: classify the TARGET-LANGUAGE front item itself as noun, verb, or adjective. For a multi-word chunk, classify its grammatical job: noun phrase as noun, verb phrase as verb, and adjective phrase as adjective."

    try:
        parsed = _generate_validated_json(
            system_msg,
            user_msg,
            req.profile,
            temperature=0.7,
            max_tokens=900,
            response_schema=response_schema,
        )
        reviewed = _review_lesson_quality(parsed, req.profile, response_schema)
        return {"style": style, "content": reviewed}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:400]}"}


@app.post("/api/generate-sentences")
def generate_sentences(req: LessonRequest) -> dict[str, Any]:
    req.style = "daily sentences"
    result = generate_lesson(req)
    if "error" in result:
        return result
    sentences = result.get("content", {}).get("sentences", [])
    return {"sentences": sentences}


@app.post("/api/generate-practice")
def generate_practice(req: PracticeRequest) -> dict[str, Any]:
    try:
        generated = []
        for question in req.lessonContent.get("practice", []) or []:
            if not isinstance(question, dict):
                continue
            prompt = str(question.get("prompt") or "").strip()
            answer = str(question.get("answer") or "").strip()
            options = [str(option).strip() for option in question.get("options", []) if str(option).strip()]
            has_placeholder = any(re.fullmatch(r"option\s*[a-z0-9]+", option, re.IGNORECASE) for option in options)
            if not prompt or not answer or answer not in options or len(set(options)) < 2 or has_placeholder:
                continue
            generated.append({
                "prompt": prompt,
                "answer": answer,
                "options": list(dict.fromkeys(options))[:4],
                "type": question.get("type") or "multiple_choice",
                "explanation": str(question.get("explanation") or "").strip(),
            })
        if generated:
            return {"questions": generated[:req.count]}
        questions = _build_rule_based_practice(req.lessonContent, req.count)
        return {"questions": questions}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:400]}"}


# ---------- Coach chat ----------

class ChatMessage(BaseModel):
    role: str
    text: str


class CoachRequest(BaseModel):
    profile: dict
    sentences: list[dict] = []
    history: list[ChatMessage] = []
    userMessage: str


@app.post("/api/ask-coach")
def ask_coach(req: CoachRequest) -> dict[str, Any]:
    profile = req.profile
    target = format_language(profile)
    native = profile.get("nativeLanguage") or "English"
    level = profile.get("level") or "beginner"
    goals = profile.get("goals") or profile.get("goal") or "everyday communication"
    if isinstance(goals, list):
        goals = ", ".join(goals)

    if req.sentences:
        lesson_lines = []
        for i, s in enumerate(req.sentences, 1):
            lesson_lines.append(
                f"{i}. {s.get('target','')} ({s.get('source','')})\n"
                f"   example: {s.get('exampleTarget','')} — {s.get('exampleSource','')}"
            )
        lesson_context = "\n".join(lesson_lines)
    else:
        lesson_context = "No lesson content yet."

    system_msg = f"""You are a patient, encouraging language coach helping a learner.

Always respond in {native} unless the learner explicitly asks for something in {target}.
Keep answers short, clear, and friendly. Use examples when it helps.
Never invent words or translations you aren't sure about.
When you correct a mistake, explain WHY briefly — don't just give the fix.

Today's lesson ({target}):
{lesson_context}

Learner level: "{level}"
Learner goals: {goals}
Language variety rule: {get_variant_instruction(profile) or 'Use the requested language variety consistently.'}"""

    messages = [{"role": "system", "content": system_msg}]
    for m in req.history:
        messages.append({
            "role": "assistant" if m.role == "coach" else "user",
            "content": m.text,
        })
    messages.append({"role": "user", "content": req.userMessage})

    try:
        resp = _call_chat_with_groq(
            messages=messages,
            temperature=0.5,
            max_tokens=600,
        )
        return {"reply": resp.choices[0].message.content}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:400]}"}
