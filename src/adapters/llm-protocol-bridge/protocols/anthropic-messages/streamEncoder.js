const { encodeSSE } = require('../../core/stream/sseCodec')

function encodeStream(events) {
  const chunk = encodeSSE(
    events.map((event) => {
      if (event.type === 'block_delta' && event.block.type === 'reasoning') {
        return {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'thinking_delta',
              thinking: event.block.text
            }
          }
        }
      }

      if (event.type === 'block_start') {
        return {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: event.index,
            content_block:
              event.block.type === 'reasoning'
                ? { type: 'thinking', thinking: '' }
                : { type: 'text', text: '' }
          }
        }
      }

      return {
        event: event.type,
        data: event
      }
    })
  )

  return {
    chunk,
    meta: {
      targetProtocol: 'anthropic.messages',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeStream
}
