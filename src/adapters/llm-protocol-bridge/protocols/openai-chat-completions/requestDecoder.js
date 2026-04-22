const { normalizeBlocks } = require('../../core/blocks/normalizeBlocks')
const { normalizeUnifiedRequest } = require('../../core/requestNormalizer')

function decodeRequest(body) {
  const system = []
  const messages = []

  for (const message of body.messages || []) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }

    if (message.role === 'assistant') {
      const blocks = []
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          blocks.push({
            type: 'tool_call',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || '{}')
          })
        }
      }
      if (message.content) {
        blocks.push(
          ...normalizeBlocks(Array.isArray(message.content) ? message.content : [message.content])
        )
      }
      messages.push({ role: 'assistant', blocks })
      continue
    }

    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        blocks: [
          {
            type: 'tool_result',
            toolCallId: message.tool_call_id,
            content: message.content,
            isError: false
          }
        ]
      })
      continue
    }

    messages.push({
      role: message.role,
      blocks: normalizeBlocks(Array.isArray(message.content) ? message.content : [message.content])
    })
  }

  return normalizeUnifiedRequest({
    protocol: 'openai.chat_completions',
    model: body.model,
    system,
    messages,
    tools: body.tools || [],
    toolChoice: body.tool_choice || null,
    stream: body.stream,
    raw: body
  })
}

module.exports = {
  decodeRequest
}
