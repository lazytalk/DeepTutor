'use client'

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspaceId } from '@/hooks/useActiveWorkspaceId'
import { useChatWorkspaces } from '@/hooks/useChatWorkspaces'
import { selectWorkspace } from '@/lib/workspace-scope'
import { categoryForPath } from '@/lib/navigation'

/**
 * Where the workspace picker lands after a switch.
 *
 * A workspace's home is its Chat: the selector is a scope switch, not a
 * "keep me on this book but in another store" move. Account-level pages are
 * the same on both sides, so they stay put. A shared class workspace has no
 * chat surface of its own — it opens the classroom console instead.
 */
export function workspaceSwitchDestination(pathname: string, shared = false): string {
  if (shared) return '/classroom'
  return ['partners', 'settings', 'calendar', 'personalization', 'admin'].includes(
    categoryForPath(pathname),
  )
    ? pathname
    : '/chat'
}

/** The destination behind the workspace name (the chevron opens the menu). */
export function workspaceHomeDestination(shared = false): string {
  return shared ? '/classroom' : '/chat'
}

/** The workspace this URL is scoped to, the ones it can switch to, and the switch. */
export function useWorkspaceChoices() {
  const { t } = useTranslation()
  const pathname = usePathname() ?? '/'
  const active = useActiveWorkspaceId()
  const { all } = useChatWorkspaces()
  const current = all.find(row => row.workspace_id === active)
  const currentName = active ? (current?.display_name ?? t('Workspace unavailable')) : t('General workspace')
  const choices = [
    { workspace_id: '', display_name: t('General workspace'), shared: false },
    ...all.filter(row => row.workspace_id === active || (!row.archived && row.status === 'ready')),
  ]
  const choose = (workspaceId: string) => {
    if (workspaceId === active) return
    const row = all.find(item => item.workspace_id === workspaceId)
    // A workspace choice lands on that workspace's Chat home. Shared class
    // workspaces still open the classroom console instead.
    void selectWorkspace(workspaceId, workspaceSwitchDestination(pathname, row?.shared))
  }
  /** The name click: open this workspace's home without touching the menu. */
  const openHome = (workspaceId = active) => {
    const row = all.find(item => item.workspace_id === workspaceId)
    void selectWorkspace(workspaceId, workspaceHomeDestination(row?.shared))
  }
  // The name half of the split control still works as a real link (middle
  // click, copy address); a shared class workspace has the classroom instead.
  const homeHref =
    current?.shared === true
      ? `/classroom?dt_workspace=${encodeURIComponent(active)}`
      : `/chat?dt_workspace=${encodeURIComponent(active)}`
  return { active, currentName, choices, choose, openHome, homeHref }
}
