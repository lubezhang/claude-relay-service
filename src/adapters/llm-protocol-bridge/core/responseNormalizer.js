const { createUnifiedResponse } = require('./schemas')
const { mapModelName } = require('./modelMapper')

function normalizeUnifiedResponse(value, options = {}) {
  const normalized = createUnifiedResponse(value)
  normalized.model = mapModelName(normalized.model, options.modelMapping)

  if (!options.includeRaw) {
    normalized.raw = null
  }

  return normalized
}

module.exports = {
  normalizeUnifiedResponse
}
