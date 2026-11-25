"""Teacher review payload keeps the rich turn evidence, not just role:text."""

from __future__ import annotations

import asyncio

import pytest

from deeptutor.multi_user import classroom


@pytest.fixture(autouse=True)
def _auth_on(monkeypatch):
    from deeptutor.api.routers import classroom as router

    monkeypatch.setattr(router, "AUTH_ENABLED", True)


@pytest.fixture
def review_fixtures(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        row = get_content_workspace_service().create_workspace("Math P3")
    record = classroom.create_class(teacher["id"], "Math P3", row["workspace_id"])
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    return teacher, student, record


def _seed_and_assign(teacher, student, record, as_user) -> str:
    from deeptutor.api.routers import classroom as router
    from deeptutor.learning.models import TopicMetadata
    from deeptutor.learning.service import LearningService
    from deeptutor.services.workspace.context import workspace_context

    with classroom.teacher_account_context(record):
        with workspace_context(record["workspace_id"]):
            LearningService().create_topic(
                "topic_src",
                name="Cranes",
                modules=[],
                metadata=TopicMetadata(path_id="topic_src", goal="Learn cranes"),
                sources=[],
            )
    with as_user(teacher["id"], role="teacher"):
        result = asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind="mastery_topic", source_id="topic_src"),
                _=None,
            )
        )
    assert result["results"][0]["ok"], result
    return classroom.list_assignments(class_id=record["id"])[0]["target_id"]


def _seed_session(student_id: str, target_id: str) -> None:
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    with student_context(student_id):
        with workspace_context(None):
            store = get_sqlite_session_store()
            asyncio.run(
                store.create_session(title="Limit review", session_id="sess_review")
            )
            LearningStore().bind_session(target_id, "sess_review")
            asyncio.run(
                store.add_message(
                    session_id="sess_review",
                    role="user",
                    content="Where should we start?",
                    capability="mastery_path",
                )
            )
            turn = asyncio.run(store.begin_turn("sess_review", "mastery_path"))
            ask_user_questions = {
                "intro": "Quick setup",
                "questions": [
                    {
                        "id": "time",
                        "prompt": "How much time do you have?",
                        "header": "Time",
                        "options": [{"label": "A few months"}],
                        "allow_free_text": True,
                    }
                ],
            }
            events = [
                {
                    "type": "stage_start",
                    "source": "chat",
                    "stage": "responding",
                    "content": "",
                    "metadata": {},
                    "timestamp": 10.0,
                },
                {
                    "type": "tool_call",
                    "source": "chat",
                    "stage": "responding",
                    "content": "ask_user",
                    "metadata": {
                        "tool_name": "ask_user",
                        "call_id": "ask-call",
                        "args": ask_user_questions,
                    },
                    "timestamp": 11.0,
                },
                {
                    "type": "tool_result",
                    "source": "chat",
                    "stage": "responding",
                    "content": "awaiting reply",
                    "metadata": {
                        "tool_name": "ask_user",
                        "call_id": "ask-call",
                        "tool_metadata": {"ask_user": ask_user_questions},
                    },
                    "timestamp": 12.0,
                },
                {
                    "type": "wait_for_input",
                    "source": "chat",
                    "stage": "responding",
                    "content": "Quick setup",
                    "metadata": {"ask_user": ask_user_questions},
                    "timestamp": 12.5,
                },
                {
                    "type": "progress",
                    "source": "chat",
                    "stage": "responding",
                    "content": "",
                    "metadata": {
                        "ask_user_resolved": True,
                        "ask_user_tool_call_id": "ask-call",
                        "answers": [{"questionId": "time", "text": "A few months"}],
                        "trace_kind": "user_reply",
                    },
                    "timestamp": 13.0,
                },
                {
                    "type": "tool_call",
                    "source": "chat",
                    "stage": "responding",
                    "content": "mastery_quiz",
                    "metadata": {
                        "tool_name": "mastery_quiz",
                        "call_id": "quiz-call",
                        "args": {"question": "Wingspan?"},
                    },
                    "timestamp": 14.0,
                },
                {
                    "type": "tool_result",
                    "source": "chat",
                    "stage": "responding",
                    "content": "The question is on the learner's answer card.",
                    "metadata": {
                        "tool_name": "mastery_quiz",
                        "call_id": "quiz-call",
                    },
                    "timestamp": 15.0,
                },
                {
                    "type": "result",
                    "source": "chat",
                    "stage": "responding",
                    "content": "Here is your question.",
                    "metadata": {"response": "Here is your question."},
                    "timestamp": 16.0,
                },
                {
                    "type": "stage_end",
                    "source": "chat",
                    "stage": "responding",
                    "content": "",
                    "metadata": {},
                    "timestamp": 17.0,
                },
            ]
            asyncio.run(store.append_turn_events(turn["id"], events))
            assistant_id = asyncio.run(
                store.add_message(
                    session_id="sess_review",
                    role="assistant",
                    content="Here is your question.",
                    capability="mastery_path",
                )
            )
            asyncio.run(store.link_turn_message(turn["id"], assistant_id))
            asyncio.run(store.update_turn_status(turn["id"], "completed"))
            asyncio.run(
                store.upsert_notebook_entries(
                    "sess_review",
                    [
                        {
                            "question": "Wingspan?",
                            "question_id": "q-crane-1",
                            "question_type": "choice",
                            "options": {"A": "Narrow", "B": "Wide"},
                            "user_answer": "A",
                            "correct_answer": "B",
                            "explanation": "Cranes have wide wingspans.",
                            "is_correct": False,
                            "result": "incorrect",
                            "assessment_type": "quiz",
                            "turn_id": turn["id"],
                            "origin_type": "conversation",
                            "origin_ref": "sess_review",
                        }
                    ],
                )
            )


