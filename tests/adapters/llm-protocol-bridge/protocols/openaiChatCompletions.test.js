const chat = require('../../../../src/adapters/llm-protocol-bridge/protocols/openai-chat-completions')

describe('openai chat completions protocol adapter', () => {
  test('decodes chat completions request into unified request with tool results and images', () => {
    const unified = chat.decodeRequest({
      model: 'gpt-5',
      stream: true,
      tool_choice: 'required',
      tools: [
        { type: 'function', function: { name: 'lookup_weather', parameters: { type: 'object' } } }
      ],
      messages: [
        { role: 'system', content: 'Be concise' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }
          ]
        },
        {
          role: 'assistant',
          content: 'I will call a tool',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup_weather', arguments: '{"city":"Paris"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'Sunny' }
      ]
    })

    expect(unified.protocol).toBe('openai.chat_completions')
    expect(unified.system).toEqual(['Be concise'])
    expect(unified.messages[0].blocks[1]).toEqual(
      expect.objectContaining({ type: 'image', url: 'https://example.com/a.png' })
    )
    expect(unified.messages[1].blocks[0]).toEqual(
      expect.objectContaining({ type: 'tool_call', name: 'lookup_weather' })
    )
    expect(unified.messages[2].blocks[0]).toEqual(
      expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1', content: 'Sunny' })
    )
  })

  test('encodes unified response and stream events into chat completions compatibility fields', () => {
    const encoded = chat.encodeResponse({
      id: 'resp-2',
      model: 'claude-sonnet-4-5',
      blocks: [
        { type: 'reasoning', text: 'step 1', signature: null },
        { type: 'text', text: 'final answer' },
        { type: 'tool_call', id: 'call-9', name: 'lookup_weather', input: { city: 'Paris' } }
      ],
      stop: { reason: 'tool_use' },
      usage: { inputTokens: 9, outputTokens: 4, reasoningTokens: 2 }
    })

    expect(encoded.body.choices[0].message).toMatchObject({
      content: 'final answer',
      reasoning_content: 'step 1',
      tool_calls: [
        {
          id: 'call-9',
          type: 'function',
          function: {
            name: 'lookup_weather',
            arguments: '{"city":"Paris"}'
          }
        }
      ]
    })
    expect(encoded.body.choices[0].finish_reason).toBe('tool_calls')

    const encodedChunk = chat.encodeStream([
      {
        type: 'message_start',
        message: { id: 'resp-2', role: 'assistant', model: 'claude-sonnet-4-5' }
      },
      { type: 'block_delta', index: 0, block: { type: 'reasoning', text: 'step 1' } },
      { type: 'block_delta', index: 1, block: { type: 'text', text: 'final answer' } },
      {
        type: 'message_stop',
        stop: { reason: 'end_turn' },
        usage: { inputTokens: 9, outputTokens: 4 }
      }
    ])

    expect(encodedChunk.chunk).toContain('reasoning_content')
    expect(encodedChunk.chunk).toContain('"content":"final answer"')
    expect(encodedChunk.chunk).toContain('[DONE]')
  })

  test('omits empty tool fields when encoding requests without tools', () => {
    const encoded = chat.encodeRequest({
      model: 'gpt-5',
      system: [],
      messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
      tools: [],
      toolChoice: null,
      stream: true
    })

    expect(encoded.body).not.toHaveProperty('tools')
    expect(encoded.body).not.toHaveProperty('tool_choice')
  })

  test('encodes sampling fields from unified requests', () => {
    const encoded = chat.encodeRequest({
      model: 'gpt-5',
      system: ['Be helpful'],
      messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
      tools: [],
      toolChoice: null,
      sampling: {
        maxTokens: 256,
        temperature: 0.2,
        topP: 0.8,
        stop: ['END']
      },
      stream: true
    })

    expect(encoded.body.max_tokens).toBe(256)
    expect(encoded.body.temperature).toBe(0.2)
    expect(encoded.body.top_p).toBe(0.8)
    expect(encoded.body.stop).toEqual(['END'])
  })

  test('requests upstream usage for streaming chat completions bridges', () => {
    const encoded = chat.encodeRequest({
      model: 'gpt-5',
      system: [],
      messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
      tools: [],
      toolChoice: null,
      sampling: {},
      stream: true
    })

    expect(encoded.body.stream_options).toEqual({ include_usage: true })
  })
})
