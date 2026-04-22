function decodeTokenCountRequest(body) {
  return {
    model: body.model,
    system: body.system || null,
    messages: body.messages || []
  }
}

function encodeTokenCountRequest(normalized) {
  return {
    body: {
      model: normalized.model,
      system: normalized.system,
      messages: normalized.messages
    },
    headers: {},
    meta: {
      targetProtocol: 'anthropic.count_tokens',
      degraded: false,
      warnings: []
    }
  }
}

function decodeTokenCountResponse(body) {
  return {
    inputTokens: body.input_tokens || 0,
    outputTokens: 0,
    totalTokens: body.input_tokens || 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0
  }
}

function encodeTokenCountResponse(tokenCount) {
  return {
    body: {
      input_tokens: tokenCount.inputTokens
    },
    headers: {},
    meta: {
      targetProtocol: 'anthropic.count_tokens',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  decodeTokenCountRequest,
  encodeTokenCountRequest,
  decodeTokenCountResponse,
  encodeTokenCountResponse
}
