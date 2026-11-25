"""Per-student learning record: class-scoped aggregation and ownership guard."""

from __future__ import annotations

import asyncio
import json
import sqlite3

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import classroom


@pytest.fixture(autouse=True)
def _auth_on(monkeypatch):
    from deeptutor.api.routers import classroom as router

    monkeypatch.setattr(router, "AUTH_ENABLED", True)


@pytest.fixture
def record_fixtures(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    other_teacher = seed_user("teacher2", role="teacher")
    other_student = seed_user("student2", role="student")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        row = get_content_workspace_service().create_workspace("Math P3")
    with as_user(other_teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        other_row = get_content_workspace_service().create_workspace("Science P5")
    record = classroom.create_class(teacher["id"], "Math P3", row["workspace_id"])
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    other_class = classroom.create_class(
        other_teacher["id"], "Science P5", other_row["workspace_id"]
    )
    classroom.invite_member(other_class["id"], other_student["id"], other_teacher["id"])
    return teacher, student, other_teacher, record


def _seed_source_topic(record: dict) -> None:
    from deeptutor.learning.models import (
        KnowledgePoint,
        KnowledgeType,
        LearningModule,
        TopicMetadata,
    )
    from deeptutor.learning.service import LearningService
    from deeptutor.services.workspace.context import workspace_context

    with classroom.teacher_account_context(record):
        with workspace_context(record["workspace_id"]):
            LearningService().create_topic(
                "topic_src",
                name="Cranes",
                modules=[
                    LearningModule(
                        id="m1",
                        name="Module 1",
                        order=0,
                        knowledge_points=[
                            KnowledgePoint(
                                id="kp1",
                                name="Wingspan",
                                type=KnowledgeType.MEMORY,
                                module_id="m1",
                            )
                        ],
                    )
                ],
                metadata=TopicMetadata(path_id="topic_src", goal="Learn cranes"),
                sources=[],
            )


def _seed_source_question_set(record: dict) -> int:
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    with classroom.teacher_account_context(record):
        with workspace_context(record["workspace_id"]):
            store = get_sqlite_session_store()
            category = asyncio.run(store.create_category("Crane quiz"))
            asyncio.run(
                store.upsert_notebook_entries(
                    None,
                    [
                        {
                            "question": "ASSIGNED CRANE QUESTION",
                            "question_id": "q-assigned-1",
                            "correct_answer": "Wide",
                            "explanation": "Because cranes.",
                            "origin_type": "external_import",
                            "origin_ref": "seed:assigned-quiz",
                        }
                    ],
                )
            )
            unfiled = asyncio.run(store.list_notebook_entries(uncategorized=True, limit=50))
            for entry in unfiled.get("items", []):
                if entry.get("question_id") == "q-assigned-1":
                    asyncio.run(store.add_entry_to_category(entry["id"], category["id"]))
            return int(category["id"])


def _assign(record: dict, teacher: dict, as_user, kind: str, source_id: str) -> dict:
    from deeptutor.api.routers import classroom as router

    with as_user(teacher["id"], role="teacher"):
        result = asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind=kind, source_id=source_id),
                _=None,
            )
        )
    assert result["results"][0]["ok"], result
    return classroom.list_assignments(class_id=record["id"], kind=kind)[-1]


def _seed_assigned_session(student: dict, target_id: str) -> None:
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    with student_context(student["id"]):
        with workspace_context(None):
            store = get_sqlite_session_store()
            asyncio.run(store.create_session(title="Crane review", session_id="sess_assigned"))
            LearningStore().bind_session(target_id, "sess_assigned")
            asyncio.run(
                store.add_message(
                    session_id="sess_assigned",
                    role="user",
                    content="How wide is a crane?",
                    capability="mastery_path",
                )
            )


def _seed_private_work(student: dict) -> None:
    """Student work in no class: must never appear in the record."""
    from deeptutor.learning.models import TopicMetadata
    from deeptutor.learning.service import LearningService
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    with student_context(student["id"]):
        with workspace_context(None):
            LearningService().create_topic(
                "topic_private",
                name="Private Goal",
                modules=[],
                metadata=TopicMetadata(path_id="topic_private", goal="Private goal"),
                sources=[],
            )
            store = get_sqlite_session_store()
            asyncio.run(store.create_session(title="Private chat", session_id="sess_private"))
            LearningStore().bind_session("topic_private", "sess_private")
            category = asyncio.run(store.create_category("Private quiz"))
            asyncio.run(
                store.upsert_notebook_entries(
                    None,
                    [
                        {
                            "question": "PRIVATE SECRET QUESTION",
                            "question_id": "q-private-1",
                            "correct_answer": "secret",
                            "category_id": category["id"],
                            "origin_type": "external_import",
                            "origin_ref": "seed:private",
                        }
                    ],
                )
            )


