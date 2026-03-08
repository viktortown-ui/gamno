import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hardResetSiteAndReload, resetSwByQueryParamAndReload } from './cacheReset'

describe('hardResetSiteAndReload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('unregisters service workers, clears caches, clears goals camera keys and reloads when APIs exist', async () => {
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

    const localStorageMock = {
      length: 3,
      key: vi.fn((index: number) => ['goals.camera.v2', 'goals.camera.old', 'other.key'][index] ?? null),
      removeItem: vi.fn(),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { location: { reload: vi.fn() }, localStorage: localStorageMock },
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
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('goals.camera.v2')
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('goals.camera.old')
    expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('other.key')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('resetSwByQueryParamAndReload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false when reset_sw query is not set', async () => {
    const result = await resetSwByQueryParamAndReload(new URL('https://example.com/concorer/#/goals'))
    expect(result).toBe(false)
  })

  it('cleans url and reloads when reset_sw=1', async () => {
    const getRegistrations = vi.fn(async () => [])
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker: { getRegistrations } },
      configurable: true,
    })

    Object.defineProperty(globalThis, 'caches', {
      value: { keys: vi.fn(async () => []), delete: vi.fn(async () => true) },
      configurable: true,
    })

    const replaceState = vi.fn()
    const reload = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { href: 'https://example.com/concorer/?reset_sw=1#/goals', reload },
        history: { replaceState },
        localStorage: { length: 0, key: vi.fn(() => null), removeItem: vi.fn() },
      },
      configurable: true,
    })

    const result = await resetSwByQueryParamAndReload(new URL('https://example.com/concorer/?reset_sw=1#/goals'))
    expect(result).toBe(true)
    expect(replaceState).toHaveBeenCalledWith({}, '', '/concorer/#/goals')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
