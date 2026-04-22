const {
  StreamStateStore
} = require('../../../../src/adapters/llm-protocol-bridge/core/stream/StreamStateStore')
const {
  normalizeStreamEvents
} = require('../../../../src/adapters/llm-protocol-bridge/core/stream/streamNormalizer')
const {
  encodeSSE,
  parseSSE
} = require('../../../../src/adapters/llm-protocol-bridge/core/stream/sseCodec')

describe('llm protocol bridge stream helpers', () => {
  test('opens, switches and closes blocks in a stable order', () => {
    const store = new StreamStateStore()

    const events = normalizeStreamEvents(
      [
        { type: 'message_start', message: { id: 'msg-1', model: 'gpt-5', role: 'assistant' } },
        { type: 'block_delta', block: { type: 'reasoning', text: 'step 1' } },
        { type: 'block_delta', block: { type: 'text', text: 'final text' } },
        { type: 'message_stop', stop: { reason: 'end_turn' }, usage: { outputTokens: 4 } }
      ],
      { sessionId: 'session-1', stateStore: store }
    )

    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'block_start',
      'block_delta',
      'block_stop',
      'block_start',
      'block_delta',
      'message_delta',
      'block_stop',
      'message_stop'
    ])

    expect(store.snapshot('session-1')).toBeNull()
  })

  test('round-trips simple SSE payloads', () => {
    const encoded = encodeSSE([
      { event: 'message_start', data: { type: 'message_start' } },
      { event: 'message_stop', data: { type: 'message_stop' } }
    ])

    expect(parseSSE(encoded)).toEqual([
      { event: 'message_start', data: { type: 'message_start' } },
      { event: 'message_stop', data: { type: 'message_stop' } }
    ])
  })
})
