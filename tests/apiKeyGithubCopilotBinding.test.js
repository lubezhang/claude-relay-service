const request = require('supertest')

jest.mock(
  '../config/config',
  () => ({
    security: {
      apiKeyPrefix: 'cr_',
      encryptionKey: 'test-encryption-key'
    },
    system: {
      timezoneOffset: 8
    }
  }),
  { virtual: true }
)

jest.mock('../src/models/redis', () => ({
  setApiKey: jest.fn(),
  getApiKeysPaginated: jest.fn(),
  getApiKey: jest.fn()
}))

jest.mock('../src/services/costRankService', () => ({
  addKeyToIndexes: jest.fn()
}))

jest.mock('../src/services/apiKeyIndexService', () => ({
  addToIndex: jest.fn(),
  updateIndex: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  success: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}))

jest.mock('../src/services/serviceRatesService', () => ({}))
jest.mock('../src/services/requestDetailService', () => ({}))
jest.mock('../src/utils/modelHelper', () => ({
  isClaudeFamilyModel: jest.fn(() => false)
}))
jest.mock('../src/utils/requestDetailHelper', () => ({
  finalizeRequestDetailMeta: jest.fn((value) => value)
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: jest.fn((_req, _res, next) => next())
}))

jest.mock('../src/utils/costCalculator', () => ({
  calculateCost: jest.fn(),
  formatCost: jest.fn()
}))

jest.mock('../src/services/requestBodyRuleService', () => ({
  validateAndNormalizeRules: jest.fn((rules) => ({
    valid: true,
    rules: Array.isArray(rules) ? rules : []
  }))
}))

const express = require('express')
const redis = require('../src/models/redis')
const apiKeyService = require('../src/services/apiKeyService')
const apiKeysRouter = require('../src/routes/admin/apiKeys')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/admin', apiKeysRouter)
  return app
}

describe('GitHub Copilot API key bindings', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    redis.setApiKey.mockReset()
    redis.setApiKey.mockResolvedValue()
    redis.getApiKeysPaginated.mockReset()
    redis.getApiKeysPaginated.mockResolvedValue({ items: [] })
    redis.getApiKey.mockReset()
  })

  test('exposes test helpers for github copilot account normalization', () => {
    expect(apiKeyService._testOnly.normalizeAccountTypeKey('github_copilot')).toBe('github-copilot')
    expect(apiKeyService._testOnly.normalizeAccountTypeKey('github-copilot')).toBe('github-copilot')
    expect(apiKeyService._testOnly.normalizeAccountTypeKey('copilot')).toBe('github-copilot')
    expect(apiKeyService._testOnly.sanitizeAccountIdForType('copilot:acct-1', 'github-copilot')).toBe(
      'acct-1'
    )
  })

  test('generateApiKey preserves copilot openaiAccountId without adding a dedicated field', async () => {
    const result = await apiKeyService.generateApiKey({
      name: 'Copilot Key',
      openaiAccountId: 'copilot:acct-1'
    })
    const [, storedKeyData] = redis.setApiKey.mock.calls[0]

    expect(storedKeyData.openaiAccountId).toBe('copilot:acct-1')
    expect(storedKeyData.githubCopilotAccountId).toBeUndefined()
    expect(result.openaiAccountId).toBe('copilot:acct-1')
    expect(result.githubCopilotAccountId).toBeUndefined()
  })

  test('binding counts keep copilot-prefixed OpenAI bindings separate from plain OpenAI ids', async () => {
    const app = createApp()

    redis.getApiKeysPaginated.mockResolvedValue({
      items: [
        { openaiAccountId: 'copilot:acct-1' },
        { openaiAccountId: 'copilot:acct-1' },
        { openaiAccountId: 'acct-1' }
      ]
    })

    const response = await request(app).get('/admin/accounts/binding-counts')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        openaiAccountId: {
          'copilot:acct-1': 2,
          'acct-1': 1
        }
      })
    })
  })

  test('create route forwards copilot binding through openaiAccountId as-is', async () => {
    const app = createApp()
    const generateApiKeySpy = jest.spyOn(apiKeyService, 'generateApiKey').mockResolvedValue({
      id: 'key-1',
      apiKey: 'cr_secret',
      openaiAccountId: 'copilot:acct-1'
    })

    const response = await request(app).post('/admin/api-keys').send({
      name: 'Copilot Key',
      openaiAccountId: 'copilot:acct-1'
    })

    expect(response.status).toBe(200)
    expect(generateApiKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        openaiAccountId: 'copilot:acct-1'
      })
    )
    expect(generateApiKeySpy.mock.calls[0][0].githubCopilotAccountId).toBeUndefined()
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        openaiAccountId: 'copilot:acct-1'
      })
    })
  })

  test('batch update route keeps copilot binding in openaiAccountId', async () => {
    const app = createApp()
    const updateApiKeySpy = jest.spyOn(apiKeyService, 'updateApiKey').mockResolvedValue()

    redis.getApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'Existing Key',
      tags: '[]'
    })

    const response = await request(app).put('/admin/api-keys/batch').send({
      keyIds: ['key-1'],
      updates: {
        openaiAccountId: 'copilot:acct-1'
      }
    })

    expect(response.status).toBe(200)
    expect(updateApiKeySpy).toHaveBeenCalledWith(
      'key-1',
      expect.objectContaining({ openaiAccountId: 'copilot:acct-1' })
    )
    expect(updateApiKeySpy.mock.calls[0][1].githubCopilotAccountId).toBeUndefined()
    expect(response.body).toEqual({
      success: true,
      message: '批量编辑完成',
      data: {
        successCount: 1,
        failedCount: 0,
        errors: []
      }
    })
  })

  test('single update route keeps copilot binding in openaiAccountId', async () => {
    const app = createApp()
    const updateApiKeySpy = jest.spyOn(apiKeyService, 'updateApiKey').mockResolvedValue()

    const response = await request(app).put('/admin/api-keys/key-1').send({
      openaiAccountId: 'copilot:acct-1'
    })

    expect(response.status).toBe(200)
    expect(updateApiKeySpy).toHaveBeenCalledWith('key-1', {
      openaiAccountId: 'copilot:acct-1'
    })
    expect(response.body).toEqual({
      success: true,
      message: 'API key updated successfully'
    })
  })
})
