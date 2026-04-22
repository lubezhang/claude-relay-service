function encodeRequest(unified) {
  const messages = []

  for (const systemText of unified.system || []) {
    messages.push({ role: 'system', content: systemText })
  }

  for (const message of unified.messages) {
    if (message.role === 'tool') {
      const toolResult = message.blocks.find((block) => block.type === 'tool_result')
      messages.push({
        role: 'tool',
        tool_call_id: toolResult.toolCallId,
        content: toolResult.content
      })
      continue
    }

    const textParts = []
    const toolCalls = []
    for (const block of message.blocks) {
      if (block.type === 'text') {
        textParts.push(block.text)
      }
      if (block.type === 'image') {
        textParts.push({
          type: 'image_url',
          image_url: { url: block.url || `data:${block.mediaType};base64,${block.data}` }
        })
      }
      if (block.type === 'tool_call') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {})
          }
        })
      }
    }

    const hasStructuredParts = textParts.some((part) => typeof part === 'object')

    messages.push({
      role: message.role,
      content: hasStructuredParts ? textParts : textParts.join('\n\n') || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    })
  }

  return {
    body: {
      model: unified.model,
      messages,
      tools: unified.tools,
      tool_choice: unified.toolChoice,
      stream: unified.stream
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeRequest
}
