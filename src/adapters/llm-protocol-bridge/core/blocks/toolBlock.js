function toUnifiedToolCallBlock(block) {
  if (!block || (block.type !== 'tool_use' && block.type !== 'tool_call')) {
    return null
  }

  return {
    type: 'tool_call',
    id: block.id,
    name: block.name,
    input: block.input || {}
  }
}

function toUnifiedToolResultBlock(block) {
  if (!block || (block.type !== 'tool_result' && block.type !== 'function_call_output')) {
    return null
  }

  return {
    type: 'tool_result',
    toolCallId: block.tool_use_id || block.call_id,
    content: block.content || block.output || '',
    isError: Boolean(block.is_error)
  }
}

function normalizeToolChoice(toolChoice) {
  if (!toolChoice) {
    return null
  }

  if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') {
    return { type: toolChoice }
  }

  if (toolChoice.type === 'function' && toolChoice.function?.name) {
    return { type: 'tool', name: toolChoice.function.name }
  }

  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'tool', name: toolChoice.name }
  }

  return toolChoice
}

module.exports = {
  normalizeToolChoice,
  toUnifiedToolCallBlock,
  toUnifiedToolResultBlock
}
