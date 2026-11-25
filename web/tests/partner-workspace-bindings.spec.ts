import { describe, expect, it } from "vitest";
import type { PartnerInfo } from "@/lib/partners-api";
import {
  defaultPartnerWorkspaceBucket,
  groupPartnersByWorkspace,
  partnersInBucket,
} from "@/lib/partner-workspace-bindings";

const partner = (partner_id: string, workspace_id?: string): PartnerInfo =>
  ({
    partner_id,
    name: partner_id,
    description: "",
    channels: [],
    running: true,
    started_at: null,
    workspace_id,
  }) as PartnerInfo;

describe("partner workspace bindings", () => {
  const partners = [
    partner("here", "ws-1"),
    partner("other", "ws-2"),
    partner("unbound"),
  ];

  it("partitions partners into this workspace, other workspaces and unbound", () => {
    const groups = groupPartnersByWorkspace(partners, "ws-1");
    expect(groups.here.map((row) => row.partner_id)).toEqual(["here"]);
    expect(groups.other.map((row) => row.partner_id)).toEqual(["other"]);
    expect(groups.unbound.map((row) => row.partner_id)).toEqual(["unbound"]);
  });

  it("has no 'this workspace' bucket in General", () => {
    const groups = groupPartnersByWorkspace(partners, "");
    expect(groups.here).toEqual([]);
    expect(groups.other.map((row) => row.partner_id)).toEqual(["here", "other"]);
    expect(groups.unbound.map((row) => row.partner_id)).toEqual(["unbound"]);
  });

  it("defaults to the current workspace, and to all in General", () => {
    expect(defaultPartnerWorkspaceBucket("ws-1")).toBe("this");
    expect(defaultPartnerWorkspaceBucket("")).toBe("all");
  });

  it("filters the directory by the selected bucket", () => {
    const groups = groupPartnersByWorkspace(partners, "ws-1");
    expect(partnersInBucket(partners, groups, "this").map((row) => row.partner_id)).toEqual(["here"]);
    expect(partnersInBucket(partners, groups, "other").map((row) => row.partner_id)).toEqual(["other"]);
    expect(partnersInBucket(partners, groups, "unbound").map((row) => row.partner_id)).toEqual(["unbound"]);
    expect(partnersInBucket(partners, groups, "all")).toHaveLength(3);
  });
});