const axios = require('axios')
const { PassThrough } = require('stream')

jest.mock('axios')

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  performance: jest.fn()
}))

jest.mock('../src/services/account/claudeConsoleAccountService', () => ({
  getAccount: jest.fn(),
  _createProxyAgent: jest.fn(),
  getMappedModel: jest.fn((_mapping, model) => model),
  isAccountRateLimited: jest.fn(),
  isAccountOverloaded: jest.fn(),
  removeAccountRateLimit: jest.fn(),
  removeAccountOverload: jest.fn(),
  checkQuotaUsage: jest.fn(),
  markAccountRateLimited: jest.fn(),
  markAccountOverloaded: jest.fn(),
  markConsoleAccountBlocked: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1)
  })),
  incrConsoleAccountConcurrency: jest.fn(),
  decrConsoleAccountConcurrency: jest.fn()
}))

jest.mock('../src/utils/errorSanitizer', () => ({
  sanitizeUpstreamError: jest.fn((value) => value),
  sanitizeErrorMessage: jest.fn((value) => value),
  isAccountDisabledError: jest.fn(() => false)
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn().mockResolvedValue(undefined),
  parseRetryAfter: jest.fn(() => null)
}))

jest.mock('../src/services/userMessageQueueService', () => ({
  isUserMessageRequest: jest.fn(() => false),
  acquireQueueLock: jest.fn(),
  releaseQueueLock: jest.fn()
}))

jest.mock('../config/config', () => ({
  requestTimeout: 10000
}))

const relayService = require('../src/services/relay/claudeConsoleRelayService')
const claudeConsoleAccountService = require('../src/services/account/claudeConsoleAccountService')

