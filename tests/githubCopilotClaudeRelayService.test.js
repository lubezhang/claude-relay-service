const EventEmitter = require('events')
const express = require('express')
const request = require('supertest')

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
    getHeader: jest.fn((key) => res.headers[key]),
    write: jest.fn((chunk) => {
      res.writes.push(chunk.toString())
      return true
    }),
    end: jest.fn(() => {
      res.writableEnded = true
    }),
    flushHeaders: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    writes: []
  }

  return res
}

function createRequest(body, apiKeyData = {}) {
  const req = new EventEmitter()
  req.body = body
  req.headers = {}
  req.method = 'POST'
  req.path = '/v1/messages'
  req.originalUrl = '/v1/messages'
  req.apiKey = apiKeyData
  req.rateLimitInfo = null
  return req
}

describe('githubCopilotClaudeRelayService', () => {
  let githubCopilotAccountService
  let githubCopilotRelayService
  let githubCopilotClaudeRelayService

  beforeEach(() => {
    jest.resetModules()

    jest.doMock('../src/services/account/githubCopilotAccountService', () => ({
      getAccount: jest.fn()
    }))

    jest.doMock('../src/services/relay/githubCopilotRelayService', () => ({
      handleRequest: jest.fn()
    }))

    jest.doMock('../src/services/apiKeyService', () => ({
      recordUsageWithDetails: jest.fn(async () => ({ totalTokens: 6, totalCost: 0.0001 }))
    }))

    jest.doMock('../src/utils/rateLimitHelper', () => ({
      updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 6, totalCost: 0.0001 }))
    }))

    jest.doMock('../src/utils/requestDetailHelper', () => ({
      createRequestDetailMeta: jest.fn(() => ({ requestId: 'detail-1' })),
      extractOpenAICacheReadTokens: jest.fn(
        (usage = {}) => usage.prompt_tokens_details?.cached_tokens || 0
      )
    }))

    jest.doMock('../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      api: jest.fn()
    }))

    githubCopilotAccountService = require('../src/services/account/githubCopilotAccountService')
    githubCopilotRelayService = require('../src/services/relay/githubCopilotRelayService')
    githubCopilotClaudeRelayService = require('../src/services/relay/githubCopilotClaudeRelayService')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('translates anthropic messages through GitHub Copilot relay for non-stream text responses', async () => {
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (openAIReq, captureRes) => {
      expect(openAIReq.body).toEqual({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Hello from Claude' }],
        max_tokens: 256,
        stream: false
      })

      return captureRes.status(200).json({
        id: 'chatcmpl-1',
        model: 'gpt-4.1',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Hello from Copilot'
            }
          }
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18
        }
      })
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 256,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello from Claude' }]
          }
        ]
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    const res = createJsonResponse()

    await githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)

    expect(githubCopilotAccountService.getAccount).toHaveBeenCalledWith('copilot-1')
    expect(githubCopilotRelayService.handleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          model: 'gpt-4.1',
          messages: [{ role: 'user', content: 'Hello from Claude' }],
          max_tokens: 256,
          stream: false
        }
      }),
      expect.any(Object),
      expect.objectContaining({ id: 'copilot-1' }),
      expect.objectContaining({ id: 'key-1' })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      id: 'chatcmpl-1',
      type: 'message',
      role: 'assistant',
      model: 'gpt-4.1',
      content: [{ type: 'text', text: 'Hello from Copilot' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 11,
        output_tokens: 7
      }
    })
  })

  test('maps system prompt and haiku model to OpenAI request shape', () => {
    const payload = githubCopilotClaudeRelayService._testOnly.anthropicMessagesToOpenAI({
      model: 'claude-3-5-haiku',
      system: [{ type: 'text', text: 'You are concise' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
      max_tokens: 128,
      stream: false
    })

    expect(githubCopilotClaudeRelayService._testOnly.mapAnthropicModel('claude-3-5-haiku')).toBe(
      'gpt-4.1-mini'
    )
    expect(payload).toEqual({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are concise' },
        { role: 'user', content: 'Ping' }
      ],
      max_tokens: 128,
      stream: false
    })
  })

  test('maps Anthropic tool_use and tool_result blocks to OpenAI tool calls and tool messages', () => {
    const payload = githubCopilotClaudeRelayService._testOnly.anthropicMessagesToOpenAI({
      model: 'claude-sonnet-4-5',
      stream: false,
      tool_choice: { type: 'any' },
      tools: [
        {
          name: 'lookup_user',
          description: 'Look up a user by id',
          input_schema: {
            type: 'object',
            properties: {
              userId: { type: 'string' }
            },
            required: ['userId']
          }
        }
      ],
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'lookup_user',
              input: { userId: 'user-1' }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '{"name":"Ada"}'
            },
            {
              type: 'text',
              text: 'Please summarize the user.'
            }
          ]
        }
      ]
    })

    expect(payload.tool_choice).toBe('required')
    expect(payload.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup_user',
          description: 'Look up a user by id',
          parameters: {
            type: 'object',
            properties: {
              userId: { type: 'string' }
            },
            required: ['userId']
          }
        }
      }
    ])
    expect(payload.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: {
              name: 'lookup_user',
              arguments: '{"userId":"user-1"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        content: '{"name":"Ada"}'
      },
      {
        role: 'user',
        content: 'Please summarize the user.'
      }
    ])
  })

  test('maps OpenAI tool calls back to Anthropic tool_use blocks', () => {
    const response = githubCopilotClaudeRelayService._testOnly.openAIResponseToAnthropic({
      id: 'chatcmpl-2',
      model: 'gpt-4.1',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: 'Need tool execution.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'lookup_user',
                  arguments: '{"userId":"user-1"}'
                }
              }
            ]
          }
        }
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 3,
        total_tokens: 8
      }
    })

    expect(response).toEqual({
      id: 'chatcmpl-2',
      type: 'message',
      role: 'assistant',
      model: 'gpt-4.1',
      content: [
        { type: 'text', text: 'Need tool execution.' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'lookup_user',
          input: { userId: 'user-1' }
        }
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 5,
        output_tokens: 3
      }
    })
  })


  test('buffers split OpenAI SSE JSON chunks before translating to Anthropic events', async () => {
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (_openAIReq, captureRes) => {
      captureRes.status(200)
      captureRes.setHeader('Content-Type', 'text/event-stream')
      captureRes.write(
        'data: {"id":"chatcmpl-1","model":"gpt-4.1","choices":[{"delta":{"role":"assistant"}'
      )
      captureRes.write('}]}\n\n')
      captureRes.write(
        'data: {"id":"chatcmpl-1","model":"gpt-4.1","choices":[{"delta":{"content":"hello"}}]}\n\n'
      )
      captureRes.write(
        'data: {"id":"chatcmpl-1","model":"gpt-4.1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":4}}\n\n'
      )
      captureRes.end('data: [DONE]\n\n')
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: true
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    const res = createJsonResponse()

    await expect(
      githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)
    ).resolves.toBeUndefined()

    const output = res.writes.join('')
    expect(output).toContain('event: message_start')
    expect(output).toContain('event: content_block_delta')
    expect(output).toContain('hello')
    expect(output).toContain('event: message_stop')
    expect(res.end).toHaveBeenCalledTimes(1)
  })

  test('records stream usage without blocking stream completion', async () => {
    const apiKeyService = require('../src/services/apiKeyService')
    const rateLimitHelper = require('../src/utils/rateLimitHelper')

    let resolveUsage
    const usagePromise = new Promise((resolve) => {
      resolveUsage = resolve
    })
    apiKeyService.recordUsageWithDetails.mockReturnValue(usagePromise)

    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (_openAIReq, captureRes) => {
      captureRes.status(200)
      captureRes.setHeader('Content-Type', 'text/event-stream')
      captureRes.write(
        'data: {"id":"chatcmpl-usage","model":"gpt-4.1","choices":[{"delta":{"role":"assistant"}}]}\n\n'
      )
      captureRes.write(
        'data: {"id":"chatcmpl-usage","model":"gpt-4.1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":2}}}\n\n'
      )
      captureRes.end('data: [DONE]\n\n')
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: true
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    req.rateLimitInfo = { tokenCountKey: 'tokens', costCountKey: 'cost' }
    const res = createJsonResponse()

    await githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)

    expect(res.end).toHaveBeenCalled()
    expect(apiKeyService.recordUsageWithDetails).toHaveBeenCalledWith(
      'key-1',
      {
        input_tokens: 3,
        output_tokens: 3,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2
      },
      'gpt-4.1',
      'copilot-1',
      'github-copilot',
      { requestId: 'detail-1' }
    )

    resolveUsage({ totalTokens: 6, totalCost: 0.0001 })
    await usagePromise
    await new Promise((resolve) => setImmediate(resolve))

    expect(rateLimitHelper.updateRateLimitCounters).toHaveBeenCalledWith(
      req.rateLimitInfo,
      {
        inputTokens: 3,
        outputTokens: 3,
        cacheCreateTokens: 0,
        cacheReadTokens: 2
      },
      'gpt-4.1',
      'key-1',
      'github-copilot',
      { totalTokens: 6, totalCost: 0.0001 }
    )
  })

  test('records stream usage with mapped OpenAI model when upstream usage chunk omits model', async () => {
    const apiKeyService = require('../src/services/apiKeyService')

    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (_openAIReq, captureRes) => {
      captureRes.status(200)
      captureRes.setHeader('Content-Type', 'text/event-stream')
      captureRes.write('data: {"id":"chatcmpl-usage","choices":[{"delta":{"role":"assistant"}}]}\n\n')
      captureRes.write(
        'data: {"id":"chatcmpl-usage","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'
      )
      captureRes.end('data: [DONE]\n\n')
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: true
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    const res = createJsonResponse()

    await githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)

    expect(apiKeyService.recordUsageWithDetails).toHaveBeenCalledWith(
      'key-1',
      {
        input_tokens: 4,
        output_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      },
      'gpt-4.1',
      'copilot-1',
      'github-copilot',
      { requestId: 'detail-1' }
    )
  })

  test('turns malformed stream chunks into safe Anthropic SSE errors', async () => {
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (_openAIReq, captureRes) => {
      captureRes.status(200)
      captureRes.setHeader('Content-Type', 'text/event-stream')
      captureRes.write('data: {"id":')
      captureRes.end('"broken"\n\n')
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: true
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    const res = createJsonResponse()

    await expect(
      githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)
    ).resolves.toBeUndefined()

    const output = res.writes.join('')
    expect(output).toContain('event: error')
    expect(output).toContain('api_error')
    expect(res.end).toHaveBeenCalled()
  })

  test('non-2xx stream responses return a safe Anthropic SSE error event', async () => {
    githubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'copilot-1',
      name: 'Copilot 1',
      accountType: 'individual'
    })

    githubCopilotRelayService.handleRequest.mockImplementation(async (_openAIReq, captureRes) => {
      captureRes.status(429)
      captureRes.setHeader('Content-Type', 'text/event-stream')
      captureRes.json({ error: { message: 'rate limited' } })
    })

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: true
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:copilot-1'
      }
    )
    const res = createJsonResponse()

    await expect(
      githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)
    ).resolves.toBeUndefined()

    const output = res.writes.join('')
    expect(output).toContain('event: error')
    expect(output).toContain('rate limited')
    expect(res.json).not.toHaveBeenCalled()
    expect(res.end).toHaveBeenCalled()
  })

  test('returns 404 when the bound GitHub Copilot account does not exist', async () => {
    githubCopilotAccountService.getAccount.mockResolvedValue(null)

    const req = createRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
        stream: false
      },
      {
        id: 'key-1',
        openaiAccountId: 'copilot:missing-account'
      }
    )
    const res = createJsonResponse()

    await githubCopilotClaudeRelayService.handleMessages(req, res, req.apiKey)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        type: 'not_found_error',
        message: 'GitHub Copilot account not found'
      }
    })
    expect(githubCopilotRelayService.handleRequest).not.toHaveBeenCalled()
  })
})

