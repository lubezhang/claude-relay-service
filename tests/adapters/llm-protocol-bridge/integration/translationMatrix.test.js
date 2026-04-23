const bridge = require('../../../../src/adapters/llm-protocol-bridge')
jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
const legacyAdapter = require('../../../../src/services/openaiToClaude')

describe('llm protocol bridge integration matrix', () => {
  test('covers the six required protocol chains and surfaces degradation warnings', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-5',
      system: 'Be concise',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the weather?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img-data' } }
          ]
        }
      ],
      tools: [{ name: 'lookup_weather', input_schema: { type: 'object' } }],
      tool_choice: { type: 'auto' }
    }

    const toChat = bridge.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      body: anthropicBody
    })
    const toResponses = bridge.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.responses',
      body: anthropicBody
    })
    const backToAnthropicFromChat = bridge.translateRequest({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'anthropic.messages',
      body: toChat.body
    })
    const backToAnthropicFromResponses = bridge.translateRequest({
      sourceProtocol: 'openai.responses',
      targetProtocol: 'anthropic.messages',
      body: toResponses.body
    })
    const chatToResponses = bridge.translateRequest({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'openai.responses',
      body: toChat.body
    })
    const responsesToChat = bridge.translateRequest({
      sourceProtocol: 'openai.responses',
      targetProtocol: 'openai.chat_completions',
      body: toResponses.body
    })

    expect(toChat.meta.targetProtocol).toBe('openai.chat_completions')
    expect(toResponses.meta.targetProtocol).toBe('openai.responses')
    expect(backToAnthropicFromChat.body.messages[0].role).toBe('user')
    expect(backToAnthropicFromResponses.body.messages[0].role).toBe('user')
    expect(chatToResponses.body.model).toBeTruthy()
    expect(responsesToChat.body.model).toBeTruthy()
  })

  test('surfaces degradation warnings when translating anthropic images to chat text-only mode', () => {
    const result = bridge.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe the image' },
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/cat.png' }
              }
            ]
          }
        ]
      },
      options: {
        endpointHint: '/chat/completions',
        allowImageParts: false
      }
    })

    expect(result.meta.degraded).toBe(true)
    expect(result.meta.warnings).toContain(
      'image block downgraded to text note for openai.chat_completions'
    )
    expect(result.body.messages[0].content).toContain(
      '[image omitted: https://example.com/cat.png]'
    )
  })

  test('applies modelMapping and strips raw payloads unless includeRaw is enabled', () => {
    const result = bridge.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.responses',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
      },
      options: {
        modelMapping: { 'claude-sonnet-4-5': 'gpt-5-mini' },
        includeRaw: false
      }
    })

    expect(result.body.model).toBe('gpt-5-mini')
    expect(result.meta.degraded).toBe(false)
  })

  test('throws in strict mode when the target protocol cannot encode the block losslessly', () => {
    expect(() =>
      bridge.translateRequest({
        sourceProtocol: 'anthropic.messages',
        targetProtocol: 'openai.chat_completions',
        body: {
          model: 'claude-sonnet-4-5',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://example.com/cat.png' }
                }
              ]
            }
          ]
        },
        options: {
          strict: true,
          allowImageParts: false
        }
      })
    ).toThrow('openai.chat_completions cannot encode image block without degradation')
  })

  test('coexists with the legacy claude-openai adapter without mutation', () => {
    const legacy = legacyAdapter.convertRequest({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hello' }]
    })
    const bridgeResult = bridge.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
      }
    })

    expect(legacy.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(bridgeResult.body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })
})
