"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  MessageSquareText,
  Target,
} from "lucide-react";

import {
  studentObjectiveEvidence,
  studentRecord,
  type MasteryKnowledgePoint,
  type MasteryTopicRecord,
  type ObjectiveReport,
  type RecordAttention,
  type StudentRecordPayload,
} from "../api";

type Tab =
  | "overview"
  | "mastery"
  | "practice"
  | "courseware"
  | "conversations"
  | "highlights"
  | "assignments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "mastery", label: "Mastery" },
  { id: "practice", label: "Practice" },
  { id: "courseware", label: "Courseware" },
  { id: "conversations", label: "Conversations" },
  { id: "highlights", label: "Highlights" },
  { id: "assignments", label: "Assignments" },
];

const panel = "rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4";
const chip =
  "rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5";
const chipLabel = "text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]";
const chipValue = "mt-0.5 font-serif text-lg font-semibold";

function formatWhen(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "";
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw;
  return new Date(ms).toLocaleDateString();
}

function statusClass(status: string): string {
  if (status === "mastered") return "text-[var(--foreground)]";
  if (status === "learning") return "text-[var(--destructive)]";
  return "text-[var(--muted-foreground)]";
}

function resultLabel(entry: { result: string; is_correct: boolean | number | null }): string {
  if (entry.result) return entry.result;
  return entry.is_correct ? "correct" : "incorrect";
}

function attentionCopy(item: RecordAttention): {
  key: string;
  values?: Record<string, unknown>;
} {
  switch (item.kind) {
    case "reviews_due":
      return { key: "{{count}} reviews due", values: { count: item.count ?? 0 } };
    case "low_mastery":
      return {
        key: "Below half mastery ({{mastered}}/{{total}})",
        values: { mastered: item.mastered ?? 0, total: item.total ?? 0 },
      };
    case "practice_due":
      return {
        key: "{{count}} practice questions due",
        values: { count: item.count ?? 0 },
      };
    case "no_conversations":
      return { key: "No conversations on assigned topics yet." };
    default:
      return { key: item.kind };
  }
}

