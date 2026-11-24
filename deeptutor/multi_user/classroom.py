"""Classroom relationships: teacher-owned classes with invited student members.

Mirrors the guardian relationship store (``guardians.py``): a single JSON
registry under ``data/system``, a thread write lock, deepcopy-on-read records,
and explicit revocation semantics. A class binds one content workspace (owned
by the teacher) to a member list; membership is the only cross-account read
grant the workspace scope seam honours.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import threading
from typing import Any, Iterator
from uuid import uuid4

from . import paths
from .audit import log_admin_action

_WRITE_LOCK = threading.Lock()


def _records_path():
    return paths.SYSTEM_ROOT / "classrooms.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_records() -> list[dict[str, Any]]:
    path = _records_path()
    if not path.exists():
        return []
    import json

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def _write_records(records: list[dict[str, Any]]) -> None:
    from deeptutor.services.file_io import atomic_write_json

    path = _records_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, records)


def _active(record: dict[str, Any]) -> bool:
    return not record.get("archived_at")


def create_class(teacher_id: str, name: str, workspace_id: str) -> dict[str, Any]:
    name = str(name or "").strip()
    if not name or len(name) > 100:
        raise ValueError("A class name must contain 1 to 100 characters.")
    with _WRITE_LOCK:
        records = _load_records()
        if any(r["workspace_id"] == workspace_id for r in records):
            raise ValueError("This workspace already belongs to a class.")
        record = {
            "id": f"cl_{uuid4().hex}",
            "name": name,
            "teacher_id": teacher_id,
            "workspace_id": workspace_id,
            "members": [],
            "created_at": _utc_now(),
            "archived_at": None,
        }
        records.append(record)
        _write_records(records)
    log_admin_action("classroom.create", summary={"class_id": record["id"], "name": name})
    return deepcopy(record)


def class_by_id(class_id: str) -> dict[str, Any] | None:
    for record in _load_records():
        if record["id"] == class_id:
            return deepcopy(record)
    return None


def class_for_workspace(workspace_id: str) -> dict[str, Any] | None:
    if not workspace_id:
        return None
    for record in _load_records():
        if record["workspace_id"] == workspace_id:
            return deepcopy(record)
    return None


def list_classes(
    *,
    teacher_id: str | None = None,
    member_id: str | None = None,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    out = []
    for record in _load_records():
        if not include_archived and not _active(record):
            continue
        if teacher_id is not None and record["teacher_id"] != teacher_id:
            continue
        if member_id is not None and not any(
            m["user_id"] == member_id for m in record["members"]
        ):
            continue
        out.append(deepcopy(record))
    return out


def member_classes(user_id: str) -> list[dict[str, Any]]:
    return list_classes(member_id=user_id)


def is_member(class_id: str, user_id: str) -> bool:
    record = class_by_id(class_id)
    return bool(record) and any(m["user_id"] == user_id for m in record["members"])


def update_class(
    class_id: str,
    actor_id: str,
    *,
    name: str | None = None,
    archived: bool | None = None,
) -> dict[str, Any]:
    with _WRITE_LOCK:
        records = _load_records()
        record = next((r for r in records if r["id"] == class_id), None)
        if record is None:
            raise ValueError("Unknown class.")
        if record["teacher_id"] != actor_id:
            raise ValueError("Only the class teacher can update the class.")
        if name is not None:
            name = str(name).strip()
            if not name or len(name) > 100:
                raise ValueError("A class name must contain 1 to 100 characters.")
            record["name"] = name
        if archived is not None:
            record["archived_at"] = _utc_now() if archived else None
        _write_records(records)
    log_admin_action("classroom.update", summary={"class_id": class_id})
    return deepcopy(record)


def invite_member(class_id: str, user_id: str, invited_by: str) -> dict[str, Any]:
    with _WRITE_LOCK:
        records = _load_records()
        record = next((r for r in records if r["id"] == class_id), None)
        if record is None:
            raise ValueError("Unknown class.")
        if record["teacher_id"] != invited_by:
            raise ValueError("Only the class teacher can invite members.")
        if not _active(record):
            raise ValueError("This class is archived.")
        if user_id == record["teacher_id"]:
            raise ValueError("The teacher is already part of the class.")
        if any(m["user_id"] == user_id for m in record["members"]):
            raise ValueError("This user is already a member of the class.")
        record["members"].append(
            {"user_id": user_id, "joined_at": _utc_now(), "invited_by": invited_by}
        )
        _write_records(records)
    log_admin_action("classroom.invite", target_user_id=user_id, summary={"class_id": class_id})
    return deepcopy(record)


def remove_member(class_id: str, user_id: str, actor_id: str) -> dict[str, Any]:
    with _WRITE_LOCK:
        records = _load_records()
        record = next((r for r in records if r["id"] == class_id), None)
        if record is None:
            raise ValueError("Unknown class.")
        if actor_id not in (record["teacher_id"], user_id):
            raise ValueError("Only the class teacher or the member themselves can remove a membership.")
        before = len(record["members"])
        record["members"] = [m for m in record["members"] if m["user_id"] != user_id]
        if len(record["members"]) == before:
            raise ValueError("This user is not a member of the class.")
        _write_records(records)
    log_admin_action("classroom.remove", target_user_id=user_id, summary={"class_id": class_id})
    return deepcopy(record)


def teacher_can_access_student(teacher_id: str, student_id: str) -> bool:
    """True when the student belongs to an active class owned by the teacher."""
    if teacher_id == student_id:
        return False
    return any(
        record["teacher_id"] == teacher_id
        and any(m["user_id"] == student_id for m in record["members"])
        for record in list_classes(teacher_id=teacher_id)
    )


def _assignments_path():
    return paths.SYSTEM_ROOT / "classroom_assignments.json"


def _load_assignments() -> list[dict[str, Any]]:
    import json

    path = _assignments_path()
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def _write_assignments(records: list[dict[str, Any]]) -> None:
    from deeptutor.services.file_io import atomic_write_json

    path = _assignments_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, records)


def create_assignment(
    class_id: str,
    teacher_id: str,
    student_id: str,
    kind: str,
    source_id: str,
    target_workspace_id: str,
    target_id: str,
) -> dict[str, Any]:
    with _WRITE_LOCK:
        records = _load_assignments()
        record = {
            "id": f"as_{uuid4().hex}",
            "class_id": class_id,
            "teacher_id": teacher_id,
            "student_id": student_id,
            "kind": kind,
            "source_id": source_id,
            "target_workspace_id": target_workspace_id,
            "target_id": target_id,
            "created_at": _utc_now(),
            "created_by": teacher_id,
            "revoked_at": None,
        }
        records.append(record)
        _write_assignments(records)
    log_admin_action(
        "classroom.assign", target_user_id=student_id, summary={"class_id": class_id, "kind": kind}
    )
    return deepcopy(record)


def list_assignments(
    *,
    class_id: str | None = None,
    student_id: str | None = None,
    teacher_id: str | None = None,
    kind: str | None = None,
    include_revoked: bool = False,
) -> list[dict[str, Any]]:
    out = []
    for record in _load_assignments():
        if not include_revoked and record.get("revoked_at"):
            continue
        if class_id is not None and record["class_id"] != class_id:
            continue
        if student_id is not None and record["student_id"] != student_id:
            continue
        if teacher_id is not None and record["teacher_id"] != teacher_id:
            continue
        if kind is not None and record["kind"] != kind:
            continue
        out.append(deepcopy(record))
    return out


def assignment_by_id(assignment_id: str) -> dict[str, Any] | None:
    for record in _load_assignments():
        if record["id"] == assignment_id:
            return deepcopy(record)
    return None


def revoke_assignment(assignment_id: str, actor_id: str) -> dict[str, Any]:
    with _WRITE_LOCK:
        records = _load_assignments()
        record = next((r for r in records if r["id"] == assignment_id), None)
        if record is None:
            raise ValueError("Unknown assignment.")
        if record["teacher_id"] != actor_id:
            raise ValueError("Only the assigning teacher can revoke an assignment.")
        record["revoked_at"] = _utc_now()
        _write_assignments(records)
    log_admin_action("classroom.revoke", summary={"assignment_id": assignment_id})
    return deepcopy(record)


def live_assignment_for(
    teacher_id: str, student_id: str, kind: str, target_id: str
) -> dict[str, Any] | None:
    """Teacher reach into a student copy requires membership AND a live assignment."""
    if not teacher_can_access_student(teacher_id, student_id):
        return None
    for record in list_assignments(teacher_id=teacher_id, student_id=student_id, kind=kind):
        if record["target_id"] == target_id:
            return record
    return None


def store_role(user_id: str) -> str | None:
    """Current store role (JWT roles are login-time snapshots)."""
    from .identity import get_user_by_id

    info = get_user_by_id(user_id)
    return info[1].get("role") if info else None


def is_class_teacher(user_id: str, class_id: str) -> bool:
    record = class_by_id(class_id)
    return bool(record) and record["teacher_id"] == user_id and store_role(user_id) in {
        "teacher",
        "admin",
    }


def student_pool() -> list[dict[str, Any]]:
    """Non-admin accounts a teacher may invite or roster into a class."""
    from deeptutor.services.auth import list_users

    return [
        {
            "id": item.get("id"),
            "username": item.get("username"),
            "role": item.get("role"),
            "created_at": item.get("created_at", ""),
        }
        for item in list_users()
        if item.get("role") != "admin"
    ]


def shared_workspace_rows() -> list[dict[str, Any]]:
    """Read-only picker rows for the caller's member classes.

    Never exposes the teacher's filesystem path; account-level data stays the
    member's own because the scope seam keeps their account context.
    """
    from deeptutor.services.auth import AUTH_ENABLED
    from deeptutor.services.workspace.models import WorkspaceError

    from .context import get_current_user

    if not AUTH_ENABLED:
        return []
    user = get_current_user()
    rows: list[dict[str, Any]] = []
    for record in member_classes(user.id):
        try:
            with teacher_account_context(record):
                from deeptutor.services.workspace import get_content_workspace_service

                service = get_content_workspace_service()
                binding = service.binding_by_id(record["workspace_id"])
                status = service.validate(str(binding.root))
                owner_username = get_current_user().username
            rows.append(
                {
                    "workspace_id": record["workspace_id"],
                    "display_name": record["name"],
                    "path": "",
                    "kind": "workspace",
                    "follows_root": False,
                    "archived": False,
                    "created_at": record["created_at"],
                    "status": status["status"],
                    "error": status.get("error", ""),
                    "instructions": "",
                    "resources": {"skills": None, "mcp": None, "knowledge_bases": None},
                    "shared": True,
                    "read_only": True,
                    "class_id": record["id"],
                    "owner_username": owner_username,
                }
            )
        except (WorkspaceError, ValueError):
            continue
    return rows


@contextmanager
def teacher_account_context(record: dict[str, Any]) -> Iterator[None]:
    """Enter the class teacher's account scope without touching the request identity.

    Used by the workspace seam to resolve/validate the class workspace against
    the teacher's catalog while the requesting student keeps their own account
    for settings, memory and audit.
    """
    from .identity import get_user_by_id
    from .models import CurrentUser
    from .paths import scope_for_user, user_context

    info = get_user_by_id(record["teacher_id"])
    if info is None:
        raise ValueError("The class teacher account no longer exists.")
    username, user_record = info[0], info[1]
    teacher = CurrentUser(
        id=record["teacher_id"],
        username=username,
        role=user_record.get("role", "teacher"),
        scope=scope_for_user(
            record["teacher_id"], is_admin=user_record.get("role") == "admin"
        ),
    )
    with user_context(teacher):
        yield
