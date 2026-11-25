'use client'

import { useTranslation } from 'react-i18next'
import PartnerAvatar from '@/components/partners/PartnerAvatar'
import { useActiveWorkspaceId } from '@/hooks/useActiveWorkspaceId'
import { usePartnerRoster } from '@/hooks/usePartnerRoster'
import { groupPartnersByWorkspace } from '@/lib/partner-workspace-bindings'
import { NavigationRow, Section } from './NavigationPrimitives'

/**
 * The account's partners that follow this workspace. They are quick links
 * into the partner's own chat; the section disappears when the workspace has
 * none, so General and untouched workspaces stay quiet.
 */
export function WorkspacePartners() {
  const { t } = useTranslation()
  const active = useActiveWorkspaceId()
  const { partners } = usePartnerRoster(Boolean(active))
  if (!active) return null
  const bound = groupPartnersByWorkspace(partners, active).here
  if (!bound.length) return null
  return (
    <div className="dt-workspace-partners">
      <Section
        title={t('Partners in this workspace')}
        action={<span className="dt-navigation-count">{bound.length}</span>}
      >
        {bound.map(partner => (
          <NavigationRow
            key={partner.partner_id}
            href={`/partners/${encodeURIComponent(partner.partner_id)}`}
            label={partner.name}
          >
            <PartnerAvatar
              name={partner.name}
              emoji={partner.emoji}
              image={partner.avatar}
              color={partner.color}
              size={16}
            />
          </NavigationRow>
        ))}
      </Section>
    </div>
  )
}