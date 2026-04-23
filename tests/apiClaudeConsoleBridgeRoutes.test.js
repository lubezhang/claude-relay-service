const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (req, res, next) => {
    req.apiKey = {
      id: 'key-1',
      name: 'Test Key',
      permissions: ['claude'],
      tokenLimit: 0
    }
    req.rateLimitInfo = null
    next()
  }
}))

jest.mock('../src/services/relay/claudeRelayService', () => ({
  relayRequest: jest.fn(),
  relayStreamRequestWithUsageCapture: jest.fn(),
  _buildStandardRateLimitMessage: jest.fn(() => 'rate limited')
}))

jest.mock('../src/services/relay/claudeConsoleRelayService', () => ({
  relayRequest: jest.fn(),
  relayStreamRequestWithUsageCapture: jest.fn()
}))

jest.mock('../src/services/relay/bedrockRelayService', () => ({
  handleStreamRequest: jest.fn(),
  handleNonStreamRequest: jest.fn()
}))

jest.mock('../src/services/relay/ccrRelayService', () => ({
  relayRequest: jest.fn(),
  relayStreamRequestWithUsageCapture: jest.fn()
}))

jest.mock('../src/services/account/bedrockAccountService', () => ({
  getAccount: jest.fn()
}))

jest.mock('../src/services/scheduler/unifiedClaudeScheduler', () => ({
  selectAccountForApiKey: jest.fn(),
  clearSessionMapping: jest.fn(),
  _isAccountAvailable: jest.fn()
}))

jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn(() => true),
  recordUsageWithDetails: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 })),
  getUsageStats: jest.fn(async () => ({ totalTokens: 0 })),
  getAllApiKeys: jest.fn(async () => [])
}))

jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/utils/sessionHelper', () => ({
  generateSessionHash: jest.fn(() => 'session-hash')
}))

jest.mock('../src/utils/rateLimitHelper', () => ({
  updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
}))

jest.mock('../src/services/claudeRelayConfigService', () => ({
  isGlobalSessionBindingEnabled: jest.fn(async () => false),
  extractOriginalSessionId: jest.fn(() => null),
  validateNewSession: jest.fn(async () => ({ valid: true, isNewSession: false })),
  getSessionBindingErrorMessage: jest.fn(async () => 'session binding failed'),
  setOriginalSessionBinding: jest.fn(async () => undefined),
  getConfig: jest.fn(async () => ({ sessionBindingErrorMessage: 'session invalid' }))
}))

jest.mock('../src/services/account/claudeAccountService', () => ({
  getAccount: jest.fn()
}))

jest.mock('../src/services/account/claudeConsoleAccountService', () => ({
  getAccount: jest.fn(),
  isCountTokensUnavailable: jest.fn(async () => false),
  markCountTokensUnavailable: jest.fn(async () => undefined),
  isSubscriptionExpired: jest.fn(() => false),
  checkQuotaUsage: jest.fn(async () => undefined),
  isAccountRateLimited: jest.fn(async () => false),
  isAccountQuotaExceeded: jest.fn(async () => false),
  isAccountOverloaded: jest.fn(async () => false)
}))

jest.mock('../src/utils/warmupInterceptor', () => ({
  isWarmupRequest: jest.fn(() => false),
  buildMockWarmupResponse: jest.fn(() => ({ type: 'message' })),
  sendMockWarmupStream: jest.fn()
}))

jest.mock('../src/utils/errorSanitizer', () => ({
  sanitizeUpstreamError: jest.fn((value) => value)
}))

jest.mock('../src/utils/anthropicRequestDump', () => ({
  dumpAnthropicMessagesRequest: jest.fn()
}))

jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn(() => ({}))
}))

jest.mock('../src/services/anthropicGeminiBridgeService', () => ({
  handleAnthropicMessagesToGemini: jest.fn(),
  handleAnthropicCountTokensToGemini: jest.fn()
}))

const apiRouter = require('../src/routes/api')
const claudeConsoleRelayService = require('../src/services/relay/claudeConsoleRelayService')
const unifiedClaudeScheduler = require('../src/services/scheduler/unifiedClaudeScheduler')
const claudeConsoleAccountService = require('../src/services/account/claudeConsoleAccountService')
const apiKeyService = require('../src/services/apiKeyService')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', apiRouter)
  return app
}

