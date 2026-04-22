function normalizeHeaders(headers = {}, { sourceProtocol, direction = 'request' } = {}) {
  if (sourceProtocol === 'anthropic.messages' || sourceProtocol === 'anthropic.count_tokens') {
    return {
      version: headers['anthropic-version'] || null,
      beta: headers['anthropic-beta'] || null,
      requestId: headers['x-request-id'] || headers['request-id'] || null,
      direction
    }
  }

  return {
    version: headers['openai-version'] || null,
    beta: headers['openai-beta'] || null,
    requestId: headers['x-request-id'] || headers['request-id'] || null,
    direction
  }
}

module.exports = {
  normalizeHeaders
}
