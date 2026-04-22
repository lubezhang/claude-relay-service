const { DEFAULT_USAGE } = require('./constants')

function pickNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed
      }
    }
  }

  return 0
}

function normalizeUsage(usage = {}) {
  const inputTokens = pickNumber(usage.inputTokens, usage.input_tokens, usage.prompt_tokens)
  const outputTokens = pickNumber(usage.outputTokens, usage.output_tokens, usage.completion_tokens)
  const cacheReadTokens = pickNumber(
    usage.cacheReadTokens,
    usage.cache_read_input_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens
  )
  const cacheWriteTokens = pickNumber(
    usage.cacheWriteTokens,
    usage.cache_creation_input_tokens,
    usage.cache_create_input_tokens
  )
  const reasoningTokens = pickNumber(
    usage.reasoningTokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens
  )

  return {
    ...DEFAULT_USAGE,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    serviceTier: usage.serviceTier || usage.service_tier || null
  }
}

module.exports = {
  normalizeUsage
}
