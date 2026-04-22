function encodeHeaders(normalized) {
  return {
    ...(normalized.version ? { 'anthropic-version': normalized.version } : {}),
    ...(normalized.beta ? { 'anthropic-beta': normalized.beta } : {}),
    ...(normalized.requestId ? { 'x-request-id': normalized.requestId } : {})
  }
}

module.exports = {
  encodeHeaders
}
