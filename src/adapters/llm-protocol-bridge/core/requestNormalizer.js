const { createUnifiedRequest } = require('./schemas')

function normalizeUnifiedRequest(value) {
  return createUnifiedRequest(value)
}

module.exports = {
  normalizeUnifiedRequest
}
