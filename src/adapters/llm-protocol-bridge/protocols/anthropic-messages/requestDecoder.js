const { normalizeBlocks } = require('../../core/blocks/normalizeBlocks')
const { normalizeUnifiedRequest } = require('../../core/requestNormalizer')

function decodeRequest(body, _headers = {}, _options = {}) {
  return normalizeUnifiedRequest({
    protocol: 'anthropic.messages',
    model: body.model,
    system: body.system,
    messages: (body.messages || []).map((message) => ({
      role: message.role,
      blocks: normalizeBlocks(Array.isArray(message.content) ? message.content : [message.content])
    })),
    tools: body.tools || [],
    toolChoice: body.tool_choice || null,
    metadata: body.metadata || {},
    stream: body.stream,
    serviceTier: body.service_tier || null,
    raw: body
  })
}

module.exports = {
  decodeRequest
}
