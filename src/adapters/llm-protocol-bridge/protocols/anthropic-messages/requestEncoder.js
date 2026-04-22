function encodeRequest(unified) {
  const messages = unified.messages.map((message) => ({
    role: message.role,
    content: message.blocks.map((block) => {
      if (block.type === 'reasoning') {
        return {
          type: 'thinking',
          thinking: block.text,
          ...(block.signature ? { signature: block.signature } : {})
        }
      }

      if (block.type === 'image') {
        return {
          type: 'image',
          source: block.url
            ? { type: 'url', url: block.url }
            : {
                type: 'base64',
                media_type: block.mediaType,
                data: block.data
              }
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

      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: block.toolCallId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {})
        }
      }

      return {
        type: 'text',
        text: block.text || ''
      }
    })
  }))

  return {
    body: {
      model: unified.model,
      system: unified.system.length === 1 ? unified.system[0] : unified.system,
      messages,
      tools: unified.tools,
      tool_choice: unified.toolChoice,
      stream: unified.stream,
      metadata: unified.metadata,
      ...(unified.serviceTier ? { service_tier: unified.serviceTier } : {})
    },
    headers: {},
    meta: {
      targetProtocol: 'anthropic.messages',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeRequest
}
