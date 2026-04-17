"""
Seed the question bank for a given target language.

Usage:
    python seed_questions.py "Traditional Chinese · Hong Kong"
    python seed_questions.py "Brazilian Portuguese"
    python seed_questions.py "Spanish"

Generates ~8 validated questions per CEFR level (A1–C2) = ~48 per language.
Takes about 30-60 seconds on Groq.
"""

import json
import os
import sys

from dotenv import load_dotenv
from groq import Groq

from db import count_questions, insert_questions

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY not set in .env")

client = Groq(api_key=GROQ_API_KEY)
MODEL = "llama-3.3-70b-versatile"
CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

LEVEL_DESCRIPTIONS = {
    "A1": (
        "A1 (absolute beginner). Question types: simple translation of a greeting or basic phrase; "
        "fill-in-the-blank with the most basic grammar (copula, articles, pronouns); "
        "answer a very simple question in one word or very short phrase. "
        "Example: 'Translate to English: 你好嗎？' or 'Fill in the blank: 我___學生。 (options: 是 / 有 / 在)'"
    ),
    "A2": (
        "A2 (elementary). Question types: short translation of a daily-life sentence; "
        "fill-in-the-blank with common grammar (prepositions, basic verb tenses); "
        "tiny everyday response (e.g. ordering food, asking for directions). "
        "Example: 'Translate: I would like a cup of coffee, please.'"
    ),
    "B1": (
        "B1 (intermediate). Question types: translation with past/future/conditional tense; "
        "respond to a short everyday scenario in 1-2 sentences; "
        "fill-in-the-blank testing verb conjugation or clause structure. "
        "Example: 'Your friend invites you hiking this weekend but you have to work. Reply in 1-2 sentences.'"
    ),
    "B2": (
        "B2 (upper intermediate). Question types: translation with subordinate clauses, subjunctive, or nuance; "
        "write 2-3 sentences describing a past event or expressing a simple opinion; "
        "reading comprehension with a short inline text (2-3 sentences). "
        "Example: 'Translate: If I had known earlier, I would have come to help.'"
    ),
    "C1": (
        "C1 (advanced). Question types: write a short paragraph (3-5 sentences) giving an opinion with reasons; "
        "nuanced translation involving idiom, register, or formality; summarize a short inline text. "
        "Example: 'Write 3-5 sentences explaining whether you prefer working alone or in a team, with reasons.'"
    ),
    "C2": (
        "C2 (mastery / near-native). Question types: write a short paragraph (4-6 sentences) on an abstract topic "
        "with sophisticated vocabulary and varied sentence structure; nuanced translation preserving register/tone; "
        "rewrite a sentence to change register (formal → informal or vice versa). "
        "Example: 'Write 4-6 sentences on: How has technology changed the way we communicate?'"
    ),
}


def generate_candidates(target_language: str, level: str) -> list[dict]:
    """Generate 10 candidate questions for one language+level."""
    level_desc = LEVEL_DESCRIPTIONS[level]
    system = (
        "You are an expert CEFR language assessment question writer. "
        "You generate high-quality, precise language test questions.\n\n"
        "CRITICAL RULES:\n"
        "- Every question MUST exercise the target language. The prompt must EITHER contain target-language text "
        "  OR require the learner to produce target-language text.\n"
        "- NEVER ask for personal info (name, age, favorite things). Personal preferences are NOT language tests.\n"
        "- Fill-in-the-blank: the blank tests GRAMMAR or VOCAB, never personal info. "
        "  NEVER put the answer next to the blank. Options go at the end.\n"
        "- NEVER create a fill-in-the-blank where the answer word already appears elsewhere in the sentence.\n"
        "- The prompt must be COMPLETE and SELF-CONTAINED.\n"
        "- Use ONLY the correct script/variant for the target language "
        "  (e.g. Traditional Chinese uses 學 not 学; Brazilian Portuguese uses 'ônibus' not 'autocarro').\n"
        "- Each question must have a definite correct answer.\n"
        "- No culture, geography, politics, or current events.\n"
        "- Respond ONLY with valid JSON."
    )
    user = f"""Target language: {target_language}
CEFR level: {level}
Level description: {level_desc}

Generate exactly 10 assessment questions at this level. Make them DIVERSE:
- Mix question types (translation to target, translation from target, fill-in-blank, scenario response, paragraph writing).
- Cover different topics (food, work, travel, daily routine, hobbies, weather, shopping).
- Cover different grammar points appropriate to the level.

Return JSON:
{{
  "questions": [
    {{
      "question_type": "<translate_to_target | translate_from_target | fill_blank | scenario | paragraph>",
      "prompt": "<the complete, self-contained question>",
      "tests": "<what language skill this tests>"
    }},
    ... 10 total
  ]
}}"""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.6,
        max_tokens=3000,
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    parsed = json.loads(content)
    return parsed.get("questions") or []


