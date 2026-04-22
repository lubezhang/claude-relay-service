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

module.exports = {
  toUnifiedToolCallBlock,
  toUnifiedToolResultBlock
}
