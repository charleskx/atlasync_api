import { notificationsRepository } from './notifications.repository'

export type NotificationItem = {
  id: string
  type: 'import_done' | 'import_failed' | 'geocoding_failures' | 'trial_expiring' | 'ticket_reply' | 'new_ticket'
  title: string
  desc: string
  createdAt: string
}

export const notificationsService = {
  async list(tenantId: string, role?: string): Promise<NotificationItem[]> {
    const isSuperAdmin = role === 'super_admin'

    const [imports, geocodingFailures, trialDaysLeft, ticketData] = await Promise.all([
      isSuperAdmin ? Promise.resolve([]) : notificationsRepository.getRecentImports(tenantId),
      isSuperAdmin ? Promise.resolve([]) : notificationsRepository.getGeocodingFailures(tenantId),
      isSuperAdmin ? Promise.resolve(null) : notificationsRepository.getTrialDaysLeft(tenantId),
      isSuperAdmin
        ? notificationsRepository.getOpenTickets()
        : notificationsRepository.getRecentStaffReplies(tenantId),
    ])

    const items: NotificationItem[] = []

    // Import notifications
    for (const job of imports) {
      if (job.status === 'done') {
        const parts: string[] = []
        if (job.created) parts.push(`${job.created} criados`)
        if (job.updated) parts.push(`${job.updated} atualizados`)
        if (job.removed) parts.push(`${job.removed} removidos`)
        items.push({
          id: `import-${job.id}`,
          type: 'import_done',
          title: 'Importação concluída',
          desc: `${job.fileName ?? 'Arquivo'} · ${parts.length ? parts.join(' · ') : 'sem alterações'}`,
          createdAt: (job.finishedAt ?? job.createdAt).toISOString(),
        })
      } else if (job.status === 'failed') {
        items.push({
          id: `import-${job.id}`,
          type: 'import_failed',
          title: 'Importação falhou',
          desc: `${job.fileName ?? 'Arquivo'} não pôde ser processado`,
          createdAt: (job.finishedAt ?? job.createdAt).toISOString(),
        })
      }
    }

    // Geocoding failures
    const failedPartners = geocodingFailures as { id: string; name: string }[]
    if (failedPartners.length > 0) {
      const count = failedPartners.length
      const preview = failedPartners.slice(0, 3).map(p => p.name).join(', ')
      const extra = count > 3 ? ` e mais ${count - 3}` : ''
      items.push({
        id: 'geocoding-failures',
        type: 'geocoding_failures',
        title: `${count} parceiro${count > 1 ? 's' : ''} com endereço não localizado`,
        desc: `${preview}${extra} — clique para ver detalhes e corrigir`,
        createdAt: new Date().toISOString(),
      })
    }

    // Trial expiry warning (≤ 5 days left)
    if (trialDaysLeft !== null && trialDaysLeft <= 5) {
      items.push({
        id: 'trial-expiring',
        type: 'trial_expiring',
        title: trialDaysLeft === 0 ? 'Seu trial expirou' : `Trial expira em ${trialDaysLeft} dia${trialDaysLeft > 1 ? 's' : ''}`,
        desc: 'Assine um plano para continuar usando o MappaHub.',
        createdAt: new Date().toISOString(),
      })
    }

    // Ticket notifications
    if (isSuperAdmin) {
      // Super admin: open tickets waiting for reply
      const openTickets = ticketData as { id: string; title: string; createdAt: Date }[]
      for (const t of openTickets) {
        items.push({
          id: `ticket-open-${t.id}`,
          type: 'new_ticket',
          title: 'Novo ticket de suporte',
          desc: t.title,
          createdAt: t.createdAt.toISOString(),
        })
      }
    } else {
      // Regular users: staff replies on their tenant's tickets
      const staffReplies = ticketData as { id: string; ticketId: string; ticketTitle: string; createdAt: Date }[]
      for (const r of staffReplies) {
        items.push({
          id: `ticket-reply-${r.id}`,
          type: 'ticket_reply',
          title: 'Resposta no seu ticket',
          desc: r.ticketTitle,
          createdAt: r.createdAt.toISOString(),
        })
      }
    }

    // Sort by most recent first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return items
  },
}
