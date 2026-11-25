import { apiFetch } from "@/shared/api/client";

export interface ClassSummary {
  id: string;
  name: string;
  teacher_id: string;
  workspace_id: string;
  member_count: number;
  created_at: string;
  archived: boolean;
}

export interface ClassMember {
  user_id: string;
  username: string;
  role: string;
  joined_at: string;
}

export interface PoolStudent {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const listClasses = () =>
  apiFetch("/api/classroom/classes").then((r) => json<{ classes: ClassSummary[] }>(r)).then((d) => d.classes);

export const myClasses = () =>
  apiFetch("/api/classroom/my-classes").then((r) => json<{ classes: ClassSummary[] }>(r)).then((d) => d.classes);

export const createClass = (name: string) =>
  apiFetch("/api/classroom/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => json<{ class: ClassSummary }>(r));

export const updateClass = (id: string, patch: { name?: string; archived?: boolean }) =>
  apiFetch(`/api/classroom/classes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json<{ class: ClassSummary }>(r));

export const listMembers = (id: string) =>
  apiFetch(`/api/classroom/classes/${id}/members`).then((r) => json<{ members: ClassMember[] }>(r)).then((d) => d.members);

export const inviteMember = (id: string, userId: string) =>
  apiFetch(`/api/classroom/classes/${id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  }).then((r) => json<{ class: ClassSummary }>(r));

export const removeMember = (id: string, userId: string) =>
  apiFetch(`/api/classroom/classes/${id}/members/${userId}`, { method: "DELETE" }).then((r) => json<{ class: ClassSummary }>(r));

export const studentPool = () =>
  apiFetch("/api/classroom/student-pool").then((r) => json<{ students: PoolStudent[] }>(r)).then((d) => d.students);

export const createStudent = (id: string, username: string, password: string) =>
  apiFetch(`/api/classroom/classes/${id}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => json<{ user_id: string; username: string }>(r));

export interface ClassWorkspace {
  workspace_id: string;
  display_name: string;
  primary: boolean;
}

export const listClassWorkspaces = (id: string) =>
  apiFetch(`/api/classroom/classes/${id}/workspaces`)
    .then((r) => json<{ workspaces: ClassWorkspace[] }>(r))
    .then((d) => d.workspaces);

export const referenceWorkspace = (id: string, workspaceId: string) =>
  apiFetch(`/api/classroom/classes/${id}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  }).then((r) => json<{ class: ClassSummary; workspace_ids: string[] }>(r));

export const unreferenceWorkspace = (id: string, workspaceId: string) =>
  apiFetch(`/api/classroom/classes/${id}/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  }).then((r) => json<{ class: ClassSummary; workspace_ids: string[] }>(r));

export type BookAccess = "read" | "hidden";

export interface ClassBook {
  book_id: string;
  title: string;
  workspace_id: string;
  access: BookAccess;
}

export interface TeacherWorkspaceOption {
  workspace_id: string;
  display_name: string;
}

/** Teacher-owned workspaces offered for additional class references. */
export const teacherOwnedWorkspaces = () =>
  apiFetch("/api/settings/workspace/registrations")
    .then((r) => json<{ workspaces: { workspace_id: string; display_name: string; kind: string; archived?: boolean; shared?: boolean }[] }>(r))
    .then((d) =>
      d.workspaces
        .filter((w) => w.kind === "workspace" && !w.archived && !w.shared)
        .map((w) => ({ workspace_id: w.workspace_id, display_name: w.display_name })),
    );

export const listClassBooks = (id: string) =>
  apiFetch(`/api/classroom/classes/${id}/books`).then((r) =>
    json<{ books: ClassBook[]; default: BookAccess }>(r),
  );

export const setBookAccess = (id: string, patch: { default?: BookAccess; books?: Record<string, BookAccess> }) =>
  apiFetch(`/api/classroom/classes/${id}/book-access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json<{ book_policy: { default: BookAccess; books: Record<string, BookAccess> } }>(r));

export interface AssignmentSource {
  kind: "mastery_topic" | "question_set";
  id: string;
  name: string;
  workspace_id: string;
}

export const listAssignmentSources = (id: string) =>
  apiFetch(`/api/classroom/classes/${id}/assignment-sources`)
    .then((r) => json<{ sources: AssignmentSource[] }>(r))
    .then((d) => d.sources);

export interface Assignment {
  id: string;
  class_id: string;
  teacher_id: string;
  student_id: string;
  kind: "mastery_topic" | "question_set";
  source_id: string;
  target_workspace_id: string;
  target_id: string;
  created_at: string;
  revoked_at: string | null;
}

export const classAssignments = (id: string) =>
  apiFetch(`/api/classroom/classes/${id}/assignments`).then((r) => json<{ assignments: Assignment[] }>(r)).then((d) => d.assignments);

export const assign = (
  id: string,
  body: { kind: string; source_id: string; source_workspace_id?: string; student_ids?: string[] },
) =>
  apiFetch(`/api/classroom/classes/${id}/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<{ results: { student_id: string; ok: boolean; error?: string }[] }>(r));

export const revokeAssignment = (id: string) =>
  apiFetch(`/api/classroom/assignments/${id}`, { method: "DELETE" }).then((r) => json<{ assignment: Assignment }>(r));

export const myAssignments = () =>
  apiFetch("/api/classroom/my-assignments").then((r) => json<{ assignments: Assignment[] }>(r)).then((d) => d.assignments);

export const studentTopic = (sid: string, pid: string) =>
  apiFetch(`/api/classroom/students/${sid}/topics/${pid}`).then((r) => json<Record<string, unknown>>(r));

export const renameStudentTopic = (sid: string, pid: string, name: string) =>
  apiFetch(`/api/classroom/students/${sid}/topics/${pid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => json<{ path_id: string; name: string }>(r));

export const studentTopicSessions = (sid: string, pid: string) =>
  apiFetch(`/api/classroom/students/${sid}/topics/${pid}/sessions`).then((r) => json<{ session_ids: string[] }>(r)).then((d) => d.session_ids);

export const studentSession = (sid: string, session_id: string) =>
  apiFetch(`/api/classroom/students/${sid}/sessions/${session_id}`).then((r) => json<{ messages?: { role?: string; content?: string }[] } & Record<string, unknown>>(r));

export const studentQuestionSets = (sid: string) =>
  apiFetch(`/api/classroom/students/${sid}/question-sets`).then((r) => json<{ question_sets: { assignment_id: string; category: { id: number; name: string } }[] }>(r)).then((d) => d.question_sets);

export const studentSetEntries = (sid: string, cat: number) =>
  apiFetch(`/api/classroom/students/${sid}/question-sets/${cat}/entries`).then((r) => json<{ entries: { id: number; question: string; correct_answer: string; explanation: string }[] }>(r)).then((d) => d.entries);

export const patchStudentEntry = (sid: string, entry: number, body: { question?: string; answer?: string; explanation?: string }) =>
  apiFetch(`/api/classroom/students/${sid}/question-entries/${entry}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<{ ok: boolean }>(r));
