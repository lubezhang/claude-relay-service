const { createUnifiedRequest } = require('./schemas')
const { mapModelName } = require('./modelMapper')
const { normalizeToolChoice } = require('./blocks/toolBlock')

function normalizeUnifiedRequest(value, options = {}) {
  const normalized = createUnifiedRequest(value)
  normalized.model = mapModelName(normalized.model, options.modelMapping)
  normalized.toolChoice = normalizeToolChoice(normalized.toolChoice)

  if (!options.includeRaw) {
    normalized.raw = null
  }

  return normalized
}

module.exports = {
  normalizeUnifiedRequest
}
