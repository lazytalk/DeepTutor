'use client'

import { useTranslation } from 'react-i18next'
import { useAuthStatus } from '@/hooks/useAuthStatus'
import Tooltip from '@/shared/ui/Tooltip'
import { UserAvatar } from '@/components/UserAvatar'

/**
 * The sidebar's account row: who you are. It is deliberately a plain
 * identity display — Settings and Admin are first-class destinations in the
 * sidebar, and Sign out lives in the footer, so there is no account menu to
 * hide them behind.
 */
export function AccountMenu({ compact = false }: {
  /** The collapsed rail: the avatar alone, with the name on its tooltip. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { enabled, authenticated, username, userId, avatar, role } = useAuthStatus()

  if (!enabled || !authenticated || !username) return null

  if (compact) {
    return (
      <Tooltip label={username} description={t('navigation.accountShelf')} side="right">
        <div className="dt-account-identity is-rail" aria-label={username}>
          <UserAvatar
            username={username}
            userId={userId ?? undefined}
            avatar={avatar}
            role={role ?? undefined}
            size={26}
            suppressTitle
          />
        </div>
      </Tooltip>
    )
  }

  return (
    <div className="dt-account-identity" aria-label={username}>
      <UserAvatar
        username={username}
        userId={userId ?? undefined}
        avatar={avatar}
        role={role ?? undefined}
        size={22}
        suppressTitle
      />
      <span className="min-w-0 flex-1 truncate text-left">{username}</span>
    </div>
  )
}