'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  activeWorkspaceId,
  forgetWorkspaceId,
  registerWorkspaceNavigator,
  rememberWorkspaceId,
  scopedUrl,
  selectWorkspace,
  workspaceExists,
  workspaceIdOf,
} from '@/lib/workspace-scope'

const currentUrl = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`

/**
 * Write the tab's workspace into any URL that arrived without one, so the
 * address can be copied and every query-reading surface sees the same scope.
 * A remembered workspace that no longer exists is forgotten before it can be
 * applied, and the tab falls back to General once.
 */
function ScopeCanonicalizer() {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams()
  const named = workspaceIdOf(query)
  useEffect(() => {
    let alive = true
    const fallBack = () => {
      void selectWorkspace('', `/${window.location.pathname.split('/')[1] || 'chat'}`)
    }
    // An explicit empty scope is the General workspace — authoritative.
    if (named === '') {
      rememberWorkspaceId('')
      return
    }
    if (named !== null) {
      void workspaceExists(named).then(exists => {
        if (!alive) return
        if (exists === false) {
          forgetWorkspaceId(named)
          fallBack()
          return
        }
        // Only persist a scope the registrations list vouches for; the URL
        // still names it either way, so nothing is lost if the list is down.
        rememberWorkspaceId(named)
      })
      return () => { alive = false }
    }
    const remembered = activeWorkspaceId()
    if (!remembered) {
      router.replace(scopedUrl(currentUrl()))
      return () => { alive = false }
    }
    // Validate before the remembered id is written into the address, so a
    // deleted workspace is never propagated as ?dt_workspace=<stale>.
    void workspaceExists(remembered).then(exists => {
      if (!alive) return
      if (exists === false) {
        forgetWorkspaceId(remembered)
        fallBack()
        return
      }
      router.replace(scopedUrl(currentUrl()))
    })
    return () => { alive = false }
  }, [named, pathname, router])
  return null
}

/** Cross-store navigation disposes client runtimes. Only a link that names a workspace leaves this one. */
export function WorkspaceNavigation() {
  const router = useRouter()
  useEffect(() => registerWorkspaceNavigator(router.push), [router])
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          event.button !== 0 || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href)
      if (url.origin !== window.location.origin) return
      const target = workspaceIdOf(url.searchParams)
      if (target !== null && target !== activeWorkspaceId()) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void selectWorkspace(target, url.toString())
      }
    }
    document.addEventListener('click', follow, true)
    return () => document.removeEventListener('click', follow, true)
  }, [])
  return (
    <Suspense>
      <ScopeCanonicalizer />
    </Suspense>
  )
}
