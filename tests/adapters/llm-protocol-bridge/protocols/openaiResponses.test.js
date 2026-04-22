const responses = require('../../../../src/adapters/llm-protocol-bridge/protocols/openai-responses')

describe('openai responses protocol adapter', () => {
  test('decodes responses request into unified request with instructions, reasoning and items', () => {
    const unified = responses.decodeRequest({
      model: 'gpt-5',
      stream: true,
      instructions: 'Be detailed',
      reasoning: { effort: 'medium' },
      tools: [{ type: 'function', name: 'lookup_weather', parameters: { type: 'object' } }],
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Weather?' },
            { type: 'input_image', image_url: 'https://example.com/img.png' }
          ]
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'function_call',
              call_id: 'call-1',
              name: 'lookup_weather',
              arguments: '{"city":"Paris"}'
            }
          ]
        },
        {
          role: 'tool',
          content: [{ type: 'function_call_output', call_id: 'call-1', output: 'Sunny' }]
        }
      ]
    })

    expect(unified.protocol).toBe('openai.responses')
    expect(unified.system).toEqual(['Be detailed'])
    expect(unified.output).toEqual(expect.objectContaining({ reasoning: { effort: 'medium' } }))
    expect(unified.messages[0].blocks[1]).toEqual(
      expect.objectContaining({ type: 'image', url: 'https://example.com/img.png' })
    )
    expect(unified.messages[1].blocks[0]).toEqual(
      expect.objectContaining({ type: 'tool_call', id: 'call-1' })
    )
    expect(unified.messages[2].blocks[0]).toEqual(
      expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1', content: 'Sunny' })
    )
  })

  test('encodes unified response and stream events into responses output items', () => {
    const encoded = responses.encodeResponse({
      id: 'resp-3',
      model: 'claude-opus-4-1',
      blocks: [
        { type: 'reasoning', text: 'step 1', signature: 'sig-3' },
        { type: 'tool_call', id: 'call-3', name: 'lookup_weather', input: { city: 'Paris' } },
        { type: 'text', text: 'Sunny in Paris' }
      ],
      stop: { reason: 'end_turn' },
      usage: { inputTokens: 11, outputTokens: 7 }
    })

    expect(encoded.body.output).toEqual([
      {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'step 1' }],
        signature: 'sig-3'
      },
      {
        type: 'function_call',
        call_id: 'call-3',
        name: 'lookup_weather',
        arguments: '{"city":"Paris"}'
      },
      { type: 'output_text', text: 'Sunny in Paris' }
    ])
    expect(encoded.body.usage).toMatchObject({ input_tokens: 11, output_tokens: 7 })

    const encodedChunk = responses.encodeStream([
      {
        type: 'message_start',
        message: { id: 'resp-3', role: 'assistant', model: 'claude-opus-4-1' }
      },
      { type: 'block_delta', index: 0, block: { type: 'reasoning', text: 'step 1' } },
      { type: 'block_delta', index: 1, block: { type: 'text', text: 'Sunny in Paris' } },
      {
        type: 'message_stop',
        stop: { reason: 'end_turn' },
        usage: { inputTokens: 11, outputTokens: 7 }
      }
    ])

    expect(encodedChunk.chunk).toContain('response.reasoning_summary_text.delta')
    expect(encodedChunk.chunk).toContain('response.output_text.delta')
    expect(encodedChunk.chunk).toContain('response.completed')
  })
})