describe('claudeConsoleRelayService protocol bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    claudeConsoleAccountService.isAccountRateLimited.mockResolvedValue(false)
    claudeConsoleAccountService.isAccountOverloaded.mockResolvedValue(false)
  })

  test('converts anthropic request/response for OpenAI chat endpoint when bridge enabled', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'acc-1',
      name: 'console-openai',
      apiUrl: 'https://openai.example.com/v1/chat/completions',
      apiKey: 'sk-openai-key',
      supportedModels: [],
      userAgent: '',
      maxConcurrentTasks: 0,
      disableAutoProtection: false,
      enableOpenAIProtocolBridge: true
    })
    claudeConsoleAccountService._createProxyAgent.mockReturnValue(null)

    axios.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        id: 'chatcmpl-1',
        model: 'gpt-4.1',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 }
      }
    })

    const result = await relayService.relayRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: false
      },
      { name: 'test-key' },
      null,
      null,
      {},
      'acc-1'
    )

    expect(axios).toHaveBeenCalledTimes(1)
    const requestConfig = axios.mock.calls[0][0]
    expect(requestConfig.url).toBe('https://openai.example.com/v1/chat/completions')
    expect(requestConfig.data).toHaveProperty('messages')
    expect(requestConfig.headers['anthropic-version']).toBeUndefined()

    const translatedBody = JSON.parse(result.body)
    expect(translatedBody.type).toBe('message')
    expect(translatedBody.usage).toEqual(
      expect.objectContaining({
        input_tokens: 12,
        output_tokens: 7
      })
    )
  })

  test('uses /chat/completions when bridge-enabled OpenAI base URL already ends with /v1', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'acc-1b',
      name: 'console-openai-base-v1',
      apiUrl: 'https://openai.example.com/v1',
      apiKey: 'sk-openai-key',
      supportedModels: [],
      userAgent: '',
      maxConcurrentTasks: 0,
      disableAutoProtection: false,
      enableOpenAIProtocolBridge: true
    })
    claudeConsoleAccountService._createProxyAgent.mockReturnValue(null)

    axios.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        id: 'chatcmpl-2',
        model: 'gpt-4.1',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 }
      }
    })

    await relayService.relayRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: false
      },
      { name: 'test-key' },
      null,
      null,
      {},
      'acc-1b'
    )

    const requestConfig = axios.mock.calls[0][0]
    expect(requestConfig.url).toBe('https://openai.example.com/v1/chat/completions')
  })

  test('preserves Claude system text blocks and max_tokens when bridging to OpenAI chat completions', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'acc-1c',
      name: 'console-openai-system',
      apiUrl: 'https://openai.example.com/v1/chat/completions',
      apiKey: 'sk-openai-key',
      supportedModels: [],
      userAgent: '',
      maxConcurrentTasks: 0,
      disableAutoProtection: false,
      enableOpenAIProtocolBridge: true
    })
    claudeConsoleAccountService._createProxyAgent.mockReturnValue(null)

    axios.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        id: 'chatcmpl-3',
        model: 'gpt-4.1',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 }
      }
    })

    await relayService.relayRequest(
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 128000,
        system: [{ type: 'text', text: 'test system prompt' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: false
      },
      { name: 'test-key' },
      null,
      null,
      {},
      'acc-1c'
    )

    const requestConfig = axios.mock.calls[0][0]
    expect(requestConfig.data.max_tokens).toBe(128000)
    expect(requestConfig.data.messages[0]).toEqual({
      role: 'system',
      content: 'test system prompt'
    })
  })

  test('waits for real upstream usage instead of finalizing on placeholder anthropic usage events', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'acc-stream-1',
      name: 'console-openai-stream',
      apiUrl: 'https://openai.example.com/v1/chat/completions',
      apiKey: 'sk-openai-key',
      supportedModels: [],
      userAgent: '',
      maxConcurrentTasks: 0,
      disableAutoProtection: false,
      enableOpenAIProtocolBridge: true
    })
    claudeConsoleAccountService._createProxyAgent.mockReturnValue(null)

    const upstream = new PassThrough()
    axios.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: upstream
    })

    const writes = []
    const responseStream = {
      headersSent: false,
      destroyed: false,
      writableEnded: false,
      socket: {
        destroyed: false,
        bytesWritten: 0,
        setNoDelay: jest.fn()
      },
      on: jest.fn(),
      getHeader: jest.fn(() => null),
      writeHead: jest.fn(function writeHead() {
        this.headersSent = true
      }),
      write: jest.fn((chunk) => {
        writes.push(chunk)
        return true
      }),
      end: jest.fn(function end(callback) {
        this.writableEnded = true
        if (typeof callback === 'function') {
          callback()
        }
      })
    }

    const usageCallback = jest.fn()

    const requestPromise = relayService._makeClaudeConsoleStreamRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: true
      },
      {
        id: 'acc-stream-1',
        name: 'console-openai-stream',
        apiUrl: 'https://openai.example.com/v1/chat/completions',
        apiKey: 'sk-openai-key',
        userAgent: '',
        enableOpenAIProtocolBridge: true
      },
      null,
      {},
      responseStream,
      'acc-stream-1',
      usageCallback
    )

    upstream.write(
      'data: {"id":"chatcmpl-9","model":"glm-5","choices":[{"delta":{"role":"assistant","content":"hello"}}]}\n\n'
    )
    upstream.write(
      'data: {"id":"chatcmpl-9","model":"glm-5","choices":[{"finish_reason":"stop","delta":{}}]}\n\n'
    )
    upstream.write(
      'data: {"id":"chatcmpl-9","model":"glm-5","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3}}\n\n'
    )
    upstream.end('data: [DONE]\n\n')

    await requestPromise

    expect(usageCallback).toHaveBeenCalledTimes(1)
    expect(usageCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        input_tokens: 8,
        output_tokens: 3,
        model: 'glm-5',
        accountId: 'acc-stream-1'
      })
    )
    expect(writes.join('')).toContain('"usage":{"input_tokens":0,"output_tokens":0}')
  })

  test('keeps original anthropic relay behavior when bridge disabled', async () => {
    claudeConsoleAccountService.getAccount.mockResolvedValue({
      id: 'acc-2',
      name: 'console-anthropic',
      apiUrl: 'https://anthropic-proxy.example.com',
      apiKey: 'anthropic-key',
      supportedModels: [],
      userAgent: '',
      maxConcurrentTasks: 0,
      disableAutoProtection: false,
      enableOpenAIProtocolBridge: false
    })
    claudeConsoleAccountService._createProxyAgent.mockReturnValue(null)

    axios.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        id: 'msg_1',
        type: 'message',
        model: 'claude-sonnet-4-5',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 5 }
      }
    })

    const result = await relayService.relayRequest(
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: false
      },
      { name: 'test-key' },
      null,
      null,
      {},
      'acc-2'
    )

    const requestConfig = axios.mock.calls[0][0]
    expect(requestConfig.url).toBe('https://anthropic-proxy.example.com/v1/messages')
    expect(requestConfig.headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(result.body)
    expect(body.type).toBe('message')
    expect(body.model).toBe('claude-sonnet-4-5')
  })
})
