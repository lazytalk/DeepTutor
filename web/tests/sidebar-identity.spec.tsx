import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/sidebar/AccountMenu";
import { SidebarSignOut } from "@/components/sidebar/SidebarShell";
import { WorkspaceMenu } from "@/components/sidebar/WorkspaceMenu";
import { WorkspacePartners } from "@/components/sidebar/WorkspacePartners";
import {
  CATEGORIES,
  CategoryTabs,
  PrimaryDestinations,
} from "@/components/sidebar/CategoryNavigation";
import { registerWorkspaceNavigator } from "@/lib/workspace-scope";

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
// A plain anchor: Next's Link schedules an idle prefetch that would update
// after these tests have finished (and trip the act warning guard).
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      prefetch: _prefetch,
      children,
      ...props
    }: {
      href: string;
      prefetch?: boolean;
      children?: ReactNode;
      [key: string]: unknown;
    }) => React.createElement("a", { href, ...props }, children),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
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
      {
        workspace_id: "class-1",
        kind: "workspace",
        display_name: "Grade 7",
        follows_root: false,
        path: "/data/class-1",
        archived: false,
        created_at: "2026-01-01",
        status: "ready",
        error: "",
        shared: true,
      },
    ],
  }),
}));

it("makes the account identity a link to Personalization, with no dropdown", () => {
  const { container } = render(<AccountMenu />);
  expect(screen.getByText("teacher1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "teacher1" })).toHaveAttribute(
    "href",
    "/personalization",
  );
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(container.textContent).not.toMatch(/v\d+\.\d+/);
});

it("sends the collapsed rail's avatar to Personalization too", () => {
  const { container } = render(<AccountMenu compact />);
  const identity = container.querySelector(".dt-account-identity");
  expect(identity).toHaveAttribute("aria-label", "teacher1");
  expect(identity).toHaveAttribute("href", "/personalization");
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
});

it("signs out from the sidebar footer", async () => {
  render(<SidebarSignOut />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(fixture.logout).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(fixture.replace).toHaveBeenCalledWith("/login"));
});

it("keeps workspace choices and Manage workspaces in the workspace menu only", () => {
  render(<WorkspaceMenu />);

  fireEvent.click(screen.getByRole("button", { name: "Manage workspaces" }));
  const menu = screen.getByRole("menu", { name: "Manage workspaces" });

  expect(within(menu).getByRole("menuitem", { name: "General workspace" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(menu).getByRole("menuitem", { name: "Algebra" })).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: /Grade 7/ })).toHaveTextContent("Shared class");
  expect(within(menu).getByRole("menuitem", { name: "Manage workspaces" })).toHaveAttribute(
    "href",
    "/settings/workspace",
  );
  expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  expect(within(menu).queryByRole("menuitem", { name: "Settings" })).toBeNull();
});

it("splits the workspace row: the name opens its Chat home, the chevron the switcher", async () => {
  const unregister = registerWorkspaceNavigator(fixture.push);
  fixture.push.mockClear();
  render(<WorkspaceMenu />);

  const home = screen.getByRole("link", { name: "General workspace" });
  expect(home).toHaveAttribute("href", "/chat?dt_workspace=");
  fireEvent.click(home);
  await vi.waitFor(() => expect(fixture.push).toHaveBeenCalledWith("/chat?dt_workspace="));
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Manage workspaces" }));
  expect(screen.getByRole("menu", { name: "Manage workspaces" })).toBeInTheDocument();
  unregister();
});

it("lands a workspace choice on that workspace's Chat home", async () => {
  const unregister = registerWorkspaceNavigator(fixture.push);
  fixture.push.mockClear();
  render(<WorkspaceMenu />);

  fireEvent.click(screen.getByRole("button", { name: "Manage workspaces" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Algebra" }));
  });
  await vi.waitFor(() => expect(fixture.push).toHaveBeenCalledWith("/chat?dt_workspace=ws-1"));

  // Shared class workspaces keep the classroom exception.
  fireEvent.click(screen.getByRole("button", { name: "Manage workspaces" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: /Grade 7/ }));
  });
  await vi.waitFor(() =>
    expect(fixture.push).toHaveBeenCalledWith("/classroom?dt_workspace=class-1"),
  );
  unregister();
});

