import { CONFIG } from '../p2p/config'
import { globalRelayManager } from '../p2p/services/authService.ts'

function b64urlToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function enablePush(): Promise<PushSubscriptionJSON> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('push-unsupported')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('push-denied')
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(CONFIG.VAPID_PUBLIC_KEY) as BufferSource,
    }))
  const subJson = sub.toJSON()
  const accepted = globalRelayManager ? await globalRelayManager.subscribePush(subJson) : false
  if (!accepted) throw new Error('push-relay-rejected')
  return subJson
}

export async function disablePush(): Promise<string | null> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  const endpoint = sub?.endpoint ?? null
  await sub?.unsubscribe()
  if (endpoint && globalRelayManager) await globalRelayManager.unsubscribePush(endpoint)
  return endpoint
}