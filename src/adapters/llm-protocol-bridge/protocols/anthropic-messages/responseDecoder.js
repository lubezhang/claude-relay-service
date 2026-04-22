const { normalizeBlocks } = require('../../core/blocks/normalizeBlocks')
const { normalizeUnifiedResponse } = require('../../core/responseNormalizer')
const { normalizeUsage } = require('../../core/usageNormalizer')

function decodeResponse(body) {
  return normalizeUnifiedResponse({
    id: body.id,
    protocol: 'anthropic.messages',
    model: body.model,
    role: body.role || 'assistant',
    blocks: normalizeBlocks(body.content || []),
    stop: {
      reason: body.stop_reason || 'unknown',
      sequence: body.stop_sequence || null
    },
    usage: normalizeUsage(body.usage || {}),
    raw: body
  })
}

module.exports = {
  decodeResponse
}
