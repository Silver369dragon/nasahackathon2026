"""Private, persistent conversations and source records for the crew training station."""
import asyncio
import json
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, Request
from pydantic import Field

from . import cloud_chat
from .alerts import list_alerts
from .chat_evidence import build_facts
from .models import Contract, Identifier
from .news2 import read as read_news2
from .store import Data, Problem, connection, encoded, now_text
from .tasks import get_task

CHAT_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_turns(
  id TEXT PRIMARY KEY, crew TEXT NOT NULL REFERENCES crew(id), conversation TEXT NOT NULL,
  command TEXT NOT NULL, question TEXT NOT NULL, lang TEXT NOT NULL, created TEXT NOT NULL,
  topic TEXT NOT NULL, facts TEXT NOT NULL, answer TEXT NOT NULL, UNIQUE(crew,command)
);
CREATE INDEX IF NOT EXISTS chat_history ON chat_turns(crew,conversation,created);
"""


def initialize_chat(path: Path) -> None:
    with connection(path, write=True) as db:
        db.executescript(CHAT_SCHEMA)
        if not any(row["name"] == "assessment_id" for row in db.execute("PRAGMA table_info(chat_turns)")):
            db.execute("ALTER TABLE chat_turns ADD COLUMN assessment_id TEXT")
        # A process restart interrupts pending network requests; their local answer is already saved.
        db.execute("""UPDATE chat_turns SET answer=json_set(answer,'$.status','fallback','$.reason','interrupted')
                      WHERE json_extract(answer,'$.status')='pending'""")


class Question(Contract):
    question: Annotated[str, Field(min_length=1, max_length=1600)]
    language: Literal["en", "zh-TW"] = "en"
    commandId: Identifier
    conversationId: Identifier | None = None
    assessmentId: Identifier | None = None


def cited_sources(facts: list[Data], indexes: list[int]) -> list[Data]:
    refs: dict[str, Data] = {}
    for i in indexes:
        for ref in facts[i]["refs"]:
            refs[encoded(ref)] = ref
    return list(refs.values())


def answer_for(facts: list[Data], indexes: list[int], status: str, reason: str = "", summary: str = "") -> Data:
    selected = list(dict.fromkeys(indexes + [i for i, item in enumerate(facts) if item["required"]]))
    supporting = [facts[i]["text"] for i in selected if facts[i]["text"] != summary]
    paragraphs = ([summary] if summary else []) + supporting
    return {"text": "\n\n".join(paragraphs), "citations": cited_sources(facts, selected),
            "summary": summary, "summaryCitations": cited_sources(facts, indexes) if summary else [],
            "status": status, "renderer": "llm" if status == "completed" else "local", "reason": reason}


def turn_document(row) -> Data:
    return {"id":row["id"],"conversationId":row["conversation"],"question":row["question"],"language":row["lang"],
            "createdAt":row["created"], **json.loads(row["answer"])}


def register_assistant(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def owner(request: Request, *, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(request.query_params.get("runId"))
        if not user["crewId"] or "crew" not in user["roles"]:
            raise Problem(403, "FORBIDDEN", "The health assistant is private to crew accounts.")
        return user["crewId"]

    async def finish(turn: str, question: str, lang: str, facts: list[Data], prior_topic: str):
        try:
            summary, chosen = await cloud_chat.render(question, lang, facts, previous=prior_topic)
            result = answer_for(facts, chosen, "completed", summary=summary)
        except cloud_chat.CloudUnavailable as error:
            result = answer_for(facts, list(range(len(facts))), "fallback", str(error))
        with connection(path, write=True) as db:
            db.execute("UPDATE chat_turns SET answer=? WHERE id=?", (encoded(result), turn))

    @app.post("/v1/assistant/query")
    async def ask(request: Request, body: Question):
        crew = owner(request, write=True)
        q = body.question.strip()
        if not q:
            raise Problem(422, "VALIDATION_ERROR", "Enter a question.")
        with connection(path, write=True) as db:
            existing = db.execute("SELECT * FROM chat_turns WHERE crew=? AND command=?",
                                  (crew, body.commandId)).fetchone()
            if existing:
                if (existing["question"] != q or existing["lang"] != body.language or
                        existing["assessment_id"] != body.assessmentId or
                        (body.conversationId and existing["conversation"] != body.conversationId)):
                    raise Problem(409, "IDEMPOTENCY_CONFLICT", "This command belongs to another question.")
                return response(turn_document(existing), replayed=True)
            conv = body.conversationId or str(uuid4())
            prev = db.execute("SELECT topic,facts,answer FROM chat_turns WHERE conversation=? AND crew=? "
                              "ORDER BY rowid DESC LIMIT 1", (conv, crew)).fetchone()
            if body.conversationId and not prev:
                raise Problem(404, "NOT_FOUND", "Conversation unavailable.")
            if prev and json.loads(prev["answer"])["status"] == "pending":
                raise Problem(409,"ANSWER_PENDING","Wait for the preceding answer.")
            prior = {"topic":prev["topic"], "facts":json.loads(prev["facts"])} if prev else None
            topic, facts = build_facts(db, crew, q, body.language, prior, body.assessmentId)
            ident, stamp = str(uuid4()), now_text()
            has_evidence = any(f["refs"] for f in facts)
            result = answer_for(facts, list(range(len(facts))), "pending" if has_evidence else "no_evidence")
            db.execute("INSERT INTO chat_turns VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (ident,crew,conv,body.commandId,q,body.language,stamp,topic,encoded(facts),encoded(result),
                        body.assessmentId))
        if has_evidence:
            job = asyncio.create_task(finish(ident, q, body.language, facts, prior["topic"] if prior else ""))
            app.state.chat_jobs.add(job)
            job.add_done_callback(app.state.chat_jobs.discard)
        return response({"id":ident, "conversationId":conv, "createdAt":stamp, "question":q,
                         "language":body.language, **result}, 202 if has_evidence else 200)

    @app.get("/v1/assistant/explanations/{turn_id}")
    def turn(request: Request, turn_id: str):
        crew = owner(request)
        with connection(path) as db:
            row = db.execute("SELECT * FROM chat_turns WHERE crew=? AND id=?", (crew,turn_id)).fetchone()
            if not row:
                raise Problem(404,"NOT_FOUND","Answer unavailable.")
            return response(turn_document(row))

    @app.get("/v1/assistant/history")
    def history(request: Request, conversationId: str | None = None):
        crew = owner(request)
        with connection(path) as db:
            if not conversationId:
                recent = db.execute("SELECT conversation FROM chat_turns WHERE crew=? ORDER BY rowid DESC LIMIT 1",
                                    (crew,)).fetchone()
                if not recent:
                    return response({"conversationId":None,"items":[]})
                conversationId = recent[0]
            rows = db.execute("SELECT * FROM chat_turns WHERE crew=? AND conversation=? ORDER BY rowid DESC LIMIT 50",
                              (crew,conversationId)).fetchall()
            if not rows:
                raise Problem(404,"NOT_FOUND","Conversation unavailable.")
            return response({"conversationId":conversationId,"items":[turn_document(r) for r in reversed(rows)]})

    @app.get("/v1/assistant/records/{kind}/{record_id}")
    def record(request: Request, kind: Literal["measurement","task","alert","assessment"], record_id: str,
               version: int | None = None):
        crew = owner(request)
        with connection(path) as db:
            if kind == "assessment":
                return response(read_news2(db, crew, record_id, version))
            if kind == "task":
                return response(get_task(db, crew, record_id))
            if kind == "alert":
                item = next((a for a in list_alerts(db, crew) if a["id"] == record_id), None)
            else:
                row = db.execute("SELECT document FROM measurements WHERE crew_id=? AND id=?",
                                 (crew,record_id)).fetchone()
                item = json.loads(row[0]) if row else None
            if item is None:
                raise Problem(404,"NOT_FOUND","Record unavailable.")
            return response(item)

