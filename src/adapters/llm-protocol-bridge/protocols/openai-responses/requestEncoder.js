function toResponsesToolChoice(toolChoice) {
  if (!toolChoice) {
    return undefined
  }

  if (toolChoice.type === 'none' || toolChoice.type === 'auto') {
    return toolChoice.type
  }

  if (toolChoice.type === 'required') {
    return 'required'
  }

  if (toolChoice.type === 'tool') {
    return {
      type: 'function',
      name: toolChoice.name
    }
  }

  return toolChoice
}

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

  const body = {
    model: unified.model,
    instructions: unified.system.join('\n\n') || undefined,
    input,
    reasoning: unified.output.reasoning || undefined,
    modalities: unified.output.modalities || undefined,
    stream: unified.stream
  }

  if (unified.sampling?.maxTokens !== undefined) {
    body.max_output_tokens = unified.sampling.maxTokens
  }

  if (unified.sampling?.temperature !== undefined) {
    body.temperature = unified.sampling.temperature
  }

  if (unified.sampling?.topP !== undefined) {
    body.top_p = unified.sampling.topP
  }

  if (unified.sampling?.stop !== undefined) {
    body.stop = unified.sampling.stop
  }

  if (Array.isArray(unified.tools) && unified.tools.length > 0) {
    body.tools = unified.tools
  }

  const toolChoice = toResponsesToolChoice(unified.toolChoice)
  if (toolChoice !== undefined) {
    body.tool_choice = toolChoice
  }

  if (Object.keys(unified.metadata || {}).length > 0) {
    body.metadata = unified.metadata
  }

  if (unified.serviceTier) {
    body.service_tier = unified.serviceTier
  }

  return {
    body,
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
