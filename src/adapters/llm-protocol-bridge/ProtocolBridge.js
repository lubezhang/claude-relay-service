const anthropic = require('./protocols/anthropic-messages')
const chat = require('./protocols/openai-chat-completions')
const responses = require('./protocols/openai-responses')
const { StreamStateStore } = require('./core/stream/StreamStateStore')
const { normalizeStreamEvents } = require('./core/stream/streamNormalizer')

class ProtocolBridge {
  constructor(options = {}) {
    this.streamStateStore = options.streamStateStore || new StreamStateStore()
    this.protocols = {
      'anthropic.messages': anthropic,
      'openai.chat_completions': chat,
      'openai.responses': responses
    }
  }

  detectProtocol({ path = '', headers = {}, body = {} }) {
    if (path.includes('/messages') || headers['anthropic-version']) {
      return 'anthropic.messages'
    }
    if (path.includes('/chat/completions') || body.messages) {
      return 'openai.chat_completions'
    }
    if (path.includes('/responses') || body.input) {
      return 'openai.responses'
    }
    return null
  }

  translateRequest({ sourceProtocol, targetProtocol, body, headers = {}, options = {} }) {
    const unified = this.protocols[sourceProtocol].decodeRequest(body, headers, options)
    const encoded = this.protocols[targetProtocol].encodeRequest(unified, headers, options)
    return this._withMeta(encoded, sourceProtocol, targetProtocol, options)
  }

  translateResponse({ sourceProtocol, targetProtocol, body, headers = {}, options = {} }) {
    const unified = this.protocols[sourceProtocol].decodeResponse(body, headers, options)
    const encoded = this.protocols[targetProtocol].encodeResponse(unified, headers, options)
    return this._withMeta(encoded, sourceProtocol, targetProtocol, options)
  }

  translateStreamChunk({
    sourceProtocol,
    targetProtocol,
    chunk,
    sessionId,
    headers = {},
    options = {}
  }) {
    const decoded = this.protocols[sourceProtocol].decodeStream(chunk, {
      headers,
      options,
      sessionId,
      stateStore: this.streamStateStore
    })
    const normalizedEvents = normalizeStreamEvents(decoded.events || decoded, {
      sessionId,
      stateStore: this.streamStateStore
    })
    const encoded = this.protocols[targetProtocol].encodeStream(normalizedEvents, {
      headers,
      options,
      sessionId,
      stateStore: this.streamStateStore
    })
    return {
      ...this._withMeta(encoded, sourceProtocol, targetProtocol, options),
      sessionId
    }
  }

  translateError({ sourceProtocol, targetProtocol, error, status, headers = {}, options = {} }) {
    const unified = this.protocols[sourceProtocol].decodeError(error, { status, headers, options })
    const encoded = this.protocols[targetProtocol].encodeError(unified, { headers, options })
    return this._withMeta(encoded, sourceProtocol, targetProtocol, options)
  }

  translateHeaders({
    sourceProtocol,
    targetProtocol,
    headers,
    direction = 'request',
    options = {}
  }) {
    const normalized = this.protocols[sourceProtocol].decodeHeaders(headers, { direction, options })
    const encoded = this.protocols[targetProtocol].encodeHeaders(normalized, { direction, options })
    return this._withMeta({ headers: encoded, body: null }, sourceProtocol, targetProtocol, options)
  }

  translateTokenCountRequest({ sourceProtocol, targetProtocol, body, headers = {}, options = {} }) {
    const normalized = this.protocols[sourceProtocol].decodeTokenCountRequest(body, {
      headers,
      options
    })
    const encoded = this.protocols[targetProtocol].encodeTokenCountRequest(normalized, {
      headers,
      options
    })
    return this._withMeta(encoded, sourceProtocol, targetProtocol, options)
  }

  translateTokenCountResponse({
    sourceProtocol,
    targetProtocol,
    body,
    headers = {},
    options = {}
  }) {
    const normalized = this.protocols[sourceProtocol].decodeTokenCountResponse(body, {
      headers,
      options
    })
    const encoded = this.protocols[targetProtocol].encodeTokenCountResponse(normalized, {
      headers,
      options
    })
    return this._withMeta(encoded, sourceProtocol, targetProtocol, options)
  }

  resetStream(sessionId) {
    this.streamStateStore.reset(sessionId)
  }

  resetAllStreams() {
    this.streamStateStore.resetAll()
  }

  getDebugState(sessionId) {
    return this.streamStateStore.snapshot(sessionId)
  }

  _withMeta(result, sourceProtocol, targetProtocol, options = {}) {
    const meta = {
      sourceProtocol,
      targetProtocol,
      degraded: result.meta?.degraded || false,
      warnings: result.meta?.warnings || []
    }

    if (options.strict && meta.degraded) {
      if (
        meta.warnings.includes('image block downgraded to text note for openai.chat_completions')
      ) {
        throw new Error(`${targetProtocol} cannot encode image block without degradation`)
      }

      throw new Error(`${targetProtocol} cannot encode payload without degradation`)
    }

    return {
      ...result,
      meta
    }
  }
}

module.exports = ProtocolBridge
