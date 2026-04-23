const {
  normalizeBlocks
} = require('../../../../src/adapters/llm-protocol-bridge/core/blocks/normalizeBlocks')
const {
  serializeBlocks
} = require('../../../../src/adapters/llm-protocol-bridge/core/blocks/serializeBlocks')

describe('llm protocol bridge block helpers', () => {
  test('normalizes anthropic-style mixed blocks into unified blocks', () => {
    expect(
      normalizeBlocks([
        { type: 'text', text: 'hello' },
        { type: 'thinking', thinking: 'reason first', signature: 'sig-1' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' }
        },
        { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { city: 'Paris' } },
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'Sunny', is_error: false }
      ])
    ).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'reasoning', text: 'reason first', signature: 'sig-1' },
      { type: 'image', sourceType: 'base64', mediaType: 'image/png', data: 'abc123', url: null },
      { type: 'tool_call', id: 'tool-1', name: 'lookup', input: { city: 'Paris' } },
      { type: 'tool_result', toolCallId: 'tool-1', content: 'Sunny', isError: false }
    ])
  })

  test('serializes unified image and reasoning blocks for chat completions compatibility', () => {
    expect(
      serializeBlocks(
        [
          { type: 'reasoning', text: 'think quietly', signature: null },
          { type: 'text', text: 'final answer' },
          {
            type: 'image',
            sourceType: 'base64',
            mediaType: 'image/jpeg',
            data: 'encoded-image',
            url: null
          }
        ],
        { targetProtocol: 'openai.chat_completions', includeReasoningField: true }
      )
    ).toEqual({
      content: [
        { type: 'text', text: 'final answer' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,encoded-image' }
        }
      ],
      reasoning: 'think quietly',
      warnings: []
    })
  })

  test('serializes blocks with visible warnings', () => {
    expect(
      serializeBlocks(
        [
          { type: 'text', text: 'describe this' },
          {
            type: 'image',
            sourceType: 'url',
            url: 'https://example.com/cat.png',
            mediaType: null,
            data: null
          }
        ],
        {
          targetProtocol: 'openai.chat_completions',
          allowImageParts: false
        }
      )
    ).toEqual({
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'text', text: '[image omitted: https://example.com/cat.png]' }
      ],
      reasoning: null,
      warnings: ['image block downgraded to text note for openai.chat_completions']
    })
  })
})
