"""Classroom workspace-scope seam: member read-only cross-account resolution."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import classroom
from deeptutor.multi_user.paths import get_account_path_service, scope_for_user
from deeptutor.services.workspace.context import (
    get_workspace_scope,
    resolve_workspace_scope,
    scoped_path_service,
    workspace_context,
)
from deeptutor.services.workspace.models import WorkspaceError


@pytest.fixture
def class_workspace(mu_isolated_root, seed_user, as_user):
    seed_user("root", role="admin")  # bootstrap admin so teacher1 keeps its role
    teacher = seed_user("teacher1", role="teacher")
    student = seed_user("student1", role="student")
    outsider = seed_user("outsider1", role="student")
    with as_user(teacher["id"], role="teacher"):
        from deeptutor.services.workspace import get_content_workspace_service

        row = get_content_workspace_service().create_workspace("Math P3")
    record = classroom.create_class(teacher["id"], "Math P3", row["workspace_id"])
    classroom.invite_member(record["id"], student["id"], teacher["id"])
    return teacher, student, outsider, row["workspace_id"], record


def test_member_scope_resolves_into_teacher_content_root(class_workspace, as_user):
    teacher, student, _, ws_id, record = class_workspace
    with as_user(student["id"], role="student"):
        scope = resolve_workspace_scope(ws_id)
        assert scope.class_member is True
        assert scope.class_id == record["id"]
        assert scope.account_root == scope_for_user(teacher["id"], is_admin=False).root
        account = get_account_path_service()
        with workspace_context(ws_id):
            paths = scoped_path_service(account)
            assert str(paths.get_chat_history_db()).startswith(str(scope.content_root))
            # Account-level data stays the student's own.
            assert paths.get_settings_dir() == account.get_settings_dir()
            assert paths.get_memory_dir() == account.get_memory_dir()


def test_non_member_and_revoked_member_denied(class_workspace, as_user):
    _, student, outsider, ws_id, record = class_workspace
    with as_user(outsider["id"], role="student"):
        with pytest.raises(WorkspaceError):
            resolve_workspace_scope(ws_id)
    classroom.remove_member(record["id"], student["id"], record["teacher_id"])
    with as_user(student["id"], role="student"):
        with pytest.raises(WorkspaceError):
            resolve_workspace_scope(ws_id)


def test_member_writes_and_ws_denied_owner_writes_allowed(class_workspace, as_user, monkeypatch):
    from deeptutor.api.routers.auth import _install_request_workspace

    teacher, student, _, ws_id, _ = class_workspace

    def request(method: str, path: str):
        return SimpleNamespace(
            headers={},
            query_params={"dt_workspace": ws_id},
            url=SimpleNamespace(path=path),
            method=method,
            state=SimpleNamespace(workspace_activity=None),
        )

    with as_user(student["id"], role="student"):
        with pytest.raises(HTTPException) as exc:
            _install_request_workspace(request("POST", "/api/sessions"))
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException):
            _install_request_workspace(request("GET", "/ws/mastery-paths"))
        _install_request_workspace(request("GET", "/api/sessions"))
        assert get_workspace_scope().class_member is True

    with as_user(teacher["id"], role="teacher"):
        _install_request_workspace(request("POST", "/api/sessions"))
        assert get_workspace_scope().class_member is False


def test_picker_union_rows_hide_teacher_path(class_workspace, as_user, monkeypatch):
    teacher, student, _, ws_id, record = class_workspace
    monkeypatch.setattr("deeptutor.services.auth.AUTH_ENABLED", True)
    with as_user(student["id"], role="student"):
        rows = classroom.shared_workspace_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row["workspace_id"] == ws_id
        assert row["shared"] is True and row["read_only"] is True
        assert row["path"] == ""
        assert row["owner_username"] == "teacher1"
        assert row["display_name"] == "Math P3"
