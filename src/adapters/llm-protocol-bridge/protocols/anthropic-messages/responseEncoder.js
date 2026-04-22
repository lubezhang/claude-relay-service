function encodeResponse(unified) {
  const content = unified.blocks.map((block) => {
    if (block.type === 'reasoning') {
      return {
        type: 'thinking',
        thinking: block.text,
        ...(block.signature ? { signature: block.signature } : {})
      }
    }

    if (block.type === 'tool_call') {
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input
      }
    }

    return {
      type: 'text',
      text: block.text || ''
    }
  })

  return {
    body: {
      id: unified.id,
      type: 'message',
      role: 'assistant',
      model: unified.model,
      content,
      stop_reason: unified.stop.reason,
      usage: {
        input_tokens: unified.usage.inputTokens,
        output_tokens: unified.usage.outputTokens,
        ...(unified.usage.cacheReadTokens > 0
          ? { cache_read_input_tokens: unified.usage.cacheReadTokens }
          : {})
      }
    },
    headers: {},
    meta: {
      sourceProtocol: unified.protocol || 'unified',
      targetProtocol: 'anthropic.messages',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeResponse
}
