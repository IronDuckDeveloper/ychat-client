/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// В injectManifest-режиме это нужно писать вручную (generateSW делал сам при autoUpdate)
self.skipWaiting()
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
// то, что раньше делал navigateFallback у generateSW (SPA-роуты)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data: { from?: string } = {}
    try { data = event.data?.json() ?? {} } catch { /* пустой/не-JSON payload */ }
    // try { data = event.data?.json() ?? {} } catch (e) { console.error('[SW] payload не JSON', e) }
    console.log('[SW] parsed data:', data)

    // Если вкладка на экране, уведомление не нужно (там работает mailbox)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // if (wins.some((w) => w.visibilityState === 'visible')) return
    console.log('[SW] окон найдено:', wins.length, wins.map(w => w.visibilityState))
    if (wins.some((w) => w.visibilityState === 'visible')) {
      console.log('[SW] есть видимое окно — уведомление не показываем')
      return
    }

    const lang = self.navigator.language.slice(0, 2)
    const body =
      lang === 'ru' ? 'Новое сообщение' :
      lang === 'es' ? 'Nuevo mensaje' :
      'New message'
    await self.registration.showNotification('ychat', {
      body,
      icon: new URL('apple-touch-icon.png', self.registration.scope).href,
      tag: data.from ? `msg-${data.from}` : 'msg', // дубли заменяют друг друга
    })
    console.log('[SW] showNotification вызван')
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.length) return void (await wins[0].focus())
    await self.clients.openWindow(self.registration.scope)
  })())
})