it("lists only the partners bound to the current workspace", () => {
  fixture.query = new URLSearchParams("dt_workspace=ws-1");
  fixture.roster = {
    loading: false,
    error: false,
    partners: [
      { partner_id: "ada", name: "Ada", description: "", workspace_id: "ws-1", channels: [], running: true },
      { partner_id: "bob", name: "Bob", description: "", workspace_id: "ws-2", channels: [], running: true },
      { partner_id: "solo", name: "Solo", description: "", channels: [], running: false },
    ],
  };
  render(<WorkspacePartners />);

  expect(screen.getByText("Partners in this workspace")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ada/ })).toHaveAttribute("href", "/partners/ada");
  expect(screen.queryByText("Bob")).toBeNull();
  expect(screen.queryByText("Solo")).toBeNull();
  fixture.query = new URLSearchParams();
  fixture.roster = { loading: false, error: false, partners: [] };
});

it("hides the workspace partner list when nothing is bound here", () => {
  fixture.query = new URLSearchParams("dt_workspace=ws-1");
  fixture.roster = { loading: false, error: false, partners: [] };
  const { container } = render(<WorkspacePartners />);
  expect(container).toBeEmptyDOMElement();
  fixture.query = new URLSearchParams();
});

it("orders cross-workspace destinations Calendar, Classroom, Admin for a teacher", () => {
  fixture.auth.isAdmin = false;
  fixture.auth.role = "teacher";
  render(<PrimaryDestinations collapsed={false} />);

  expect(screen.getByRole("link", { name: "Classroom" })).toHaveAttribute("href", "/classroom");
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
  expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  expect(
    screen.getAllByRole("link").map((link) => link.textContent),
  ).toEqual(["Calendar", "Classroom"]);
  fixture.auth.isAdmin = true;
  fixture.auth.role = "admin";
});

it("keeps Calendar first-level for a plain account too", () => {
  fixture.auth.isAdmin = false;
  fixture.auth.role = "user";
  render(<PrimaryDestinations collapsed={false} />);

  expect(screen.queryByRole("link", { name: "Classroom" })).toBeNull();
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
  fixture.auth.isAdmin = true;
  fixture.auth.role = "teacher";
});

it("orders Calendar, Classroom and Admin first-level for an admin", () => {
  fixture.auth.isAdmin = true;
  fixture.auth.role = "admin";
  const { container } = render(<PrimaryDestinations collapsed={false} />);

  expect(screen.getByRole("link", { name: "Classroom" })).toHaveAttribute("href", "/classroom");
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/users");
  const labels = [...container.querySelectorAll("a")].map((link) => link.textContent);
  expect(labels).toEqual(["Calendar", "Classroom", "Admin"]);
  fixture.auth.isAdmin = true;
  fixture.auth.role = "teacher";
});

it("shows six shelves, with only the active one printing its name", () => {
  type CategoryId = (typeof CATEGORIES)[number]["id"];
  const nav = {
    category: "home" as CategoryId,
    categories: [...CATEGORIES],
    select: vi.fn(),
    allowedSurfaces: null,
  };
  const { container } = render(<CategoryTabs nav={nav} collapsed={false} />);

  const order = [...container.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.getAttribute("aria-label"),
  );
  expect(order).toEqual([
    "navigation.home",
    "navigation.chat",
    "navigation.learning",
    "navigation.resources",
    "navigation.taskBoard",
    "navigation.notebook",
  ]);
  expect(screen.getByRole("tab", { name: "navigation.home" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Active expands to icon + label; the rest are icon-only.
  expect(
    [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
  ).toEqual(["navigation.home", "", "", "", "", ""]);
  // The saved-records Notebook is not an icon — it lives under Resources only.
  expect(screen.queryByRole("tab", { name: /Favorites/ })).toBeNull();
  // The account shelf is gone.
  expect(container.querySelector(".dt-category-account-divider")).toBeNull();
  expect(screen.queryByRole("tab", { name: "navigation.personalization" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "navigation.partners" })).toBeNull();
});

it("switches the active shelf when an icon is picked", () => {
  type CategoryId = (typeof CATEGORIES)[number]["id"];
  const nav = {
    category: "home" as CategoryId,
    categories: [...CATEGORIES],
    select: vi.fn(),
    allowedSurfaces: null,
  };
  render(<CategoryTabs nav={nav} collapsed={false} />);

  fireEvent.click(screen.getByRole("tab", { name: "navigation.chat" }));
  expect(nav.select).toHaveBeenCalledWith("chat");
  expect(fixture.push).not.toHaveBeenCalled();
});