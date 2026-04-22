function decodeError(errorBody, { status }) {
  const error = errorBody.error || errorBody
  return {
    type: error.type || 'api_error',
    message: error.message || 'Unknown error',
    code: error.code || null,
    status,
    retryable: status >= 500 || status === 429
  }
}

function encodeError(error) {
  return {
    status: error.status || 500,
    body: {
      type: 'error',
      error: {
        type: error.type || 'api_error',
        message: error.message || 'Unknown error',
        ...(error.code ? { code: error.code } : {})
      }
    }
  }
}

module.exports = {
  decodeError,
  encodeError
}
