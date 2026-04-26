const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const protocol = require('../src/services/githubCopilotProtocol')

function createJsonResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    status: jest.fn((code) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((payload) => {
      res.payload = payload
      return res
    }),
    setHeader: jest.fn((key, value) => {
      res.headers[key] = value
    }),
    write: jest.fn((chunk) => {
      res.writes.push(chunk.toString())
      return true
    }),
    end: jest.fn(() => {
      res.writableEnded = true
    }),
    flushHeaders: jest.fn(),
    writes: []
  }

  return res
}

describe('githubCopilotProtocol', () => {
  test('buildCopilotBaseUrl resolves individual, business, and enterprise accounts', () => {
    expect(protocol.buildCopilotBaseUrl({ accountType: 'individual' })).toBe(
      'https://api.githubcopilot.com'
    )
    expect(protocol.buildCopilotBaseUrl({ accountType: 'business' })).toBe(
      'https://api.business.githubcopilot.com'
    )
    expect(protocol.buildCopilotBaseUrl({ accountType: 'enterprise' })).toBe(
      'https://api.enterprise.githubcopilot.com'
    )
  })

  test('buildCopilotBaseUrl uses baseApi override and removes trailing slash', () => {
    expect(protocol.buildCopilotBaseUrl({ baseApi: 'https://custom.example.com/' })).toBe(
      'https://custom.example.com'
    )
  })

  test('buildGitHubHeaders uses GitHub token authorization scheme', () => {
    const headers = protocol.buildGitHubHeaders('github-token-1')

    expect(headers.authorization).toBe('token github-token-1')
  })

  test('buildCopilotHeaders includes required Copilot client headers', () => {
    const headers = protocol.buildCopilotHeaders({ vsCodeVersion: '1.99.0' }, 'copilot-token-1', {
      stream: true,
      vision: true
    })

    expect(headers.authorization).toBe('Bearer copilot-token-1')
    expect(headers.accept).toBe('text/event-stream')
    expect(headers['copilot-integration-id']).toBe('vscode-chat')
    expect(headers['editor-version']).toBe('vscode/1.99.0')
    expect(headers['editor-plugin-version']).toBe('copilot-chat/0.26.7')
    expect(headers['user-agent']).toBe('GitHubCopilotChat/0.26.7')
    expect(headers['openai-intent']).toBe('conversation-panel')
    expect(headers['x-github-api-version']).toBe('2025-04-01')
    expect(headers['copilot-vision-request']).toBe('true')
    expect(headers['x-request-id']).toEqual(expect.any(String))
  })

  test('hasVisionContent detects image_url content blocks', () => {
    expect(
      protocol.hasVisionContent({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }]
      })
    ).toBe(true)
  })
})

