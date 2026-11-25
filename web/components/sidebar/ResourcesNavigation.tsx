'use client'
import { useTranslation } from 'react-i18next'
import { NavigationRow, OverviewRow } from './NavigationPrimitives'
import { ResourcesShelfIcon } from './ShelfIcons'
import { DASHBOARD_GROUPS } from '@/components/space/dashboard-groups'

/**
 * The materials shelf: the workspace's resources only. Conversations live in
 * Chat, so chat history is deliberately not one of these rows.
 */
const RESOURCE_KEYS = ['notebooks', 'journal', 'question_bank', 'knowledge'] as const

export function ResourcesNavigation() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const rows = DASHBOARD_GROUPS.flatMap(group => group.items).filter(item =>
    (RESOURCE_KEYS as readonly string[]).includes(item.key)
  )
  return (
    <>
      <OverviewRow href="/space" label={t('navigation.allResources')} icon={ResourcesShelfIcon} />
      <div className="dt-navigation-section">
        {rows.map(row => (
          <NavigationRow
            key={row.key}
            href={row.href}
            label={zh ? row.title.zh : t(row.title.en)}
            icon={row.icon}
          />
        ))}
      </div>
    </>
  )
}