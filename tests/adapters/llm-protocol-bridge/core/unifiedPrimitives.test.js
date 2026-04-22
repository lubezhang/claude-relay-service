const {
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedError,
  createUnifiedTokenCount
} = require('../../../../src/adapters/llm-protocol-bridge/core/schemas')
const { mapModelName } = require('../../../../src/adapters/llm-protocol-bridge/core/modelMapper')
const {
  normalizeUsage
} = require('../../../../src/adapters/llm-protocol-bridge/core/usageNormalizer')

describe('llm protocol bridge core primitives', () => {
  test('creates stable unified defaults', () => {
    expect(createUnifiedRequest({ protocol: 'anthropic.messages' })).toMatchObject({
      protocol: 'anthropic.messages',
      system: [],
      messages: [],
      tools: [],
      toolChoice: null,
      stream: false,
      raw: null
    })

    expect(createUnifiedResponse({ model: 'gpt-5' })).toMatchObject({
      model: 'gpt-5',
      role: 'assistant',
      blocks: [],
      stop: { reason: 'unknown', sequence: null },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    })

    expect(createUnifiedError({ message: 'boom', status: 429 })).toMatchObject({
      type: 'api_error',
      status: 429,
      retryable: true
    })

    expect(createUnifiedTokenCount({ inputTokens: 9 })).toEqual({
      inputTokens: 9,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 9,
      reasoningTokens: 0
    })
  })

  test('normalizes usage fields from anthropic and openai shapes', () => {
    expect(normalizeUsage({ prompt_tokens: 7, completion_tokens: 5 })).toEqual({
      inputTokens: 7,
      outputTokens: 5,
      totalTokens: 12,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      serviceTier: null
    })

    expect(
      normalizeUsage({
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 3,
        service_tier: 'priority'
      })
    ).toMatchObject({
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 3,
      serviceTier: 'priority'
    })
  })

  test('maps model names with exact and case-insensitive overrides', () => {
    const mapping = {
      'claude-sonnet-4-5': 'gpt-5-mini',
      'GPT-5': 'claude-opus-4-1'
    }

    expect(mapModelName('claude-sonnet-4-5', mapping)).toBe('gpt-5-mini')
    expect(mapModelName('gpt-5', mapping)).toBe('claude-opus-4-1')
    expect(mapModelName('unknown-model', mapping)).toBe('unknown-model')
  })
})
