function encodeError(error) {
  return {
    status: error.status || 500,
    body: {
      error: {
        type: error.type || 'api_error',
        message: error.message || 'Unknown error',
        ...(error.code ? { code: error.code } : {})
      }
    }
  }
}

module.exports = {
  encodeError
}
