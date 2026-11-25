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
from deeptutor.services.workspace.context import workspace_context

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


# --- P2: assign-by-copy and teacher reach into assigned copies ---


class AssignRequest(BaseModel):
    kind: str = Field(pattern="^(mastery_topic|question_set)$")
    source_id: str
    student_ids: list[str] | None = None
    target_workspace_id: str = ""
    source_workspace_id: str = ""


class ReferenceWorkspaceRequest(BaseModel):
    workspace_id: str


class BookAccessRequest(BaseModel):
    default: str | None = None
    books: dict[str, str] | None = None


class RenameTopicRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PatchEntryRequest(BaseModel):
    question: str | None = None
    answer: str | None = None
    explanation: str | None = None


def _class_or_404(class_id: str) -> dict:
    record = classroom.class_by_id(class_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown class.")
    return record


@router.post("/classes/{class_id}/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignments(
    class_id: str,
    body: AssignRequest,
    _: object = Depends(require_teacher),
) -> dict:
    _require_mode()
    from deeptutor.services.classroom import assignments as delivery

    record = _require_owner(class_id)
    members = [m["user_id"] for m in record["members"]]
    targets = body.student_ids if body.student_ids is not None else members
    unknown = [uid for uid in targets if uid not in members]
    if unknown:
        raise HTTPException(status_code=400, detail="Every target must be a class member.")
    source_workspace = body.source_workspace_id or record["workspace_id"]
    if source_workspace not in classroom.class_workspaces(record):
        raise HTTPException(status_code=400, detail="Source workspace is not part of this class.")
    source_book_ids: list[str] = []
    if body.kind == "mastery_topic":
        from deeptutor.learning.storage import LearningStore

        with classroom.teacher_account_context(record):
            with workspace_context(source_workspace):
                source_topic = LearningStore().get_topic(body.source_id)
                source_book_ids = [
                    s.source_id
                    for s in (source_topic.sources if source_topic else [])
                    if getattr(s.kind, "value", str(s.kind)) == "book" and s.source_id
                ]
    results = []
    for student_id in targets:
        try:
            if body.kind == "mastery_topic":
                target_id = await delivery.copy_mastery_topic(
                    record,
                    body.source_id,
                    student_id,
                    body.target_workspace_id,
                    source_workspace,
                )
            else:
                target_id = str(
                    await delivery.copy_question_set(
                        record,
                        int(body.source_id),
                        student_id,
                        body.target_workspace_id,
                        source_workspace,
                    )
                )
        except (ValueError, TypeError) as exc:
            results.append({"student_id": student_id, "ok": False, "error": str(exc)})
            continue
        assignment = classroom.create_assignment(
            class_id,
            record["teacher_id"],
            student_id,
            body.kind,
            body.source_id,
            body.target_workspace_id,
            target_id,
            source_book_ids,
        )
        results.append({"student_id": student_id, "ok": True, "assignment_id": assignment["id"]})
    return {"results": results}


@router.get("/classes/{class_id}/assignments")
async def list_class_assignments(class_id: str, _: object = Depends(require_teacher)) -> dict:
    _require_mode()
    _require_owner(class_id)
    return {"assignments": classroom.list_assignments(class_id=class_id, include_revoked=True)}


@router.delete("/assignments/{assignment_id}")
async def revoke_assignment(assignment_id: str, _: object = Depends(require_teacher)) -> dict:
    _require_mode()
    try:
        record = classroom.revoke_assignment(assignment_id, get_current_user().id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"assignment": record}


def _live_assignment_or_403(kind: str, student_id: str, target_id: str) -> dict:
    record = classroom.live_assignment_for(get_current_user().id, student_id, kind, target_id)
    if record is None:
        raise HTTPException(status_code=403, detail="No live assignment grants access to this copy.")
    return record


@router.get("/students/{student_id}/topics/{path_id}")
async def view_student_topic(
    student_id: str, path_id: str, _: object = Depends(require_teacher)
) -> dict:
    _require_mode()
    from deeptutor.api.routers.mastery_path import _topic_payload
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context

    record = _live_assignment_or_403("mastery_topic", student_id, path_id)
    with student_context(student_id):
        with workspace_context(record["target_workspace_id"] or None):
            payload = _topic_payload(LearningStore(), path_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="The assigned copy no longer exists.")
    return payload


@router.put("/students/{student_id}/topics/{path_id}")
async def rename_student_topic(
    student_id: str,
    path_id: str,
    body: RenameTopicRequest,
    _: object = Depends(require_teacher),
) -> dict:
    _require_mode()
    from deeptutor.learning.service import LearningService
    from deeptutor.services.classroom.assignments import student_context

    record = _live_assignment_or_403("mastery_topic", student_id, path_id)
    with student_context(student_id):
        with workspace_context(record["target_workspace_id"] or None):
            progress = LearningService().rename_path(path_id, body.name)
    return {"path_id": progress.book_id, "name": progress.name}


@router.get("/students/{student_id}/topics/{path_id}/sessions")
async def list_student_topic_sessions(
    student_id: str, path_id: str, _: object = Depends(require_teacher)
) -> dict:
    _require_mode()
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context

    record = _live_assignment_or_403("mastery_topic", student_id, path_id)
    with student_context(student_id):
        with workspace_context(record["target_workspace_id"] or None):
            session_ids = LearningStore().list_session_ids(path_id)
    return {"session_ids": session_ids}


@router.get("/students/{student_id}/sessions/{session_id}")
async def view_student_session(
    student_id: str, session_id: str, _: object = Depends(require_teacher)
) -> dict:
    """View-only transcript of a session bound to an assigned topic."""
    _require_mode()
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store_for

    actor = get_current_user().id
    allowed = None
    for record in classroom.list_assignments(
        teacher_id=actor, student_id=student_id, kind="mastery_topic"
    ):
        with student_context(student_id):
            with workspace_context(record["target_workspace_id"] or None):
                if session_id in LearningStore().list_session_ids(record["target_id"]):
                    allowed = record
                    break
    if allowed is None:
        raise HTTPException(
            status_code=403, detail="Only sessions bound to assigned topics are visible."
        )
    with student_context(student_id):
        with workspace_context(allowed["target_workspace_id"] or None):
            from deeptutor.multi_user.paths import get_current_path_service

            store = get_sqlite_session_store_for(get_current_path_service())
            payload = await store.get_session_with_messages(session_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Unknown session.")
    return payload


@router.get("/students/{student_id}/question-sets")
async def list_student_question_sets(student_id: str, _: object = Depends(require_teacher)) -> dict:
    _require_mode()
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    records = classroom.list_assignments(
        teacher_id=get_current_user().id, student_id=student_id, kind="question_set"
    )
    if not records:
        raise HTTPException(status_code=403, detail="No live assignment grants access.")
    out = []
    for record in records:
        with student_context(student_id):
            with workspace_context(record["target_workspace_id"] or None):
                store = get_sqlite_session_store()
                categories = await store.list_categories()
                category = next(
                    (c for c in categories if str(c.get("id")) == record["target_id"]), None
                )
                if category is not None:
                    out.append({"assignment_id": record["id"], "category": category})
    return {"question_sets": out}


@router.get("/students/{student_id}/question-sets/{category_id}/entries")
async def list_student_set_entries(
    student_id: str, category_id: int, _: object = Depends(require_teacher)
) -> dict:
    _require_mode()
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    record = _live_assignment_or_403("question_set", student_id, str(category_id))
    with student_context(student_id):
        with workspace_context(record["target_workspace_id"] or None):
            store = get_sqlite_session_store()
            listed = await store.list_notebook_entries(category_id=category_id, limit=500)
    items = listed.get("items", []) if isinstance(listed, dict) else list(listed)
    return {"entries": items, "total": listed.get("total", len(items)) if isinstance(listed, dict) else len(items)}


@router.patch("/students/{student_id}/question-entries/{entry_id}")
async def patch_student_entry(
    student_id: str,
    entry_id: int,
    body: PatchEntryRequest,
    _: object = Depends(require_teacher),
) -> dict:
    """Edit question/answer/explanation of an assigned copy — never progress."""
    _require_mode()
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    actor = get_current_user().id
    allowed = None
    matched = None
    for record in classroom.list_assignments(
        teacher_id=actor, student_id=student_id, kind="question_set"
    ):
        with student_context(student_id):
            with workspace_context(record["target_workspace_id"] or None):
                store = get_sqlite_session_store()
                listed = await store.list_notebook_entries(
                    category_id=int(record["target_id"]), limit=500
                )
                entries = listed.get("items", []) if isinstance(listed, dict) else list(listed)
                matched = next((e for e in entries if e.get("id") == entry_id), None)
                if matched is not None:
                    allowed = record
                    break
    if allowed is None or matched is None:
        raise HTTPException(status_code=403, detail="No live assignment covers this entry.")
    # Question content is immutable via update_notebook_entry (learner-state
    # only); content edits re-upsert under the same origin identity.
    item = {
        "question": body.question if body.question is not None else matched.get("question", ""),
        "question_id": matched.get("question_id", ""),
        "correct_answer": body.answer if body.answer is not None else matched.get("correct_answer", ""),
        "explanation": body.explanation if body.explanation is not None else matched.get("explanation", ""),
        "origin_type": matched.get("origin_type", "external_import"),
        "origin_ref": matched.get("origin_ref", ""),
        "turn_id": matched.get("turn_id", ""),
        "is_correct": bool(matched.get("is_correct")),
    }
    with student_context(student_id):
        with workspace_context(allowed["target_workspace_id"] or None):
            store = get_sqlite_session_store()
            count = await store.upsert_notebook_entries(None, [item])
    if not count:
        raise HTTPException(status_code=404, detail="Unknown entry.")
    return {"ok": True}


@router.get("/my-assignments")
async def my_assignments(_: object = Depends(require_auth)) -> dict:
    _require_mode()
    user = get_current_user()
    return {"assignments": classroom.list_assignments(student_id=user.id)}


@router.get("/classes/{class_id}/progress")
async def class_progress(class_id: str, _: object = Depends(require_teacher)) -> dict:
    """P3: per-student progress over assigned copies (read-only aggregation)."""
    _require_mode()
    from deeptutor.services.classroom.progress import compute_progress_rows

    record = _require_owner(class_id)
    rows = await compute_progress_rows(
        teacher_id=record["teacher_id"],
        student_ids=[member["user_id"] for member in record["members"]],
    )
    return {"rows": rows}


@router.get("/dashboard")
async def teacher_dashboard(_: object = Depends(require_teacher)) -> dict:
    """Cross-class teacher dashboard (read-only).

    Iterates the requesting teacher's non-archived classes and reuses the
    per-class aggregation helper, so a dashboard row always matches the
    corresponding class progress panel. An actor without owned classes (for
    example another teacher) simply receives an empty aggregate.
    """
    _require_mode()
    from deeptutor.services.classroom.progress import compute_progress_rows

    user = get_current_user()
    records = classroom.list_classes(teacher_id=user.id)
    class_ids = {record["id"] for record in records}
    assignments = [
        assignment
        for assignment in classroom.list_assignments(teacher_id=user.id)
        if assignment["class_id"] in class_ids
    ]

    classes: list[dict] = []
    student_ids: set[str] = set()
    reviews_due = 0
    sessions = 0
    for record in records:
        rows = await compute_progress_rows(
            teacher_id=record["teacher_id"],
            student_ids=[member["user_id"] for member in record["members"]],
        )
        for row in rows:
            student_ids.add(row["student_id"])
            for topic in row["topics"]:
                reviews_due += topic["reviews_due"]
                sessions += topic["sessions"]
        classes.append(
            {
                "class_id": record["id"],
                "class_name": record["name"],
                "workspace_id": record["workspace_id"],
                "member_count": len(record["members"]),
                "assignments": sum(
                    1 for assignment in assignments if assignment["class_id"] == record["id"]
                ),
                "reviews_due": sum(
                    topic["reviews_due"] for row in rows for topic in row["topics"]
                ),
                "students": rows,
            }
        )

    return {
        "classes": classes,
        "totals": {
            "classes": len(classes),
            "students": len(student_ids),
            "assignments": len(assignments),
            "reviews_due": reviews_due,
            "sessions": sessions,
        },
    }


@router.get("/classes/{class_id}/workspaces")
async def list_class_workspaces(class_id: str, _: object = Depends(require_auth)) -> dict:
    _require_mode()
    from deeptutor.services.workspace import get_content_workspace_service

    record = _class_or_404(class_id)
    user = get_current_user()
    if not (classroom.is_class_teacher(user.id, class_id) or classroom.is_member(class_id, user.id)):
        raise HTTPException(status_code=403, detail="Not a member of this class.")
    out = []
    with classroom.teacher_account_context(record):
        service = get_content_workspace_service()
        for ws_id in classroom.class_workspaces(record):
            try:
                binding = service.binding_by_id(ws_id)
            except Exception:
                continue
            out.append(
                {
                    "workspace_id": ws_id,
                    "display_name": binding.display_name,
                    "primary": ws_id == record["workspace_id"],
                }
            )
    return {"workspaces": out}


@router.post("/classes/{class_id}/workspaces", status_code=status.HTTP_201_CREATED)
async def reference_workspace(
    class_id: str,
    body: ReferenceWorkspaceRequest,
    _: object = Depends(require_teacher),
) -> dict:
    _require_mode()
    _require_owner(class_id)
    try:
        record = classroom.add_reference_workspace(class_id, body.workspace_id, get_current_user().id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"class": _public_class(record), "workspace_ids": classroom.class_workspaces(record)}


@router.delete("/classes/{class_id}/workspaces/{workspace_id}")
async def unreference_workspace(
    class_id: str, workspace_id: str, _: object = Depends(require_teacher)
) -> dict:
    _require_mode()
    _require_owner(class_id)
    try:
        record = classroom.remove_reference_workspace(class_id, workspace_id, get_current_user().id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"class": _public_class(record), "workspace_ids": classroom.class_workspaces(record)}


@router.get("/classes/{class_id}/books")
async def list_class_books(class_id: str, _: object = Depends(require_teacher)) -> dict:
    _require_mode()
    from deeptutor.api.routers.book import accessible_books

    record = _require_owner(class_id)
    policy = record.get("book_policy") or {"default": "read", "books": {}}
    out = []
    with classroom.teacher_account_context(record):
        for ws_id in classroom.class_workspaces(record):
            with workspace_context(ws_id):
                for book, _resolved in accessible_books():
                    out.append(
                        {
                            "book_id": book.id,
                            "title": getattr(book, "title", "") or book.id,
                            "workspace_id": ws_id,
                            "access": (policy.get("books") or {}).get(book.id, policy.get("default", "read")),
                        }
                    )
    return {"books": out, "default": policy.get("default", "read")}


@router.put("/classes/{class_id}/book-access")
async def set_book_access(
    class_id: str,
    body: BookAccessRequest,
    _: object = Depends(require_teacher),
) -> dict:
    _require_mode()
    _require_owner(class_id)
    try:
        record = classroom.set_book_policy(
            class_id, get_current_user().id, default=body.default, books=body.books
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"book_policy": record["book_policy"]}


@router.get("/classes/{class_id}/assignment-sources")
async def list_assignment_sources(class_id: str, _: object = Depends(require_teacher)) -> dict:
    _require_mode()
    from deeptutor.learning.storage import LearningStore
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    record = _require_owner(class_id)
    sources = []
    with classroom.teacher_account_context(record):
        for ws_id in classroom.class_workspaces(record):
            with workspace_context(ws_id):
                for progress, topic, _sessions, _interaction in LearningStore().list_topic_snapshots(
                    status="active"
                ):
                    sources.append(
                        {
                            "kind": "mastery_topic",
                            "id": progress.book_id,
                            "name": progress.name or (topic.metadata.goal if topic else progress.book_id),
                            "workspace_id": ws_id,
                        }
                    )
                for category in await get_sqlite_session_store().list_categories():
                    sources.append(
                        {
                            "kind": "question_set",
                            "id": str(category["id"]),
                            "name": category["name"],
                            "workspace_id": ws_id,
                        }
                    )
    return {"sources": sources}