def test_review_payload_includes_ask_user_and_quiz(
    review_fixtures, as_user
) -> None:
    from deeptutor.api.routers import classroom as router

    teacher, student, record = review_fixtures
    target = _seed_and_assign(teacher, student, record, as_user)
    _seed_session(student["id"], target)

    with as_user(teacher["id"], role="teacher"):
        payload = asyncio.run(
            router.view_student_session(student["id"], "sess_review", _=None)
        )

    assert payload["context"]["student"]["username"] == "student1"
    assert payload["context"]["class"]["name"] == "Math P3"
    assert payload["context"]["topic"]["name"] == "Cranes"
    assert payload["summary"]["turns"] == 1
    assert payload["summary"]["ask_user"] == 1
    assert payload["summary"]["quizzes"] == 1
    assert payload["summary"]["mistakes"] == 1

    turn = payload["turns"][0]
    assert turn["capability"] == "mastery_path"
    assert turn["status"] == "completed"
    assert turn["user_message_id"] is not None
    assert turn["assistant_message_id"] is not None

    exchange = turn["ask_user"][0]
    assert exchange["questions"][0]["prompt"] == "How much time do you have?"
    assert exchange["answers"] == [
        {"questionId": "time", "text": "A few months"}
    ]
    assert exchange["resolved"] is True

    quiz = turn["quiz_results"][0]
    assert quiz["question"] == "Wingspan?"
    assert quiz["user_answer"] == "A"
    assert quiz["correct_answer"] == "B"
    assert quiz["is_correct"] is False
    assert quiz["explanation"] == "Cranes have wide wingspans."

    assert [call["name"] for call in turn["tool_calls"]] == ["mastery_quiz"]
    assert turn["tool_calls"][0]["status"] == "completed"
    assert [stage["stage"] for stage in turn["stages"]] == ["responding"]

    # The transcript messages are the chat detail contract: the assistant row
    # carries the ask_user card events the renderer reads.
    assistant = next(
        message for message in payload["messages"] if message["role"] == "assistant"
    )
    assert any(
        (event.get("metadata") or {}).get("tool_metadata", {}).get("ask_user")
        for event in assistant["events"]
    )
    assert any(
        (event.get("metadata") or {}).get("ask_user_resolved")
        for event in assistant["events"]
    )