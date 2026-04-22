const { decodeRequest } = require('./requestDecoder')
const { encodeRequest } = require('./requestEncoder')
const { decodeResponse } = require('./responseDecoder')
const { encodeResponse } = require('./responseEncoder')
const { decodeStream } = require('./streamDecoder')
const { encodeStream } = require('./streamEncoder')
const { encodeError } = require('./errorMapper')
const { decodeHeaders, encodeHeaders } = require('./headerMapper')
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
  decodeError: (errorBody, { status }) => ({ ...(errorBody.error || errorBody), status }),
  encodeError,
  decodeHeaders,
  encodeHeaders,
  decodeTokenCountRequest,
  encodeTokenCountRequest,
  decodeTokenCountResponse,
  encodeTokenCountResponse
}
