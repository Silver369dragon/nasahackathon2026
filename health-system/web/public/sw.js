self.addEventListener('push', event => {
  if (!event.data) return
  event.waitUntil(showEmergency(event.data.json()))
})

async function showEmergency(item) {
  const zh = item.lang === 'zh-TW'
  let body = zh ? '開啟 App 查看船內通知。' : 'Open the app to view the crew notification.'
  let path = '/'
  try {
    const response = await fetch('/v1/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(2500) })
    if (!response.ok) return
    const { data } = await response.json()
    if (data.username !== item.recipient) return
    const crew = item.crew.charAt(0).toUpperCase() + item.crew.slice(1)
    const source = item.source === 'manual' ? (zh ? '主動求助' : 'Manual help request') : (zh ? '訓練感測警示' : 'Training sensor alert')
    body = crew + ' · ' + source
    path = data.crewId ? '/app' : (data.roles.includes('display') ? '/board' : '/system')
  } catch { /* Without a ship connection show a generic notification on the lock screen. */ }
  await self.registration.showNotification(zh ? 'Orbital · 緊急通知' : 'Orbital · Emergency notification', {
    body, tag: item.id, data: { path }, icon: '/orbital-192.png', timestamp: Date.parse(item.created)
  })
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.length) return windows[0].focus()
    return self.clients.openWindow(event.notification.data?.path || '/')
  })())
})
