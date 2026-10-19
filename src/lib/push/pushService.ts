import { CONFIG } from '../p2p/config'
import { globalRelayManager, globalContactsDb } from '../p2p/services/authService.ts'

function b64urlToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function swReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sw-not-registered')), 5000)),
  ])
}

export async function enablePush(): Promise<PushSubscriptionJSON> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('push-unsupported')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('push-denied')
  const reg = await swReady()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(CONFIG.VAPID_PUBLIC_KEY) as BufferSource,
    }))
  const subJson = sub.toJSON()
  const accepted = globalRelayManager ? await globalRelayManager.subscribePush(subJson) : false
  if (!accepted) throw new Error('push-relay-rejected')
    await syncPushMuted().catch(() => {})
  return subJson
}

/** Отправляет релею актуальный список выключенных чатов (id контакта или группы). */
export async function syncPushMuted(): Promise<boolean> {
  if (!globalRelayManager || !globalContactsDb) return false
  const { getAllContacts } = await import('../p2p/services/contactsService.ts')
  const ids = (await getAllContacts(globalContactsDb))
    .filter((c) => c.pushMuted && !c.isDeleted)
    .map((c) => c.id)
  return globalRelayManager.setPushMuted(ids)
}

/** Включает/выключает уведомления одного чата (id собеседника или grp_…). */
export async function setChatMuted(contactId: string, muted: boolean): Promise<void> {
  if (!globalContactsDb) return
  const { getContact, saveContact } = await import('../p2p/services/contactsService.ts')
  const c = await getContact(globalContactsDb, contactId)
  if (!c) return
  await saveContact(globalContactsDb, { ...c, pushMuted: muted }) // updatedAt не трогаем: порядок списка не меняется
  window.dispatchEvent(new Event('onContactsUpdated'))
  await syncPushMuted().catch(() => {})
}

export async function disablePush(): Promise<string | null> {
  const reg = await swReady()
  const sub = await reg.pushManager.getSubscription()
  const endpoint = sub?.endpoint ?? null
  await sub?.unsubscribe()
  if (endpoint && globalRelayManager) await globalRelayManager.unsubscribePush(endpoint)
  return endpoint
}