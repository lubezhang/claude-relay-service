function encodeRequest(unified) {
  const input = unified.messages.map((message) => ({
    role: message.role,
    content: message.blocks.map((block) => {
      if (block.type === 'text') {
        return { type: 'input_text', text: block.text }
      }
      if (block.type === 'image') {
        return {
          type: 'input_image',
          image_url: block.url || `data:${block.mediaType};base64,${block.data}`
        }
      }
      if (block.type === 'tool_call') {
        return {
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      }
      if (block.type === 'tool_result') {
        return {
          type: 'function_call_output',
          call_id: block.toolCallId,
          output: block.content
        }
      }
      return { type: 'input_text', text: block.text || '' }
    })
  }))

  return {
    body: {
      model: unified.model,
      instructions: unified.system.join('\n\n') || undefined,
      input,
      tools: unified.tools,
      reasoning: unified.output.reasoning || undefined,
      modalities: unified.output.modalities || undefined,
      stream: unified.stream
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeRequest
}
