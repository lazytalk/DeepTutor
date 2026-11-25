'use client'

import { useEffect, useId, useState, startTransition, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { m, useReducedMotion } from 'framer-motion'
import {
  CalendarDays,
  Columns3,
  GraduationCap,
  ListChecks,
  NotebookPen,
  Plus,
  School,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  ChatShelfIcon,
  HomeShelfIcon,
  LearningShelfIcon,
  ResourcesShelfIcon,
} from './ShelfIcons'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/shared/ui/Tooltip'
import { categoryForPath, type NavigationCategory } from '@/lib/navigation'
import { navVisibleUnderPolicy } from './nav-entries'
import { useAuthStatus } from '@/hooks/useAuthStatus'
import { useSidebarDrawer } from '@/components/layout/AppShell'
import { navigateTask } from '@/lib/workspace-scope'
import { ActionRow, NavigationRow, OverviewRow, Status } from './NavigationPrimitives'
import { WorkspacePartners } from './WorkspacePartners'
import { SHORTCUTS } from '@/lib/shortcuts'
import { useTaskBoard } from '@/lib/task-board-store'
import { listNotes, type NoteSummary } from '@/lib/notes-api'
import { setPendingPrompt } from '@/lib/pending-prompt'
import type { LearningSessions } from './LearningNavigation'

// Feature libraries load when their category opens, not in every workspace.
const LearningNavigation = dynamic(() =>
  import('./LearningNavigation').then(module => module.LearningNavigation)
)
const ResourcesNavigation = dynamic(() =>
  import('./ResourcesNavigation').then(module => module.ResourcesNavigation)
)

/**
 * The shelves behind the icon row: Home (the workspace overview), Chat (new
 * conversation + history), Learning, Resources, Task Board and Co-Writer.
 * Home is the default. Account-level destinations (Calendar, Classroom,
 * Admin) sit above the workspace selector; Settings and Personalization are
 * reached from the account footer and identity row instead of taking a shelf.
 *
 * Naming: "Co-Writer" is the writing canvas at /co-writer; a "notebook" is
 * the saved-records collection at /notebooks that mastery/book sources read.
 */
export const CATEGORIES = [
  { id: 'home', label: 'navigation.home', icon: HomeShelfIcon, href: '/chat' },
  { id: 'chat', label: 'navigation.chat', icon: ChatShelfIcon, href: '/chat' },
  { id: 'learning', label: 'navigation.learning', icon: LearningShelfIcon, href: '/learning' },
  { id: 'resources', label: 'navigation.resources', icon: ResourcesShelfIcon, href: '/space' },
  { id: 'task_board', label: 'navigation.taskBoard', icon: Columns3, href: '/kanban' },
  { id: 'notebook', label: 'navigation.notebook', icon: NotebookPen, href: '/co-writer' },
] as const

export function useCategoryNavigation() {
  const pathname = usePathname()
  const { learningPolicy } = useAuthStatus()
  const categories = CATEGORIES.filter(item =>
    navVisibleUnderPolicy(item.href, learningPolicy?.allowedSurfaces ?? null)
  )
  const [selection, setSelection] = useState<{
    pathname: string
    category: NavigationCategory
  } | null>(null)
  const desired = selection?.pathname === pathname ? selection.category : categoryForPath(pathname)
  const category = categories.find(item => item.id === desired)?.id ?? categories[0]?.id ?? 'home'
  return {
    category,
    categories,
    select: (next: NavigationCategory) => {
      startTransition(() => setSelection({ pathname, category: next }))
    },
    allowedSurfaces: learningPolicy?.allowedSurfaces ?? null,
  }
}
type Navigation = ReturnType<typeof useCategoryNavigation>

/**
 * The icons row. Only the active shelf prints its name; the rest are glyphs
 * with tooltips, so all six destinations fit in one line. Picking one reveals
 * that shelf's sub-menu and hides the others.
 */
export function CategoryTabs({
  nav,
  collapsed,
}: {
  nav: Navigation
  collapsed: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const id = useId()
  const reduced = useReducedMotion()
  const select = (category: (typeof CATEGORIES)[number]) => {
    nav.select(category.id)
    if (collapsed) navigateTask(category.href, router.push)
  }
  return (
    <div className={`dt-category-bar ${collapsed ? 'is-collapsed' : ''}`}>
      <div
        role="tablist"
        aria-label={t('navigation.categories')}
        aria-orientation={collapsed ? 'vertical' : 'horizontal'}
      >
        {nav.categories.map((item, index) => {
          const active = nav.category === item.id
          return (
            <Tooltip
              key={item.id}
              label={t(item.label)}
              side={collapsed ? 'right' : 'bottom'}
              shortcut={SHORTCUTS.category(index)}
              // The active tab already prints its name.
              suppressed={!collapsed && active}
            >
              <button
                id={`category-${item.id}`}
                type="button"
                role="tab"
                aria-controls="category-content"
                aria-label={t(item.label)}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={event => {
                  const delta = ['ArrowRight', 'ArrowDown'].includes(event.key)
                    ? 1
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                      ? -1
                      : 0
                  if (!delta && !['Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? nav.categories.length - 1
                        : (index + delta + nav.categories.length) % nav.categories.length
                  select(nav.categories[next])
                  event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus()
                }}
                onClick={() => select(item)}
                className={active ? 'is-active' : ''}
              >
                {active && (
                  <m.span
                    layoutId={`category-pill-${id}`}
                    className="dt-category-pill"
                    transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <item.icon size={20} strokeWidth={1.6} />
                {/* Inactive shelves are icon-only; the label appears with the
                    selection (and is never printed in the rail). */}
                {active && !collapsed && <span>{t(item.label)}</span>}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Cross-workspace destinations, above the workspace selector: Calendar for
 * everyone, Classroom for teaching roles and Admin for administrators. They
 * belong to the account, so switching workspace never changes them.
 */
export function PrimaryDestinations({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const { role, isAdmin, learningPolicy } = useAuthStatus()
  const drawer = useSidebarDrawer()
  const allowedSurfaces = learningPolicy?.allowedSurfaces ?? null
  const items = [
    // Calendar is account-level (it follows you across workspaces) and open
    // to every role, subject to the learning policy.
    ...(navVisibleUnderPolicy('/calendar', allowedSurfaces)
      ? [{ href: '/calendar', label: t('Calendar'), icon: CalendarDays }]
      : []),
    ...(['admin', 'teacher', 'student'].includes(role ?? '') &&
    navVisibleUnderPolicy('/classroom', allowedSurfaces)
      ? [{ href: '/classroom', label: t('Classroom'), icon: School }]
      : []),
    ...(isAdmin ? [{ href: '/admin/users', label: t('Admin'), icon: ShieldCheck }] : []),
  ]
  if (!items.length) return null
  if (collapsed) {
    return (
      <div className="dt-primary-nav is-rail">
        {items.map(item => (
          <Tooltip key={item.href} label={item.label} side="right">
            <Link
              href={item.href}
              prefetch={false}
              aria-label={item.label}
              onClick={() => drawer?.close()}
              className="dt-nav-icon"
            >
              <item.icon size={18} strokeWidth={1.6} />
            </Link>
          </Tooltip>
        ))}
      </div>
    )
  }
  return (
    <div className="dt-primary-nav">
      {items.map(item => (
        <NavigationRow key={item.href} href={item.href} label={item.label} icon={item.icon} />
      ))}
    </div>
  )
}

/**
 * Home's shelf: the workspace overview's suggestions. The tools that used to
 * sit here are shelves of their own now, and conversations belong to Chat, so
 * what remains is a short set of ways to start working. Picking one hands the
 * prompt to the Chat composer. No group title is printed.
 */
const HOME_SUGGESTIONS = [
  { key: 'starters.explain.1', icon: Sparkles },
  { key: 'starters.solve.1', icon: ListChecks },
  { key: 'starters.practice.1', icon: GraduationCap },
] as const

function HomeOverview() {
  const { t } = useTranslation()
  const router = useRouter()
  const drawer = useSidebarDrawer()
  const pick = (prompt: string) => {
    setPendingPrompt(prompt)
    // If Chat is already mounted (the sidebar renders on /chat too), its
    // prefill bridge takes the line directly; otherwise the pending prompt is
    // consumed when the Chat view mounts.
    window.dispatchEvent(new CustomEvent('dt:visualize-prompt', { detail: prompt }))
    drawer?.close()
    navigateTask('/chat', router.push)
  }
  return (
    <div className="dt-navigation-section">
      {HOME_SUGGESTIONS.map(item => (
        <ActionRow
          key={item.key}
          label={t(item.key)}
          icon={item.icon}
          onClick={() => pick(t(`${item.key}.prompt`))}
        />
      ))}
    </div>
  )
}

/** Task Board's shelf: the board itself, then its three lanes. */
function TaskBoardNavigation() {
  const { t } = useTranslation()
  const { board } = useTaskBoard()
  const cards = board?.cards.filter(card => !card.archived) ?? []
  const lanes = [
    { id: 'todo', label: 'kanban.todo' },
    { id: 'doing', label: 'kanban.doing' },
    { id: 'done', label: 'kanban.done' },
  ] as const
  const count = (status: string) => cards.filter(card => card.status === status).length
  return (
    <>
      <OverviewRow href="/kanban" label={t('Open board')} icon={Columns3} />
      <div className="dt-navigation-section">
        {lanes.map(lane => (
          <NavigationRow
            key={lane.id}
            href="/kanban"
            label={t(lane.label)}
            detail={board ? String(count(lane.id)) : undefined}
            active={false}
          />
        ))}
      </div>
    </>
  )
}

/**
 * Co-Writer's shelf: the page list at /co-writer. It reads the same page
 * list the Co-Writer home does, without the editor's state.
 */
function NotebookNavigation() {
  const { t } = useTranslation()
  const [pages, setPages] = useState<NoteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let cancelled = false
    listNotes()
      .then(({ documents }) => {
        if (!cancelled) setPages(documents)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [generation])
  const retry = () => {
    setLoading(true)
    setFailed(false)
    setGeneration(value => value + 1)
  }
  return (
    <>
      <OverviewRow href="/co-writer" label={t('navigation.allNotebooks')} icon={NotebookPen} />
      <div className="dt-navigation-section">
        <Status loading={loading} error={failed} retry={retry} />
        {!loading &&
          !failed &&
          pages.map(page => (
            <NavigationRow
              key={page.id}
              href={`/co-writer/${page.id}`}
              label={page.title || t('Untitled')}
            />
          ))}
      </div>
    </>
  )
}

export function CategoryBody({
  nav,
  collapsed,
  sessions,
  learningSessions,
  onNewChat,
}: {
  nav: Navigation
  collapsed: boolean
  /**
   * Chat's conversation records: the new-conversation action lives above
   * them in the Chat panel.
   */
  sessions: ReactNode
  /** Learning conversations, filed by the learning shelf under their records. */
  learningSessions?: LearningSessions
  onNewChat?: () => void
}) {
  const { t } = useTranslation()
  if (collapsed) return null
  const fixed = nav.category === 'learning'
  return (
    <div
      id="category-content"
      role="tabpanel"
      aria-labelledby={`category-${nav.category}`}
      className={`dt-category-content ${fixed ? 'dt-category-content-fixed' : ''}`}
    >
      {nav.category === 'home' && <HomeOverview />}
      {nav.category === 'chat' && (
        <>
          <ActionRow
            label={t('navigation.newChat')}
            icon={Plus}
            onClick={() => onNewChat?.()}
          />
          <WorkspacePartners />
          {sessions}
        </>
      )}
      {nav.category === 'learning' && (
        <div className="dt-category-panel">
          <LearningNavigation active sessions={learningSessions} />
        </div>
      )}
      {nav.category === 'resources' && <ResourcesNavigation />}
      {nav.category === 'task_board' && <TaskBoardNavigation />}
      {nav.category === 'notebook' && <NotebookNavigation />}
    </div>
  )
}