export function StudentRecord({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<StudentRecordPayload | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, ObjectiveReport | null>>({});
  const [loadingEvidence, setLoadingEvidence] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setError("");
    try {
      setData(await studentRecord(studentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggleEvidence(topic: MasteryTopicRecord, kp: MasteryKnowledgePoint) {
    const key = `${topic.path_id}:${kp.id}`;
    const nextOpen = !expanded[key];
    setExpanded((prev) => ({ ...prev, [key]: nextOpen }));
    if (!nextOpen || evidence[key] !== undefined || loadingEvidence[key]) return;
    setLoadingEvidence((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = await studentObjectiveEvidence(studentId, topic.path_id, kp.id);
      setEvidence((prev) => ({ ...prev, [key]: payload.objective }));
    } catch {
      setEvidence((prev) => ({ ...prev, [key]: null }));
    } finally {
      setLoadingEvidence((prev) => ({ ...prev, [key]: false }));
    }
  }

  if (error) {
    return (
      <section className={panel}>
        <p className="text-sm text-[var(--destructive)]">{error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className={panel}>
        <p className="text-sm text-[var(--muted-foreground)]">{t("Loading…")}</p>
      </section>
    );
  }

  const practiceDue = data.practice.sets.reduce((sum, set) => sum + set.due, 0);
  const practiceMistakes = data.practice.sets.reduce((sum, set) => sum + set.mistakes, 0);
  const coursewarePercent = data.courseware.length
    ? Math.round(
        data.courseware.reduce((sum, book) => sum + book.reading.percent, 0) /
          data.courseware.length,
      )
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className={panel} data-testid="student-record">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/classroom"
            className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={14} /> {t("Back to dashboard")}
          </Link>
          <span className="text-xs text-[var(--muted-foreground)]">
            {data.classes.map((entry) => entry.name).join(" · ")}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-semibold" data-testid="student-record-title">
          {t("Learning record for {{name}}", { name: data.student.username })}
        </h1>
        {data.needs_attention.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.needs_attention.map((item, index) => {
              const copy = attentionCopy(item);
              return (
                <span
                  key={`${item.kind}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--destructive)] px-2 py-0.5 text-[11px] text-[var(--destructive)]"
                >
                  <AlertTriangle size={11} /> {t(copy.key, copy.values)}
                </span>
              );
            })}
          </div>
        )}
        <div role="tablist" aria-label={t("Learning record tabs")} className="mt-3 flex flex-wrap gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`record-tab-${entry.id}`}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                tab === entry.id
                  ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]"
              }`}
              onClick={() => setTab(entry.id)}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
      </section>

      {tab === "overview" && (
        <section className={panel} data-testid="record-overview">
          <h2 className="mb-3 text-sm font-medium">{t("Overview")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={chip}>
              <div className={chipLabel}>{t("Mastered")}</div>
              <div className={chipValue} data-testid="record-mastered">
                {data.mastery.counts.mastered}/{data.mastery.counts.total}
              </div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Reviews due")}</div>
              <div className={chipValue} data-testid="record-reviews">
                {data.mastery.due_reviews}
              </div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Practice mistakes")}</div>
              <div className={chipValue}>{practiceMistakes}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Practice due")}</div>
              <div className={chipValue}>{practiceDue}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Courseware")}</div>
              <div className={chipValue}>{coursewarePercent}%</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Conversations")}</div>
              <div className={chipValue}>{data.sessions.length}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Highlights")}</div>
              <div className={chipValue}>{data.highlights.total}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Assignments")}</div>
              <div className={chipValue}>{data.assignments.length}</div>
            </div>
          </div>
        </section>
      )}

      {tab === "mastery" && (
        <section className={panel} data-testid="record-mastery">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Target size={15} /> {t("Mastery")}
          </h2>
          {data.mastery.topics.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {t("No mastery topics assigned yet.")}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {data.mastery.topics.map((topic) => (
              <div
                key={`${topic.assignment_id}:${topic.path_id}`}
                className="rounded-lg border border-[var(--border)] p-3"
                data-testid={`mastery-topic-${topic.path_id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{topic.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {topic.class_name}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("Mastered")} {topic.counts.mastered}/{topic.counts.total}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("Reviews due")} {topic.due_reviews}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("Conversations")} {topic.session_count}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {t("Next objective")}:{" "}
                  <span className="text-[var(--foreground)]">
                    {topic.next.knowledge_point_name || topic.next.action}
                  </span>
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {topic.modules.map((module) => (
                    <div key={module.id}>
                      <div className="text-xs font-medium">
                        {module.name}{" "}
                        <span className="font-normal text-[var(--muted-foreground)]">
                          ({module.mastered}/{module.total})
                        </span>
                      </div>
                      {module.knowledge_points.map((kp) => {
                        const key = `${topic.path_id}:${kp.id}`;
                        const report = evidence[key];
                        return (
                          <div key={kp.id} className="ml-2">
                            <button
                              type="button"
                              data-testid={`mastery-kp-${kp.id}`}
                              className="mt-1 flex w-full items-center gap-1.5 text-left text-xs hover:underline"
                              onClick={() => void toggleEvidence(topic, kp)}
                            >
                              {expanded[key] ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                              <span className={statusClass(kp.status)}>{kp.name}</span>
                              <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                                {kp.status}
                              </span>
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {Math.round(kp.mastery * 100)}%
                              </span>
                            </button>
                            {expanded[key] && (
                              <div className="ml-5 mt-1 rounded-lg border border-[var(--border)] p-2 text-xs">
                                {loadingEvidence[key] && (
                                  <p className="text-[var(--muted-foreground)]">
                                    {t("Loading evidence…")}
                                  </p>
                                )}
                                {!loadingEvidence[key] && report === null && (
                                  <p className="text-[var(--muted-foreground)]">
                                    {t("No evidence yet.")}
                                  </p>
                                )}
                                {report && (
                                  <div className="flex flex-col gap-1" data-testid="objective-evidence">
                                    <p>
                                      {t("Status")}: {report.status} · {t("Mastery")}{" "}
                                      {Math.round(report.mastery * 100)}% /{" "}
                                      {Math.round(report.threshold * 100)}%
                                    </p>
                                    <p className="text-[var(--muted-foreground)]">
                                      {t("Attempts")}: {report.attempts.length} ·{" "}
                                      {t("Correct")}: {report.correct_count} ·{" "}
                                      {t("Errors")}: {report.errors.length}
                                    </p>
                                    {report.attempts.slice(0, 5).map((attempt, index) => (
                                      <p
                                        key={`${attempt.question_id}-${index}`}
                                        className="text-[var(--muted-foreground)]"
                                      >
                                        {attempt.is_correct ? "✓" : "✗"}{" "}
                                        {attempt.prompt || attempt.question_id}
                                        {attempt.error_type ? ` · ${attempt.error_type}` : ""}
                                      </p>
                                    ))}
                                    {report.attempts.length === 0 && (
                                      <p className="text-[var(--muted-foreground)]">
                                        {t("No attempts recorded.")}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "practice" && (
        <section className={panel} data-testid="record-practice">
          <h2 className="mb-3 text-sm font-medium">{t("Practice")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={chip}>
              <div className={chipLabel}>{t("Total")}</div>
              <div className={chipValue}>{data.practice.summary.total ?? 0}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Mistakes")}</div>
              <div className={chipValue}>{data.practice.summary.mistakes ?? 0}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Due")}</div>
              <div className={chipValue}>{data.practice.summary.due ?? 0}</div>
            </div>
            <div className={chip}>
              <div className={chipLabel}>{t("Overdue")}</div>
              <div className={chipValue}>{data.practice.summary.overdue ?? 0}</div>
            </div>
          </div>
          {data.practice.analytics.totals && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {t("30-day activity")}: {data.practice.analytics.totals.questions}{" "}
              {t("Questions")} · {data.practice.analytics.totals.mistakes}{" "}
              {t("Mistakes")} · {data.practice.analytics.totals.reviews} {t("Reviews")}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2">
            {data.practice.sets.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">
                {t("No practice sets assigned yet.")}
              </p>
            )}
            {data.practice.sets.map((set) => (
              <div
                key={set.assignment_id}
                className="rounded-lg border border-[var(--border)] p-2 text-xs"
                data-testid={`practice-set-${set.category_id}`}
              >
                <span className="font-medium">{set.name}</span>{" "}
                <span className="text-[var(--muted-foreground)]">
                  {set.class_name} · {t("Questions")} {set.entry_count} · {t("Mistakes")}{" "}
                  {set.mistakes} · {t("Due")} {set.due}
                </span>
              </div>
            ))}
          </div>
          <h3 className="mt-4 text-xs font-medium">{t("Due review queue")}</h3>
          {data.practice.queue.length === 0 && (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {t("No practice due.")}
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.practice.queue.map((item) => (
              <li
                key={`${item.category_id}-${item.id}`}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium">{item.question}</span>{" "}
                <span className="text-[var(--muted-foreground)]">
                  {item.category_name}
                  {item.due_at ? ` · ${formatWhen(item.due_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "courseware" && (
        <section className={panel} data-testid="record-courseware">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <BookOpen size={15} /> {t("Courseware")}
          </h2>
          {data.courseware.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {t("No courseware assigned yet.")}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {data.courseware.map((book) => (
              <li
                key={book.book_id}
                className="rounded-lg border border-[var(--border)] p-2.5"
                data-testid={`courseware-${book.book_id}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{book.title}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {book.class_names.join(" · ")}
                  </span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                    {book.reading.percent}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full bg-[var(--foreground)]"
                    style={{ width: `${Math.min(100, book.reading.percent)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  {t("Visited")} {book.reading.visited_pages} /{" "}
                  {book.reading.total_pages} {t("pages")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "conversations" && (
        <section className={panel} data-testid="record-conversations">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <MessageSquareText size={15} /> {t("Conversations")}
          </h2>
          {data.sessions.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {t("No conversations yet.")}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {data.sessions.map((session) => (
              <li key={session.session_id}>
                <Link
                  href={`/classroom/review/${encodeURIComponent(studentId)}/${encodeURIComponent(session.session_id)}`}
                  data-testid={`conversation-${session.session_id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm hover:border-[var(--foreground)]"
                >
                  <span className="font-medium">
                    {session.title || session.session_id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {session.topic_name} · {session.class_name}
                  </span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                    {formatWhen(session.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "highlights" && (
        <section className={panel} data-testid="record-highlights">
          <h2 className="mb-3 text-sm font-medium">{t("Recent highlights")}</h2>
          {data.highlights.recent.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {t("No highlights yet.")}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {data.highlights.recent.map((entry) => (
              <li
                key={`${entry.category_id ?? "topic"}-${entry.id}`}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
                data-testid={`highlight-${entry.id}`}
              >
                <p className="font-medium">{entry.question}</p>
                <p className="text-[var(--muted-foreground)]">
                  {entry.category_name || t("Topic")} · {resultLabel(entry)}
                  {entry.created_at ? ` · ${formatWhen(entry.created_at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "assignments" && (
        <section className={panel} data-testid="record-assignments">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ClipboardList size={15} /> {t("Assignments")}
          </h2>
          {data.assignments.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {t("No assignments yet.")}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {data.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
                data-testid={`record-assignment-${assignment.id}`}
              >
                <span className="font-medium">
                  {assignment.target_name || assignment.target_id}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {assignment.kind === "mastery_topic"
                    ? t("Guided Learning topic")
                    : t("Practice question set")}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {assignment.class_name}
                </span>
                <span
                  className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    assignment.status === "revoked"
                      ? "border-[var(--border)] text-[var(--muted-foreground)]"
                      : "border-[var(--foreground)] text-[var(--foreground)]"
                  }`}
                >
                  {assignment.status === "revoked" ? t("Revoked") : t("Active")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}