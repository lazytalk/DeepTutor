import { beforeEach, expect, it, vi } from "vitest";
import {
  activeWorkspaceId,
  forgetWorkspaceId,
  isWorkspaceIdStale,
  navigateTask,
  reconcileWorkspaceId,
  reconcileWorkspaceScope,
  rememberWorkspaceId,
  scopedUrl,
} from "@/lib/workspace-scope";
import { apiUrl, wsUrl } from "@/lib/api";

const registry = vi.hoisted(() => ({
  rows: [] as { workspace_id: string; kind: string }[],
  offline: false,
}));

vi.mock("@/lib/workspaces-api", () => ({
  listWorkspaces: vi.fn(async () => {
    if (registry.offline) throw new Error("registrations unavailable");
    return registry.rows;
  }),
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  registry.rows = [
    { workspace_id: "ws_live", kind: "workspace" },
    { workspace_id: "ws_other", kind: "workspace" },
  ];
  registry.offline = false;
  window.history.replaceState(null, "", "/learning?dt_workspace=");
  activeWorkspaceId();
  // Reset the tab's in-memory scope between tests.
  forgetWorkspaceId("");
});

it("uses the default workspace and keeps explicitly scoped URLs immutable", () => {
  expect(activeWorkspaceId()).toBe("");
  expect(apiUrl("/api/reading/materials")).toBe("/api/reading/materials?dt_workspace=");
  const fixed = scopedUrl("/files/attachments/a/b/file.pdf", "ws_a");
  window.history.replaceState(null, "", "/learning?dt_workspace=ws_b");
  expect(scopedUrl(fixed)).toBe(fixed);
});

it("stays in the tab's workspace when a URL names none, and pins sockets", () => {
  window.history.replaceState(null, "", "/learning?dt_workspace=ws_a");
  expect(activeWorkspaceId()).toBe("ws_a");
  const socket = wsUrl("/ws");
  window.history.replaceState(null, "", "/learning/books");
  expect(activeWorkspaceId()).toBe("ws_a");
  expect(apiUrl("/api/books")).toBe("/api/books?dt_workspace=ws_a");
  // Only an explicit scope leaves it, General included.
  window.history.replaceState(null, "", "/learning?dt_workspace=");
  expect(activeWorkspaceId()).toBe("");
  window.history.replaceState(null, "", "/chat");
  expect(activeWorkspaceId()).toBe("");
  expect(socket).toBe("/ws?dt_workspace=ws_a");
});

it("does not append workspace identity to external or signed URLs", () => {
  expect(scopedUrl("https://example.org/video?signature=abc", "ws_a")).toBe("https://example.org/video?signature=abc");
  expect(scopedUrl("//example.org/video", "ws_a")).toBe("//example.org/video");
});

it("pins same-origin absolute URLs and honors legacy workspace links", () => {
  expect(scopedUrl(`${window.location.origin}/api/books`, "ws_a"))
    .toBe(`${window.location.origin}/api/books?dt_workspace=ws_a`);
  expect(scopedUrl("/chat?workspace=ws_b", "ws_a"))
    .toBe("/chat?workspace=ws_b&dt_workspace=ws_b");
});

it("keeps bare task navigation in the current workspace", () => {
  window.history.replaceState(null, "", "/chat?dt_workspace=ws_a");
  const push = vi.fn();
  navigateTask("/kanban", push);
  expect(push).toHaveBeenCalledWith("/kanban?dt_workspace=ws_a");
});

it("records the last workspace for the next fresh tab", () => {
  rememberWorkspaceId("ws_last");
  expect(localStorage.getItem("deeptutor:workspace")).toBe("ws_last");
  expect(sessionStorage.getItem("deeptutor:workspace")).toBe("ws_last");
});

it("forgets a remembered workspace that no longer exists", async () => {
  window.history.replaceState(null, "", "/classroom");
  rememberWorkspaceId("ws_gone_1");
  expect(activeWorkspaceId()).toBe("ws_gone_1");

  expect(await reconcileWorkspaceId("ws_gone_1")).toBe(true);
  expect(activeWorkspaceId()).toBe("");
  expect(isWorkspaceIdStale("ws_gone_1")).toBe(true);
  expect(localStorage.getItem("deeptutor:workspace")).toBe("");
  expect(sessionStorage.getItem("deeptutor:workspace")).toBe("");
});

it("keeps a remembered workspace the registrations still list", async () => {
  window.history.replaceState(null, "", "/classroom");
  rememberWorkspaceId("ws_live");
  expect(await reconcileWorkspaceScope()).toBe(false);
  expect(activeWorkspaceId()).toBe("ws_live");
  expect(localStorage.getItem("deeptutor:workspace")).toBe("ws_live");
});

it("leaves the scope alone when the registrations cannot be read", async () => {
  window.history.replaceState(null, "", "/classroom");
  rememberWorkspaceId("ws_offline");
  registry.offline = true;
  expect(await reconcileWorkspaceScope()).toBe(false);
  expect(activeWorkspaceId()).toBe("ws_offline");
  expect(localStorage.getItem("deeptutor:workspace")).toBe("ws_offline");
});

it("treats a fallback as idempotent and ignores the stale URL scope", async () => {
  window.history.replaceState(null, "", "/classroom?dt_workspace=ws_gone_2");
  registry.rows = [{ workspace_id: "ws_live", kind: "workspace" }];
  expect(await reconcileWorkspaceScope()).toBe(true);
  expect(activeWorkspaceId()).toBe("");
  expect(await reconcileWorkspaceScope()).toBe(false);
});
