"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ClipboardList, RotateCcw, Users } from "lucide-react";
import {
  classroomDashboard,
  type ClassroomDashboard,
  type DashboardStudentProgress,
} from "../api";
import { StudentActivityViewer } from "./StudentActivityViewer";

const panel = "rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4";
const card = "rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4";

interface StudentTotals {
  kpTotal: number;
  kpMastered: number;
  reviewsDue: number;
  sessions: number;
}

function studentTotals(student: DashboardStudentProgress): StudentTotals {
  return student.topics.reduce<StudentTotals>(
    (acc, topic) => ({
      kpTotal: acc.kpTotal + topic.kp_total,
      kpMastered: acc.kpMastered + topic.kp_mastered,
      reviewsDue: acc.reviewsDue + topic.reviews_due,
      sessions: acc.sessions + topic.sessions,
    }),
    { kpTotal: 0, kpMastered: 0, reviewsDue: 0, sessions: 0 },
  );
}

function needsAttention(totals: StudentTotals): boolean {
  if (totals.reviewsDue > 0) return true;
  return totals.kpTotal > 0 && totals.kpMastered / totals.kpTotal < 0.5;
}

/**
 * Teacher landing view: aggregate progress across every owned class.
 * Class headers drill into the existing per-class panels; student rows open
 * the read-only activity viewer in place.
 */
export function TeacherDashboard({ onOpenClass }: { onOpenClass: (classId: string) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ClassroomDashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{
    classId: string;
    studentId: string;
    username: string;
  } | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await classroomDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totals = data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <section className={panel}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-medium">{t("Teacher dashboard")}</h2>
          <button
            type="button"
            className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={() => void reload()}
            disabled={busy}
          >
            {t("Refresh")}
          </button>
        </div>
        {error && <p className="mb-2 text-xs text-[var(--destructive)]">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={card}>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Users size={14} /> {t("Students")}
            </div>
            <p data-testid="dashboard-total-students" className="mt-1 font-serif text-2xl font-semibold">
              {totals?.students ?? 0}
            </p>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <ClipboardList size={14} /> {t("Active assignments")}
            </div>
            <p
              data-testid="dashboard-total-assignments"
              className="mt-1 font-serif text-2xl font-semibold"
            >
              {totals?.assignments ?? 0}
            </p>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <RotateCcw size={14} /> {t("Reviews due")}
            </div>
            <p
              data-testid="dashboard-total-reviews"
              className="mt-1 font-serif text-2xl font-semibold"
            >
              {totals?.reviews_due ?? 0}
            </p>
          </div>
        </div>
      </section>

      {!busy && data && data.classes.length === 0 && (
        <section className={panel}>
          <p className="text-sm text-[var(--muted-foreground)]">{t("No dashboard data yet.")}</p>
        </section>
      )}

      {data?.classes.map((entry) => (
        <section key={entry.class_id} className={panel} data-testid={`dashboard-class-${entry.class_id}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{entry.class_name}</h2>
            <span className="text-xs text-[var(--muted-foreground)]">
              {entry.member_count} {t("Members")}
            </span>
            <button
              type="button"
              className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              onClick={() => onOpenClass(entry.class_id)}
            >
              {t("Open class")} →
            </button>
          </div>
          {entry.students.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">{t("No students in this class.")}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {entry.students.map((student) => {
              const summary = studentTotals(student);
              const flagged = needsAttention(summary);
              return (
                <li key={student.student_id}>
                  <button
                    type="button"
                    data-testid={`dashboard-student-${entry.class_id}-${student.student_id}`}
                    className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm ${
                      flagged
                        ? "border-[var(--destructive)] bg-[var(--background)]"
                        : "border-[var(--border)]"
                    }`}
                    onClick={() =>
                      setViewer({
                        classId: entry.class_id,
                        studentId: student.student_id,
                        username: student.username,
                      })
                    }
                  >
                    <span className="font-medium">{student.username}</span>
                    {flagged && (
                      <span className="flex items-center gap-1 rounded-full border border-[var(--destructive)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--destructive)]">
                        <AlertTriangle size={11} /> {t("Needs attention")}
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {t("Mastered")} {summary.kpMastered}/{summary.kpTotal}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {t("Reviews due")} {summary.reviewsDue}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {t("Sessions")} {summary.sessions}
                    </span>
                    {Object.keys(student.practice_totals ?? {}).length > 0 && (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {t("Practice totals")}:{" "}
                        {Object.entries(student.practice_totals)
                          .map(([key, value]) => `${key} ${value}`)
                          .join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {viewer && (
        <section className={panel}>
          <button
            type="button"
            className="mb-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={() => setViewer(null)}
          >
            ← {t("Back to overview")}
          </button>
          <StudentActivityViewer
            classId={viewer.classId}
            studentId={viewer.studentId}
            username={viewer.username}
          />
        </section>
      )}
    </div>
  );
}