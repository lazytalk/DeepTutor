"""P3: per-student progress aggregation over assigned copies."""

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
def progress_fixtures(mu_isolated_root, seed_user, as_user):
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


def test_progress_rows_and_guard(progress_fixtures, as_user):
    from deeptutor.api.routers import classroom as router
    from deeptutor.learning.models import (
        KnowledgePoint,
        KnowledgeType,
        LearningModule,
        TopicMetadata,
    )
    from deeptutor.learning.service import LearningService
    from deeptutor.services.workspace.context import workspace_context

    teacher, student, other, record = progress_fixtures
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
                                id="kp1", name="KP 1", type=KnowledgeType.MEMORY, module_id="m1"
                            )
                        ],
                    )
                ],
                metadata=TopicMetadata(path_id="topic_src", goal="Learn cranes"),
                sources=[],
            )
    with as_user(teacher["id"], role="teacher"):
        asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(kind="mastery_topic", source_id="topic_src"),
                _=None,
            )
        )
        payload = asyncio.run(router.class_progress(record["id"], _=None))
    assert len(payload["rows"]) == 1
    row = payload["rows"][0]
    assert row["username"] == "student1"
    assert len(row["topics"]) == 1
    topic = row["topics"][0]
    assert topic["kp_total"] == 1 and topic["kp_mastered"] == 0
    assert topic["sessions"] == 0 and topic["reviews_due"] == 0
    assert isinstance(row["practice_totals"], dict)
    with as_user(other["id"], role="teacher"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(router.class_progress(record["id"], _=None))
        assert exc.value.status_code == 403
