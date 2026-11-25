"""Read-only review payload for a student's assigned-topic session.

The classroom session endpoint used to return the raw session-store payload;
teachers then saw a flat ``role: content`` blob. This module folds the canonical
turn trace and the question-bank rows into the same rich ``messages`` payload
the chat renderer already consumes, plus a per-turn activity digest:

* ``ask_user`` questions and the learner's answers,
* tool calls with their outcome,
* capability stages and their timings,
* quiz/assessment results (mistakes included),
* errors.

It is a pure projection over rows the store already returns — no writes, no
second copy of chat persistence logic.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

_ASK_USER_TOOL = "ask_user"
_PREVIEW_CHARS = 480
_ARGS_PREVIEW_CHARS = 320

#: Event kinds the turn timeline can render. Streamed ``thinking``/``content``
#: deltas stay in the assistant message preview; replaying them here would
#: triple the payload without adding anything a reviewer can use.
_TIMELINE_EVENT_TYPES = frozenset(
    {
        "session",
        "session_meta",
        "stage_start",
        "stage_end",
        "tool_call",
        "tool_result",
        "wait_for_input",
        "progress",
        "error",
        "result",
        "done",
    }
)

_EVENT_META_KEYS = (
    "call_id",
    "tool_call_id",
    "tool_name",
    "tool",
    "trace_id",
    "trace_kind",
    "trace_role",
    "trace_group",
    "label",
    "phase",
    "call_kind",
    "call_state",
    "ask_user_resolved",
    "ask_user_tool_call_id",
    "reply_preview",
    "error_code",
    "status",
)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _preview(value: Any, limit: int = _PREVIEW_CHARS) -> str:
    text = _text(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _json_preview(value: Any, limit: int = _ARGS_PREVIEW_CHARS) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _duration(started_at: Any, ended_at: Any) -> float | None:
    try:
        start = float(started_at)
        end = float(ended_at)
    except (TypeError, ValueError):
        return None
    if start <= 0 or end <= 0:
        return None
    return round(max(0.0, end - start), 2)


def _tool_name(event: dict[str, Any]) -> str:
    metadata = _as_dict(event.get("metadata"))
    return _text(
        metadata.get("tool_name")
        or metadata.get("tool")
        or event.get("content")
        or ""
    )


def _call_id(event: dict[str, Any]) -> str:
    metadata = _as_dict(event.get("metadata"))
    return _text(
        metadata.get("call_id")
        or metadata.get("tool_call_id")
        or metadata.get("trace_id")
        or ""
    )


def _ask_user_payload(metadata: dict[str, Any]) -> dict[str, Any] | None:
    tool_metadata = _as_dict(metadata.get("tool_metadata"))
    payload = tool_metadata.get("ask_user") or metadata.get("ask_user")
    return payload if isinstance(payload, dict) else None


def _normalize_options(raw_options: Any) -> list[dict[str, str | None]]:
    options: list[dict[str, str | None]] = []
    if not isinstance(raw_options, list):
        return options
    for option in raw_options:
        if isinstance(option, str):
            label = option.strip()
            description = None
        elif isinstance(option, dict):
            label = _text(
                option.get("label")
                or option.get("id")
                or option.get("value")
                or option.get("body")
            )
            description = _text(
                option.get("description") or option.get("body") or ""
            ) or None
        else:
            continue
        if label:
            options.append({"label": label, "description": description})
    return options


def normalize_questions(raw: Any) -> list[dict[str, Any]]:
    """Normalise every ask_user payload generation into one card shape."""
    if isinstance(raw, dict):
        questions = raw.get("questions")
    elif isinstance(raw, list):
        questions = raw
    else:
        questions = None
    if not isinstance(questions, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        question_id = _text(
            item.get("id")
            or item.get("question_id")
            or item.get("questionId")
        )
        prompt = _text(
            item.get("prompt")
            or item.get("question")
            or item.get("label")
        )
        if not question_id and not prompt:
            continue
        normalized.append(
            {
                "id": question_id,
                "prompt": prompt,
                "header": _text(item.get("header")) or None,
                "multi_select": bool(
                    item.get("multi_select") or item.get("multiSelect")
                ),
                "allow_free_text": bool(item.get("allow_free_text", True)),
                "placeholder": _text(item.get("placeholder")) or None,
                "options": _normalize_options(item.get("options")),
            }
        )
    return normalized


def _normalize_answers(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    answers: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        question_id = _text(
            item.get("questionId")
            or item.get("question_id")
            or item.get("id")
        )
        if not question_id:
            continue
        answers.append(
            {
                "questionId": question_id,
                "text": _text(item.get("text") or item.get("answer") or ""),
            }
        )
    return answers


def _collect_ask_user(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One exchange per ask_user call, carrying its questions and answers.

    A single call reaches the trace under two identities: the agent-loop
    ``call_id`` on ``tool_call``/``tool_result`` and the model's
    ``tool_call_id`` on ``wait_for_input`` and the resolving ``progress``
    event. Both are aliased to the same exchange so a question and its answer
    never split into two cards.
    """
    exchanges: list[dict[str, Any]] = []
    by_call: dict[str, dict[str, Any]] = {}

    def find(call_id: str, tool_call_id: str) -> dict[str, Any] | None:
        if call_id and call_id in by_call:
            return by_call[call_id]
        if tool_call_id and tool_call_id in by_call:
            return by_call[tool_call_id]
        return next(
            (item for item in reversed(exchanges) if not item["resolved"]),
            None,
        )

    def create(call_id: str, tool_call_id: str) -> dict[str, Any]:
        exchange = {
            "tool_call_id": tool_call_id or call_id,
            "intro": None,
            "questions": [],
            "answers": [],
            "resolved": False,
            "asked_at": None,
            "answered_at": None,
        }
        for alias in (call_id, tool_call_id):
            if alias:
                by_call[alias] = exchange
        exchanges.append(exchange)
        return exchange

    def merge(
        exchange: dict[str, Any],
        questions: list[dict[str, Any]] | None,
        intro: Any,
        asked_at: Any,
    ) -> None:
        if questions:
            exchange["questions"] = questions
        if intro:
            exchange["intro"] = _text(intro)
        if asked_at and not exchange["asked_at"]:
            exchange["asked_at"] = asked_at

    for event in events:
        event_type = _text(event.get("type"))
        metadata = _as_dict(event.get("metadata"))
        timestamp = event.get("timestamp")
        call_id = _call_id(event)
        tool_call_id = _text(metadata.get("tool_call_id"))
        if event_type == "tool_call":
            if _tool_name(event) != _ASK_USER_TOOL:
                continue
            args = _as_dict(metadata.get("args"))
            exchange = find(call_id, tool_call_id) or create(call_id, tool_call_id)
            merge(
                exchange,
                normalize_questions(args),
                args.get("intro"),
                timestamp,
            )
        elif event_type == "tool_result":
            payload = _ask_user_payload(metadata)
            if payload is None:
                continue
            exchange = find(call_id, tool_call_id) or create(call_id, tool_call_id)
            merge(
                exchange,
                normalize_questions(payload),
                payload.get("intro"),
                timestamp,
            )
        elif event_type == "wait_for_input":
            payload = _as_dict(metadata.get("ask_user"))
            if not payload:
                continue
            exchange = find(call_id, tool_call_id) or create(call_id, tool_call_id)
            merge(
                exchange,
                normalize_questions(payload),
                payload.get("intro"),
                timestamp,
            )
        elif event_type == "progress" and metadata.get("ask_user_resolved"):
            resolved_id = _text(metadata.get("ask_user_tool_call_id"))
            exchange = by_call.get(resolved_id) or find(resolved_id, "")
            if exchange is None:
                continue
            exchange["answers"] = _normalize_answers(metadata.get("answers"))
            exchange["resolved"] = True
            exchange["answered_at"] = timestamp
    return exchanges


