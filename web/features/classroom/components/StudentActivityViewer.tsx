"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  classAssignments,
  patchStudentEntry,
  renameStudentTopic,
  studentQuestionSets,
  studentSetEntries,
  studentTopic,
  studentTopicSessions,
  type Assignment,
} from "../api";

const input =
  "rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)]";
const button =
  "rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)] disabled:opacity-40";

interface Entry {
  id: number;
  question: string;
  correct_answer: string;
  explanation: string;
}

/** Teacher: view/update assigned copies and view-only transcripts. */
export function StudentActivityViewer({
  classId,
  studentId,
  username,
}: {
  classId: string;
  studentId: string;
  username: string;
}) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [topic, setTopic] = useState<Record<string, unknown> | null>(null);
  const [topicId, setTopicId] = useState("");
  const [rename, setRename] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [sets, setSets] = useState<{ assignment_id: string; category: { id: number; name: string } }[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editAnswer, setEditAnswer] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const all = await classAssignments(classId);
      setAssignments(all.filter((a) => a.student_id === studentId && !a.revoked_at));
      setSets(await studentQuestionSets(studentId).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [classId, studentId]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
    void reload();
    setTopic(null);
    setSessions([]);
    setEntries([]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [reload]);

  async function openTopic(pid: string) {
    setError("");
    setTopicId(pid);
    try {
      const payload = await studentTopic(studentId, pid);
      setTopic(payload);
      setRename(String(payload.name ?? ""));
      setSessions(await studentTopicSessions(studentId, pid));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">
          {username} · {t("Assigned work")}
        </h2>
        <Link
          href={`/classroom/record/${encodeURIComponent(studentId)}`}
          data-testid="open-learning-record"
          className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {t("Open learning record")} →
        </Link>
      </div>
      {error && <p className="mb-2 text-xs text-[var(--destructive)]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {assignments
          .filter((a) => a.kind === "mastery_topic")
          .map((a) => (
            <button key={a.id} className={`${button} text-xs`} onClick={() => void openTopic(a.target_id)}>
              {t("Topic")} {a.target_id.slice(0, 10)}
            </button>
          ))}
      </div>
      {topic && (
        <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
          <p className="text-sm font-medium">{String(topic.name ?? topicId)}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{String(topic.goal ?? "")}</p>
          <div className="mt-2 flex items-center gap-2">
            <input className={input} value={rename} onChange={(e) => setRename(e.target.value)} />
            <button
              className={button}
              disabled={!rename.trim()}
              onClick={() =>
                void renameStudentTopic(studentId, topicId, rename.trim())
                  .then(() => openTopic(topicId))
                  .catch((err) => setError(String(err)))
              }
            >
              {t("Rename")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {sessions.map((sid) => (
              <Link
                key={sid}
                href={`/classroom/review/${encodeURIComponent(studentId)}/${encodeURIComponent(sid)}`}
                className="text-xs text-[var(--muted-foreground)] hover:underline"
              >
                {t("Open session")} {sid.slice(0, 8)}
              </Link>
            ))}
            {sessions.length === 0 && (
              <span className="text-xs text-[var(--muted-foreground)]">{t("No sessions yet.")}</span>
            )}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {sets.map((s) => (
          <div key={s.assignment_id}>
            <button
              className="text-xs font-medium hover:underline"
              onClick={() =>
                void studentSetEntries(studentId, s.category.id)
                  .then(setEntries)
                  .catch((err) => setError(String(err)))
              }
            >
              {t("Practice question set")}: {s.category.name}
            </button>
          </div>
        ))}
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border border-[var(--border)] p-2 text-xs">
            <p className="font-medium">{e.question}</p>
            {editId === e.id ? (
              <div className="mt-1 flex items-center gap-2">
                <input className={input} value={editAnswer} onChange={(ev) => setEditAnswer(ev.target.value)} />
                <button
                  className={button}
                  onClick={() =>
                    void patchStudentEntry(studentId, e.id, { answer: editAnswer })
                      .then(() => {
                        setEditId(null);
                        return studentSetEntries(studentId, sets[0]?.category.id ?? 0).then(setEntries);
                      })
                      .catch((err) => setError(String(err)))
                  }
                >
                  {t("Save")}
                </button>
              </div>
            ) : (
              <p className="mt-1 text-[var(--muted-foreground)]">
                {e.correct_answer}
                <button
                  className="ml-2 hover:underline"
                  onClick={() => {
                    setEditId(e.id);
                    setEditAnswer(e.correct_answer);
                  }}
                >
                  {t("Edit answer")}
                </button>
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
