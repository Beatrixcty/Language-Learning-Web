import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(__file__), "bealingo.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS vocab_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_language TEXT NOT NULL UNIQUE,
            words_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.close()


def get_vocab_list(target_language: str) -> list[dict] | None:
    conn = get_db()
    row = conn.execute(
        "SELECT words_json FROM vocab_lists WHERE target_language = ?",
        (target_language,),
    ).fetchone()
    conn.close()
    if row:
        return json.loads(row["words_json"])
    return None


def save_vocab_list(target_language: str, words: list[dict]):
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO vocab_lists (target_language, words_json) VALUES (?, ?)",
        (target_language, json.dumps(words, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()


init_db()
