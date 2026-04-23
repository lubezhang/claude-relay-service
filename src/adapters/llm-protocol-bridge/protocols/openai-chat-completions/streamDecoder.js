function decodeStream(chunk) {
  const events = []

  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue
    }

    if (line === 'data: [DONE]') {
      events.push({
        type: 'message_stop',
        stop: { reason: null },
        usage: null
      })
      continue
    }

    const payload = JSON.parse(line.slice(6))
    const choice = payload.choices?.[0] || {}
    const delta = choice.delta || {}

    if (delta.role === 'assistant') {
      events.push({
        type: 'message_start',
        message: { id: payload.id, role: 'assistant', model: payload.model }
      })
    }
    if (delta.reasoning_content) {
      events.push({
        type: 'block_delta',
        block: { type: 'reasoning', text: delta.reasoning_content }
      })
    }
    if (delta.content) {
      events.push({ type: 'block_delta', block: { type: 'text', text: delta.content } })
    }
    for (const toolCall of delta.tool_calls || []) {
      const partialJson = toolCall.function?.arguments || ''
      if (toolCall.id || toolCall.function?.name || partialJson) {
        events.push({
          type: 'block_delta',
          block: {
            type: 'tool_call',
            id: toolCall.id,
            name: toolCall.function?.name,
            partialJson
          }
        })
      }
    }
    if (choice.finish_reason) {
      events.push({
        type: 'message_delta',
        delta: { stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn' },
        usage: payload.usage
      })
      continue
    }

    if (payload.usage) {
      events.push({
        type: 'message_delta',
        delta: {},
        usage: payload.usage
      })
    }
  }

  return { events }
}

module.exports = {
  decodeStream
}
