import { EventEmitter } from 'node:events'
import { Redis } from 'ioredis'
import { env } from '../config/env'

export type SseEvent =
  | { type: 'notification' }
  | { type: 'geocoding-updated'; partnerId: string }

// In-process bus — SSE response handlers listen here
const localBus = new EventEmitter()
localBus.setMaxListeners(500)

// Redis pub/sub requires dedicated connections (subscribe mode blocks the connection)
const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })
const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })

sub.connect().then(() => {
  sub.psubscribe('sse:*')
  sub.on('pmessage', (_pattern, channel, message) => {
    try {
      localBus.emit(channel, JSON.parse(message) as SseEvent)
    } catch {}
  })
}).catch(() => {})

// Fire-and-forget — callers don't need to await
export function emitToTenant(tenantId: string, event: SseEvent) {
  pub.connect().catch(() => {})
  pub.publish(`sse:${tenantId}`, JSON.stringify(event)).catch(() => {})
}

export function onTenantEvent(tenantId: string, handler: (e: SseEvent) => void): () => void {
  const channel = `sse:${tenantId}`
  localBus.on(channel, handler)
  return () => localBus.off(channel, handler)
}