describe('githubCopilotRelayService', () => {
  let axios
  let githubCopilotAccountService
  let apiKeyService
  let rateLimitHelper
  let logger
  let relayService

  beforeEach(() => {
    jest.resetModules()

    jest.doMock('axios', () => ({
      post: jest.fn(),
      get: jest.fn()
    }))

    jest.doMock(
      '../config/config',
      () => ({
        requestTimeout: 1234
      }),
      { virtual: true }
    )

    jest.doMock('../src/services/account/githubCopilotAccountService', () => ({
      ensureCopilotToken: jest.fn()
    }))

    jest.doMock('../src/services/apiKeyService', () => ({
      recordUsageWithDetails: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
    }))

    jest.doMock('../src/utils/rateLimitHelper', () => ({
      updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
    }))

    jest.doMock('../src/utils/requestDetailHelper', () => ({
      createRequestDetailMeta: jest.fn(() => ({ requestId: 'detail-1' })),
      extractOpenAICacheReadTokens: jest.fn(() => 0)
    }))

    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }))

    jest.doMock('../src/utils/proxyHelper', () => ({
      createProxyAgent: jest.fn(() => null),
      getProxyDescription: jest.fn(() => 'none')
    }))

    axios = require('axios')
    githubCopilotAccountService = require('../src/services/account/githubCopilotAccountService')
    apiKeyService = require('../src/services/apiKeyService')
    rateLimitHelper = require('../src/utils/rateLimitHelper')
    logger = require('../src/utils/logger')
    relayService = require('../src/services/relay/githubCopilotRelayService')
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.dontMock('axios')
  })

  test('relays non-stream OpenAI chat completions through GitHub Copilot', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    axios.post.mockResolvedValue({
      status: 200,
      data: { id: 'chatcmpl-1', choices: [] }
    })

    const req = new EventEmitter()
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }

    const res = createJsonResponse()
    const account = { id: 'copilot-1', name: 'Copilot', accountType: 'individual' }
    const apiKeyData = { id: 'key-1' }

    await relayService.handleRequest(req, res, account, apiKeyData)

    expect(githubCopilotAccountService.ensureCopilotToken).toHaveBeenCalledWith('copilot-1')
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      req.body,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer copilot-token',
          accept: 'application/json'
        }),
        timeout: 1234,
        validateStatus: expect.any(Function),
        signal: expect.any(Object)
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id: 'chatcmpl-1', choices: [] })
  })

  test('relays stream responses as SSE and aborts upstream when client closes', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    const upstream = new PassThrough()
    axios.post.mockResolvedValue({
      status: 200,
      data: upstream
    })

    const req = new EventEmitter()
    req.body = {
      model: 'gpt-4o-mini',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }]
    }

    const res = createJsonResponse()
    const account = { id: 'copilot-1', name: 'Copilot', accountType: 'individual' }

    const relayPromise = relayService.handleRequest(req, res, account, { id: 'key-1' })
    await new Promise((resolve) => setImmediate(resolve))

    const requestConfig = axios.post.mock.calls[0][2]
    expect(requestConfig.responseType).toBe('stream')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')

    upstream.write('data: {"id":"chatcmpl-1"}\n\n')
    req.emit('close')
    expect(requestConfig.signal.aborted).toBe(true)

    upstream.end('data: [DONE]\n\n')
    await relayPromise

    expect(res.writes.join('')).toContain('data: {"id":"chatcmpl-1"}')
    expect(res.end).toHaveBeenCalled()
  })

  test('records non-stream usage without logging tokens', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        id: 'chatcmpl-usage',
        model: 'gpt-4o-mini',
        choices: [],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18
        }
      }
    })

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/chat/completions'
    req.originalUrl = '/openai/v1/chat/completions'
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }
    req.rateLimitInfo = { tokenCountKey: 'tokens', costCountKey: 'cost' }

    const res = createJsonResponse()
    const account = { id: 'copilot-1', name: 'Copilot', accountType: 'individual' }
    const apiKeyData = { id: 'key-1' }

    await relayService.handleRequest(req, res, account, apiKeyData)

    expect(apiKeyService.recordUsageWithDetails).toHaveBeenCalledWith(
      'key-1',
      {
        input_tokens: 11,
        output_tokens: 7,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      },
      'gpt-4o-mini',
      'copilot-1',
      'github-copilot',
      { requestId: 'detail-1' }
    )
    expect(rateLimitHelper.updateRateLimitCounters).toHaveBeenCalledWith(
      req.rateLimitInfo,
      {
        inputTokens: 11,
        outputTokens: 7,
        cacheCreateTokens: 0,
        cacheReadTokens: 0
      },
      'gpt-4o-mini',
      'key-1',
      'github-copilot',
      { totalTokens: 0, totalCost: 0 }
    )
  })

  test('sanitizes axios errors before logging authorization headers', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    const error = new Error('upstream exploded')
    error.code = 'ERR_BAD_RESPONSE'
    error.response = { status: 502, data: { error: { message: 'bad gateway' } } }
    error.config = {
      headers: {
        authorization: 'Bearer secret-copilot-token'
      }
    }
    axios.post.mockRejectedValue(error)

    const req = new EventEmitter()
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }
    const res = createJsonResponse()

    await relayService.handleRequest(req, res, { id: 'copilot-1' }, { id: 'key-1' })

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-copilot-token')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('Bearer')
    expect(logger.error.mock.calls[0][1]).toEqual({
      message: 'upstream exploded',
      code: 'ERR_BAD_RESPONSE',
      status: 502
    })
  })

  test('destroys upstream stream and resolves when the client closes', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    const upstream = new PassThrough()
    const destroySpy = jest.spyOn(upstream, 'destroy')
    axios.post.mockResolvedValue({
      status: 200,
      data: upstream
    })

    const req = new EventEmitter()
    req.body = {
      model: 'gpt-4o-mini',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }]
    }
    const res = createJsonResponse()

    const relayPromise = relayService.handleRequest(req, res, { id: 'copilot-1' }, { id: 'key-1' })
    await new Promise((resolve) => setImmediate(resolve))

    const requestConfig = axios.post.mock.calls[0][2]
    req.emit('close')

    await expect(relayPromise).resolves.toBeUndefined()
    expect(requestConfig.signal.aborted).toBe(true)
    expect(destroySpy).toHaveBeenCalled()
  })

  test('does not wait for non-stream usage recording before returning response', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    let releaseUsage
    const usagePromise = new Promise((resolve) => {
      releaseUsage = resolve
    })
    apiKeyService.recordUsageWithDetails.mockReturnValue(usagePromise)
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        id: 'chatcmpl-pending-usage',
        model: 'gpt-4o-mini',
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7
        }
      }
    })

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/chat/completions'
    req.originalUrl = '/openai/v1/chat/completions'
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }

    const res = createJsonResponse()

    await relayService.handleRequest(req, res, { id: 'copilot-1' }, { id: 'key-1' })

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chatcmpl-pending-usage' })
    )
    expect(apiKeyService.recordUsageWithDetails).toHaveBeenCalled()

    releaseUsage({ totalTokens: 0, totalCost: 0 })
    await usagePromise
  })

  test('loads models from GitHub Copilot with Copilot authorization headers', async () => {
    githubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')
    axios.get.mockResolvedValue({
      status: 200,
      data: { object: 'list', data: [] }
    })

    const req = new EventEmitter()
    req.body = {}
    const res = createJsonResponse()
    const account = { id: 'copilot-1', name: 'Copilot', accountType: 'individual' }

    await relayService.handleModels(req, res, account)

    expect(githubCopilotAccountService.ensureCopilotToken).toHaveBeenCalledWith('copilot-1')
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer copilot-token',
          accept: 'application/json'
        }),
        timeout: 1234,
        validateStatus: expect.any(Function),
        signal: expect.any(Object)
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ object: 'list', data: [] })
  })
})

