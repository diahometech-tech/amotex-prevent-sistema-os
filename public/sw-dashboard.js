// Service Worker do DASHBOARD (não confundir com public/sw.js, que é do
// captador offline — este aqui NUNCA intercepta fetch/cache nada, só existe
// pra habilitar push notification + badge quando o app está instalado
// ("Adicionar à Tela de Início"). Isso é deliberado: um SW que cacheia
// /api/* já causou incidente real neste projeto (dados "presos" em cache
// velho) — este arquivo evita a categoria inteira do problema não
// implementando handler de 'fetch' nenhum.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'NexusFlow', body: 'Você tem uma nova notificação.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload não era JSON — mantém o texto padrão
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    });
    // Badge no ícone (Android/Chrome desktop; iOS Safari 16.4+ com o app
    // instalado). Silenciosamente ignorado onde a API não existe.
    if (self.registration.setAppBadge) {
      try { await self.registration.setAppBadge(); } catch {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    if (self.registration.clearAppBadge) {
      try { await self.registration.clearAppBadge(); } catch {}
    }
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.postMessage({ type: 'nexus-notification-click', url });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
