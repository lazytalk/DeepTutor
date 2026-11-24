"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/shared/api/client";
import { assign, classAssignments, revokeAssignment, type Assignment, type ClassMember } from "../api";

const input =
  "rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)]";
const button =
  "rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)] disabled:opacity-40";

interface SourceOption {
  id: string;
  label: string;
}

/** Teacher: assign class topics/question sets to members (assign-by-copy). */
export function AssignmentBoard({
  classId,
  workspaceId,
  members,
}: {
  classId: string;
  workspaceId: string;
  members: ClassMember[];
}) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [kind, setKind] = useState<"mastery_topic" | "question_set">("mastery_topic");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setAssignments(await classAssignments(classId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [classId]);

  useEffect(() => {
    void reload();
    setTargets(members.map((m) => m.user_id));
  }, [reload, members]);

  useEffect(() => {
    let alive = true;
    setSourceId("");
    const url =
      kind === "mastery_topic"
        ? `/api/mastery-paths/topics?dt_workspace=${workspaceId}`
        : `/api/question-notebook/categories?dt_workspace=${workspaceId}`;
    void apiFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const rows = d.topics ?? d.categories ?? d.items ?? [];
        setSources(
          (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => ({
            id: String(row.path_id ?? row.id ?? ""),
            label: String(row.name ?? (row.metadata as Record<string, unknown>)?.goal ?? row.id ?? ""),
          })),
        );
      })
      .catch(() => setSources([]));
    return () => {
      alive = false;
    };
  }, [kind, workspaceId]);

  async function runAssign() {
    setError("");
    setNotice("");
    try {
      const result = await assign(classId, {
        kind,
        source_id: sourceId,
        student_ids: targets,
      });
      const failed = result.results.filter((r) => !r.ok);
      setNotice(
        failed.length
          ? `${result.results.length - failed.length}/${result.results.length} assigned: ${failed[0].error ?? ""}`
          : t("Assigned."),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <h2 className="mb-2 text-sm font-medium">{t("Assignments")}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="mastery_topic">{t("Guided Learning topic")}</option>
          <option value="question_set">{t("Practice question set")}</option>
        </select>
        <select className={input} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">{t("Source in class workspace")}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className={button} disabled={!sourceId || targets.length === 0} onClick={() => void runAssign()}>
          {t("Assign to selected")}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {members.map((m) => (
          <label key={m.user_id} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={targets.includes(m.user_id)}
              onChange={(e) =>
                setTargets((prev) =>
                  e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id),
                )
              }
            />
            {m.username}
          </label>
        ))}
      </div>
      {notice && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{notice}</p>}
      {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
      <ul className="mt-3 flex flex-col gap-1">
        {assignments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-xs">
            <span className="font-medium">{a.kind === "mastery_topic" ? t("Guided Learning topic") : t("Practice question set")}</span>
            <span className="text-[var(--muted-foreground)]">
              {members.find((m) => m.user_id === a.student_id)?.username ?? a.student_id}
              {a.revoked_at ? ` · ${t("Revoked")}` : ""}
            </span>
            {!a.revoked_at && (
              <button
                className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                onClick={() => void revokeAssignment(a.id).then(reload)}
              >
                {t("Revoke")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
