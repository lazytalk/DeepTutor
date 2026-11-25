'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useAuthStatus } from '@/hooks/useAuthStatus'
import { useSidebarDrawer } from '@/components/layout/AppShell'
import Tooltip from '@/shared/ui/Tooltip'
import { UserAvatar } from '@/components/UserAvatar'

/**
 * The sidebar's account row: who you are. The name (and the avatar in the
 * rail) is the way into Personalization; Settings and Sign out live in the
 * footer, so there is no account menu to hide them behind.
 */
export function AccountMenu({ compact = false }: {
  /** The collapsed rail: the avatar alone, with the name on its tooltip. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { enabled, authenticated, username, userId, avatar, role } = useAuthStatus()
  const drawer = useSidebarDrawer()

  if (!enabled || !authenticated || !username) return null

  if (compact) {
    return (
      <Tooltip label={username} description={t('navigation.personalization')} side="right">
        <Link
          href="/personalization"
          prefetch={false}
          aria-label={username}
          onClick={() => drawer?.close()}
          className="dt-account-identity is-rail"
        >
          <UserAvatar
            username={username}
            userId={userId ?? undefined}
            avatar={avatar}
            role={role ?? undefined}
            size={26}
            suppressTitle
          />
        </Link>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={t('navigation.personalization')} side="bottom">
    <Link
      href="/personalization"
      prefetch={false}
      aria-label={username}
      onClick={() => drawer?.close()}
      className="dt-account-identity"
    >
      <UserAvatar
        username={username}
        userId={userId ?? undefined}
        avatar={avatar}
        role={role ?? undefined}
        size={22}
        suppressTitle
      />
      <span className="min-w-0 flex-1 truncate text-left">{username}</span>
    </Link>
    </Tooltip>
  )
}