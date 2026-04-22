const bridge = require('../../../../src/adapters/llm-protocol-bridge')
const { ProtocolBridge } = require('../../../../src/adapters/llm-protocol-bridge')

describe('ProtocolBridge facade', () => {
  test('detects protocols and translates requests with meta information', () => {
    const instance = new ProtocolBridge()

    expect(
      instance.detectProtocol({
        path: '/v1/messages',
        headers: { 'anthropic-version': '2023-06-01' }
      })
    ).toBe('anthropic.messages')
    expect(instance.detectProtocol({ path: '/v1/chat/completions' })).toBe(
      'openai.chat_completions'
    )
    expect(instance.detectProtocol({ path: '/v1/responses' })).toBe('openai.responses')

    const translated = instance.translateRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      body: {
        model: 'claude-sonnet-4-5',
        system: 'Be concise',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
      }
    })

    expect(translated.body).toMatchObject({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'hello' }
      ]
    })
    expect(translated.meta).toEqual({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    })
  })

  test('translates streams and exposes stream reset helpers', () => {
    const chunk = bridge.translateStreamChunk({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'anthropic.messages',
      sessionId: 'session-99',
      chunk:
        'data: {"id":"chatcmpl-1","model":"gpt-5","choices":[{"delta":{"role":"assistant","reasoning_content":"step 1"}}]}\n\n'
    })

    expect(chunk.chunk).toContain('thinking_delta')
    expect(bridge.getDebugState('session-99')).toEqual(
      expect.objectContaining({
        started: true
      })
    )

    bridge.resetStream('session-99')
    expect(bridge.getDebugState('session-99')).toBeNull()
  })
})
