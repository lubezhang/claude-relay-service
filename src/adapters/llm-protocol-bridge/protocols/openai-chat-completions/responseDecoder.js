const { normalizeUnifiedResponse } = require('../../core/responseNormalizer')
const { normalizeUsage } = require('../../core/usageNormalizer')

function decodeResponse(body) {
  const choice = body.choices?.[0] || {}
  const message = choice.message || {}
  const blocks = []

  if (message.reasoning_content) {
    blocks.push({ type: 'reasoning', text: message.reasoning_content, signature: null })
  }

  if (message.content) {
    blocks.push({ type: 'text', text: message.content })
  }

  for (const toolCall of message.tool_calls || []) {
    blocks.push({
      type: 'tool_call',
      id: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments || '{}')
    })
  }

  return normalizeUnifiedResponse({
    id: body.id,
    protocol: 'openai.chat_completions',
    model: body.model,
    role: 'assistant',
    blocks,
    stop: {
      reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      sequence: null
    },
    usage: normalizeUsage(body.usage || {}),
    raw: body
  })
}

module.exports = {
  decodeResponse
}
