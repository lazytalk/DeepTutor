"""Classroom console API: teacher-owned classes, rosters, and invites.

Fork module (``modules/manifests/classroom.json``). Mounted ``authenticated``;
every handler self-guards and re-reads store roles because JWT roles are
login-time snapshots (the ``guardian_can_access`` precedent). P1 surface:
class CRUD, membership, student pool, teacher-created accounts, member view.
Assignments and cross-account activity management arrive in P2.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from deeptutor.api.routers.auth import require_auth, require_teacher
from deeptutor.multi_user import classroom
from deeptutor.multi_user.context import get_current_user
from deeptutor.services.auth import AUTH_ENABLED, POCKETBASE_ENABLED

router = APIRouter()


def _require_mode() -> None:
    if not AUTH_ENABLED or POCKETBASE_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Classroom requires the built-in identity store with auth enabled.",
        )


def _actor_role() -> str:
    user = get_current_user()
    return classroom.store_role(user.id) or user.role


def _require_owner(class_id: str) -> dict:
    user = get_current_user()
    record = classroom.class_by_id(class_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown class.")
    if not classroom.is_class_teacher(user.id, class_id):
        raise HTTPException(status_code=403, detail="Only the class teacher can manage this class.")
    return record


class CreateClassRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UpdateClassRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    archived: bool | None = None


class InviteRequest(BaseModel):
    user_id: str


class CreateStudentRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)


def _public_class(record: dict) -> dict:
    return {
        "id": record["id"],
        "name": record["name"],
        "teacher_id": record["teacher_id"],
        "workspace_id": record["workspace_id"],
        "member_count": len(record["members"]),
        "created_at": record["created_at"],
        "archived": bool(record["archived_at"]),
    }


@router.get("/classes")
async def list_classes(_: object = Depends(require_auth)) -> dict:
    _require_mode()
    user = get_current_user()
    role = _actor_role()
    if role == "admin":
        records = classroom.list_classes(include_archived=True)
    elif role == "teacher":
        records = classroom.list_classes(teacher_id=user.id, include_archived=True)
    else:
        records = classroom.member_classes(user.id)
    return {"classes": [_public_class(r) for r in records]}


@router.post("/classes", status_code=status.HTTP_201_CREATED)
async def create_class(
    body: CreateClassRequest,
    _: object = Depends(require_teacher),
) -> dict:
    _require_mode()
    from deeptutor.services.workspace import get_content_workspace_service
    from deeptutor.services.workspace.models import WorkspaceError

    user = get_current_user()
    try:
        row = get_content_workspace_service().create_workspace(body.name)
    except WorkspaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        record = classroom.create_class(user.id, body.name, row["workspace_id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"class": _public_class(record), "workspace": row}


@router.patch("/classes/{class_id}")
async def update_class(
    class_id: str,
    body: UpdateClassRequest,
    _: object = Depends(require_auth),
) -> dict:
    _require_mode()
    record = _require_owner(class_id)
    try:
        updated = classroom.update_class(
            class_id,
            get_current_user().id,
            name=body.name,
            archived=body.archived,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.archived is not None:
        from deeptutor.services.workspace import get_content_workspace_service
        from deeptutor.services.workspace.models import WorkspaceError

        try:
            get_content_workspace_service().update_workspace(
                record["workspace_id"], archived=body.archived
            )
        except WorkspaceError:
            pass
    return {"class": _public_class(updated)}


@router.get("/classes/{class_id}/members")
async def list_members(class_id: str, _: object = Depends(require_auth)) -> dict:
    _require_mode()
    from deeptutor.multi_user.identity import get_user_by_id

    user = get_current_user()
    record = classroom.class_by_id(class_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown class.")
    if not (
        classroom.is_class_teacher(user.id, class_id)
        or classroom.is_member(class_id, user.id)
    ):
        raise HTTPException(status_code=403, detail="Not a member of this class.")
    members = []
    for entry in record["members"]:
        info = get_user_by_id(entry["user_id"])
        members.append(
            {
                "user_id": entry["user_id"],
                "username": info[0] if info else "",
                "role": info[1].get("role") if info else "",
                "joined_at": entry["joined_at"],
            }
        )
    return {"members": members, "teacher_id": record["teacher_id"]}


@router.post("/classes/{class_id}/members", status_code=status.HTTP_201_CREATED)
async def invite_member(
    class_id: str,
    body: InviteRequest,
    _: object = Depends(require_auth),
) -> dict:
    _require_mode()
    from deeptutor.multi_user.identity import get_user_by_id

    _require_owner(class_id)
    info = get_user_by_id(body.user_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Unknown user.")
    if info[1].get("role") == "admin" or info[1].get("disabled"):
        raise HTTPException(status_code=400, detail="This account cannot be invited to a class.")
    try:
        record = classroom.invite_member(class_id, body.user_id, get_current_user().id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"class": _public_class(record)}


@router.delete("/classes/{class_id}/members/{user_id}")
async def remove_member(
    class_id: str,
    user_id: str,
    _: object = Depends(require_auth),
) -> dict:
    _require_mode()
    record = classroom.class_by_id(class_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown class.")
    actor = get_current_user().id
    if not (classroom.is_class_teacher(actor, class_id) or actor == user_id):
        raise HTTPException(status_code=403, detail="Only the class teacher or the member themselves can remove a membership.")
    try:
        updated = classroom.remove_member(class_id, user_id, actor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"class": _public_class(updated)}


@router.get("/student-pool")
async def student_pool(_: object = Depends(require_teacher)) -> dict:
    _require_mode()
    return {"students": classroom.student_pool()}


@router.post("/classes/{class_id}/students", status_code=status.HTTP_201_CREATED)
async def create_student(
    class_id: str,
    body: CreateStudentRequest,
    _: object = Depends(require_auth),
) -> dict:
    _require_mode()
    from deeptutor.multi_user.identity import get_user_by_id, set_must_change_password
    from deeptutor.services.auth import add_user, list_users

    _require_owner(class_id)
    if any(u.get("username") == body.username for u in list_users()):
        raise HTTPException(status_code=409, detail="Username already taken")
    add_user(body.username, body.password, role="student")
    set_must_change_password(body.username, True)
    info = get_user_by_id(
        next(u["id"] for u in list_users() if u.get("username") == body.username)
    )
    user_id = info[1]["id"] if info else ""
    try:
        record = classroom.invite_member(class_id, user_id, get_current_user().id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user_id": user_id, "username": body.username, "class": _public_class(record)}


@router.get("/my-classes")
async def my_classes(_: object = Depends(require_auth)) -> dict:
    _require_mode()
    user = get_current_user()
    return {"classes": [_public_class(r) for r in classroom.member_classes(user.id)]}
