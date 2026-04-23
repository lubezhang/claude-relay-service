const { encodeSSE } = require('../../core/stream/sseCodec')
const { normalizeUsage } = require('../../core/usageNormalizer')

function toAnthropicUsage(usage) {
  const normalized = normalizeUsage(usage || {})
  return {
    input_tokens: normalized.inputTokens,
    output_tokens: normalized.outputTokens,
    ...(normalized.cacheReadTokens > 0
      ? { cache_read_input_tokens: normalized.cacheReadTokens }
      : {})
  }
}

function toAnthropicStopReason(delta = {}) {
  const reason = delta.stop_reason || delta.reason || 'end_turn'
  return reason
}

function encodeStream(events) {
  const chunk = encodeSSE(
    events.map((event) => {
      if (event.type === 'message_start') {
        const usage = toAnthropicUsage(event.message?.usage || {})
        return {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              ...event.message,
              usage
            }
          }
        }
      }

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
                : event.block.type === 'tool_call'
                  ? {
                      type: 'tool_use',
                      id: event.block.id,
                      name: event.block.name,
                      input: event.block.input || {}
                    }
                  : { type: 'text', text: '' }
          }
        }
      }

      if (event.type === 'block_delta' && event.block.type === 'tool_call') {
        return {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'input_json_delta',
              partial_json: event.block.partialJson || ''
            }
          }
        }
      }

      if (event.type === 'block_delta' && event.block.type === 'text') {
        return {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'text_delta',
              text: event.block.text || ''
            }
          }
        }
      }

      if (event.type === 'block_stop') {
        return {
          event: 'content_block_stop',
          data: {
            type: 'content_block_stop',
            index: event.index
          }
        }
      }

      if (event.type === 'message_delta') {
        const usage = toAnthropicUsage(event.usage)
        return {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: {
              stop_reason: toAnthropicStopReason(event.delta)
            },
            usage
          }
        }
      }

      if (event.type === 'message_stop') {
        return {
          event: 'message_stop',
          data: {
            type: 'message_stop'
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
