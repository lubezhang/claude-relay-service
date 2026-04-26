const mockStored = new Map()
const mockIndex = new Set()

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

jest.mock(
  '../config/config',
  () => ({
    security: { encryptionKey: '12345678901234567890123456789012' },
    requestTimeout: 1000
  }),
  { virtual: true }
)

let axios

describe('githubCopilotAccountService', () => {
  beforeEach(() => {
    jest.resetModules()
    axios = require('axios')
    mockStored.clear()
    mockIndex.clear()
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
