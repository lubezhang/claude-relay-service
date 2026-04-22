function encodeStream(events) {
  const payloads = []

  for (const event of events) {
    if (event.type === 'block_delta' && event.block.type === 'reasoning') {
      payloads.push(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: event.block.text } }] })}\n\n`
      )
      continue
    }

    if (event.type === 'block_delta' && event.block.type === 'text') {
      payloads.push(
        `data: ${JSON.stringify({ choices: [{ delta: { content: event.block.text } }] })}\n\n`
      )
      continue
    }

    if (event.type === 'message_stop') {
      payloads.push(
        `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }], usage: { prompt_tokens: event.usage?.inputTokens || 0, completion_tokens: event.usage?.outputTokens || 0 } })}\n\n`
      )
      payloads.push('data: [DONE]\n\n')
    }
  }

  return {
    chunk: payloads.join(''),
    meta: {
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeStream
}
