const { createUnifiedResponse } = require('./schemas')

function normalizeUnifiedResponse(value) {
  return createUnifiedResponse(value)
}

module.exports = {
  normalizeUnifiedResponse
}
