const { decodeRequest } = require('./requestDecoder')
const { encodeRequest } = require('./requestEncoder')
const { decodeResponse } = require('./responseDecoder')
const { encodeResponse } = require('./responseEncoder')
const { decodeStream } = require('./streamDecoder')
const { encodeStream } = require('./streamEncoder')
const { decodeError, encodeError } = require('./errorMapper')
const { encodeHeaders } = require('./headerMapper')
const {
  decodeTokenCountRequest,
  encodeTokenCountRequest,
  decodeTokenCountResponse,
  encodeTokenCountResponse
} = require('./tokenCountMapper')

module.exports = {
  decodeRequest,
  encodeRequest,
  decodeResponse,
  encodeResponse,
  decodeStream,
  encodeStream,
  decodeError,
  encodeError,
  decodeHeaders: (headers = {}, { direction = 'request' } = {}) => ({
    version: headers['anthropic-version'] || null,
    beta: headers['anthropic-beta'] || null,
    requestId: headers['x-request-id'] || headers['request-id'] || null,
    direction
  }),
  encodeHeaders,
  decodeTokenCountRequest,
  encodeTokenCountRequest,
  decodeTokenCountResponse,
  encodeTokenCountResponse
}
