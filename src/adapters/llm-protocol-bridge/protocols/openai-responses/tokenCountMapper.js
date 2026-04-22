function encodeTokenCountResponse(tokenCount) {
  return {
    body: {
      usage: {
        input_tokens: tokenCount.inputTokens,
        output_tokens: tokenCount.outputTokens,
        total_tokens: tokenCount.totalTokens
      }
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeTokenCountResponse
}
