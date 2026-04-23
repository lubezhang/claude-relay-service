const anthropic = require('../../../../src/adapters/llm-protocol-bridge/protocols/anthropic-messages')

describe('anthropic protocol adapter', () => {
  test('decodes anthropic request into unified request with thinking, tool_result and service tier', () => {
    const unified = anthropic.decodeRequest({
      model: 'claude-sonnet-4-5',
      system: [{ type: 'text', text: 'Follow policy' }],
      stream: true,
      max_tokens: 256,
      temperature: 0.2,
      top_p: 0.8,
      stop_sequences: ['END'],
      service_tier: 'standard_only',
      metadata: { user_id: 'user-1' },
      tools: [{ name: 'lookup_weather', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'lookup_weather' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Weather in Paris?' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'img-data' }
            },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'Sunny', is_error: false }
          ]
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need location first', signature: 'sig-1' },
            { type: 'tool_use', id: 'call-1', name: 'lookup_weather', input: { city: 'Paris' } }
          ]
        }
      ]
    })

    expect(unified).toMatchObject({
      protocol: 'anthropic.messages',
      model: 'claude-sonnet-4-5',
      system: ['Follow policy'],
      stream: true,
      serviceTier: 'standard_only',
      metadata: { user_id: 'user-1' },
      toolChoice: { type: 'tool', name: 'lookup_weather' }
    })
    expect(unified.sampling).toEqual({
      maxTokens: 256,
      temperature: 0.2,
      topP: 0.8,
      topK: undefined,
      stop: ['END']
    })
    expect(unified.messages[0].blocks[1]).toEqual(
      expect.objectContaining({ type: 'image', mediaType: 'image/png' })
    )
    expect(unified.messages[1].blocks[0]).toEqual(
      expect.objectContaining({ type: 'reasoning', text: 'Need location first' })
    )
  })

  test('encodes unified response and stream events back to anthropic shapes', () => {
    const encodedResponse = anthropic.encodeResponse({
      id: 'resp-1',
      model: 'gpt-5',
      blocks: [
        { type: 'reasoning', text: 'step 1', signature: 'sig-2' },
        { type: 'text', text: 'answer' },
        { type: 'tool_call', id: 'call-9', name: 'lookup_weather', input: { city: 'Paris' } }
      ],
      stop: { reason: 'tool_use', sequence: null },
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 }
    })

    expect(encodedResponse.body).toMatchObject({
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_read_input_tokens: 2
      }
    })
    expect(encodedResponse.body.content).toEqual([
      { type: 'thinking', thinking: 'step 1', signature: 'sig-2' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 'call-9', name: 'lookup_weather', input: { city: 'Paris' } }
    ])

    const encodedChunk = anthropic.encodeStream([
      { type: 'message_start', message: { id: 'resp-1', role: 'assistant', model: 'gpt-5' } },
      { type: 'block_start', index: 0, block: { type: 'reasoning' } },
      { type: 'block_delta', index: 0, block: { type: 'reasoning', text: 'step 1' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop', stop: { reason: 'end_turn' } }
    ])

    expect(encodedChunk.chunk).toContain('event: message_start')
    expect(encodedChunk.chunk).toContain('"usage":{"input_tokens":0,"output_tokens":0}')
    expect(encodedChunk.chunk).toContain(
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":0,"output_tokens":0}}'
    )
    expect(encodedChunk.chunk).toContain('thinking_delta')
    expect(encodedChunk.chunk).toContain('event: message_stop')
  })
})
