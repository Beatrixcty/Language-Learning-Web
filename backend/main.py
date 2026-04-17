import os
import json
from datetime import datetime
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from vocab_data import get_static_vocab

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY missing. Copy .env.example to .env and add your key.")

client = Groq(api_key=GROQ_API_KEY)
MODEL = "llama-3.1-8b-instant"

app = FastAPI(title="BeaLingo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
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
                "Prefer forms natural in Portugal, for example 'autocarro', 'telemovel', 'fixe', and European Portuguese verb usage."
            )
        if "brazilian" in variant:
            return (
                "Use Brazilian Portuguese only. Do not use European Portuguese vocabulary, spelling, or phrasing. "
                "Prefer forms natural in Brazil, for example 'onibus', 'celular', and Brazilian Portuguese verb usage."
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
                return "Use Traditional Chinese for Hong Kong usage only."
            if region == "taiwan":
                return "Use Traditional Chinese for Taiwan usage only."
            return "Use Traditional Chinese only."
        if "simplified" in variant:
            return "Use Simplified Chinese only."

    return ""


def format_style_amount(profile: dict) -> str:
    primary = profile.get("primaryStyle")
    settings = profile.get("styleSettings") or {}
    if primary and settings.get(primary):
        return settings[primary]
    return primary or "2 sentences"


def _call_json(system_msg: str, user_msg: str, *, temperature: float = 0.5, max_tokens: int = 1800) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content


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


def _generate_validated_json(
    system_msg: str,
    user_msg: str,
    profile: dict,
    *,
    temperature: float,
    max_tokens: int,
    attempts: int = 3,
) -> Any:
    retry_note = ""
    last_mismatches: list[str] = []

    for _ in range(attempts):
        raw = _call_json(system_msg, f"{user_msg}{retry_note}", temperature=temperature, max_tokens=max_tokens)
        parsed = json.loads(raw)
        mismatches = _find_variant_mismatches(profile, parsed)
        if not mismatches:
            return parsed
        last_mismatches = mismatches
        retry_note = (
            "\n\nIMPORTANT RETRY RULE:\n"
            f"The previous attempt used forbidden variety markers: {', '.join(sorted(set(mismatches))[:8])}. "
            "Regenerate the full response and strictly obey the requested language variety."
        )

    raise ValueError(f"Variant validation failed after retries: {', '.join(sorted(set(last_mismatches))[:8])}")


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


def _build_structured_flashcards(profile: dict, count: int) -> list[dict]:
    vocab = get_static_vocab(format_language(profile))
    if not vocab:
        return []

    allowed_difficulties = set(_difficulty_order(profile.get("level") or profile.get("assessedLevel") or "beginner"))
    eligible = [item for item in vocab if item.get("difficulty", "beginner") in allowed_difficulties]
    if len(eligible) < count:
        eligible = vocab

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
        })
    return flashcards


def _build_rule_based_practice(lesson_content: dict, count: int) -> list[dict]:
    questions: list[dict] = []
    sentence_targets = [s.get("target", "").strip() for s in lesson_content.get("sentences", []) or [] if s.get("target")]
    flashcard_backs = [f.get("back", "").strip() for f in lesson_content.get("flashcards", []) or [] if f.get("back")]

    for sentence in lesson_content.get("sentences", []) or []:
        target = sentence.get("target", "").strip()
        source = sentence.get("source", "").strip()
        if target and source:
            questions.append({
                "prompt": f"Which target-language sentence matches: {source}",
                "options": _build_multiple_choice_options(target, sentence_targets, sentence.get("exampleTarget", "").strip()),
                "answer": target,
                "type": "multiple_choice",
            })

    for flashcard in lesson_content.get("flashcards", []) or []:
        front = flashcard.get("front", "").strip()
        back = flashcard.get("back", "").strip()
        if front and back:
            questions.append({
                "prompt": f"Choose the correct meaning of: {front}",
                "options": _build_multiple_choice_options(back, flashcard_backs, flashcard.get("note", "").strip()),
                "answer": back,
                "type": "multiple_choice",
            })

    for exchange in (lesson_content.get("scenario") or {}).get("exchanges", []) or []:
        line_target = exchange.get("lineTarget", "").strip()
        line_source = exchange.get("lineSource", "").strip()
        if line_target and line_source:
            questions.append({
                "prompt": f"Fill in the blank: {line_source} -> {line_target.replace(line_target.split()[0], '____', 1) if line_target.split() else line_target}",
                "options": _build_fill_blank_options(line_target),
                "answer": line_target.split()[0] if line_target.split() else line_target,
                "type": "fill_blank",
            })

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
        while len(normalized_options) < 4:
            normalized_options.append(f"Option {len(normalized_options) + 1}")
        question["options"] = normalized_options[:4]
        if answer and answer not in question["options"]:
            question["options"][0] = answer
        deduped.append(question)

    return deduped[:count]


