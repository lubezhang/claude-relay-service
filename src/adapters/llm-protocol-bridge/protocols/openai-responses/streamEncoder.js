function encodeStream(events) {
  const chunks = []

  for (const event of events) {
    if (event.type === 'block_delta' && event.block.type === 'reasoning') {
      chunks.push(
        `data: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: event.block.text })}\n\n`
      )
    }

    if (event.type === 'block_delta' && event.block.type === 'text') {
      chunks.push(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: event.block.text })}\n\n`
      )
    }

    if (event.type === 'message_stop') {
      chunks.push(
        `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: event.usage?.inputTokens || 0, output_tokens: event.usage?.outputTokens || 0 } } })}\n\n`
      )
    }
  }

  return {
    chunk: chunks.join(''),
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeStream
}