describe('openaiRoutes GitHub Copilot dispatch', () => {
  let openaiRoutes
  let unifiedOpenAIScheduler
  let githubCopilotAccountService
  let githubCopilotRelayService
  let openaiResponsesRelayService
  let axios

  beforeEach(() => {
    jest.resetModules()

    const mockRouter = {
      get: jest.fn(),
      post: jest.fn()
    }

    jest.doMock(
      'express',
      () => ({
        Router: () => mockRouter
      }),
      { virtual: true }
    )

    jest.doMock('../src/middleware/auth', () => ({
      authenticateApiKey: jest.fn((_req, _res, next) => next())
    }))

    jest.doMock('axios', () => ({
      post: jest.fn()
    }))

    jest.doMock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
      selectAccountForApiKey: jest.fn(),
      markAccountRateLimited: jest.fn(),
      isAccountRateLimited: jest.fn().mockResolvedValue(false),
      removeAccountRateLimit: jest.fn(),
      markAccountUnauthorized: jest.fn()
    }))

    jest.doMock('../src/services/account/openaiAccountService', () => ({
      getAccount: jest.fn(),
      decrypt: jest.fn(),
      isTokenExpired: jest.fn(() => false),
      refreshAccountToken: jest.fn(),
      updateCodexUsageSnapshot: jest.fn()
    }))

    jest.doMock('../src/services/account/openaiResponsesAccountService', () => ({
      getAccount: jest.fn()
    }))

    jest.doMock('../src/services/account/githubCopilotAccountService', () => ({
      getAccount: jest.fn()
    }))

    jest.doMock('../src/services/relay/openaiResponsesRelayService', () => ({
      handleRequest: jest.fn()
    }))

    jest.doMock('../src/services/relay/githubCopilotRelayService', () => ({
      handleRequest: jest.fn()
    }))

    jest.doMock('../src/services/apiKeyService', () => ({
      hasPermission: jest.fn(() => true),
      recordUsage: jest.fn(),
      recordUsageWithDetails: jest.fn()
    }))

    jest.doMock('../src/models/redis', () => ({
      getUsageStats: jest.fn()
    }))

    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      api: jest.fn(),
      security: jest.fn()
    }))

    jest.doMock('../src/utils/proxyHelper', () => ({
      createProxyAgent: jest.fn(() => null),
      getProxyDescription: jest.fn(() => 'none')
    }))

    jest.doMock('../src/utils/rateLimitHelper', () => ({
      updateRateLimitCounters: jest.fn()
    }))

    jest.doMock('../src/utils/sseParser', () => ({
      IncrementalSSEParser: jest.fn().mockImplementation(() => ({
        feed: jest.fn(() => []),
        getRemaining: jest.fn(() => '')
      }))
    }))

    jest.doMock('../src/utils/errorSanitizer', () => ({
      getSafeMessage: jest.fn((error) => error?.message || 'error')
    }))

    jest.doMock('../src/utils/requestDetailHelper', () => ({
      createRequestDetailMeta: jest.fn(() => null),
      extractOpenAICacheReadTokens: jest.fn(() => 0)
    }))

    unifiedOpenAIScheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
    githubCopilotAccountService = require('../src/services/account/githubCopilotAccountService')
    githubCopilotRelayService = require('../src/services/relay/githubCopilotRelayService')
    openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')
    axios = require('axios')
    openaiRoutes = require('../src/routes/openaiRoutes')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('dispatches github-copilot accounts to the GitHub Copilot relay path', async () => {
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'copilot-1',
      accountType: 'github-copilot'
    })
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot Account',
      proxy: { type: 'http', host: '127.0.0.1', port: 8080 }
    })
    githubCopilotRelayService.handleRequest.mockResolvedValue({ ok: true })

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/responses'
    req.originalUrl = '/openai/v1/responses'
    req.headers = { 'user-agent': 'client/1.0' }
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }
    req.apiKey = {
      id: 'key-1',
      permissions: ['openai'],
      enableOpenAIResponsesCodexAdaptation: false,
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: []
    }
    req._fromUnifiedEndpoint = false

    const res = createJsonResponse()

    await openaiRoutes.handleResponses(req, res)

    expect(githubCopilotAccountService.getAccount).toHaveBeenCalledWith('copilot-1')
    expect(githubCopilotRelayService.handleRequest).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ id: 'copilot-1', name: 'Copilot Account' }),
      req.apiKey
    )
    expect(openaiResponsesRelayService.handleRequest).not.toHaveBeenCalled()
    expect(axios.post).not.toHaveBeenCalled()
  })

  test('rejects Responses-like payloads before calling GitHub Copilot relay', async () => {
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'copilot-1',
      accountType: 'github-copilot'
    })
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot Account'
    })

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/responses'
    req.originalUrl = '/openai/v1/responses'
    req.headers = { 'user-agent': 'client/1.0' }
    req.body = {
      model: 'gpt-4o-mini',
      input: 'hello',
      stream: false
    }
    req.apiKey = {
      id: 'key-1',
      permissions: ['openai'],
      enableOpenAIResponsesCodexAdaptation: false,
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: []
    }
    req._fromUnifiedEndpoint = false

    const res = createJsonResponse()

    await openaiRoutes.handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: 'GitHub Copilot relay only supports OpenAI chat completions payloads',
        type: 'unsupported_request',
        code: 'unsupported_request'
      }
    })
    expect(githubCopilotRelayService.handleRequest).not.toHaveBeenCalled()
    expect(axios.post).not.toHaveBeenCalled()
  })

  test('allows unified chat completions converted to Responses when original chat body is available', async () => {
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'copilot-1',
      accountType: 'github-copilot'
    })
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot Account'
    })
    githubCopilotRelayService.handleRequest.mockResolvedValue({ ok: true })

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/responses'
    req.originalUrl = '/openai/v1/chat/completions'
    req.headers = { 'user-agent': 'client/1.0' }
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      instructions: 'codex instructions'
    }
    req._openAIChatCompletionsBody = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }
    req.apiKey = {
      id: 'key-1',
      permissions: ['openai'],
      enableOpenAIResponsesCodexAdaptation: false,
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: []
    }
    req._fromUnifiedEndpoint = true

    const res = createJsonResponse()

    await openaiRoutes.handleResponses(req, res)

    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(req.body).toEqual(req._openAIChatCompletionsBody)
    expect(githubCopilotRelayService.handleRequest).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ id: 'copilot-1' }),
      req.apiKey
    )
    expect(axios.post).not.toHaveBeenCalled()
  })

  test('returns 404 when scheduled github-copilot account cannot be loaded', async () => {
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'copilot-missing',
      accountType: 'github-copilot'
    })
    githubCopilotAccountService.getAccount.mockResolvedValue(null)

    const req = new EventEmitter()
    req.method = 'POST'
    req.path = '/v1/responses'
    req.originalUrl = '/openai/v1/responses'
    req.headers = { 'user-agent': 'client/1.0' }
    req.body = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }]
    }
    req.apiKey = {
      id: 'key-1',
      permissions: ['openai'],
      enableOpenAIResponsesCodexAdaptation: false,
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: []
    }
    req._fromUnifiedEndpoint = false

    const res = createJsonResponse()

    await openaiRoutes.handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: 'Scheduled GitHub Copilot account copilot-missing not found'
      }
    })
    expect(githubCopilotRelayService.handleRequest).not.toHaveBeenCalled()
  })
})