def _seed_assigned_mistake(student: dict, category_id: int) -> None:
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    with student_context(student["id"]):
        with workspace_context(None):
            store = get_sqlite_session_store()
            asyncio.run(
                store.upsert_notebook_entries(
                    None,
                    [
                        {
                            "question": "ASSIGNED MISTAKE QUESTION",
                            "question_id": "q-assigned-mistake",
                            "correct_answer": "Wide",
                            "explanation": "Because cranes.",
                            "origin_type": "external_import",
                            "origin_ref": "seed:assigned-mistake",
                            "is_correct": False,
                            "result": "incorrect",
                        }
                    ],
                )
            )
            unfiled = asyncio.run(store.list_notebook_entries(uncategorized=True, limit=50))
            for entry in unfiled.get("items", []):
                if entry.get("question_id") == "q-assigned-mistake":
                    asyncio.run(store.add_entry_to_category(entry["id"], category_id))
            conn = sqlite3.connect(store.db_path)
            try:
                conn.execute("UPDATE practice_review_state SET due_at = 0")
                conn.commit()
            finally:
                conn.close()


def test_record_aggregates_assigned_work_and_rejects_other_teachers(
    record_fixtures, as_user
):
    from deeptutor.api.routers import classroom as router

    teacher, student, other_teacher, record = record_fixtures
    _seed_source_topic(record)
    source_category = _seed_source_question_set(record)
    topic_assignment = _assign(record, teacher, as_user, "mastery_topic", "topic_src")
    set_assignment = _assign(
        record, teacher, as_user, "question_set", str(source_category)
    )
    _seed_assigned_session(student, topic_assignment["target_id"])
    _seed_assigned_mistake(student, int(set_assignment["target_id"]))
    _seed_private_work(student)

    with as_user(teacher["id"], role="teacher"):
        payload = asyncio.run(router.student_record(student["id"], _=None))

    assert payload["student"]["id"] == student["id"]
    assert [entry["name"] for entry in payload["classes"]] == ["Math P3"]
    assert {entry["kind"] for entry in payload["assignments"]} == {
        "mastery_topic",
        "question_set",
    }
    assert all(entry["status"] == "active" for entry in payload["assignments"])

    assert len(payload["mastery"]["topics"]) == 1
    topic = payload["mastery"]["topics"][0]
    assert topic["path_id"] == topic_assignment["target_id"]
    assert topic["name"] == "Cranes"
    assert topic["counts"]["total"] == 1
    assert [kp["id"] for kp in topic["modules"][0]["knowledge_points"]] == ["kp1"]
    assert payload["mastery"]["counts"]["total"] == 1

    assert [item["session_id"] for item in payload["sessions"]] == ["sess_assigned"]
    assert payload["sessions"][0]["topic_name"] == "Cranes"
    assert payload["sessions"][0]["class_name"] == "Math P3"

    assert [entry["category_id"] for entry in payload["practice"]["sets"]] == [
        int(set_assignment["target_id"])
    ]
    assert payload["practice"]["sets"][0]["mistakes"] >= 1
    # Practice aggregates cover the assigned copy only: the two copied
    # questions, never the private notebook entry in the same workspace.
    assert payload["practice"]["summary"]["total"] == 2
    assert payload["practice"]["analytics"]["totals"]["questions"] == 2
    assert any(
        item["question"] == "ASSIGNED MISTAKE QUESTION"
        for item in payload["practice"]["queue"]
    )

    assert any(
        entry["question"] == "ASSIGNED CRANE QUESTION"
        for entry in payload["highlights"]["recent"]
    )

    serialized = json.dumps(payload)
    assert "PRIVATE SECRET QUESTION" not in serialized
    assert "topic_private" not in serialized
    assert "Private Goal" not in serialized
    assert "sess_private" not in serialized

    with as_user(teacher["id"], role="teacher"):
        evidence = asyncio.run(
            router.view_student_objective(
                student["id"], topic_assignment["target_id"], "kp1", _=None
            )
        )
    assert evidence["objective"]["id"] == "kp1"
    assert evidence["objective"]["module_name"] == "Module 1"

    with as_user(other_teacher["id"], role="teacher"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(router.student_record(student["id"], _=None))
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as evidence_exc:
            asyncio.run(
                router.view_student_objective(
                    student["id"], topic_assignment["target_id"], "kp1", _=None
                )
            )
        assert evidence_exc.value.status_code == 403