import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PenLine } from "lucide-react";

import { CommandPalette } from "@/components/sidebar/CommandPalette";
import { initI18n } from "@/i18n/init";
import type { SessionSummary } from "@/lib/session-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/capabilities/useCapabilityCatalog", () => ({
  useCapabilityFilter: () => null,
}));
vi.mock("@/hooks/useLearningIndex", () => ({
  useLearningIndex: () => ({
    sources: { books: [], mastery: [], reading: [], watching: [], practice: [] },
  }),
}));
vi.mock("@/hooks/usePartnerNavigation", () => ({
  usePartnerNavigation: () => ({
    data: { partners: [], groups: [] },
  }),
}));

initI18n("en");

Element.prototype.scrollIntoView = vi.fn();

function session(
  id: string,
  preferences: SessionSummary["preferences"],
  title = id,
): SessionSummary {
  return {
    id,
    session_id: id,
    title,
    created_at: 1,
    updated_at: 1,
    message_count: 1,
    last_message: "",
    preferences,
  };
}

it("finds a Little Tutor thread from another conversation", () => {
  render(
    <CommandPalette
      open
      onClose={vi.fn()}
      categories={[]}
      allowedSurfaces={null}
      sessions={[
        session("parent", { session_kind: "chat" }, "Fork and exec"),
        session(
          "thread",
          { session_kind: "selection_tutor", parent_session_id: "parent" },
          "Why fork returns twice",
        ),
      ]}
      onSelectSession={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );

  expect(screen.getByText("Little Tutor")).toBeTruthy();
  expect(screen.getByText("Why fork returns twice")).toBeTruthy();
  expect(screen.getAllByText("Fork and exec").length).toBeGreaterThan(0);
});

it("matches only the current names — no Favorites or Notebook aliases", () => {
  render(
    <CommandPalette
      open
      onClose={vi.fn()}
      categories={[
        { id: "notebook", label: "navigation.manuscript", href: "/co-writer", icon: PenLine },
      ]}
      allowedSurfaces={null}
      sessions={[]}
      onSelectSession={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );

  const input = screen.getByRole("combobox");
  // Legacy aliases no longer resolve to anything.
  for (const legacy of ["Favorites", "Notebook", "Co-Writer", "Books"]) {
    fireEvent.change(input, { target: { value: legacy } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  }

  fireEvent.change(input, { target: { value: "Highlights" } });
  let names = screen.getAllByRole("option").map(option => option.textContent);
  expect(names.some(name => name?.includes("Highlights"))).toBe(true);

  fireEvent.change(input, { target: { value: "Manuscript" } });
  names = screen.getAllByRole("option").map(option => option.textContent);
  expect(names.some(name => name?.includes("Manuscript"))).toBe(true);
  expect(names.some(name => name?.includes("Notebook"))).toBe(false);
});
