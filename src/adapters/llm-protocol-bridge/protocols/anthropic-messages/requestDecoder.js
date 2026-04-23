const { normalizeBlocks } = require('../../core/blocks/normalizeBlocks')
const { normalizeUnifiedRequest } = require('../../core/requestNormalizer')

function normalizeSystem(system) {
  if (!system) {
    return []
  }

  if (typeof system === 'string') {
    return [system]
  }

  const blocks = Array.isArray(system) ? system : [system]

  return blocks
    .map((block) => {
      if (typeof block === 'string') {
        return block
      }

      if (block && typeof block.text === 'string') {
        return block.text
      }

      return null
    })
    .filter((value) => typeof value === 'string' && value.length > 0)
}

function decodeRequest(body, _headers = {}, _options = {}) {
  return normalizeUnifiedRequest({
    protocol: 'anthropic.messages',
    model: body.model,
    system: normalizeSystem(body.system),
    messages: (body.messages || []).map((message) => ({
      role: message.role,
      blocks: normalizeBlocks(Array.isArray(message.content) ? message.content : [message.content])
    })),
    tools: body.tools || [],
    toolChoice: body.tool_choice || null,
    sampling: {
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      topP: body.top_p,
      topK: body.top_k,
      stop: body.stop_sequences
    },
    metadata: body.metadata || {},
    stream: body.stream,
    serviceTier: body.service_tier || null,
    raw: body
  })
}

module.exports = {
  decodeRequest
}
