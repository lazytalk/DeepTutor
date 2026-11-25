import type { PartnerInfo } from "@/lib/partners-api";

export type PartnerWorkspaceBucket = "this" | "other" | "unbound" | "all";

export interface PartnerWorkspaceGroups {
  /** Partners explicitly bound to the workspace this tab is in. */
  here: PartnerInfo[];
  /** Partners bound to a different workspace. */
  other: PartnerInfo[];
  /** Partners with no binding (and assigned partners, whose card omits it). */
  unbound: PartnerInfo[];
}

/**
 * Partition partners by their content-workspace binding. An empty binding is
 * "unbound", not General: partners only follow a workspace when their config
 * names one. General therefore has no "this workspace" bucket.
 */
export function groupPartnersByWorkspace(
  partners: PartnerInfo[],
  activeWorkspaceId: string,
): PartnerWorkspaceGroups {
  const here = activeWorkspaceId
    ? partners.filter((partner) => partner.workspace_id === activeWorkspaceId)
    : [];
  const other = partners.filter(
    (partner) =>
      Boolean(partner.workspace_id) && partner.workspace_id !== activeWorkspaceId,
  );
  const unbound = partners.filter((partner) => !partner.workspace_id);
  return { here, other, unbound };
}

/** Start on the workspace's own partners; General has none, so show all. */
export function defaultPartnerWorkspaceBucket(
  activeWorkspaceId: string,
): PartnerWorkspaceBucket {
  return activeWorkspaceId ? "this" : "all";
}

export function partnersInBucket(
  partners: PartnerInfo[],
  groups: PartnerWorkspaceGroups,
  bucket: PartnerWorkspaceBucket,
): PartnerInfo[] {
  if (bucket === "this") return groups.here;
  if (bucket === "other") return groups.other;
  if (bucket === "unbound") return groups.unbound;
  return partners;
}