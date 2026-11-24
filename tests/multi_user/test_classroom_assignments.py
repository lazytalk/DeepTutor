"""P2 assign-by-copy: fidelity, snapshots, teacher reach, revocation."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import classroom


@pytest.fixture(autouse=True)
def _auth_on(monkeypatch):
    from deeptutor.api.routers import classroom as router

    monkeypatch.setattr(router, "AUTH_ENABLED", True)


@pytest.fixture
def delivery_fixtures(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    other = seed_user("teacher2", role="teacher")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        row = get_content_workspace_service().create_workspace("Math P3")
    record = classroom.create_class(teacher["id"], "Math P3", row["workspace_id"])
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    return teacher, student, other, record


def _seed_source_topic(record):
    from deeptutor.learning.models import TopicMetadata, TopicSource, TopicSourceKind
    from deeptutor.learning.service import LearningService
    from deeptutor.multi_user.paths import get_current_path_service
    from deeptutor.services.workspace.context import workspace_context

    with classroom.teacher_account_context(record):
        with workspace_context(record["workspace_id"]):
            kb_raw = get_current_path_service().get_knowledge_bases_root() / "classkb" / "raw"
            kb_raw.mkdir(parents=True, exist_ok=True)
            (kb_raw / "notes.txt").write_text("Crane facts: wingspan wide.", encoding="utf-8")
            sources = [
                TopicSource(
                    id="s1",
                    kind=TopicSourceKind.TEXT,
                    label="Inline notes",
                    metadata={"text": "Inline snapshot text about cranes."},
                ),
                TopicSource(
                    id="s2",
                    kind=TopicSourceKind.KNOWLEDGE_BASE,
                    source_id="classkb",
                    label="Class KB",
                    metadata={"kb_name": "classkb"},
                ),
            ]
            LearningService().create_topic(
                "topic_src",
                name="Cranes",
                modules=[],
                metadata=TopicMetadata(path_id="topic_src", goal="Learn cranes"),
                sources=sources,
            )


def test_copy_fidelity_and_snapshot_resolution(delivery_fixtures, as_user):
    from deeptutor.learning.storage import LearningStore
    from deeptutor.learning.topic_materials import build_topic_materials
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.workspace.context import workspace_context

    teacher, student, _, record = delivery_fixtures
    _seed_source_topic(record)
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.api.routers import classroom as router

        result = asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind="mastery_topic", source_id="topic_src"),
                _=None,
            )
        )
    assert result["results"][0]["ok"], result
    assignment = classroom.list_assignments(class_id=record["id"])[0]
    target = assignment["target_id"]
    with student_context(student["id"]):
        with workspace_context(None):
            store = LearningStore()
            progress = store.load(target)
            assert progress is not None and progress.name == "Cranes"
            sources = store.get_topic(target).sources
            assert all(s.kind.value == "text" for s in sources)
            materials = build_topic_materials(sources)
            texts = [m.full_text for m in materials.materials]
            assert any("Inline snapshot text" in t for t in texts)
            assert any("wingspan" in t for t in texts), texts


def test_teacher_reach_and_revocation(delivery_fixtures, as_user):
    from deeptutor.api.routers import classroom as router

    teacher, student, other, record = delivery_fixtures
    _seed_source_topic(record)
    with as_user(teacher["id"], role="teacher"):
        asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind="mastery_topic", source_id="topic_src"),
                _=None,
            )
        )
    assignment = classroom.list_assignments(class_id=record["id"])[0]
    target = assignment["target_id"]
    with as_user(teacher["id"], role="teacher"):
        payload = asyncio.run(router.view_student_topic(student["id"], target, _=None))
        assert payload is not None
        asyncio.run(
            router.rename_student_topic(
                student["id"], target, router.RenameTopicRequest(name="Cranes II"), _=None
            )
        )
        with pytest.raises(HTTPException):
            asyncio.run(router.view_student_session(student["id"], "sess_nope", _=None))
    with as_user(other["id"], role="teacher"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(router.view_student_topic(student["id"], target, _=None))
        assert exc.value.status_code == 403
    with as_user(teacher["id"], role="teacher"):
        asyncio.run(router.revoke_assignment(assignment["id"], _=None))
        with pytest.raises(HTTPException):
            asyncio.run(router.view_student_topic(student["id"], target, _=None))
    # The copy remains the student's own data after revocation.
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.workspace.context import workspace_context

    with student_context(student["id"]):
        with workspace_context(None):
            assert LearningStore().load(target) is not None
    with as_user(student["id"], role="student"):
        mine = asyncio.run(router.my_assignments(_=None))
        assert mine["assignments"] == []


def test_question_set_copy_and_patch(delivery_fixtures, as_user):
    from deeptutor.api.routers import classroom as router
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store
    from deeptutor.services.workspace.context import workspace_context

    teacher, student, _, record = delivery_fixtures
    with classroom.teacher_account_context(record):
        with workspace_context(record["workspace_id"]):
            store = get_sqlite_session_store()
            category = asyncio.run(store.create_category("Crane quiz"))
            asyncio.run(
                store.upsert_notebook_entries(
                    None,
                    [
                        {
                            "question": "Wingspan?",
                            "question_id": "q-crane-1",
                            "correct_answer": "Wide",
                            "explanation": "Because cranes.",
                            "origin_type": "external_import",
                            "origin_ref": "seed:crane-quiz",
                        }
                    ],
                )
            )
            unfiled = asyncio.run(store.list_notebook_entries(uncategorized=True, limit=50))
            for entry in unfiled.get("items", []):
                asyncio.run(store.add_entry_to_category(entry["id"], category["id"]))
    with as_user(teacher["id"], role="teacher"):
        result = asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind="question_set", source_id=str(category["id"])),
                _=None,
            )
        )
        assert result["results"][0]["ok"], result
        sets = asyncio.run(router.list_student_question_sets(student["id"], _=None))
        assert len(sets["question_sets"]) == 1
        new_cat = sets["question_sets"][0]["category"]["id"]
        entries = asyncio.run(
            router.list_student_set_entries(student["id"], new_cat, _=None)
        )["entries"]
        assert len(entries) == 1 and entries[0]["question"] == "Wingspan?"
        asyncio.run(
            router.patch_student_entry(
                student["id"],
                entries[0]["id"],
                router.PatchEntryRequest(answer="Very wide"),
                _=None,
            )
        )
        entries = asyncio.run(
            router.list_student_set_entries(student["id"], new_cat, _=None)
        )["entries"]
        assert entries[0]["correct_answer"] == "Very wide"
