const { parseSSE } = require('../../core/stream/sseCodec')

function decodeStream(chunk) {
  const frames = parseSSE(chunk)
  const events = []

  for (const frame of frames) {
    const payload = frame.data
    if (payload.type === 'message_start') {
      events.push({ type: 'message_start', message: payload.message })
    }
    if (payload.type === 'content_block_start') {
      const contentBlock = payload.content_block || {}
      events.push({
        type: 'block_start',
        index: payload.index,
        block:
          contentBlock.type === 'thinking'
            ? { type: 'reasoning' }
            : contentBlock.type === 'tool_use'
              ? {
                  type: 'tool_call',
                  id: contentBlock.id,
                  name: contentBlock.name,
                  input: contentBlock.input || {}
                }
              : { type: contentBlock.type }
      })
    }
    if (payload.type === 'content_block_delta') {
      if (payload.delta.type === 'thinking_delta') {
        events.push({
          type: 'block_delta',
          index: payload.index,
          block: { type: 'reasoning', text: payload.delta.thinking }
        })
      }
      if (payload.delta.type === 'text_delta') {
        events.push({
          type: 'block_delta',
          index: payload.index,
          block: { type: 'text', text: payload.delta.text }
        })
      }
      if (payload.delta.type === 'input_json_delta') {
        events.push({
          type: 'block_delta',
          index: payload.index,
          block: {
            type: 'tool_call',
            partialJson: payload.delta.partial_json
          }
        })
      }
    }
    if (payload.type === 'content_block_stop') {
      events.push({ type: 'block_stop', index: payload.index })
    }
    if (payload.type === 'message_delta') {
      events.push({
        type: 'message_delta',
        delta: payload.delta || {},
        usage: payload.usage || null
      })
    }
    if (payload.type === 'message_stop') {
      events.push({ type: 'message_stop', stop: { reason: 'end_turn' } })
    }
  }

  return { events }
}

module.exports = {
  decodeStream
}
