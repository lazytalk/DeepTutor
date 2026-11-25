import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomConsole from '@/features/classroom/components/ClassroomConsole'
import { TeacherDashboard } from '@/features/classroom/components/TeacherDashboard'
import type { ClassroomDashboard } from '@/features/classroom/api'

const translate = (key: string, values?: Record<string, unknown>) =>
  key.replace(/{{(\w+)}}/g, (_, name) => String(values?.[name] ?? name))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('@/hooks/useAuthStatus', () => ({ useAuthStatus: () => ({ role: 'teacher' }) }))
vi.mock('@/lib/workspace-scope', () => ({ selectWorkspace: vi.fn() }))
vi.mock('@/shared/api/client', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '@/shared/api/client'

const dashboard: ClassroomDashboard = {
  classes: [
    {
      class_id: 'c1',
      class_name: 'Math P3',
      workspace_id: 'w1',
      member_count: 1,
      assignments: 1,
      reviews_due: 2,
      students: [
        {
          student_id: 's1',
          username: 'alice',
          topics: [
            {
              target_id: 't1',
              name: 'Cranes',
              kp_total: 4,
              kp_mastered: 1,
              reviews_due: 2,
              sessions: 3,
            },
          ],
          practice_totals: { answered: 10 },
        },
      ],
    },
    {
      class_id: 'c2',
      class_name: 'Science P4',
      workspace_id: 'w2',
      member_count: 1,
      assignments: 2,
      reviews_due: 0,
      students: [
        {
          student_id: 's2',
          username: 'bob',
          topics: [
            {
              target_id: 't2',
              name: 'Photosynthesis',
              kp_total: 2,
              kp_mastered: 2,
              reviews_due: 0,
              sessions: 1,
            },
          ],
          practice_totals: {},
        },
      ],
    },
  ],
  totals: { classes: 2, students: 2, assignments: 3, reviews_due: 2, sessions: 4 },
}

const classSummary = {
  id: 'c1',
  name: 'Math P3',
  teacher_id: 'teacher-1',
  workspace_id: 'w1',
  member_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  archived: false,
}

function payloadFor(rawUrl: string): unknown {
  const path = new URL(rawUrl, 'http://localhost').pathname
  if (path === '/api/classroom/dashboard') return dashboard
  if (path === '/api/classroom/classes') return { classes: [classSummary] }
  if (path === '/api/classroom/student-pool') return { students: [] }
  if (path === '/api/settings/workspace/registrations') return { workspaces: [] }
  if (path.endsWith('/members')) return { members: [] }
  if (path.endsWith('/workspaces')) return { workspaces: [] }
  if (path.endsWith('/books')) return { books: [], default: 'read' }
  if (path.endsWith('/assignment-sources')) return { sources: [] }
  if (path.endsWith('/assignments')) return { assignments: [] }
  if (path.endsWith('/progress')) return { rows: [] }
  if (path.includes('/question-sets')) return { question_sets: [] }
  return {}
}

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (url: RequestInfo | URL) =>
    Response.json(payloadFor(String(url))),
  )
})

describe('TeacherDashboard', () => {
  it('renders cross-class totals, flags attention, and drills into class or student', async () => {
    const onOpenClass = vi.fn()
    render(<TeacherDashboard onOpenClass={onOpenClass} />)

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-total-students')).toHaveTextContent('2'),
    )
    expect(screen.getByTestId('dashboard-total-assignments')).toHaveTextContent('3')
    expect(screen.getByTestId('dashboard-total-reviews')).toHaveTextContent('2')

    const math = await screen.findByTestId('dashboard-class-c1')
    const science = screen.getByTestId('dashboard-class-c2')
    expect(within(math).getByText('Math P3')).toBeInTheDocument()
    expect(within(science).getByText('Science P4')).toBeInTheDocument()

    expect(within(math).getByText('alice')).toBeInTheDocument()
    expect(within(math).getByText('Needs attention')).toBeInTheDocument()
    expect(within(science).getByText('bob')).toBeInTheDocument()
    expect(within(science).queryByText('Needs attention')).not.toBeInTheDocument()
    expect(within(math).getByText(/Practice totals/)).toHaveTextContent('answered 10')

    fireEvent.click(within(math).getByText('Open class →'))
    expect(onOpenClass).toHaveBeenCalledWith('c1')

    expect(within(math).getByTestId('dashboard-student-c1-s1')).toHaveAttribute(
      'href',
      '/classroom/record/s1',
    )
    expect(within(math).getByText('Learning record →')).toBeInTheDocument()
  })
})

describe('ClassroomConsole', () => {
  it('defaults teachers to the dashboard and opens the selected class panels', async () => {
    render(<ClassroomConsole />)

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' })
    await waitFor(() => expect(dashboardTab).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByTestId('dashboard-class-c1')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-total-students')).toHaveTextContent('2')

    fireEvent.click(
      within(screen.getByTestId('dashboard-class-c1')).getByText('Open class →'),
    )

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Classes' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(await screen.findByText('Math P3 · Members')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-class-c1')).not.toBeInTheDocument()
    expect(screen.queryByText('My assignments')).not.toBeInTheDocument()
  })
})