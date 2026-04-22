const {
  normalizeHeaders
} = require('../../../../src/adapters/llm-protocol-bridge/core/headerMapper')
const {
  normalizeError
} = require('../../../../src/adapters/llm-protocol-bridge/core/errorNormalizer')
const {
  normalizeTokenCount
} = require('../../../../src/adapters/llm-protocol-bridge/core/tokenCountNormalizer')
const anthropicHeaders = require('../../../../src/adapters/llm-protocol-bridge/protocols/anthropic-messages/headerMapper')
const chatErrors = require('../../../../src/adapters/llm-protocol-bridge/protocols/openai-chat-completions/errorMapper')
const responsesTokens = require('../../../../src/adapters/llm-protocol-bridge/protocols/openai-responses/tokenCountMapper')

describe('llm bridge cross-cutting mappers', () => {
  test('normalizes and re-encodes headers across protocols', () => {
    const normalized = normalizeHeaders(
      {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
        'x-request-id': 'req-1'
      },
      { sourceProtocol: 'anthropic.messages', direction: 'request' }
    )

    expect(normalized).toEqual({
      version: '2023-06-01',
      beta: 'tools-2024-04-04',
      requestId: 'req-1',
      direction: 'request'
    })

    expect(anthropicHeaders.encodeHeaders(normalized, { direction: 'request' })).toEqual({
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'tools-2024-04-04',
      'x-request-id': 'req-1'
    })
  })

  test('normalizes errors and token count results', () => {
    expect(
      normalizeError(
        {
          error: { type: 'rate_limit_error', message: 'Too many requests', code: 'rate_limit' }
        },
        { status: 429 }
      )
    ).toMatchObject({
      type: 'rate_limit_error',
      status: 429,
      retryable: true
    })

    expect(
      chatErrors.encodeError(
        { type: 'invalid_request_error', message: 'bad payload', code: 'bad_request', status: 400 },
        { targetProtocol: 'openai.chat_completions' }
      )
    ).toEqual({
      status: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          message: 'bad payload',
          code: 'bad_request'
        }
      }
    })

    expect(
      normalizeTokenCount({ input_tokens: 9, output_tokens: 4, cache_read_input_tokens: 2 })
    ).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      totalTokens: 13,
      reasoningTokens: 0
    })

    expect(
      responsesTokens.encodeTokenCountResponse({ inputTokens: 9, outputTokens: 4, totalTokens: 13 })
    ).toEqual({
      body: {
        usage: {
          input_tokens: 9,
          output_tokens: 4,
          total_tokens: 13
        }
      },
      headers: {},
      meta: {
        targetProtocol: 'openai.responses',
        degraded: false,
        warnings: []
      }
    })
  })
})
