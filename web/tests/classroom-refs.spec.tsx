import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ClassroomConsole from "@/features/classroom/components/ClassroomConsole";
import { AssignmentBoard } from "@/features/classroom/components/AssignmentBoard";
import { apiFetch } from "@/shared/api/client";
import type { ClassBook, ClassMember, ClassWorkspace, ClassSummary } from "@/features/classroom/api";

vi.mock("@/shared/api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("@/hooks/useAuthStatus", () => ({ useAuthStatus: () => ({ role: "teacher" }) }));
vi.mock("@/lib/workspace-scope", () => ({ selectWorkspace: vi.fn() }));
vi.mock("@/features/classroom/components/ProgressDashboard", () => ({ ProgressDashboard: () => null }));
vi.mock("@/features/classroom/components/StudentActivityViewer", () => ({
  StudentActivityViewer: () => null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Handler = (init?: RequestInit) => Response | Promise<Response>;
type Routes = Record<string, Handler>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const bodyOf = (init?: RequestInit) =>
  init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

function mockApi(routes: Routes) {
  vi.mocked(apiFetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unhandled ${method} ${path}`);
    return handler(init);
  });
}

const mathClass: ClassSummary = {
  id: "c1",
  name: "Math P3",
  teacher_id: "teacher1",
  workspace_id: "ws-main",
  member_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  archived: false,
};

const member: ClassMember = {
  user_id: "u1",
  username: "student1",
  role: "student",
  joined_at: "2026-01-01T00:00:00Z",
};

const workspaces: ClassWorkspace[] = [
  { workspace_id: "ws-main", display_name: "Math P3 Workspace", primary: true },
  { workspace_id: "ws-extra", display_name: "Extra Workspace", primary: false },
];

const books: ClassBook[] = [
  { book_id: "b1", title: "Algebra Book", workspace_id: "ws-main", access: "read" },
  { book_id: "b2", title: "Geometry Book", workspace_id: "ws-extra", access: "hidden" },
];

function consoleRoutes(overrides: Routes = {}): Routes {
  return {
    "GET /api/classroom/classes": () => jsonResponse({ classes: [mathClass] }),
    "GET /api/classroom/student-pool": () => jsonResponse({ students: [] }),
    "GET /api/classroom/classes/c1/members": () => jsonResponse({ members: [member] }),
    "GET /api/classroom/classes/c1/workspaces": () => jsonResponse({ workspaces }),
    "GET /api/classroom/classes/c1/books": () => jsonResponse({ books, default: "read" }),
    "GET /api/settings/workspace/registrations": () =>
      jsonResponse({
        workspaces: [
          { workspace_id: "ws-main", display_name: "Math P3 Workspace", kind: "workspace" },
          { workspace_id: "ws-extra", display_name: "Extra Workspace", kind: "workspace" },
          { workspace_id: "ws-free", display_name: "Free Workspace", kind: "workspace" },
          { workspace_id: "ws-shared", display_name: "Shared Class", kind: "workspace", shared: true },
        ],
      }),
    "GET /api/classroom/classes/c1/assignments": () => jsonResponse({ assignments: [] }),
    "GET /api/classroom/classes/c1/assignment-sources": () => jsonResponse({ sources: [] }),
    ...overrides,
  };
}

async function openMathClass() {
  render(<ClassroomConsole />);
  fireEvent.click(await screen.findByRole("tab", { name: "Classes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Math P3" }));
  await screen.findByText("Class workspaces");
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("lists referenced workspaces with a protected primary and offers unreferenced ones", async () => {
  mockApi(consoleRoutes());
  await openMathClass();

  expect(screen.getAllByText("Math P3 Workspace").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Extra Workspace").length).toBeGreaterThan(0);
  expect(screen.getByText("Primary")).toBeInTheDocument();

  const removeButtons = screen.getAllByRole("button", { name: "Remove workspace" });
  expect(removeButtons).toHaveLength(2);
  expect(removeButtons[0]).toBeDisabled();
  expect(removeButtons[1]).not.toBeDisabled();

  const picker = screen.getByRole("combobox", { name: "Add workspace" });
  expect(picker).toHaveTextContent("Free Workspace");
  expect(picker).not.toHaveTextContent("Extra Workspace");
});

it("references an additional teacher workspace", async () => {
  const post = vi.fn((_init?: RequestInit) =>
    jsonResponse({ class: mathClass, workspace_ids: ["ws-main", "ws-free"] }),
  );
  mockApi(consoleRoutes({ "POST /api/classroom/classes/c1/workspaces": post }));
  await openMathClass();

  fireEvent.change(screen.getByRole("combobox", { name: "Add workspace" }), {
    target: { value: "ws-free" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(bodyOf(post.mock.calls[0]?.[0] as RequestInit)).toEqual({ workspace_id: "ws-free" });
  expect(await screen.findByText("Workspace referenced.")).toBeInTheDocument();
});

it("groups books by workspace and updates a per-book access override", async () => {
  const put = vi.fn((_init?: RequestInit) =>
    jsonResponse({ book_policy: { default: "read", books: { b1: "hidden" } } }),
  );
  mockApi(consoleRoutes({ "PUT /api/classroom/classes/c1/book-access": put }));
  await openMathClass();

  expect(screen.getByText("Algebra Book")).toBeInTheDocument();
  expect(screen.getByText("Geometry Book")).toBeInTheDocument();
  expect(screen.getAllByText("Extra Workspace").length).toBeGreaterThan(0);

  fireEvent.change(screen.getByRole("combobox", { name: "Algebra Book · Access" }), {
    target: { value: "hidden" },
  });

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(bodyOf(put.mock.calls[0]?.[0] as RequestInit)).toEqual({ books: { b1: "hidden" } });
  expect(await screen.findByText("Book access updated.")).toBeInTheDocument();
});

it("unreferences a non-primary workspace and updates the default book access", async () => {
  const del = vi.fn((_init?: RequestInit) =>
    jsonResponse({ class: mathClass, workspace_ids: ["ws-main"] }),
  );
  const put = vi.fn((_init?: RequestInit) =>
    jsonResponse({ book_policy: { default: "hidden", books: {} } }),
  );
  mockApi(
    consoleRoutes({
      "DELETE /api/classroom/classes/c1/workspaces/ws-extra": del,
      "PUT /api/classroom/classes/c1/book-access": put,
    }),
  );
  await openMathClass();

  fireEvent.click(screen.getAllByRole("button", { name: "Remove workspace" })[1]);
  await waitFor(() => expect(del).toHaveBeenCalledTimes(1));

  fireEvent.change(screen.getByRole("combobox", { name: "Default access" }), {
    target: { value: "hidden" },
  });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(bodyOf(put.mock.calls[0]?.[0] as RequestInit)).toEqual({ default: "hidden" });
});

it("assigns from a workspace-qualified source with source_workspace_id", async () => {
  const post = vi.fn((_init?: RequestInit) =>
    jsonResponse({ results: [{ student_id: "u1", ok: true }] }),
  );
  mockApi({
    "GET /api/classroom/classes/c1/assignments": () => jsonResponse({ assignments: [] }),
    "GET /api/classroom/classes/c1/assignment-sources": () =>
      jsonResponse({
        sources: [
          { kind: "mastery_topic", id: "t-main", name: "Fractions", workspace_id: "ws-main" },
          { kind: "mastery_topic", id: "t-extra", name: "Angles", workspace_id: "ws-extra" },
          { kind: "question_set", id: "7", name: "Warmups", workspace_id: "ws-main" },
        ],
      }),
    "POST /api/classroom/classes/c1/assignments": post,
  });

  render(<AssignmentBoard classId="c1" workspaces={workspaces} members={[member]} />);

  const sourceSelect = await screen.findByRole("combobox", { name: "Source" });
  await waitFor(() => expect(sourceSelect).toHaveTextContent("Fractions · Math P3 Workspace"));
  expect(sourceSelect).toHaveTextContent("Angles · Extra Workspace");
  expect(sourceSelect).not.toHaveTextContent("Warmups");

  const fractionsKey = JSON.stringify(["ws-main", "t-main"]);
  fireEvent.change(sourceSelect, { target: { value: fractionsKey } });
  fireEvent.click(screen.getByRole("button", { name: "Assign to selected" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(bodyOf(post.mock.calls[0]?.[0] as RequestInit)).toEqual({
    kind: "mastery_topic",
    source_id: "t-main",
    source_workspace_id: "ws-main",
    student_ids: ["u1"],
  });
});