describe('Claude Console bridge wrapper routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'console-1',
      name: 'Console Bridge',
      isActive: true,
      schedulable: true,
      status: 'active',
      supportedModels: [],
      enableOpenAIProtocolBridge: true
    })
    unifiedClaudeScheduler._isAccountAvailable.mockResolvedValue(true)
  })

  test('POST /api/console/:accountId/v1/messages forwards directly to the requested Claude Console account', async () => {
    claudeConsoleRelayService.relayRequest.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_123',
        type: 'message',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 4, output_tokens: 6 }
      }),
      accountId: 'console-1'
    })

    const app = buildApp()
    const response = await request(app)
      .post('/api/console/console-1/v1/messages')
      .send({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }]
      })

    expect(response.status).toBe(200)
    expect(response.body.type).toBe('message')
    expect(unifiedClaudeScheduler.selectAccountForApiKey).not.toHaveBeenCalled()
    expect(unifiedClaudeScheduler._isAccountAvailable).toHaveBeenCalledWith(
      'console-1',
      'claude-console',
      'claude-sonnet-4-5'
    )
    expect(claudeConsoleRelayService.relayRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-5' }),
      expect.objectContaining({ id: 'key-1' }),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'console-1'
    )
  })

  test('POST /api/console/:accountId/v1/messages rejects accounts without the bridge enabled', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'console-2',
      name: 'Console Raw',
      isActive: true,
      schedulable: true,
      status: 'active',
      supportedModels: [],
      enableOpenAIProtocolBridge: false
    })

    const app = buildApp()
    const response = await request(app)
      .post('/api/console/console-2/v1/messages')
      .send({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }]
      })

    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('not_found_error')
    expect(claudeConsoleRelayService.relayRequest).not.toHaveBeenCalled()
  })

  test('POST /api/console/:accountId/v1/messages/count_tokens uses the wrapped path and custom endpoint', async () => {
    const app = buildApp()
    const response = await request(app)
      .post('/api/console/console-1/v1/messages/count_tokens')
      .send({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }]
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ input_tokens: 0 })
    expect(unifiedClaudeScheduler.selectAccountForApiKey).not.toHaveBeenCalled()
    expect(claudeConsoleRelayService.relayRequest).not.toHaveBeenCalled()
  })

  test('GET /api/console/:accountId/v1/models serves a Claude Code compatible model list for the wrapped account', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'console-1',
      name: 'Console Bridge',
      isActive: true,
      schedulable: true,
      status: 'active',
      supportedModels: {
        'claude-sonnet-4-5': 'gpt-4.1',
        'claude-haiku-4-5': 'gpt-4.1-mini'
      },
      enableOpenAIProtocolBridge: true
    })

    const app = buildApp()
    const response = await request(app).get('/api/console/console-1/v1/models')

    expect(response.status).toBe(200)
    expect(response.body.object).toBe('list')
    expect(response.body.data.map((item) => item.id)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-5'
    ])
    expect(unifiedClaudeScheduler.selectAccountForApiKey).not.toHaveBeenCalled()
  })

  test('GET /api/console/:accountId/v1/me serves a Claude Code compatible user payload for the wrapped account', async () => {
    const app = buildApp()
    const response = await request(app).get('/api/console/console-1/v1/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(
      expect.objectContaining({
        id: 'user_key-1',
        type: 'user',
        display_name: 'Test Key'
      })
    )
  })

  test('GET /api/console/:accountId/v1/organizations/:orgId/usage serves wrapped usage data', async () => {
    apiKeyService.getUsageStats.mockResolvedValue({ totalTokens: 12 })

    const app = buildApp()
    const response = await request(app).get('/api/console/console-1/v1/organizations/org-1/usage')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      object: 'usage',
      data: [{ type: 'credit_balance', credit_balance: -12 }]
    })
  })

  test('GET wrapped helper routes reject accounts without the bridge enabled', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'console-2',
      name: 'Console Raw',
      isActive: true,
      schedulable: true,
      status: 'active',
      supportedModels: [],
      enableOpenAIProtocolBridge: false
    })

    const app = buildApp()
    const response = await request(app).get('/api/console/console-2/v1/me')

    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('not_found_error')
  })
})
