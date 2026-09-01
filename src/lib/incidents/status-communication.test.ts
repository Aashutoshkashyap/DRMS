import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  sendMessageToConversation: vi.fn(),
}))

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
}))

import { deliverIncidentStatusUpdate, retryFailedIncidentStatusUpdate } from './status-communication'

type Incident = {
  id: string
  request_id: string
  incident_status: 'received' | 'assigned' | 'dispatched'
  assigned_team: string | null
  assigned_resource: string | null
  conversation_id: string | null
}

type Delivery = { id: string; delivery_status: 'pending' | 'sent' } | null

function makeRetryDb() {
  let deliveryStatus: 'failed' | 'pending' | 'sent' = 'failed'
  let claimed = false
  const db = {
    from(table: string) {
      if (table === 'deals') {
        const query = { eq: () => query, maybeSingle: async () => ({ data: baseIncident, error: null }) }
        return { select: () => query }
      }
      if (table === 'incident_status_deliveries') {
        const selectQuery = { eq: () => selectQuery, maybeSingle: async () => ({ data: { id: 'delivery-retry', delivery_status: deliveryStatus }, error: null }) }
        const updateQuery = {
          eq: () => updateQuery,
          select: () => updateQuery,
          maybeSingle: async () => {
            if (deliveryStatus !== 'failed' || claimed) return { data: null, error: null }
            claimed = true
            deliveryStatus = 'pending'
            return { data: { id: 'delivery-retry' }, error: null }
          },
        }
        return { select: () => selectQuery, update: () => updateQuery }
      }
      if (table === 'response_teams' || table === 'vehicles') {
        const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }
        return { select: () => query }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
  return db as unknown as SupabaseClient
}

function makeDb(incident: Incident | null, delivery: Delivery) {
  const updates: { table: string; row: Record<string, unknown>; id: string }[] =
    []
  const db = {
    from(table: string) {
      if (table === 'deals') {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({ data: incident, error: null }),
        }
        return { select: () => query }
      }

      if (table === 'incident_status_deliveries') {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({ data: delivery, error: null }),
        }
        return {
          select: () => query,
          update: (row: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ table, row, id })
              return { error: null }
            },
          }),
        }
      }

      if (table === 'response_teams' || table === 'vehicles') {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return { select: () => query }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { db: db as unknown as SupabaseClient, updates }
}

const baseIncident: Incident = {
  id: 'incident-1',
  request_id: 'DRMS-001',
  incident_status: 'received',
  assigned_team: null,
  assigned_resource: null,
  conversation_id: 'conversation-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sendMessageToConversation.mockResolvedValue({
    whatsappMessageId: 'wamid.status-1',
  })
})

describe('deliverIncidentStatusUpdate', () => {
  it('sends the predefined status text and records the provider message id', async () => {
    const { db, updates } = makeDb(baseIncident, {
      id: 'delivery-1',
      delivery_status: 'pending',
    })

    await expect(
      deliverIncidentStatusUpdate(db, 'account-1', baseIncident.id)
    ).resolves.toEqual({
      delivered: true,
    })

    expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, 'account-1', {
      conversationId: 'conversation-1',
      messageType: 'text',
      contentText: '✅ Request DRMS-001 has been received.',
      senderType: 'bot',
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      table: 'incident_status_deliveries',
      id: 'delivery-1',
      row: {
        delivery_status: 'sent',
        whatsapp_message_id: 'wamid.status-1',
        error_message: null,
      },
    })
  })

  it('does not claim an unverified team or vehicle in a dispatched update', async () => {
    const incident: Incident = {
      ...baseIncident,
      incident_status: 'dispatched',
      assigned_team: 'Unverified team',
      assigned_resource: 'Unverified vehicle',
    }
    const { db } = makeDb(incident, {
      id: 'delivery-2',
      delivery_status: 'pending',
    })

    await deliverIncidentStatusUpdate(db, 'account-1', incident.id)

    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      db,
      'account-1',
      expect.objectContaining({
        contentText: '🚑 Response dispatched for request DRMS-001.',
      })
    )
  })

  it('does not send a delivery that has already been recorded', async () => {
    const { db, updates } = makeDb(baseIncident, {
      id: 'delivery-3',
      delivery_status: 'sent',
    })

    await expect(
      deliverIncidentStatusUpdate(db, 'account-1', baseIncident.id)
    ).resolves.toEqual({
      delivered: true,
      reason: 'already_sent',
    })

    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('does not send without a durable conversation', async () => {
    const { db, updates } = makeDb(
      { ...baseIncident, conversation_id: null },
      { id: 'delivery-4', delivery_status: 'pending' }
    )

    await expect(
      deliverIncidentStatusUpdate(db, 'account-1', baseIncident.id)
    ).resolves.toEqual({
      delivered: false,
      reason: 'no_conversation',
    })

    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('allows only one explicit retry claim for a failed delivery', async () => {
    const db = makeRetryDb()
    await expect(retryFailedIncidentStatusUpdate(db, 'account-1', baseIncident.id)).resolves.toEqual({ delivered: true })
    await expect(retryFailedIncidentStatusUpdate(db, 'account-1', baseIncident.id)).resolves.toEqual({ delivered: false, reason: 'not_failed' })
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })
})