def critique_questions(target_language: str, level: str, questions: list[dict]) -> list[dict]:
    """Send questions through a critique pass. Returns only the valid ones."""
    system = (
        "You are a strict quality reviewer for language assessment questions. "
        "Review each question and mark it VALID or INVALID.\n\n"
        "Mark INVALID if ANY of these apply:\n"
        "- Question doesn't involve the target language (prompt in English with English answer expected)\n"
        "- Question asks for personal info or preferences (name, age, favorite color, etc.)\n"
        "- Fill-in-the-blank has the answer shown in the sentence or the answer already appears in the sentence\n"
        "- Grammar/spelling error in the target language text\n"
        "- Wrong script used (e.g. Simplified characters for Traditional Chinese target)\n"
        "- Prompt is incomplete or empty (e.g. 'Translate:' with no text)\n"
        "- Question is nonsensical or impossible to answer\n"
        "- Options for fill-in-the-blank are ambiguous (multiple equally correct answers)\n"
        "\nRespond ONLY with valid JSON."
    )
    q_list = "\n".join(
        f"{i+1}. [{q.get('question_type','')}] {q.get('prompt','')}"
        for i, q in enumerate(questions)
    )
    user = f"""Target language: {target_language}
CEFR level: {level}

Review these {len(questions)} questions:
{q_list}

Return JSON:
{{
  "results": [
    {{ "index": 1, "valid": true }},
    {{ "index": 2, "valid": false, "reason": "uses simplified characters" }},
    ...
  ]
}}"""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        max_tokens=1200,
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    parsed = json.loads(content)
    results = parsed.get("results") or []

    valid_indices = set()
    for r in results:
        idx = r.get("index")
        if r.get("valid") and isinstance(idx, int) and 1 <= idx <= len(questions):
            valid_indices.add(idx - 1)

    return [questions[i] for i in sorted(valid_indices)]


def seed_language(target_language: str):
    """Generate and store a question bank for one language."""
    print(f"\n{'='*60}")
    print(f"Seeding: {target_language}")
    print(f"{'='*60}\n")

    total_added = 0
    for level in CEFR_LEVELS:
        existing = count_questions(target_language, level)
        if existing >= 8:
            print(f"  {level}: already has {existing} questions, skipping.")
            continue

        print(f"  {level}: generating candidates...", end=" ", flush=True)
        try:
            candidates = generate_candidates(target_language, level)
        except Exception as e:
            print(f"FAILED ({e})")
            continue
        print(f"got {len(candidates)}.", end=" ", flush=True)

        if not candidates:
            print("No candidates.")
            continue

        print("Critiquing...", end=" ", flush=True)
        try:
            validated = critique_questions(target_language, level, candidates)
        except Exception as e:
            print(f"critique failed ({e}), saving all candidates.")
            validated = candidates

        print(f"{len(validated)}/{len(candidates)} passed.")

        if validated:
            rows = [
                {
                    "target_language": target_language,
                    "cefr_level": level,
                    "question_type": q.get("question_type", "unknown"),
                    "prompt": q["prompt"],
                    "tests": q.get("tests", ""),
                }
                for q in validated
                if q.get("prompt")
            ]
            insert_questions(rows)
            total_added += len(rows)

    print(f"\nDone! Added {total_added} questions for '{target_language}'.\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python seed_questions.py 'Traditional Chinese · Hong Kong'")
        sys.exit(1)
    language = " ".join(sys.argv[1:])
    seed_language(language)
