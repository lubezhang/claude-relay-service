const { DEFAULT_USAGE, STOP_REASONS } = require('./constants')

function createUnifiedRequest(value = {}) {
  return {
    protocol: value.protocol || null,
    model: value.model || null,
    system: Array.isArray(value.system) ? value.system : value.system ? [value.system] : [],
    messages: Array.isArray(value.messages) ? value.messages : [],
    tools: Array.isArray(value.tools) ? value.tools : [],
    toolChoice: value.toolChoice || null,
    sampling: value.sampling || {},
    output: value.output || {},
    metadata: value.metadata || {},
    stream: Boolean(value.stream),
    serviceTier: value.serviceTier || null,
    raw: value.raw || null
  }
}

function createUnifiedResponse(value = {}) {
  return {
    id: value.id || null,
    protocol: value.protocol || null,
    model: value.model || null,
    role: value.role || 'assistant',
    blocks: Array.isArray(value.blocks) ? value.blocks : [],
    stop: {
      reason: value.stop?.reason || STOP_REASONS.UNKNOWN,
      sequence: value.stop?.sequence || null
    },
    usage: {
      ...DEFAULT_USAGE,
      ...(value.usage || {})
    },
    raw: value.raw || null
  }
}

function createUnifiedError(value = {}) {
  const status = Number(value.status || 500)
  return {
    type: value.type || 'api_error',
    message: value.message || 'Unknown error',
    code: value.code || null,
    status,
    retryable: value.retryable ?? [408, 409, 429, 500, 502, 503, 504].includes(status),
    details: value.details || null,
    raw: value.raw || null
  }
}

function createUnifiedTokenCount(value = {}) {
  const inputTokens = Number(value.inputTokens || 0)
  const outputTokens = Number(value.outputTokens || 0)
  const cacheReadTokens = Number(value.cacheReadTokens || 0)
  const cacheWriteTokens = Number(value.cacheWriteTokens || 0)
  const reasoningTokens = Number(value.reasoningTokens || 0)

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: value.totalTokens ?? inputTokens + outputTokens,
    reasoningTokens
  }
}

module.exports = {
  createUnifiedError,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTokenCount
}