describe('unified route GitHub Copilot handoff', () => {
  let routeToBackend
  let mockBuildRequestFromOpenAI
  let mockHandleResponses

  beforeEach(() => {
    jest.resetModules()

    mockBuildRequestFromOpenAI = jest.fn((body) => ({
      model: body.model,
      stream: false,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'converted hello' }]
        }
      ]
    }))
    mockHandleResponses = jest.fn(async () => undefined)

    jest.doMock('../src/middleware/auth', () => ({
      authenticateApiKey: jest.fn((_req, _res, next) => next())
    }))

    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }))

    jest.doMock('../src/routes/openaiClaudeRoutes', () => ({
      handleChatCompletion: jest.fn()
    }))

    jest.doMock('../src/handlers/geminiHandlers', () => ({
      handleStandardGenerateContent: jest.fn(),
      handleStandardStreamGenerateContent: jest.fn()
    }))

    jest.doMock('../src/routes/openaiRoutes', () => ({
      handleResponses: mockHandleResponses,
      CODEX_CLI_INSTRUCTIONS: 'test codex instructions'
    }))

    jest.doMock('../src/services/apiKeyService', () => ({
      hasPermission: jest.fn(() => true)
    }))

    jest.doMock('../src/services/geminiToOpenAI', () => {
      return jest.fn().mockImplementation(() => ({
        createStreamState: jest.fn(),
        convertStreamChunk: jest.fn(),
        convertResponse: jest.fn()
      }))
    })

    jest.doMock('../src/services/codexToOpenAI', () => {
      return jest.fn().mockImplementation(() => ({
        createStreamState: jest.fn(() => ({ data: '' })),
        convertStreamChunk: jest.fn(() => []),
        convertResponse: jest.fn((data) => data),
        buildRequestFromOpenAI: mockBuildRequestFromOpenAI
      }))
    })

    ;({ routeToBackend } = require('../src/routes/unified'))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('preserves unified chat body snapshot before converting to Responses payload', async () => {
    const originalBody = {
      model: 'gpt-4o-mini',
      stream: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello unified' }]
        }
      ],
      metadata: {
        nested: {
          value: 'keep me'
        }
      }
    }

    const req = new EventEmitter()
    req.body = originalBody
    req.apiKey = {
      permissions: ['openai']
    }
    req.url = '/v1/chat/completions'

    const res = createJsonResponse()

    await routeToBackend(req, res, 'gpt-4o-mini')

    originalBody.messages[0].content[0].text = 'mutated after call'
    originalBody.metadata.nested.value = 'changed later'

    expect(req._fromUnifiedEndpoint).toBe(true)
    expect(req._openAIChatCompletionsBody).toEqual({
      model: 'gpt-4o-mini',
      stream: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello unified' }]
        }
      ],
      metadata: {
        nested: {
          value: 'keep me'
        }
      }
    })
    expect(req.body).toEqual({
      model: 'gpt-4o-mini',
      stream: false,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'converted hello' }]
        }
      ],
      instructions: 'test codex instructions'
    })
    expect(req.url).toBe('/v1/responses')
    expect(mockHandleResponses).toHaveBeenCalledWith(req, res)
  })
})
