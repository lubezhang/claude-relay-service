const { serializeBlocks } = require('../../core/blocks/serializeBlocks')

function encodeRequest(unified, _headers = {}, options = {}) {
  const messages = []
  const warnings = []

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
    const serializedBlocks = serializeBlocks(message.blocks, {
      targetProtocol: 'openai.chat_completions',
      allowImageParts: options.allowImageParts
    })

    warnings.push(...serializedBlocks.warnings)

    for (const block of message.blocks) {
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

    for (const item of serializedBlocks.content) {
      textParts.push(item.type === 'text' ? item.text : item)
    }

    const hasStructuredParts = textParts.some((part) => typeof part === 'object')

    messages.push({
      role: message.role,
      content: hasStructuredParts ? textParts : textParts.join('\n\n') || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    })
  }

  const body = {
    model: unified.model,
    messages,
    stream: unified.stream
  }

  if (unified.stream) {
    body.stream_options = {
      include_usage: true
    }
  }

  if (unified.sampling?.maxTokens !== undefined) {
    body.max_tokens = unified.sampling.maxTokens
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

  if (unified.toolChoice !== null && unified.toolChoice !== undefined) {
    body.tool_choice = unified.toolChoice
  }

  return {
    body,
    headers: {},
    meta: {
      targetProtocol: 'openai.chat_completions',
      degraded: warnings.length > 0,
      warnings
    }
  }
}

module.exports = {
  encodeRequest
}
