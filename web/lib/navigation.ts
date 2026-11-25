/** Product grouping only. Existing URLs and persisted records remain authoritative. */
import type { SessionSummary } from '@/lib/session-api'
import { sessionRoute } from '@/lib/mastery-session'
export type NavigationCategory =
  | 'home'
  | 'chat'
  | 'learning'
  | 'resources'
  | 'task_board'
  | 'notebook'
  | 'partners'
  | 'settings'
  | 'calendar'
  | 'personalization'
  | 'admin'
/** Account-level places: the same in every workspace. */
export const PERSONALIZATION_ROOTS = [
  '/personalization',
  // The profile lives inside the personalization hub: it is the "you" half
  // of "you + your AI", so the shelf stays selected while editing it.
  '/profile',
  '/agents',
  '/space/personas',
  '/space/skills',
  '/space/mcp',
  '/space/cli-apps',
  '/memory',
] as const
const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`)
export function categoryForPath(pathname: string): NavigationCategory {
  if (under(pathname, '/partners')) return 'partners'
  if (under(pathname, '/settings')) return 'settings'
  if (under(pathname, '/calendar')) return 'calendar'
  if (under(pathname, '/admin')) return 'admin'
  if (PERSONALIZATION_ROOTS.some(root => under(pathname, root))) return 'personalization'
  // The blank /chat is the workspace overview (Home); an open conversation
  // belongs to Chat, so its history stays selected while it is being read.
  if (pathname === '/chat') return 'home'
  if (pathname.startsWith('/chat/')) return 'chat'
  if (under(pathname, '/kanban')) return 'task_board'
  // Manuscript (the writing canvas) is /co-writer; /notebooks is the saved
  // records "Highlights" collection and lives in Resources, not its own shelf.
  if (under(pathname, '/co-writer')) return 'notebook'
  if (
    pathname === '/learning' ||
    pathname.startsWith('/learning/')
  )
    return 'learning'
  if (['/space', '/notebooks', '/knowledge-bases'].some(root => under(pathname, root)))
    return 'resources'
  return 'home'
}
export function isLearningSession(session: SessionSummary): boolean {
  return categoryForPath(sessionRoute(session).split('?')[0]) === 'learning'
}
export function partnerSessionHref(session: {
  kind: 'partner' | 'group'
  owner_id: string
  session_key: string
}): string {
  const root = session.kind === 'group' ? '/partners/groups' : '/partners'
  return `${root}/${encodeURIComponent(session.owner_id)}?${new URLSearchParams({ session: session.session_key })}`
}

/** Query identities matter: practice items share a page but not a record. */
export function isNavigationTargetActive(
  href: string,
  pathname: string,
  search: URLSearchParams
): boolean {
  const target = new URL(href, 'http://localhost')
  const workspace = target.searchParams.get('dt_workspace') ?? target.searchParams.get('workspace')
  const currentWorkspace = search.get('dt_workspace') ?? search.get('workspace') ?? ''
  return (
    (pathname === target.pathname || pathname.startsWith(`${target.pathname}/`)) &&
    (workspace === null || workspace === currentWorkspace) &&
    [...target.searchParams].every(
      ([key, value]) => key === 'dt_workspace' || key === 'workspace' || search.get(key) === value
    )
  )
}
