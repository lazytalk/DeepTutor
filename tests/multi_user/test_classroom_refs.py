"""1:N class workspaces, per-book read policy, and assignment auto-grant."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import classroom


@pytest.fixture(autouse=True)
def _auth_on(monkeypatch):
    from deeptutor.api.routers import classroom as router

    monkeypatch.setattr(router, "AUTH_ENABLED", True)
    monkeypatch.setattr("deeptutor.services.auth.AUTH_ENABLED", True)


@pytest.fixture
def ref_fixtures(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    other = seed_user("teacher2", role="teacher")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        service = get_content_workspace_service()
        primary = service.create_workspace("Math P3")["workspace_id"]
        extra = service.create_workspace("Reference library")["workspace_id"]
    record = classroom.create_class(teacher["id"], "Math P3", primary)
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    return teacher, student, other, record, extra


def test_reference_and_member_scope(ref_fixtures, as_user):
    from deeptutor.services.workspace.context import resolve_workspace_scope

    teacher, student, other, record, extra = ref_fixtures
    from deeptutor.api.routers import classroom as router

    with as_user(other["id"], role="teacher"):
        with pytest.raises(HTTPException):
            asyncio.run(
                router.reference_workspace(
                    record["id"],
                    router.ReferenceWorkspaceRequest(workspace_id=extra),
                    _=None,
                )
            )
    with as_user(teacher["id"], role="teacher"):
        classroom.add_reference_workspace(record["id"], extra, teacher["id"])
    with as_user(student["id"], role="student"):
        scope = resolve_workspace_scope(extra)
        assert scope.class_member is True and scope.class_id == record["id"]
        rows = classroom.shared_workspace_rows()
        assert {r["workspace_id"] for r in rows} == {record["workspace_id"], extra}
    with as_user(teacher["id"], role="teacher"):
        with pytest.raises(ValueError):
            classroom.remove_reference_workspace(record["id"], record["workspace_id"], teacher["id"])
        classroom.remove_reference_workspace(record["id"], extra, teacher["id"])
    with as_user(student["id"], role="student"):
        from deeptutor.services.workspace.models import WorkspaceError

        with pytest.raises(WorkspaceError):
            resolve_workspace_scope(extra)


def test_book_policy_precedence_and_auto_grant(ref_fixtures):
    teacher, student, _other, record, _extra = ref_fixtures
    assert classroom.book_visible_for_member(record, "bk_a", student["id"]) is True
    classroom.set_book_policy(record["id"], teacher["id"], default="hidden")
    record = classroom.class_by_id(record["id"])
    assert classroom.book_visible_for_member(record, "bk_a", student["id"]) is False
    classroom.create_assignment(
        record["id"], teacher["id"], student["id"], "mastery_topic",
        "topic_src", "", "topic_copy", ["bk_a"],
    )
    record = classroom.class_by_id(record["id"])
    assert classroom.book_visible_for_member(record, "bk_a", student["id"]) is True
    assert classroom.book_visible_for_member(record, "bk_b", student["id"]) is False
    classroom.set_book_policy(record["id"], teacher["id"], books={"bk_a": "hidden"})
    record = classroom.class_by_id(record["id"])
    assert classroom.book_visible_for_member(record, "bk_a", student["id"]) is False


def test_book_gate_under_member_scope(ref_fixtures, as_user):
    from deeptutor.api.routers.book import _class_member_book_gate
    from deeptutor.services.workspace.context import install_workspace_scope

    teacher, student, _other, record, _extra = ref_fixtures
    classroom.set_book_policy(record["id"], teacher["id"], books={"bk_hidden": "hidden"})
    with as_user(student["id"], role="student"):
        install_workspace_scope(record["workspace_id"])
        assert _class_member_book_gate("bk_open", skip=True) is True
        assert _class_member_book_gate("bk_hidden", skip=True) is False
        with pytest.raises(HTTPException) as exc:
            _class_member_book_gate("bk_hidden")
        assert exc.value.status_code == 404


def test_assignment_from_referenced_workspace(ref_fixtures, as_user):
    from deeptutor.api.routers import classroom as router
    from deeptutor.learning.models import TopicMetadata, TopicSource, TopicSourceKind
    from deeptutor.learning.service import LearningService
    from deeptutor.services.workspace.context import workspace_context

    teacher, student, _other, record, extra = ref_fixtures
    classroom.add_reference_workspace(record["id"], extra, teacher["id"])
    with classroom.teacher_account_context(record):
        with workspace_context(extra):
            LearningService().create_topic(
                "topic_ref",
                name="From reference",
                modules=[],
                metadata=TopicMetadata(path_id="topic_ref", goal="g"),
                sources=[
                    TopicSource(
                        id="s1", kind=TopicSourceKind.BOOK, source_id="bk_source", label="Book"
                    )
                ],
            )
    with as_user(teacher["id"], role="teacher"):
        result = asyncio.run(
            router.create_assignments(
                record["id"],
                router.AssignRequest(
                    kind="mastery_topic", source_id="topic_ref", source_workspace_id=extra
                ),
                _=None,
            )
        )
    assert result["results"][0]["ok"], result
    assignment = classroom.list_assignments(class_id=record["id"])[0]
    assert assignment["source_book_ids"] == ["bk_source"]
