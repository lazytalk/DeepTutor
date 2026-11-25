import { browserStorage } from '@/shared/storage'

/**
 * The content workspace this tab is in.
 *
 * A URL that names a workspace (`dt_workspace`, including the empty value for
 * General) selects it; a URL that names none stays where the tab already is.
 * Links therefore never need to carry the scope to stay put, and leaving a
 * workspace is always an explicit act. A fresh tab resumes the last workspace
 * used in this browser.
 */
const STORAGE_KEY = 'deeptutor:workspace'

let remembered: string | null = null

/** Scopes confirmed to name a workspace that no longer exists. */
const staleWorkspaceIds = new Set<string>()

function storedWorkspaceId(): string {
  remembered ??=
    browserStorage.readRaw('session', STORAGE_KEY) ?? browserStorage.readRaw('local', STORAGE_KEY) ?? ''
  return remembered
}

/** Record the scope a URL selected, for this tab and for the next fresh one. */
export function rememberWorkspaceId(workspaceId: string): void {
  if (workspaceId) staleWorkspaceIds.delete(workspaceId)
  if (remembered === workspaceId) return
  remembered = workspaceId
  // Unavailable storage (private mode) only costs the next fresh tab its resume.
  browserStorage.writeRaw('session', STORAGE_KEY, workspaceId)
  browserStorage.writeRaw('local', STORAGE_KEY, workspaceId)
}

/**
 * Drop the stored scope after its workspace disappeared. The id stays marked
 * stale so a URL that keeps naming it cannot re-apply it while the browser
 * navigates back to General.
 */
export function forgetWorkspaceId(workspaceId: string = remembered ?? ''): void {
  if (workspaceId) staleWorkspaceIds.add(workspaceId)
  remembered = ''
  browserStorage.writeRaw('session', STORAGE_KEY, '')
  browserStorage.writeRaw('local', STORAGE_KEY, '')
}

/** A scope already proven missing, so callers can ignore it without a fetch. */
export function isWorkspaceIdStale(workspaceId: string): boolean {
  return workspaceId !== '' && staleWorkspaceIds.has(workspaceId)
}

/** The workspace a URL names explicitly, or null when it names none. */
export function workspaceIdOf(search: URLSearchParams): string | null {
  return search.get('dt_workspace') ?? search.get('workspace')
}

export function activeWorkspaceId(): string {
  if (typeof window === 'undefined') return ''
  const named = workspaceIdOf(new URLSearchParams(window.location.search))
  if (named !== null) {
    if (isWorkspaceIdStale(named)) return ''
    rememberWorkspaceId(named)
    return named
  }
  const stored = storedWorkspaceId()
  return isWorkspaceIdStale(stored) ? '' : stored
}

let validation: Promise<ReadonlySet<string> | null> | null = null

/** The account's registered workspace ids, or null when the list is unreachable. */
function registeredWorkspaceIds(): Promise<ReadonlySet<string> | null> {
  validation ??= (async () => {
    try {
      const { listWorkspaces } = await import('./workspaces-api')
      const rows = await listWorkspaces()
      return new Set(rows.filter(row => row.kind === 'workspace').map(row => row.workspace_id))
    } catch {
      return null
    } finally {
      validation = null
    }
  })()
  return validation
}

/**
 * Whether a non-empty scope still names a registered workspace. `null` means
 * the registrations could not be read, so callers must not treat it as gone.
 */
export async function workspaceExists(workspaceId: string): Promise<boolean | null> {
  if (!workspaceId) return true
  const known = await registeredWorkspaceIds()
  return known === null ? null : known.has(workspaceId)
}

/**
 * Clear the stored scope when it names a workspace that no longer exists.
 * Returns true when the caller should fall back to General.
 *
 * Idempotent: a second pass finds an empty scope and does nothing.
 */
export async function reconcileWorkspaceId(workspaceId: string): Promise<boolean> {
  if (!workspaceId) return false
  if ((await workspaceExists(workspaceId)) !== false) return false
  // Only the scope this tab is actually in should be forgotten; a stale id
  // named by an old link must not reset a tab that moved elsewhere.
  const current =
    typeof window === 'undefined'
      ? remembered
      : workspaceIdOf(new URLSearchParams(window.location.search)) ?? storedWorkspaceId()
  if (current === workspaceId) forgetWorkspaceId(workspaceId)
  else staleWorkspaceIds.add(workspaceId)
  return true
}

/** Reconcile whichever scope this tab is currently in (URL first, then storage). */
export async function reconcileWorkspaceScope(): Promise<boolean> {
  return reconcileWorkspaceId(activeWorkspaceId())
}

export function scopedUrl(path: string, workspaceId = activeWorkspaceId()): string {
  // Never attach local identity to third-party URLs (including signed media).
  const origin = typeof window === 'undefined' ? 'http://workspace.local' : window.location.origin
  if (path.startsWith('//')) return path
  const absolute = /^https?:\/\//.test(path)
  if (!path.startsWith('/') && !absolute) return path
  const url = new URL(path, origin)
  if (url.origin !== origin) return path
  if (!url.searchParams.has('dt_workspace'))
    url.searchParams.set('dt_workspace', url.searchParams.get('workspace') ?? workspaceId)
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
}

/**
 * The same target pinned to General. Used when a scope turns out to be stale:
 * the request is retried instead of surfacing the 404 it would otherwise earn.
 */
export function generalScopedUrl(path: string): string {
  const origin = typeof window === 'undefined' ? 'http://workspace.local' : window.location.origin
  if (path.startsWith('//')) return path
  const absolute = /^https?:\/\//.test(path)
  if (!path.startsWith('/') && !absolute) return path
  const url = new URL(path, origin)
  if (url.origin !== origin) return path
  url.searchParams.set('dt_workspace', '')
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
}

let navigate: ((path: string) => void) | undefined
let navigationVersion = 0

/** Installed by the root navigation bridge; callers need no router singleton. */
export function registerWorkspaceNavigator(push: (path: string) => void): () => void {
  navigate = push
  return () => { if (navigate === push) navigate = undefined }
}

export async function selectWorkspace(
  workspaceId: string,
  destination = '/learning',
  options?: { beforeNavigate?: () => Promise<void> }
): Promise<void> {
  const version = ++navigationVersion
  const pending: Promise<void>[] = []
  window.dispatchEvent(new CustomEvent('deeptutor:before-workspace-switch', { detail: pending }))
  try {
    await Promise.all(pending)
    if (version !== navigationVersion) return
    await options?.beforeNavigate?.()
  } catch {
    const { notify } = await import('./notifications')
    const { default: i18n } = await import('i18next')
    notify(i18n.t('Could not save the draft. Free browser storage before switching workspaces.'), { tone: 'error' })
    window.dispatchEvent(new CustomEvent('deeptutor:workspace-switch-error'))
    return
  }
  if (version !== navigationVersion) return
  // Next owns navigation. The workspace layout resets only scoped runtimes;
  // the document, account settings and loaded assets stay in place.
  const url = new URL(scopedUrl(destination, workspaceId), window.location.origin)
  navigate?.(`${url.pathname}${url.search}${url.hash}`)
}

/** Keep live runtimes when staying in one store; reset them before crossing stores. */
export function navigateTask(path: string, push: (path: string) => void): void {
  const url = new URL(path, window.location.origin)
  const target = workspaceIdOf(url.searchParams)
  if (target === null || target === activeWorkspaceId()) push(scopedUrl(path))
  else void selectWorkspace(target, path)
}
