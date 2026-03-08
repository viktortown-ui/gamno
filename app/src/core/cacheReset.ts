const CAMERA_STORAGE_PREFIX = 'goals.camera.'
const CAMERA_STORAGE_KEY = 'goals.camera.v2'

async function clearGoalsCameraState(storage: Storage): Promise<void> {
  const keysToDelete: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    if (key === CAMERA_STORAGE_KEY || key.startsWith(CAMERA_STORAGE_PREFIX)) {
      keysToDelete.push(key)
    }
  }
  keysToDelete.forEach((key) => storage.removeItem(key))
}

export async function hardResetSiteAndReload(reload: () => void = () => window.location.reload()): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }

    if ('caches' in globalThis) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    }

    clearGoalsCameraState(window.localStorage)
  } catch (error) {
    console.warn('[cache-reset] failed to reset service worker or cache storage', error)
  }

  reload()
}

export async function resetSwByQueryParamAndReload(url: URL = new URL(window.location.href)): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (url.searchParams.get('reset_sw') !== '1') return false

  try {
    await hardResetSiteAndReload(() => {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete('reset_sw')
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
      window.location.reload()
    })
  } catch (error) {
    console.warn('[cache-reset] reset via query failed', error)
    return false
  }

  return true
}

export const hardCacheResetAndReload = hardResetSiteAndReload
