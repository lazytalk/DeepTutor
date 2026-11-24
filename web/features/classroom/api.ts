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
