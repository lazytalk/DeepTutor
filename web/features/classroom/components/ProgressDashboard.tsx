"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/shared/api/client";

interface TopicProgress {
  target_id: string;
  name: string;
  kp_total: number;
  kp_mastered: number;
  reviews_due: number;
  sessions: number;
}

interface ProgressRow {
  student_id: string;
  username: string;
  topics: TopicProgress[];
  practice_totals: Record<string, number>;
}

/** P3: teacher view of per-student progress over assigned copies. */
export function ProgressDashboard({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/classroom/classes/${classId}/progress`);
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      setRows((await res.json()).rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [classId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium">{t("Progress")}</h2>
        <button
          className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          onClick={() => void reload()}
          disabled={busy}
        >
          {t("Refresh")}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
      {rows.length === 0 && !error && (
        <p className="text-sm text-[var(--muted-foreground)]">{t("No progress yet.")}</p>
      )}
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.student_id} className="rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm font-medium">{row.username}</p>
            {row.topics.length === 0 && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("No assignments yet.")}</p>
            )}
            <ul className="mt-1 flex flex-col gap-1">
              {row.topics.map((topic) => (
                <li key={topic.target_id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{topic.name}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {t("Mastered")} {topic.kp_mastered}/{topic.kp_total}
                  </span>
                  <span className="text-[var(--muted-foreground)]">
                    {t("Sessions")} {topic.sessions}
                  </span>
                  <span className="text-[var(--muted-foreground)]">
                    {t("Reviews due")} {topic.reviews_due}
                  </span>
                </li>
              ))}
            </ul>
            {Object.keys(row.practice_totals ?? {}).length > 0 && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {t("Practice totals")}:{" "}
                {Object.entries(row.practice_totals)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
