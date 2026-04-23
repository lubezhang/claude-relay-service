const { normalizeUnifiedResponse } = require('../../core/responseNormalizer')
const { normalizeUsage } = require('../../core/usageNormalizer')

function decodeResponse(body) {
  const blocks = []
  const outputItems = body.output || []

  for (const item of outputItems) {
    if (item.type === 'reasoning') {
      blocks.push({
        type: 'reasoning',
        text: item.summary?.[0]?.text || '',
        signature: item.signature || null
      })
    }
    if (item.type === 'function_call') {
      blocks.push({
        type: 'tool_call',
        id: item.call_id,
        name: item.name,
        input: JSON.parse(item.arguments || '{}')
      })
    }
    if (item.type === 'function_call_output') {
      blocks.push({
        type: 'tool_result',
        toolCallId: item.call_id,
        content: item.output,
        isError: false
      })
    }
    if (item.type === 'output_text') {
      blocks.push({ type: 'text', text: item.text })
    }
  }

  const hasToolCall = outputItems.some((item) => item.type === 'function_call')
  const hasOutputText = outputItems.some((item) => item.type === 'output_text')

  return normalizeUnifiedResponse({
    id: body.id,
    protocol: 'openai.responses',
    model: body.model,
    role: 'assistant',
    blocks,
    stop: { reason: hasToolCall && !hasOutputText ? 'tool_use' : 'end_turn', sequence: null },
    usage: normalizeUsage(body.usage || {}),
    raw: body
  })
}

module.exports = {
  decodeResponse
}
