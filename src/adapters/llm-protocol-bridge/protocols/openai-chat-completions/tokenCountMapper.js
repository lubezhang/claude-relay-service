function decodeTokenCountRequest(body) {
  return {
    model: body.model,
    messages: body.messages || []
  }
}

function encodeTokenCountRequest(normalized) {
  return {
    body: {
      model: normalized.model,
      messages: normalized.messages
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    }
  }
}

function decodeTokenCountResponse(body) {
  return {
    inputTokens: body.prompt_tokens || 0,
    outputTokens: body.completion_tokens || 0,
    totalTokens: body.total_tokens || (body.prompt_tokens || 0) + (body.completion_tokens || 0),
    cacheReadTokens: body.prompt_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: 0,
    reasoningTokens: body.completion_tokens_details?.reasoning_tokens || 0
  }
}

function encodeTokenCountResponse(tokenCount) {
  return {
    body: {
      prompt_tokens: tokenCount.inputTokens,
      completion_tokens: tokenCount.outputTokens,
      total_tokens: tokenCount.totalTokens
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.chat_completions',
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