def _collect_tool_calls(
    events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    call_states: dict[str, str] = {}
    for event in events:
        if _text(event.get("type")) != "progress":
            continue
        metadata = _as_dict(event.get("metadata"))
        call_id = _call_id(event)
        state = _text(metadata.get("call_state"))
        if call_id and state:
            call_states[call_id] = state

    calls: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for event in events:
        if _text(event.get("type")) != "tool_call":
            continue
        name = _tool_name(event)
        if name == _ASK_USER_TOOL:
            continue
        metadata = _as_dict(event.get("metadata"))
        call_id = _call_id(event)
        call = {
            "call_id": call_id,
            "name": name or _text(metadata.get("tool")),
            "status": call_states.get(call_id, "running"),
            "args_preview": _json_preview(_as_dict(metadata.get("args"))),
            "result_preview": "",
            "started_at": event.get("timestamp"),
            "finished_at": None,
        }
        calls.append(call)
        if call_id:
            by_id[call_id] = call

    for event in events:
        if _text(event.get("type")) != "tool_result":
            continue
        metadata = _as_dict(event.get("metadata"))
        if _ask_user_payload(metadata) is not None:
            continue
        call_id = _call_id(event)
        call = by_id.get(call_id)
        if call is None:
            name = _tool_name(event)
            if not name:
                tool_metadata = _as_dict(metadata.get("tool_metadata"))
                name = _text(next(iter(tool_metadata), ""))
            call = {
                "call_id": call_id,
                "name": name,
                "status": call_states.get(call_id, "running"),
                "args_preview": "",
                "result_preview": "",
                "started_at": None,
                "finished_at": None,
            }
            calls.append(call)
            if call_id:
                by_id[call_id] = call
        call["result_preview"] = _preview(event.get("content"))
        call["finished_at"] = event.get("timestamp")
        call["status"] = call_states.get(
            call_id,
            "error" if call["status"] == "error" else "completed",
        )

    for call in calls:
        if call["status"] == "running" and call["finished_at"] is not None:
            call["status"] = "completed"
    return calls


def _collect_stages(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    running: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        event_type = _text(event.get("type"))
        if event_type not in ("stage_start", "stage_end"):
            continue
        metadata = _as_dict(event.get("metadata"))
        stage = _text(event.get("stage") or event.get("content") or "stage")
        if event_type == "stage_start":
            row = {
                "stage": stage,
                "label": _text(metadata.get("label")) or stage,
                "status": "running",
                "started_at": event.get("timestamp"),
                "ended_at": None,
                "duration": None,
            }
            stages.append(row)
            running[stage].append(row)
            continue
        row = next(
            (item for item in reversed(running.get(stage, [])) if item["status"] == "running"),
            None,
        )
        if row is None:
            row = {
                "stage": stage,
                "label": _text(metadata.get("label")) or stage,
                "status": "completed",
                "started_at": None,
                "ended_at": None,
                "duration": None,
            }
            stages.append(row)
        row["status"] = "completed"
        row["ended_at"] = event.get("timestamp")
        row["duration"] = _duration(row["started_at"], row["ended_at"])
    return stages


def _collect_errors(
    turn: dict[str, Any], events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    turn_error = _text(turn.get("error"))
    if turn_error:
        errors.append(
            {
                "message": _preview(turn_error),
                "code": _text(turn.get("failure_code")),
                "at": turn.get("finished_at") or turn.get("updated_at"),
            }
        )
    for event in events:
        if _text(event.get("type")) != "error":
            continue
        metadata = _as_dict(event.get("metadata"))
        errors.append(
            {
                "message": _preview(
                    event.get("content") or metadata.get("message") or "Error"
                ),
                "code": _text(metadata.get("error_code") or metadata.get("code")),
                "at": event.get("timestamp"),
            }
        )
    return errors


def _timeline_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact, renderable slice of a turn's event trace."""
    compact: list[dict[str, Any]] = []
    for event in events:
        event_type = _text(event.get("type"))
        if event_type not in _TIMELINE_EVENT_TYPES:
            continue
        metadata = _as_dict(event.get("metadata"))
        if event_type == "progress":
            if not (
                metadata.get("ask_user_resolved")
                or metadata.get("call_state")
                or metadata.get("trace_kind") == "user_reply"
            ):
                continue
        compact.append(
            {
                "type": event_type,
                "source": _text(event.get("source")),
                "stage": _text(event.get("stage")),
                "content": _preview(event.get("content"), 240),
                "seq": event.get("seq"),
                "timestamp": event.get("timestamp"),
                "metadata": {
                    key: metadata[key]
                    for key in _EVENT_META_KEYS
                    if key in metadata
                },
            }
        )
    return compact


def _quiz_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """The slice of a question-bank row the review timeline shows."""
    return {
        "id": entry.get("id"),
        "question_id": _text(entry.get("question_id")),
        "question": _text(entry.get("question")),
        "question_type": _text(entry.get("question_type")),
        "options": entry.get("options") if isinstance(entry.get("options"), dict) else {},
        "user_answer": _text(entry.get("user_answer")),
        "correct_answer": _text(entry.get("correct_answer")),
        "explanation": _text(entry.get("explanation")),
        "is_correct": bool(entry.get("is_correct")),
        "result": _text(entry.get("result")),
        "assessment_type": _text(entry.get("assessment_type")),
        "knowledge_point_id": _text(entry.get("knowledge_point_id")),
        "mastery_path_id": _text(entry.get("mastery_path_id")),
        "attempt_count": int(entry.get("attempt_count") or 1),
        "hints_used": int(entry.get("hints_used") or 0),
        "created_at": entry.get("created_at"),
    }


def _turn_counts(turn: dict[str, Any]) -> dict[str, int]:
    quizzes = turn.get("quiz_results") or []
    exchanges = turn.get("ask_user") or []
    return {
        # A reviewer counts questions, not cards: one multi-part ask_user call
        # is still four things the learner had to answer.
        "ask_user": sum(
            len(exchange.get("questions") or []) or 1 for exchange in exchanges
        ),
        "tools": len(turn.get("tool_calls") or []),
        "stages": len(turn.get("stages") or []),
        "quizzes": len(quizzes),
        "mistakes": sum(1 for item in quizzes if not item.get("is_correct")),
        "errors": len(turn.get("errors") or []),
    }


def _group_messages_by_turn(
    messages: list[dict[str, Any]],
    turns: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pair each turn with the user row that prompted its assistant reply.

    The store links a turn to its assistant message. The user row is the
    nearest preceding user message, which is exactly how the transcript reads.
    """
    ordered = sorted(
        (message for message in messages if isinstance(message, dict)),
        key=lambda message: (
            float(message.get("created_at") or 0),
            int(message.get("id") or 0),
        ),
    )
    index_by_id = {
        message.get("id"): index
        for index, message in enumerate(ordered)
        if message.get("id") is not None
    }
    assigned: set[Any] = set()
    pairings: list[tuple[str, Any, Any, list[Any]]] = []

    for turn in turns:
        assistant_id = turn.get("assistant_message_id")
        user_id = None
        if assistant_id in index_by_id:
            start = index_by_id[assistant_id]
            for index in range(start - 1, -1, -1):
                candidate = ordered[index]
                if candidate.get("role") != "user":
                    continue
                candidate_id = candidate.get("id")
                if candidate_id in assigned:
                    continue
                user_id = candidate_id
                break
        message_ids = [item for item in (user_id, assistant_id) if item is not None]
        assigned.update(message_ids)
        pairings.append((_text(turn.get("id")), user_id, assistant_id, message_ids))

    unlinked = [
        message
        for message in ordered
        if message.get("role") in ("user", "assistant")
        and message.get("id") not in assigned
    ]
    return pairings, unlinked


def build_session_review(
    *,
    session: dict[str, Any],
    turns: list[dict[str, Any]],
    events_by_turn: dict[str, list[dict[str, Any]]],
    quiz_entries: list[dict[str, Any]],
    context: dict[str, Any],
) -> dict[str, Any]:
    """Project stored rows into the teacher review contract."""
    messages = session.get("messages") or []
    pairings, unlinked = _group_messages_by_turn(messages, turns)
    message_by_id = {
        message.get("id"): message
        for message in messages
        if isinstance(message, dict) and message.get("id") is not None
    }

    quizzes_by_turn: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unassigned_quizzes: list[dict[str, Any]] = []
    for entry in quiz_entries:
        if not isinstance(entry, dict):
            continue
        projected = _quiz_entry(entry)
        turn_id = _text(entry.get("turn_id"))
        if turn_id:
            quizzes_by_turn[turn_id].append(projected)
        else:
            unassigned_quizzes.append(projected)

    payload_turns: list[dict[str, Any]] = []
    for number, (turn_id, user_id, assistant_id, message_ids) in enumerate(
        pairings, start=1
    ):
        turn = turns[number - 1]
        events = events_by_turn.get(turn_id, [])
        assistant = message_by_id.get(assistant_id) if assistant_id is not None else None
        ask_user = _collect_ask_user(events)
        tool_calls = _collect_tool_calls(events)
        row = {
            "id": turn_id,
            "turn_id": turn_id,
            "number": number,
            "capability": _text(
                turn.get("capability")
                or (assistant or {}).get("capability")
            ),
            "status": _text(turn.get("status")) or "completed",
            "error": _text(turn.get("error")),
            "failure_code": _text(turn.get("failure_code")),
            "retryable": bool(turn.get("retryable")),
            "created_at": turn.get("created_at"),
            "updated_at": turn.get("updated_at"),
            "finished_at": turn.get("finished_at"),
            "duration": _duration(turn.get("created_at"), turn.get("finished_at")),
            "user_message_id": user_id,
            "assistant_message_id": assistant_id,
            "message_ids": message_ids,
            "events": _timeline_events(events),
            "ask_user": ask_user,
            "tool_calls": tool_calls,
            "stages": _collect_stages(events),
            "quiz_results": quizzes_by_turn.get(turn_id, []),
            "errors": _collect_errors(turn, events),
        }
        row["counts"] = _turn_counts(row)
        payload_turns.append(row)

    if unlinked:
        first = unlinked[0]
        last = unlinked[-1]
        row = {
            "id": "__unlinked__",
            "turn_id": "",
            "number": len(payload_turns) + 1,
            "capability": _text(first.get("capability")),
            "status": "complete",
            "error": "",
            "failure_code": "",
            "retryable": False,
            "created_at": first.get("created_at"),
            "updated_at": last.get("created_at"),
            "finished_at": last.get("created_at"),
            "duration": None,
            "user_message_id": next(
                (message.get("id") for message in unlinked if message.get("role") == "user"),
                None,
            ),
            "assistant_message_id": None,
            "message_ids": [message.get("id") for message in unlinked],
            "events": [],
            "ask_user": [],
            "tool_calls": [],
            "stages": [],
            "quiz_results": [],
            "errors": [],
        }
        row["counts"] = _turn_counts(row)
        payload_turns.append(row)

    if unassigned_quizzes:
        if payload_turns:
            payload_turns[-1]["quiz_results"].extend(unassigned_quizzes)
            payload_turns[-1]["counts"] = _turn_counts(payload_turns[-1])
        else:
            payload_turns.append(
                {
                    "id": "__questions__",
                    "turn_id": "",
                    "number": 1,
                    "capability": "",
                    "status": "complete",
                    "error": "",
                    "failure_code": "",
                    "retryable": False,
                    "created_at": None,
                    "updated_at": None,
                    "finished_at": None,
                    "duration": None,
                    "user_message_id": None,
                    "assistant_message_id": None,
                    "message_ids": [],
                    "events": [],
                    "ask_user": [],
                    "tool_calls": [],
                    "stages": [],
                    "quiz_results": unassigned_quizzes,
                    "errors": [],
                    "counts": {
                        "ask_user": 0,
                        "tools": 0,
                        "stages": 0,
                        "quizzes": len(unassigned_quizzes),
                        "mistakes": sum(
                            1 for item in unassigned_quizzes if not item["is_correct"]
                        ),
                        "errors": 0,
                    },
                }
            )

    totals = {
        "turns": len(payload_turns),
        "messages": len([m for m in messages if m.get("role") in ("user", "assistant")]),
        "ask_user": sum(turn["counts"]["ask_user"] for turn in payload_turns),
        "tools": sum(turn["counts"]["tools"] for turn in payload_turns),
        "quizzes": sum(turn["counts"]["quizzes"] for turn in payload_turns),
        "mistakes": sum(turn["counts"]["mistakes"] for turn in payload_turns),
        "errors": sum(turn["counts"]["errors"] for turn in payload_turns),
    }
    for turn in payload_turns:
        turn["counts"]["messages"] = len(turn["message_ids"])

    return {
        **session,
        "turns": payload_turns,
        "context": context,
        "summary": totals,
    }