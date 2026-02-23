import { describe, expect, it, vi } from 'vitest'
import { hardResetSiteAndReload } from './cacheReset'

describe('hardResetSiteAndReload', () => {
  it('unregisters service workers, clears caches and reloads when APIs exist', async () => {
    const unregisterA = vi.fn(async () => true)
    const unregisterB = vi.fn(async () => true)
    const getRegistrations = vi.fn(async () => [{ unregister: unregisterA }, { unregister: unregisterB }])
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker: { getRegistrations } },
      configurable: true,
    })

    const keys = vi.fn(async () => ['v1', 'v2'])
    const del = vi.fn(async () => true)
    Object.defineProperty(globalThis, 'caches', {
      value: { keys, delete: del },
      configurable: true,
    })

    const reload = vi.fn()
    await hardResetSiteAndReload(reload)

    expect(getRegistrations).toHaveBeenCalledTimes(1)
    expect(unregisterA).toHaveBeenCalledTimes(1)
    expect(unregisterB).toHaveBeenCalledTimes(1)
    expect(keys).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('v1')
    expect(del).toHaveBeenCalledWith('v2')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
