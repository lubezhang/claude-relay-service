const { normalizeUnifiedResponse } = require('../../core/responseNormalizer')
const { normalizeUsage } = require('../../core/usageNormalizer')

function decodeResponse(body) {
  const blocks = []

  for (const item of body.output || []) {
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
    if (item.type === 'output_text') {
      blocks.push({ type: 'text', text: item.text })
    }
  }

  return normalizeUnifiedResponse({
    id: body.id,
    protocol: 'openai.responses',
    model: body.model,
    role: 'assistant',
    blocks,
    stop: { reason: 'end_turn', sequence: null },
    usage: normalizeUsage(body.usage || {}),
    raw: body
  })
}

module.exports = {
  decodeResponse
}