describe('api.js Claude messages route Copilot adapter branch', () => {
  function buildApp(router) {
    const app = express()
    app.use(express.json())
    app.use('/api', router)
    return app
  }

  beforeEach(() => {
    jest.resetModules()
  })

  test('calls GitHub Copilot Claude adapter when API key binds copilot account', async () => {
    let apiRouter
    let githubCopilotClaudeRelayService
    let unifiedClaudeScheduler

    jest.isolateModules(() => {
      jest.doMock('../src/middleware/auth', () => ({
        authenticateApiKey: (req, _res, next) => {
          req.apiKey = {
            id: 'key-1',
            name: 'Test Key',
            permissions: ['claude'],
            tokenLimit: 0,
            openaiAccountId: req.headers['x-openai-account-id'] || null
          }
          req.rateLimitInfo = null
          next()
        }
      }))

      jest.doMock('../src/services/relay/githubCopilotClaudeRelayService', () => ({
        handleMessages: jest.fn((req, res) => {
          res.status(200).json({
            id: 'msg_copilot',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: req.apiKey.openaiAccountId }],
            usage: { input_tokens: 1, output_tokens: 1 }
          })
        })
      }))

      jest.doMock('../src/services/relay/claudeRelayService', () => ({
        relayRequest: jest.fn(),
        relayStreamRequestWithUsageCapture: jest.fn(),
        _buildStandardRateLimitMessage: jest.fn(() => 'rate limited')
      }))

      jest.doMock('../src/services/relay/claudeConsoleRelayService', () => ({
        relayRequest: jest.fn(),
        relayStreamRequestWithUsageCapture: jest.fn()
      }))

      jest.doMock('../src/services/relay/bedrockRelayService', () => ({
        handleStreamRequest: jest.fn(),
        handleNonStreamRequest: jest.fn()
      }))

      jest.doMock('../src/services/relay/ccrRelayService', () => ({
        relayRequest: jest.fn(),
        relayStreamRequestWithUsageCapture: jest.fn()
      }))

      jest.doMock('../src/services/account/bedrockAccountService', () => ({
        getAccount: jest.fn()
      }))

      jest.doMock('../src/services/scheduler/unifiedClaudeScheduler', () => ({
        selectAccountForApiKey: jest.fn(),
        clearSessionMapping: jest.fn(),
        _isAccountAvailable: jest.fn()
      }))

      jest.doMock('../src/services/apiKeyService', () => ({
        hasPermission: jest.fn(() => true),
        recordUsageWithDetails: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 })),
        getUsageStats: jest.fn(async () => ({ totalTokens: 0 })),
        getAllApiKeys: jest.fn(async () => [])
      }))

      jest.doMock('../src/utils/logger', () => ({
        api: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        success: jest.fn()
      }))

      jest.doMock('../src/utils/sessionHelper', () => ({
        generateSessionHash: jest.fn(() => 'session-hash')
      }))

      jest.doMock('../src/utils/rateLimitHelper', () => ({
        updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
      }))

      jest.doMock('../src/services/claudeRelayConfigService', () => ({
        isGlobalSessionBindingEnabled: jest.fn(async () => false),
        extractOriginalSessionId: jest.fn(() => null),
        validateNewSession: jest.fn(async () => ({ valid: true, isNewSession: false })),
        getSessionBindingErrorMessage: jest.fn(async () => 'session binding failed'),
        setOriginalSessionBinding: jest.fn(async () => undefined),
        getConfig: jest.fn(async () => ({ sessionBindingErrorMessage: 'session invalid' }))
      }))

      jest.doMock('../src/services/account/claudeAccountService', () => ({
        getAccount: jest.fn()
      }))

      jest.doMock('../src/services/account/claudeConsoleAccountService', () => ({
        getAccount: jest.fn(),
        isCountTokensUnavailable: jest.fn(async () => false),
        markCountTokensUnavailable: jest.fn(async () => undefined),
        isSubscriptionExpired: jest.fn(() => false),
        checkQuotaUsage: jest.fn(async () => undefined),
        isAccountRateLimited: jest.fn(async () => false),
        isAccountQuotaExceeded: jest.fn(async () => false),
        isAccountOverloaded: jest.fn(async () => false)
      }))

      jest.doMock('../src/utils/warmupInterceptor', () => ({
        isWarmupRequest: jest.fn(() => false),
        buildMockWarmupResponse: jest.fn(() => ({ type: 'message' })),
        sendMockWarmupStream: jest.fn()
      }))

      jest.doMock('../src/utils/errorSanitizer', () => ({
        sanitizeUpstreamError: jest.fn((value) => value)
      }))

      jest.doMock('../src/utils/anthropicRequestDump', () => ({
        dumpAnthropicMessagesRequest: jest.fn()
      }))

      jest.doMock('../src/utils/requestDetailHelper', () => ({
        createRequestDetailMeta: jest.fn(() => ({}))
      }))

      jest.doMock('../src/services/anthropicGeminiBridgeService', () => ({
        handleAnthropicMessagesToGemini: jest.fn(),
        handleAnthropicCountTokensToGemini: jest.fn()
      }))

      apiRouter = require('../src/routes/api')
      githubCopilotClaudeRelayService = require('../src/services/relay/githubCopilotClaudeRelayService')
      unifiedClaudeScheduler = require('../src/services/scheduler/unifiedClaudeScheduler')
    })

    const app = buildApp(apiRouter)
    const response = await request(app)
      .post('/api/v1/messages')
      .set('x-openai-account-id', 'copilot:copilot-1')
      .send({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }]
      })

    expect(response.status).toBe(200)
    expect(response.body.content[0].text).toBe('copilot:copilot-1')
    expect(githubCopilotClaudeRelayService.handleMessages).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ openaiAccountId: 'copilot:copilot-1' })
    )
    expect(unifiedClaudeScheduler.selectAccountForApiKey).not.toHaveBeenCalled()
  })

  test('does not call GitHub Copilot Claude adapter for non-copilot API keys', async () => {
    let apiRouter
    let githubCopilotClaudeRelayService
    let unifiedClaudeScheduler
    let claudeConsoleRelayService

    jest.isolateModules(() => {
      jest.doMock('../src/middleware/auth', () => ({
        authenticateApiKey: (req, _res, next) => {
          req.apiKey = {
            id: 'key-1',
            name: 'Test Key',
            permissions: ['claude'],
            tokenLimit: 0,
            openaiAccountId: req.headers['x-openai-account-id'] || null
          }
          req.rateLimitInfo = null
          next()
        }
      }))

      jest.doMock('../src/services/relay/githubCopilotClaudeRelayService', () => ({
        handleMessages: jest.fn()
      }))

      jest.doMock('../src/services/relay/claudeRelayService', () => ({
        relayRequest: jest.fn(),
        relayStreamRequestWithUsageCapture: jest.fn(),
        _buildStandardRateLimitMessage: jest.fn(() => 'rate limited')
      }))

      jest.doMock('../src/services/relay/claudeConsoleRelayService', () => ({
        relayRequest: jest.fn(async () => ({
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'msg_1',
            type: 'message',
            model: 'claude-sonnet-4-5',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          accountId: 'console-1'
        })),
        relayStreamRequestWithUsageCapture: jest.fn()
      }))

      jest.doMock('../src/services/relay/bedrockRelayService', () => ({
        handleStreamRequest: jest.fn(),
        handleNonStreamRequest: jest.fn()
      }))

      jest.doMock('../src/services/relay/ccrRelayService', () => ({
        relayRequest: jest.fn(),
        relayStreamRequestWithUsageCapture: jest.fn()
      }))

      jest.doMock('../src/services/account/bedrockAccountService', () => ({
        getAccount: jest.fn()
      }))

      jest.doMock('../src/services/scheduler/unifiedClaudeScheduler', () => ({
        selectAccountForApiKey: jest.fn(async () => ({
          accountId: 'console-1',
          accountType: 'claude-console'
        })),
        clearSessionMapping: jest.fn(),
        _isAccountAvailable: jest.fn()
      }))

      jest.doMock('../src/services/apiKeyService', () => ({
        hasPermission: jest.fn(() => true),
        recordUsageWithDetails: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 })),
        getUsageStats: jest.fn(async () => ({ totalTokens: 0 })),
        getAllApiKeys: jest.fn(async () => [])
      }))

      jest.doMock('../src/utils/logger', () => ({
        api: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        success: jest.fn()
      }))

      jest.doMock('../src/utils/sessionHelper', () => ({
        generateSessionHash: jest.fn(() => 'session-hash')
      }))

      jest.doMock('../src/utils/rateLimitHelper', () => ({
        updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
      }))

      jest.doMock('../src/services/claudeRelayConfigService', () => ({
        isGlobalSessionBindingEnabled: jest.fn(async () => false),
        extractOriginalSessionId: jest.fn(() => null),
        validateNewSession: jest.fn(async () => ({ valid: true, isNewSession: false })),
        getSessionBindingErrorMessage: jest.fn(async () => 'session binding failed'),
        setOriginalSessionBinding: jest.fn(async () => undefined),
        getConfig: jest.fn(async () => ({ sessionBindingErrorMessage: 'session invalid' }))
      }))

      jest.doMock('../src/services/account/claudeAccountService', () => ({
        getAccount: jest.fn()
      }))

      jest.doMock('../src/services/account/claudeConsoleAccountService', () => ({
        getAccount: jest.fn(async () => ({ id: 'console-1', name: 'Console 1' })),
        isCountTokensUnavailable: jest.fn(async () => false),
        markCountTokensUnavailable: jest.fn(async () => undefined),
        isSubscriptionExpired: jest.fn(() => false),
        checkQuotaUsage: jest.fn(async () => undefined),
        isAccountRateLimited: jest.fn(async () => false),
        isAccountQuotaExceeded: jest.fn(async () => false),
        isAccountOverloaded: jest.fn(async () => false)
      }))

      jest.doMock('../src/utils/warmupInterceptor', () => ({
        isWarmupRequest: jest.fn(() => false),
        buildMockWarmupResponse: jest.fn(() => ({ type: 'message' })),
        sendMockWarmupStream: jest.fn()
      }))

      jest.doMock('../src/utils/errorSanitizer', () => ({
        sanitizeUpstreamError: jest.fn((value) => value)
      }))

      jest.doMock('../src/utils/anthropicRequestDump', () => ({
        dumpAnthropicMessagesRequest: jest.fn()
      }))

      jest.doMock('../src/utils/requestDetailHelper', () => ({
        createRequestDetailMeta: jest.fn(() => ({}))
      }))

      jest.doMock('../src/services/anthropicGeminiBridgeService', () => ({
        handleAnthropicMessagesToGemini: jest.fn(),
        handleAnthropicCountTokensToGemini: jest.fn()
      }))

      apiRouter = require('../src/routes/api')
      githubCopilotClaudeRelayService = require('../src/services/relay/githubCopilotClaudeRelayService')
      unifiedClaudeScheduler = require('../src/services/scheduler/unifiedClaudeScheduler')
      claudeConsoleRelayService = require('../src/services/relay/claudeConsoleRelayService')
    })

    const app = buildApp(apiRouter)
    const response = await request(app).post('/api/v1/messages').send({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
      stream: false
    })

    expect(response.status).toBe(200)
    expect(response.body.type).toBe('message')
    expect(githubCopilotClaudeRelayService.handleMessages).not.toHaveBeenCalled()
    expect(unifiedClaudeScheduler.selectAccountForApiKey).toHaveBeenCalled()
    expect(claudeConsoleRelayService.relayRequest).toHaveBeenCalled()
  })
})
