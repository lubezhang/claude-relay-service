const { createUnifiedError } = require('./schemas')

function normalizeError(errorBody = {}, { status = 500 } = {}) {
  const error = errorBody.error || errorBody
  return createUnifiedError({
    type: error.type,
    message: error.message,
    code: error.code,
    status,
    details: error.details || null,
    raw: errorBody
  })
}

module.exports = {
  normalizeError
}
