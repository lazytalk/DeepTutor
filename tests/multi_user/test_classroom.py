"""Classroom registry, guards, and P1 router surface (fork feature)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import classroom


@pytest.fixture
def class_fixtures(mu_isolated_root, seed_user):
    seed_user("root", role="admin")  # bootstrap admin so teacher1 keeps its role
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    other = seed_user("teacher2", role="teacher")
    return teacher, student, other


def test_registry_roundtrip_and_dedupe(class_fixtures):
    teacher, student, _ = class_fixtures
    record = classroom.create_class(teacher["id"], "Math P3", "ws_a")
    assert record["id"].startswith("cl_")
    assert classroom.class_for_workspace("ws_a")["id"] == record["id"]
    with pytest.raises(ValueError):
        classroom.create_class(teacher["id"], "Dup", "ws_a")
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    with pytest.raises(ValueError):
        classroom.invite_member(record["id"], student["id"], teacher["id"])
    with pytest.raises(ValueError):
        classroom.invite_member(record["id"], teacher["id"], teacher["id"])
    assert classroom.is_member(record["id"], student["id"])
    assert classroom.teacher_can_access_student(teacher["id"], student["id"])
    assert not classroom.teacher_can_access_student(teacher["id"], "u_nobody")


def test_membership_removal_and_archive(class_fixtures):
    teacher, student, other = class_fixtures
    record = classroom.create_class(teacher["id"], "Math P3", "ws_a")
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    with pytest.raises(ValueError):
        classroom.remove_member(record["id"], student["id"], other["id"])
    classroom.remove_member(record["id"], student["id"], student["id"])
    assert not classroom.is_member(record["id"], student["id"])
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    classroom.update_class(record["id"], teacher["id"], archived=True)
    assert classroom.member_classes(student["id"]) == []
    assert not classroom.teacher_can_access_student(teacher["id"], student["id"])


def test_guards_reread_store_role(class_fixtures, monkeypatch):
    from deeptutor.multi_user.identity import set_role

    teacher, student, _ = class_fixtures
    record = classroom.create_class(teacher["id"], "Math P3", "ws_a")
    assert classroom.is_class_teacher(teacher["id"], record["id"])
    set_role("teacher1", "user")
    assert not classroom.is_class_teacher(teacher["id"], record["id"])


def test_require_teacher_matrix(class_fixtures, monkeypatch):
    from deeptutor.api.routers import auth as auth_router
    from deeptutor.multi_user.identity import set_role

    monkeypatch.setattr(auth_router, "AUTH_ENABLED", True)
    teacher, student, _ = class_fixtures
    # The first seeded user is auto-promoted to admin; restore the teacher role.
    from deeptutor.multi_user.identity import set_role

    set_role("teacher1", "teacher")
    payload = SimpleNamespace(role="teacher", user_id=teacher["id"])
    assert asyncio.run(auth_router.require_teacher(payload)) is payload
    admin = SimpleNamespace(role="admin", user_id="u_admin")
    assert asyncio.run(auth_router.require_teacher(admin)) is admin
    set_role("teacher1", "user")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth_router.require_teacher(payload))
    assert exc.value.status_code == 403
    student_payload = SimpleNamespace(role="student", user_id=student["id"])
    with pytest.raises(HTTPException):
        asyncio.run(auth_router.require_teacher(student_payload))


def test_router_p1_surface(class_fixtures, mu_isolated_root, monkeypatch, as_user):
    from deeptutor.api.routers import classroom as router

    monkeypatch.setattr(router, "AUTH_ENABLED", True)
    teacher, student, other = class_fixtures

    with as_user(teacher["id"], role="teacher"):
        created = asyncio.run(router.create_class(router.CreateClassRequest(name="Math P3"), _=None))
    class_id = created["class"]["id"]
    ws_id = created["workspace"]["workspace_id"]
    assert classroom.class_for_workspace(ws_id)["id"] == class_id

    with as_user(other["id"], role="teacher"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(router.invite_member(class_id, router.InviteRequest(user_id=student["id"]), _=None))
        assert exc.value.status_code == 403

    with as_user(teacher["id"], role="teacher"):
        asyncio.run(router.invite_member(class_id, router.InviteRequest(user_id=student["id"]), _=None))
        roster = asyncio.run(router.list_members(class_id, _=None))
        assert [m["username"] for m in roster["members"]] == ["student1"]
        made = asyncio.run(
            router.create_student(class_id, router.CreateStudentRequest(username="student2", password="password1234"), _=None)
        )
        pool = asyncio.run(router.student_pool(_=None))
    assert made["username"] == "student2"
    from deeptutor.multi_user.identity import get_user_by_id

    info = get_user_by_id(made["user_id"])
    assert info[1]["role"] == "student"
    assert info[1]["must_change_password"] is True
    assert {s["username"] for s in pool["students"]} >= {"student1", "student2"}

    with as_user(student["id"], role="student"):
        mine = asyncio.run(router.my_classes(_=None))
        assert [c["id"] for c in mine["classes"]] == [class_id]
        roster = asyncio.run(router.list_members(class_id, _=None))
        assert len(roster["members"]) == 2
        with pytest.raises(HTTPException):
            asyncio.run(router.update_class(class_id, router.UpdateClassRequest(name="X"), _=None))

    with as_user(teacher["id"], role="teacher"):
        asyncio.run(router.remove_member(class_id, student["id"], _=None))
    with as_user(student["id"], role="student"):
        assert asyncio.run(router.my_classes(_=None))["classes"] == []
