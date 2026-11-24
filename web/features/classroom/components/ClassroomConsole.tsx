"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { School, Users, UserPlus, Trash2, FolderOpen } from "lucide-react";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { selectWorkspace } from "@/lib/workspace-scope";
import {
  createClass,
  createStudent,
  inviteMember,
  listClasses,
  listMembers,
  myAssignments,
  myClasses,
  removeMember,
  studentPool,
  updateClass,
  type Assignment,
  type ClassMember,
  type ClassSummary,
  type PoolStudent,
} from "../api";
import { AssignmentBoard } from "./AssignmentBoard";
import { StudentActivityViewer } from "./StudentActivityViewer";

const panel = "rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4";
const input =
  "rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)]";
const button =
  "rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)] disabled:opacity-40";

export default function ClassroomConsole() {
  const { t } = useTranslation();
  const { role } = useAuthStatus();
  const isTeacher = role === "teacher" || role === "admin";
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [selected, setSelected] = useState<ClassSummary | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [pool, setPool] = useState<PoolStudent[]>([]);
  const [name, setName] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewerStudent, setViewerStudent] = useState("");
  const [myAssign, setMyAssign] = useState<Assignment[]>([]);

  const reload = useCallback(async () => {
    setError("");
    try {
      setClasses(isTeacher ? await listClasses() : await myClasses());
      if (isTeacher) setPool(await studentPool());
      else setMyAssign(await myAssignments());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTeacher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openMembers = useCallback(async (item: ClassSummary) => {
    setSelected(item);
    setNotice("");
    try {
      setMembers(await listMembers(item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  async function run(action: () => Promise<unknown>, message: string) {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await reload();
      if (selected) setMembers(await listMembers(selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-6 py-8">
      <header className="flex items-center gap-2">
        <School size={20} strokeWidth={1.7} />
        <h1 className="font-serif text-xl font-semibold">{t("Classroom")}</h1>
      </header>
      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
      {notice && <p className="text-sm text-[var(--muted-foreground)]">{notice}</p>}

      {isTeacher && (
        <form
          className={`${panel} flex flex-wrap items-center gap-2`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await createClass(name.trim());
              setName("");
            }, t("Class created."));
          }}
        >
          <input
            className={input}
            placeholder={t("Class name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
          <button className={button} type="submit" disabled={!name.trim()}>
            {t("Create class")}
          </button>
        </form>
      )}

      <section className={panel}>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Users size={15} /> {isTeacher ? t("Classes") : t("My classes")}
        </h2>
        {classes.length === 0 && (
          <p className="text-sm text-[var(--muted-foreground)]">{t("No classes yet.")}</p>
        )}
        <ul className="flex flex-col gap-1">
          {classes.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => void openMembers(item)}
              >
                {item.name}
              </button>
              <span className="text-xs text-[var(--muted-foreground)]">
                {item.member_count} {t("Members")}
                {item.archived ? ` · ${t("Archived")}` : ""}
              </span>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => void selectWorkspace(item.workspace_id, "/chat")}
              >
                <FolderOpen size={13} /> {t("Open workspace")}
              </button>
              {isTeacher && (
                <button
                  type="button"
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  onClick={() =>
                    void run(() => updateClass(item.id, { archived: !item.archived }), t("Saved."))
                  }
                >
                  {item.archived ? t("Restore") : t("Archive")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isTeacher && selected && (
        <section className={panel}>
          <h2 className="mb-2 text-sm font-medium">
            {selected.name} · {t("Members")}
          </h2>
          <ul className="mb-3 flex flex-col gap-1">
            {members.length === 0 && (
              <li className="text-sm text-[var(--muted-foreground)]">{t("No members yet.")}</li>
            )}
            {members.map((member) => (
              <li key={member.user_id} className="flex items-center gap-2 text-sm">
                <span>{member.username}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{member.role}</span>
                <button
                  type="button"
                  aria-label={t("Remove")}
                  className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                  onClick={() =>
                    void run(() => removeMember(selected.id, member.user_id), t("Removed."))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={input}
              value={inviteId}
              onChange={(event) => setInviteId(event.target.value)}
              aria-label={t("Student pool")}
            >
              <option value="">{t("Student pool")}</option>
              {pool
                .filter((student) => !members.some((m) => m.user_id === student.id))
                .map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.username}
                  </option>
                ))}
            </select>
            <button
              className={button}
              type="button"
              disabled={!inviteId}
              onClick={() =>
                void run(async () => {
                  await inviteMember(selected.id, inviteId);
                  setInviteId("");
                }, t("Invited."))
              }
            >
              <UserPlus size={14} className="mr-1 inline" />
              {t("Invite")}
            </button>
          </div>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!studentName.trim() || studentPassword.length < 8) return;
              void run(async () => {
                await createStudent(selected.id, studentName.trim(), studentPassword);
                setStudentName("");
                setStudentPassword("");
              }, t("Student account created."));
            }}
          >
            <input
              className={input}
              placeholder={t("Username")}
              value={studentName}
              onChange={(event) => setStudentName(event.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder={t("Password")}
              value={studentPassword}
              onChange={(event) => setStudentPassword(event.target.value)}
            />
            <button className={button} type="submit">
              {t("Create student account")}
            </button>
          </form>
        </section>
      )}

      {isTeacher && selected && (
        <>
          <AssignmentBoard
            classId={selected.id}
            workspaceId={selected.workspace_id}
            members={members}
          />
          <section className={panel}>
            <h2 className="mb-2 text-sm font-medium">{t("Assigned work")}</h2>
            <select
              className={input}
              value={viewerStudent}
              onChange={(event) => setViewerStudent(event.target.value)}
            >
              <option value="">{t("Pick a student")}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.username}
                </option>
              ))}
            </select>
            {viewerStudent && (
              <div className="mt-3">
                <StudentActivityViewer
                  classId={selected.id}
                  studentId={viewerStudent}
                  username={members.find((m) => m.user_id === viewerStudent)?.username ?? viewerStudent}
                />
              </div>
            )}
          </section>
        </>
      )}

      {!isTeacher && (
        <>
          <section className={panel}>
            <h2 className="mb-2 text-sm font-medium">{t("My assignments")}</h2>
            {myAssign.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">{t("No assignments yet.")}</p>
            )}
            <ul className="flex flex-col gap-1">
              {myAssign.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span>
                    {a.kind === "mastery_topic" ? t("Guided Learning topic") : t("Practice question set")}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    onClick={() => void selectWorkspace(a.target_workspace_id || "", "/learning")}
                  >
                    {t("Open copy")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t("Read-only class workspace: browsing only.")}
          </p>
        </>
      )}
    </div>
  );
}
