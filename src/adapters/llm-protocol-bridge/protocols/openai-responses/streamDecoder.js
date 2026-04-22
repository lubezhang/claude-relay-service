function decodeStream(chunk) {
  const events = []

  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue
    }

    const payload = JSON.parse(line.slice(6))
    if (payload.type === 'response.created') {
      events.push({ type: 'message_start', message: payload.response })
    }
    if (payload.type === 'response.reasoning_summary_text.delta') {
      events.push({ type: 'block_delta', block: { type: 'reasoning', text: payload.delta } })
    }
    if (payload.type === 'response.output_text.delta') {
      events.push({ type: 'block_delta', block: { type: 'text', text: payload.delta } })
    }
    if (payload.type === 'response.function_call_arguments.delta') {
      events.push({
        type: 'block_delta',
        block: {
          type: 'tool_call',
          id: payload.call_id,
          name: payload.name,
          partialJson: payload.delta
        }
      })
    }
    if (payload.type === 'response.completed') {
      events.push({
        type: 'message_stop',
        stop: { reason: 'end_turn' },
        usage: payload.response?.usage || null
      })
    }
  }

  return { events }
}

module.exports = {
  decodeStream
}
