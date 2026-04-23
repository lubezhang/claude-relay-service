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

  test('preserves tool call stream metadata and usage when bridging chat completions to anthropic', () => {
    const sessionId = 'session-tool-chat'
    const firstChunk = bridge.translateStreamChunk({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'anthropic.messages',
      sessionId,
      chunk:
        'data: {"id":"chatcmpl-1","model":"gpt-5","choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup_weather","arguments":""}}]}}]}\n\n'
    })
    const secondChunk = bridge.translateStreamChunk({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'anthropic.messages',
      sessionId,
      chunk:
        'data: {"id":"chatcmpl-1","model":"gpt-5","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Paris\\"}"}}]}}]}\n\n'
    })
    const stopChunk = bridge.translateStreamChunk({
      sourceProtocol: 'openai.chat_completions',
      targetProtocol: 'anthropic.messages',
      sessionId,
      chunk:
        'data: {"id":"chatcmpl-1","model":"gpt-5","choices":[{"finish_reason":"tool_calls","delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n'
    })

    expect(firstChunk.chunk).toContain('"content_block_start"')
    expect(firstChunk.chunk).toContain('"type":"tool_use"')
    expect(firstChunk.chunk).toContain('"name":"lookup_weather"')
    expect(secondChunk.chunk).toContain('"input_json_delta"')
    expect(secondChunk.chunk).toContain('\\"city\\":\\"Paris\\"')
    expect(stopChunk.chunk).toContain('"stop_reason":"tool_use"')
    expect(stopChunk.chunk).toContain('"input_tokens":10')
    expect(stopChunk.chunk).toContain('"output_tokens":4')
  })

  test('preserves tool use stream metadata and usage when bridging anthropic to chat completions', () => {
    const sessionId = 'session-tool-anthropic'
    const startChunk = bridge.translateStreamChunk({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      sessionId,
      chunk:
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","model":"claude-sonnet-4-5"}}\n\n' +
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"lookup_weather","input":{}}}\n\n'
    })
    const deltaChunk = bridge.translateStreamChunk({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      sessionId,
      chunk:
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Paris\\"}"}}\n\n'
    })
    const stopChunk = bridge.translateStreamChunk({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.chat_completions',
      sessionId,
      chunk:
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":12,"output_tokens":3}}\n\n' +
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    })

    expect(startChunk.chunk).toContain('"role":"assistant"')
    expect(startChunk.chunk).toContain('"tool_calls"')
    expect(startChunk.chunk).toContain('"id":"toolu_1"')
    expect(startChunk.chunk).toContain('"name":"lookup_weather"')
    expect(deltaChunk.chunk).toContain('"tool_calls"')
    expect(deltaChunk.chunk).toContain('\\"city\\":\\"Paris\\"')
    expect(stopChunk.chunk).toContain('"finish_reason":"tool_calls"')
    expect(stopChunk.chunk).toContain('"prompt_tokens":12')
    expect(stopChunk.chunk).toContain('"completion_tokens":3')
  })

  test('supports token count translation for openai responses payloads', () => {
    const request = bridge.translateTokenCountRequest({
      sourceProtocol: 'anthropic.messages',
      targetProtocol: 'openai.responses',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
      }
    })
    const response = bridge.translateTokenCountResponse({
      sourceProtocol: 'openai.responses',
      targetProtocol: 'anthropic.messages',
      body: {
        usage: {
          input_tokens: 9,
          output_tokens: 0,
          total_tokens: 9
        }
      }
    })

    expect(request.body).toMatchObject({
      model: 'claude-sonnet-4-5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]
    })
    expect(response.body).toEqual({ input_tokens: 9 })
  })
})
