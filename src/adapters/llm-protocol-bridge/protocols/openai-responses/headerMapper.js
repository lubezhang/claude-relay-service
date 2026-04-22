function decodeHeaders(headers = {}) {
  return {
    version: headers['openai-version'] || null,
    beta: headers['openai-beta'] || null,
    requestId: headers['x-request-id'] || null,
    direction: 'request'
  }
}

function encodeHeaders(normalized) {
  return {
    ...(normalized.version ? { 'openai-version': normalized.version } : {}),
    ...(normalized.beta ? { 'openai-beta': normalized.beta } : {}),
    ...(normalized.requestId ? { 'x-request-id': normalized.requestId } : {})
  }
}

module.exports = {
  decodeHeaders,
  encodeHeaders
}
