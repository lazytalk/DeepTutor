import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { SidebarShell } from "@/components/sidebar/SidebarShell";

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
  query: new URLSearchParams(),
  roster: { partners: [], loading: false, error: false } as {
    partners: {
      partner_id: string;
      name: string;
      description: string;
      workspace_id?: string;
      channels: string[];
      running: boolean;
    }[];
    loading: boolean;
    error: boolean;
  },
  auth: {
    enabled: true,
    authenticated: true,
    isAdmin: true,
    role: "teacher",
    userId: "user-1",
    username: "teacher1",
    avatar: "",
    statusAvailable: true,
    loading: false,
    learningPolicy: null,
  },
}));

vi.mock("@/hooks/useAuthStatus", () => ({ useAuthStatus: () => fixture.auth }));
vi.mock("@/hooks/usePartnerRoster", () => ({ usePartnerRoster: () => fixture.roster }));
vi.mock("@/components/layout/AppShell", () => ({
  useSidebarDrawer: () => ({ close: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ logout: fixture.logout }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => fixture.query,
  useRouter: () => ({ push: fixture.push, replace: fixture.replace }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      prefetch: _prefetch,
      children,
      ...props
    }: Omit<ComponentProps<"a">, "prefetch"> & {
      children?: ReactNode;
      prefetch?: boolean;
    }) => React.createElement("a", { href, ...props }, children),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/context/AppShellContext", () => ({
  useAppShell: () => ({ sidebarCollapsed: false, setSidebarCollapsed: vi.fn() }),
}));
vi.mock("@/hooks/useDevice", () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock("@/hooks/useChatWorkspaces", () => ({
  useChatWorkspaces: () => ({
    workspaces: [],
    all: [
      {
        workspace_id: "ws-1",
        kind: "workspace",
        display_name: "Algebra",
        follows_root: false,
        path: "/data/ws-1",
        archived: false,
        created_at: "2026-01-01",
        status: "ready",
        error: "",
      },
    ],
  }),
}));
vi.mock("@/lib/notes-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/notes-api")>();
  return {
    ...original,
    listNotes: vi.fn(async () => ({
      documents: [
        {
          id: "note-1",
          title: "Algebra notes",
          created_at: 1,
          updated_at: 1,
          preview: "",
          parent_id: null,
          icon: "",
          pinned: false,
          revision: 1,
        },
      ],
    })),
  };
});
vi.mock("@/features/capabilities/useCapabilityCatalog", () => ({
  useCapabilityFilter: () => () => true,
}));

const session = {
  id: "session-1",
  session_id: "session-1",
  title: "Retained session",
  created_at: 1,
  updated_at: 1,
  message_count: 1,
  last_message: "Hello",
};

function renderShell() {
  return render(
    <SidebarShell
      showSessions
      sessions={[session]}
      onNewChat={vi.fn()}
      onSelectSession={vi.fn()}
      onRenameSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onOrganizeSession={vi.fn()}
    />,
  );
}

async function pick(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });
}

it("orders Calendar, Classroom and Admin above the workspace dropdown", () => {
  const { container } = renderShell();
  const header = container.querySelector(".dt-sidebar-header")!;
  const primary = header.querySelector(".dt-primary-nav")!;
  const workspace = header.querySelector(".dt-workspace-menu")!;

  expect([...primary.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
    "Calendar",
    "Classroom",
    "Admin",
  ]);
  // The cross-workspace rows sit before the workspace control in the DOM.
  expect(
    primary.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // No visible group headings in the nav area.
  expect(screen.queryByText("navigation.workspace")).toBeNull();
  expect(screen.queryByText("navigation.accountShelf")).toBeNull();
});

it("reveals only the active shelf's sub-menu", async () => {
  renderShell();

  // Home (default): the overview's suggestions, no history.
  expect(screen.getByRole("button", { name: "starters.explain.1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "navigation.newChat" })).toBeNull();
  expect(screen.queryByText("Retained session")).toBeNull();

  await pick("navigation.chat");
  expect(screen.getByRole("button", { name: "navigation.newChat" })).toBeInTheDocument();
  expect(await screen.findByText("Retained session")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "starters.explain.1" })).toBeNull();

  await pick("navigation.resources");
  expect(await screen.findByRole("link", { name: "Notebook" })).toBeInTheDocument();
  expect(screen.queryByText("Retained session")).toBeNull();
  expect(screen.queryByRole("button", { name: "navigation.newChat" })).toBeNull();
});

it("puts new conversation and bound partner chips in Chat, next to history", async () => {
  fixture.query = new URLSearchParams("dt_workspace=ws-1");
  fixture.roster = {
    loading: false,
    error: false,
    partners: [
      {
        partner_id: "ada",
        name: "Ada",
        description: "",
        workspace_id: "ws-1",
        channels: [],
        running: true,
      },
    ],
  };
  renderShell();
  await pick("navigation.chat");

  expect(screen.getByRole("button", { name: "navigation.newChat" })).toBeInTheDocument();
  expect(screen.getByText("Partners in this workspace")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ada/ })).toHaveAttribute("href", "/partners/ada");
  expect(await screen.findByText("Retained session")).toBeInTheDocument();
  fixture.query = new URLSearchParams();
  fixture.roster = { loading: false, error: false, partners: [] };
});

it("keeps Resources to its own entries, with no chat history and no Notebook shelf icon", async () => {
  renderShell();
  await pick("navigation.resources");

  expect(await screen.findByRole("link", { name: "Notebook" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Learning journal" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Question Bank" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Knowledge Center" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /navigation.allResources/ })).toBeInTheDocument();

  expect(screen.queryByRole("link", { name: /Chat History/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /navigation.chatRecords/ })).toBeNull();
  expect(document.querySelector('a[href="/space/chat-history"]')).toBeNull();
  // The saved-records Notebook may be a sub-menu row, but never an
  // icons-row shelf: /co-writer owns that shelf as Co-Writer.
  expect(screen.queryByRole("tab", { name: /Notebook/ })).toBeNull();
  expect(screen.queryByRole("tab", { name: /Favorites/ })).toBeNull();
});

it("gives Task Board and Co-Writer their own shelves", async () => {
  renderShell();

  await pick("navigation.taskBoard");
  expect(screen.getByRole("link", { name: /Open board/ })).toHaveAttribute("href", "/kanban");
  expect(screen.getByRole("link", { name: "kanban.todo" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "kanban.doing" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "kanban.done" })).toBeInTheDocument();
  // They are no longer rows of the Home overview.
  expect(screen.queryByRole("link", { name: "Task Board" })).toBeNull();

  await pick("navigation.notebook");
  expect(await screen.findByRole("link", { name: "Algebra notes" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /navigation.allNotebooks/ })).toHaveAttribute(
    "href",
    "/co-writer",
  );
});

it("puts sign out on the left and Settings on the right of one footer row", () => {
  const { container } = renderShell();
  const row = container.querySelector(".dt-sidebar-footer-row")!;
  const signOut = screen.getByRole("button", { name: "Sign out" });
  const settings = screen.getByRole("link", { name: "Settings" });

  expect(row).toContainElement(signOut);
  expect(row).toContainElement(settings);
  expect(row.firstElementChild).toContainElement(signOut);
  expect(row.lastElementChild).toContainElement(settings);
});