def _build_fill_blank_options(text: str) -> list[str]:
    first_word = text.split()[0] if text.split() else text
    distractors = ["eu", "você", "de", "o"]
    options = [first_word] + [item for item in distractors if item != first_word]
    return options[:4]


def _build_text_options(answer: str) -> list[str]:
    distractors = ["Not this one", "Something else", "I forgot"]
    return [answer] + distractors


def _build_multiple_choice_options(answer: str, pool: list[str], fallback: str = "") -> list[str]:
    options = [answer]
    for item in pool:
        if item and item != answer and item not in options:
            options.append(item)
        if len(options) == 4:
            return options
    if fallback and fallback not in options:
        options.append(fallback)
    while len(options) < 4:
        options.append(f"Option {len(options) + 1}")
    return options[:4]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------- Vocab list for level assessment ----------

class VocabListRequest(BaseModel):
    targetLanguage: str


@app.post("/api/vocab-list")
def vocab_list(req: VocabListRequest) -> dict[str, Any]:
    words = get_static_vocab(req.targetLanguage)
    if not words:
        return {"error": f"No vocab list available for '{req.targetLanguage}'. Supported: Chinese, Japanese, Korean, Spanish, French, Portuguese, German, Italian, Arabic, Russian, Thai, Vietnamese, Turkish, Hindi, Malay."}
    return {"words": words}


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


SENTENCE_PROMPT = """Generate {count} NEW {target} sentences for a learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Pick content matching the learner's level, goal, and interests.

Return JSON:
{{
  "sentences": [
    {{
      "source": "<sentence in English>",
      "target": "<sentence in {target}>",
      "meaning": "<short explanation covering usage, register, or grammar>",
      "exampleTarget": "<a different example using the same key word/structure, in {target}>",
      "exampleSource": "<that example translated into English>"
    }}
  ]
}}"""

FLASHCARD_PROMPT = """Generate {count} vocabulary flashcards in {target} for a learner.

Learner profile:
- Target language: {target}
- Level: {level}
- Goals: {goals}
- Interests: {interests}
- Variety rule: {variant_instruction}

Pick words/phrases matching the learner's level, goal, and interests. Mix nouns, verbs, and useful phrases.

Return JSON:
{{
  "flashcards": [
    {{
      "front": "<word or short phrase in {target}>",
      "back": "<English translation>",
      "note": "<one-line usage tip, grammar note, or example context>",
      "exampleTarget": "<a short example sentence using this word, in {target}>",
      "exampleSource": "<that example in English>"
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

Return JSON:
{{
  "scenario": {{
    "setup": "<one-line situation description in English>",
    "exchanges": [
      {{
        "speaker": "<role, e.g. 'you', 'waiter', 'friend'>",
        "lineTarget": "<what they say in {target}>",
        "lineSource": "<English translation>",
        "note": "<optional grammar/vocab tip>"
      }}
    ]
  }}
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

Return JSON:
{{
  "questions": [
    {{
      "prompt": "<the question>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "answer": "<the correct option, must match one of the options exactly>",
      "type": "<translate | fill_blank | meaning>"
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

Return JSON:
{{
  "questions": [
    {{
      "prompt": "<the question>",
      "answer": "<the correct answer>",
      "type": "<translate | fill_blank | short_answer>"
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

    system_msg = (
        "You are a careful, friendly language coach. You generate learning material "
        "for a student. Respond ONLY with valid JSON — no markdown, no commentary."
    )

    if "flashcard" in style:
        user_msg = FLASHCARD_PROMPT.format(count=req.count, **ctx)
    elif "conversation" in style:
        user_msg = CONVERSATION_PROMPT.format(count=req.count, **ctx)
    elif "quiz" in style:
        is_advanced = "advanced" in ctx["level"].lower()
        prompt_template = QUIZ_PROMPT_ADVANCED if is_advanced else QUIZ_PROMPT_BEGINNER
        user_msg = prompt_template.format(count=req.count, **ctx)
    else:
        user_msg = SENTENCE_PROMPT.format(count=req.count, **ctx)

    try:
        parsed = _generate_validated_json(
            system_msg,
            user_msg,
            req.profile,
            temperature=0.7,
            max_tokens=2000,
        )
        return {"style": style, "content": parsed}
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
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.5,
            max_tokens=600,
        )
        return {"reply": resp.choices[0].message.content}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:400]}"}
