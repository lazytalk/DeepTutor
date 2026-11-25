import { apiFetch } from "@/shared/api/client";
import type { StreamEvent } from "@/features/chat/model/protocol";

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

export interface DashboardTopicProgress {
  target_id: string;
  name: string;
  kp_total: number;
  kp_mastered: number;
  reviews_due: number;
  sessions: number;
}

export interface DashboardStudentProgress {
  student_id: string;
  username: string;
  topics: DashboardTopicProgress[];
  practice_totals: Record<string, number>;
}

export interface DashboardClass {
  class_id: string;
  class_name: string;
  workspace_id: string;
  member_count: number;
  assignments: number;
  reviews_due: number;
  students: DashboardStudentProgress[];
}

export interface ClassroomDashboard {
  classes: DashboardClass[];
  totals: {
    classes: number;
    students: number;
    assignments: number;
    reviews_due: number;
    sessions: number;
  };
}

/** Teacher: aggregate progress across every non-archived owned class. */
export const classroomDashboard = () =>
  apiFetch("/api/classroom/dashboard").then((r) => json<ClassroomDashboard>(r));

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

export interface ReviewAskUserOption {
  label: string;
  description: string | null;
}

export interface ReviewAskUserQuestion {
  id: string;
  prompt: string;
  header: string | null;
  multi_select: boolean;
  allow_free_text: boolean;
  placeholder: string | null;
  options: ReviewAskUserOption[];
}

export interface ReviewAskUserAnswer {
  questionId: string;
  text: string;
}

/** One ask_user call: what the assistant asked and what the learner replied. */
export interface ReviewAskUserExchange {
  tool_call_id: string;
  intro: string | null;
  questions: ReviewAskUserQuestion[];
  answers: ReviewAskUserAnswer[];
  resolved: boolean;
  asked_at: number | null;
  answered_at: number | null;
}

export interface ReviewToolCall {
  call_id: string;
  name: string;
  status: string;
  args_preview: string;
  result_preview: string;
  started_at: number | null;
  finished_at: number | null;
}

export interface ReviewStage {
  stage: string;
  label: string;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  duration: number | null;
}

export interface ReviewQuizResult {
  id: number;
  question_id: string;
  question: string;
  question_type: string;
  options: Record<string, string>;
  user_answer: string;
  correct_answer: string;
  explanation: string;
  is_correct: boolean;
  result: string;
  assessment_type: string;
  knowledge_point_id: string;
  mastery_path_id: string;
  attempt_count: number;
  hints_used: number;
  created_at: number;
}

export interface ReviewError {
  message: string;
  code: string;
  at: number | null;
}

export interface ReviewTurn {
  id: string;
  turn_id: string;
  number: number;
  capability: string;
  status: string;
  error: string;
  failure_code: string;
  retryable: boolean;
  created_at: number | null;
  updated_at: number | null;
  finished_at: number | null;
  duration: number | null;
  user_message_id: number | null;
  assistant_message_id: number | null;
  message_ids: number[];
  events: Array<{
    type: string;
    source: string;
    stage: string;
    content: string;
    seq: number;
    timestamp: number;
    metadata: Record<string, unknown>;
  }>;
  ask_user: ReviewAskUserExchange[];
  tool_calls: ReviewToolCall[];
  stages: ReviewStage[];
  quiz_results: ReviewQuizResult[];
  errors: ReviewError[];
  counts: {
    ask_user: number;
    tools: number;
    stages: number;
    quizzes: number;
    mistakes: number;
    errors: number;
    messages?: number;
  };
}

export interface ReviewMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  capability?: string;
  events: StreamEvent[];
  attachments?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  created_at: number;
  parent_message_id?: number | null;
  trace?: Record<string, unknown>;
}

export interface SessionReviewContext {
  student: { id: string; username: string };
  class: { id: string; name: string };
  assignment: { id: string; kind: string; target_id: string };
  topic: { id: string; name: string };
  session: { id: string; title: string };
}

export interface SessionReviewSummary {
  turns: number;
  messages: number;
  ask_user: number;
  tools: number;
  quizzes: number;
  mistakes: number;
  errors: number;
}

/** Full read-only review payload for a session bound to an assigned topic. */
export interface SessionReviewPayload {
  id: string;
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preferences?: Record<string, unknown>;
  messages: ReviewMessage[];
  turns: ReviewTurn[];
  context: SessionReviewContext;
  summary: SessionReviewSummary;
  active_turns?: Record<string, unknown>[];
}

export const studentSessionReview = (sid: string, sessionId: string) =>
  apiFetch(`/api/classroom/students/${sid}/sessions/${sessionId}`).then((r) =>
    json<SessionReviewPayload>(r),
  );

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
