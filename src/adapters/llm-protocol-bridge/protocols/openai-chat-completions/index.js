const { decodeRequest } = require('./requestDecoder')
const { encodeRequest } = require('./requestEncoder')
const { decodeResponse } = require('./responseDecoder')
const { encodeResponse } = require('./responseEncoder')
const { decodeStream } = require('./streamDecoder')
const { encodeStream } = require('./streamEncoder')

module.exports = {
  decodeRequest,
  encodeRequest,
  decodeResponse,
  encodeResponse,
  decodeStream,
  encodeStream
}
