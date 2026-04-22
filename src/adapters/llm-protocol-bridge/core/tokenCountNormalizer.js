const { createUnifiedTokenCount } = require('./schemas')

function normalizeTokenCount(body = {}) {
  return createUnifiedTokenCount({
    inputTokens: body.inputTokens ?? body.input_tokens ?? body.prompt_tokens ?? 0,
    outputTokens: body.outputTokens ?? body.output_tokens ?? body.completion_tokens ?? 0,
    cacheReadTokens: body.cacheReadTokens ?? body.cache_read_input_tokens ?? 0,
    cacheWriteTokens: body.cacheWriteTokens ?? body.cache_creation_input_tokens ?? 0,
    reasoningTokens: body.reasoningTokens ?? body.reasoning_tokens ?? 0
  })
}

module.exports = {
  normalizeTokenCount
}
