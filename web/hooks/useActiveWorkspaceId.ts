'use client'

import { useSearchParams } from 'next/navigation'
import { activeWorkspaceId, isWorkspaceIdStale, workspaceIdOf } from '@/lib/workspace-scope'

/** The workspace this tab is in, for render: the URL's, else the one it stayed in. */
export function useActiveWorkspaceId(): string {
  const named = workspaceIdOf(useSearchParams())
  // A URL can name a workspace that has since been deleted. Treat it as
  // General until the canonicalizer replaces the address, rather than passing
  // the dead scope to every scoped request.
  if (named !== null) return isWorkspaceIdStale(named) ? '' : named
  return activeWorkspaceId()
}
