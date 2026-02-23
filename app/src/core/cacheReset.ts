export async function hardResetSiteAndReload(reload: () => void = () => window.location.reload()): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }

  if ('caches' in globalThis) {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  }

  reload()
}

export const hardCacheResetAndReload = hardResetSiteAndReload
