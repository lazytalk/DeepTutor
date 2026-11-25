"""Read-only progress aggregation shared by per-class and dashboard views.

Both ``GET /classes/{id}/progress`` and ``GET /dashboard`` must report the
same numbers: per-student rows over the teacher's assigned mastery copies
(``LearningStore``) plus the student's practice analytics (``PracticeStore``).
Keeping the computation here avoids the two endpoints drifting apart.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Any

from deeptutor.services.workspace.context import workspace_context


async def compute_progress_rows(
    *, teacher_id: str, student_ids: Iterable[str]
) -> list[dict[str, Any]]:
    """Aggregate progress rows for ``student_ids`` under ``teacher_id``.

    Each row matches the historical ``/classes/{id}/progress`` payload:
    ``student_id``, ``username``, ``topics`` and ``practice_totals``.
    Copy/learning reads happen under the student's own account context so no
    storage resolves in the teacher's account.
    """
    from deeptutor.learning.storage import LearningStore
    from deeptutor.multi_user import classroom
    from deeptutor.multi_user.identity import get_user_by_id
    from deeptutor.services.classroom.assignments import student_context
    from deeptutor.services.practice.storage import PracticeStore
    from deeptutor.services.session.sqlite_store import get_sqlite_session_store

    rows: list[dict[str, Any]] = []
    for student_id in student_ids:
        info = get_user_by_id(student_id)
        topics: list[dict[str, Any]] = []
        with student_context(student_id):
            for assignment in classroom.list_assignments(
                teacher_id=teacher_id, student_id=student_id, kind="mastery_topic"
            ):
                with workspace_context(assignment["target_workspace_id"] or None):
                    store = LearningStore()
                    progress = store.load(assignment["target_id"])
                    if progress is None:
                        continue
                    knowledge_points = [
                        kp for module in progress.modules for kp in module.knowledge_points
                    ]
                    thresholds = {m.id: m.pass_threshold for m in progress.modules}
                    mastered = 0
                    for kp in knowledge_points:
                        ktype = progress.knowledge_types.get(kp.id) or kp.type
                        ktype_value = getattr(ktype, "value", str(ktype)).lower()
                        if ktype_value in ("memory", "procedure"):
                            if progress.mastery_levels.get(kp.id, 0.0) >= thresholds.get(
                                kp.module_id, 0.7
                            ):
                                mastered += 1
                        elif progress.qualitative_mastery.get(kp.id):
                            mastered += 1
                    topics.append(
                        {
                            "target_id": assignment["target_id"],
                            "name": progress.name or assignment["target_id"],
                            "kp_total": len(knowledge_points),
                            "kp_mastered": mastered,
                            "reviews_due": len(progress.review_queue),
                            "sessions": len(store.list_session_ids(assignment["target_id"])),
                        }
                    )
            with workspace_context(None):
                session_store = get_sqlite_session_store()
                practice = await asyncio.to_thread(
                    PracticeStore(session_store.db_path).analytics, "UTC", 30
                )
        rows.append(
            {
                "student_id": student_id,
                "username": info[0] if info else student_id,
                "topics": topics,
                "practice_totals": practice.get("totals", {}),
            }
        )
    return rows