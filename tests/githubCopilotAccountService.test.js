const mockStored = new Map()
const mockIndex = new Set()
const mockProxyAgent = { name: 'proxy-agent' }
const mockCreateProxyAgent = jest.fn(() => mockProxyAgent)

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn(() => ({
    hset: jest.fn(async (key, data) => {
      mockStored.set(key, { ...(mockStored.get(key) || {}), ...data })
    }),
    hgetall: jest.fn(async (key) => mockStored.get(key) || {}),
    del: jest.fn(async (key) => mockStored.delete(key)),
    sadd: jest.fn(async (_key, id) => mockIndex.add(id)),
    srem: jest.fn(async (_key, id) => mockIndex.delete(id))
  })),
  addToIndex: jest.fn(async (_key, id) => mockIndex.add(id)),
  removeFromIndex: jest.fn(async (_key, id) => mockIndex.delete(id)),
  getAllIdsByIndex: jest.fn(async () => Array.from(mockIndex)),
  getDateStringInTimezone: jest.fn(() => '2026-04-25')
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: (...args) => mockCreateProxyAgent(...args)
}))

jest.mock(
  '../config/config',
  () => ({
    security: { encryptionKey: '12345678901234567890123456789012' },
    requestTimeout: 1000
  }),
  { virtual: true }
)

let axios

const getStoredAccountRecord = (id) => {
  return mockStored.get(`github_copilot_account:${id}`)
}

describe('githubCopilotAccountService', () => {
  beforeEach(() => {
    jest.resetModules()
    axios = require('axios')
    mockStored.clear()
    mockIndex.clear()
    mockCreateProxyAgent.mockReset()
    mockCreateProxyAgent.mockReturnValue(mockProxyAgent)
    axios.post.mockReset()
    axios.get.mockReset()
  })

  test('createAccount stores sensitive tokens encrypted and returns sanitized data', async () => {
    const service = require('../src/services/account/githubCopilotAccountService')
    const account = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'copilot_secret',
      copilotTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      githubUsername: 'octocat'
    })

    expect(account.platform).toBe('github-copilot')
    expect(account.githubToken).toBe('***')
    expect(account.copilotToken).toBe('***')

    const raw = Array.from(mockStored.values()).find((value) => value.platform === 'github-copilot')
    expect(raw.githubToken).not.toBe('ghu_secret')
    expect(raw.copilotToken).not.toBe('copilot_secret')
  })

  test('ensureCopilotToken reuses unexpired cached token', async () => {
    const service = require('../src/services/account/githubCopilotAccountService')
    const created = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'cached_token',
      copilotTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    })

    await expect(service.ensureCopilotToken(created.id)).resolves.toBe('cached_token')
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('ensureCopilotToken refreshes expired token with GitHub token', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        token: 'fresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_in: 1800
      }
    })

    const service = require('../src/services/account/githubCopilotAccountService')
    const created = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'old_token',
      copilotTokenExpiresAt: '2000-01-01T00:00:00.000Z'
    })

    await expect(service.ensureCopilotToken(created.id)).resolves.toBe('fresh_token')
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'token ghu_secret' })
      })
    )
  })

  test('ensureCopilotToken applies proxy agent when account has proxy', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        token: 'fresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_in: 1800
      }
    })

    const service = require('../src/services/account/githubCopilotAccountService')
    const proxy = {
      type: 'http',
      host: '127.0.0.1',
      port: 7890
    }
    const created = await service.createAccount({
      name: 'copilot-proxy',
      githubToken: 'ghu_secret',
      copilotToken: 'old_token',
      copilotTokenExpiresAt: '2000-01-01T00:00:00.000Z',
      proxy
    })

    await expect(service.ensureCopilotToken(created.id)).resolves.toBe('fresh_token')
    expect(mockCreateProxyAgent).toHaveBeenCalledWith(proxy)
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        httpAgent: mockProxyAgent,
        httpsAgent: mockProxyAgent,
        proxy: false
      })
    )
  })

  test('ensureCopilotToken refreshes expired token only once for concurrent calls', async () => {
    let resolveRefresh
    axios.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )

    const service = require('../src/services/account/githubCopilotAccountService')
    const created = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'old_token',
      copilotTokenExpiresAt: '2000-01-01T00:00:00.000Z'
    })

    const firstPromise = service.ensureCopilotToken(created.id)
    const secondPromise = service.ensureCopilotToken(created.id)

    await Promise.resolve()
    await Promise.resolve()

    expect(axios.get).toHaveBeenCalledTimes(1)

    resolveRefresh({
      data: {
        token: 'fresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_in: 1800
      }
    })

    await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([
      'fresh_token',
      'fresh_token'
    ])
    expect(service._refreshPromises.size).toBe(0)
  })

  test('ensureCopilotToken keeps refreshed token encrypted in storage', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        token: 'fresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_in: 1800
      }
    })

    const service = require('../src/services/account/githubCopilotAccountService')
    const created = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'old_token',
      copilotTokenExpiresAt: '2000-01-01T00:00:00.000Z'
    })

    await expect(service.ensureCopilotToken(created.id)).resolves.toBe('fresh_token')

    const raw = getStoredAccountRecord(created.id)
    expect(raw.copilotToken).toBeTruthy()
    expect(raw.copilotToken).not.toBe('fresh_token')

    const reloaded = await service.getAccount(created.id)
    expect(reloaded.copilotToken).toBe('fresh_token')
  })

  test('getAllAccounts(true) preserves proxy structure after sanitization', async () => {
    const service = require('../src/services/account/githubCopilotAccountService')
    const proxy = {
      type: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: 'user',
      password: 'pass'
    }

    await service.createAccount({
      name: 'copilot-proxy',
      githubToken: 'ghu_secret',
      copilotToken: 'copilot_secret',
      copilotTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      proxy
    })

    const accounts = await service.getAllAccounts(true)

    expect(accounts).toHaveLength(1)
    expect(accounts[0].proxy).toEqual(proxy)
    expect(accounts[0].githubToken).toBe('***')
    expect(accounts[0].copilotToken).toBe('***')
  })

  test('ensureCopilotToken marks account unauthorized when GitHub refresh returns 401', async () => {
    axios.get.mockRejectedValueOnce({
      response: { status: 401 }
    })

    const service = require('../src/services/account/githubCopilotAccountService')
    const created = await service.createAccount({
      name: 'copilot-main',
      githubToken: 'ghu_secret',
      copilotToken: 'old_token',
      copilotTokenExpiresAt: '2000-01-01T00:00:00.000Z'
    })

    await expect(service.ensureCopilotToken(created.id)).rejects.toThrow(
      'GitHub Copilot authorization failed'
    )

    const updated = await service.getAccount(created.id)
    expect(updated.status).toBe('unauthorized')
    expect([false, 'false']).toContain(updated.schedulable)
    expect(updated.errorMessage).toBeTruthy()
  })
})
