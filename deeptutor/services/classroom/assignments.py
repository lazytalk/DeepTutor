"""Assign-by-copy: class activities delivered into students' private workspaces.

Source content is read under the teacher's account + class workspace; copies
are created under the student's account + target workspace using the existing
learning/notebook services unchanged. KB/file sources travel as bounded inline
TEXT snapshots so a copied topic never resolves storage in another account.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from copy import deepcopy
from typing import Any, Iterator
from uuid import uuid4

from deeptutor.multi_user import classroom
from deeptutor.multi_user.paths import get_account_path_service, scope_for_user, user_context
from deeptutor.services.workspace.context import workspace_context
from deeptutor.utils.document_extractor import (
    MAX_EXTRACTED_CHARS_PER_DOC,
    extract_text_from_path,
)

SNAPSHOT_BUDGET = 120_000


@contextmanager
def student_context(student_id: str) -> Iterator[None]:
    from deeptutor.multi_user.identity import get_user_by_id
    from deeptutor.multi_user.models import CurrentUser

    info = get_user_by_id(student_id)
    if info is None:
        raise ValueError("Unknown student account.")
    student = CurrentUser(
        id=student_id,
        username=info[0],
        role=info[1].get("role", "student"),
        scope=scope_for_user(student_id, is_admin=False),
    )
    with user_context(student):
        yield


async def _kb_snapshot_text(kb_name: str, filename: str | None) -> str:
    from deeptutor.multi_user.paths import get_current_path_service

    # Class KBs are workspace-scoped; fall back to the account library.
    raw = get_current_path_service().get_knowledge_bases_root() / kb_name / "raw"
    if not raw.is_dir():
        raw = get_account_path_service().get_knowledge_bases_root() / kb_name / "raw"
    if not raw.is_dir():
        return ""
    files = [raw / filename] if filename else sorted(p for p in raw.rglob("*") if p.is_file())
    chunks: list[str] = []
    remaining = SNAPSHOT_BUDGET
    for path in files:
        if remaining <= 0 or not path.is_file():
            continue
        try:
            # In-process on purpose: these are the teacher's own KB documents,
            # read under the teacher's account scope, not untrusted uploads.
            text = await asyncio.to_thread(
                extract_text_from_path,
                path,
                max_chars=min(remaining, MAX_EXTRACTED_CHARS_PER_DOC),
            )
        except Exception:
            continue
        if text:
            chunks.append(text)
            remaining -= len(text)
    return "\n\n".join(chunks)


async def _snapshot_sources(sources: list[Any]) -> list[Any]:
    from deeptutor.learning.models import TopicSource, TopicSourceKind
    from deeptutor.learning.topic_materials import build_topic_materials

    materials = build_topic_materials(sources)
    by_label = {row.name: row for row in materials.materials}
    out: list[Any] = []
    for position, source in enumerate(sources):
        kind = getattr(source.kind, "value", str(source.kind))
        if kind == "goal":
            continue
        row = by_label.get(source.label)
        text = row.full_text if row is not None else ""
        if kind in ("knowledge_base", "file") and not text:
            metadata = source.metadata or {}
            kb_name = str(metadata.get("kb_name") or source.source_id or "")
            filename = source.source_id if kind == "file" else None
            text = await _kb_snapshot_text(kb_name, filename)
        out.append(
            TopicSource(
                id=f"snap_{position}_{uuid4().hex[:8]}",
                kind=TopicSourceKind.TEXT,
                source_id="",
                label=source.label,
                excerpt=text[:200],
                position=position,
                available=bool(text),
                metadata={
                    "text": text,
                    "snapshot_of": kind,
                    "origin_source_id": source.source_id,
                },
            )
        )
    return out


async def copy_mastery_topic(
    record: dict[str, Any],
    source_path_id: str,
    student_id: str,
    target_workspace_id: str = "",
    source_workspace_id: str = "",
) -> str:
    from deeptutor.learning.models import TopicMetadata
    from deeptutor.learning.service import LearningService
    from deeptutor.learning.storage import LearningStore

    with classroom.teacher_account_context(record):
        with workspace_context(source_workspace_id or record["workspace_id"]):
            store = LearningStore()
            progress = store.load(source_path_id)
            if progress is None:
                raise ValueError("Unknown source topic in the class workspace.")
            topic = store.get_topic(source_path_id, progress=progress)
            sources = list(topic.sources) if topic is not None else []
            snapshots = await _snapshot_sources(sources)
            modules = deepcopy(progress.modules)
            metadata = deepcopy(topic.metadata) if topic is not None else TopicMetadata(path_id="")
            source_name = progress.name or metadata.goal or "Assigned topic"

    new_id = f"topic_{uuid4().hex}"
    with student_context(student_id):
        with workspace_context(target_workspace_id or None):
            metadata.path_id = new_id
            LearningService().create_topic(
                new_id,
                name=source_name,
                modules=modules,
                metadata=metadata,
                sources=snapshots,
            )
    return new_id


async def copy_question_set(
    record: dict[str, Any],
    category_id: int,
    student_id: str,
    target_workspace_id: str = "",
    source_workspace_id: str = "",
) -> int:
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    with classroom.teacher_account_context(record):
        with workspace_context(source_workspace_id or record["workspace_id"]):
            store = get_sqlite_session_store()
            categories = await store.list_categories()
            category = next((c for c in categories if c.get("id") == category_id), None)
            if category is None:
                raise ValueError("Unknown question set in the class workspace.")
            listed = await store.list_notebook_entries(category_id=category_id, limit=500)
            entries = listed.get("items", []) if isinstance(listed, dict) else list(listed)

    with student_context(student_id):
        with workspace_context(target_workspace_id or None):
            store = get_sqlite_session_store()
            new_category = await store.create_category(category["name"])
            items = [
                {
                    "question": entry.get("question", ""),
                    "question_id": entry.get("question_id") or f"classroom-{uuid4().hex}",
                    "correct_answer": entry.get("correct_answer", ""),
                    "explanation": entry.get("explanation", ""),
                    "category_id": new_category["id"],
                    "origin_type": "external_import",
                    "origin_ref": f"classroom:{record['id']}:{category_id}",
                }
                for entry in entries
            ]
            if items:
                await store.upsert_notebook_entries(None, items)
                # Upsert does not file categories; file the fresh copies by
                # their stable question ids.
                wanted = {item["question_id"] for item in items}
                unfiled = await store.list_notebook_entries(uncategorized=True, limit=500)
                for entry in unfiled.get("items", []):
                    if entry.get("question_id") in wanted:
                        await store.add_entry_to_category(entry["id"], new_category["id"])
    return int(new_category["id"])
