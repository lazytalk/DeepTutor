"""Cross-class teacher dashboard aggregation over owned classes."""

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
def dashboard_fixtures(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")
    teacher = seed_user("teacher1", role="teacher")
    student_one = seed_user("student1", role="student")
    student_two = seed_user("student2", role="student")
    other = seed_user("teacher2", role="teacher")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        service = get_content_workspace_service()
        math_workspace = service.create_workspace("Math P3")
        science_workspace = service.create_workspace("Science P4")
    math_class = classroom.create_class(teacher["id"], "Math P3", math_workspace["workspace_id"])
    science_class = classroom.create_class(
        teacher["id"], "Science P4", science_workspace["workspace_id"]
    )
    classroom.invite_member(math_class["id"], student_one["id"], teacher["id"])
    classroom.invite_member(science_class["id"], student_two["id"], teacher["id"])
    return teacher, student_one, student_two, other, math_class, science_class


def _seed_topic(record: dict, path_id: str, name: str) -> None:
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
                path_id,
                name=name,
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
                metadata=TopicMetadata(path_id=path_id, goal=f"Learn {name}"),
                sources=[],
            )


def test_dashboard_aggregates_across_classes_and_guards_ownership(dashboard_fixtures, as_user):
    from deeptutor.api.routers import classroom as router

    teacher, student_one, student_two, other, math_class, science_class = dashboard_fixtures
    _seed_topic(math_class, "topic_math", "Cranes")
    _seed_topic(science_class, "topic_science", "Photosynthesis")
    with as_user(teacher["id"], role="teacher"):
        for record, source_id in ((math_class, "topic_math"), (science_class, "topic_science")):
            asyncio.run(
                router.create_assignments(
                    record["id"],
                    router.AssignRequest(kind="mastery_topic", source_id=source_id),
                    _=None,
                )
            )
        payload = asyncio.run(router.teacher_dashboard(_=None))

    assert payload["totals"]["classes"] == 2
    assert payload["totals"]["students"] == 2
    assert payload["totals"]["assignments"] == 2
    assert payload["totals"]["reviews_due"] == 0
    by_class = {entry["class_name"]: entry for entry in payload["classes"]}
    assert set(by_class) == {"Math P3", "Science P4"}
    math_rows = by_class["Math P3"]["students"]
    science_rows = by_class["Science P4"]["students"]
    assert [row["username"] for row in math_rows] == ["student1"]
    assert [row["username"] for row in science_rows] == ["student2"]
    assert math_rows[0]["topics"][0]["name"] == "Cranes"
    assert math_rows[0]["topics"][0]["kp_total"] == 1
    assert science_rows[0]["topics"][0]["name"] == "Photosynthesis"
    assert by_class["Math P3"]["assignments"] == 1

    # Another teacher owns none of these classes: the dashboard stays empty and
    # per-class progress remains forbidden.
    with as_user(other["id"], role="teacher"):
        other_payload = asyncio.run(router.teacher_dashboard(_=None))
        assert other_payload == {
            "classes": [],
            "totals": {
                "classes": 0,
                "students": 0,
                "assignments": 0,
                "reviews_due": 0,
                "sessions": 0,
            },
        }
        with pytest.raises(HTTPException) as exc:
            asyncio.run(router.class_progress(math_class["id"], _=None))
        assert exc.value.status_code == 403