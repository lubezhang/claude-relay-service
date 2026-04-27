const protocolBridge = require('../../adapters/llm-protocol-bridge')
const logger = require('../../utils/logger')
const { updateRateLimitCounters } = require('../../utils/rateLimitHelper')
const {
  createRequestDetailMeta,
  extractOpenAICacheReadTokens
} = require('../../utils/requestDetailHelper')
const apiKeyService = require('../apiKeyService')
const githubCopilotAccountService = require('../account/githubCopilotAccountService')
const githubCopilotRelayService = require('./githubCopilotRelayService')

function mapAnthropicModel(model = '') {
  const normalizedModel = String(model || '').toLowerCase()
  return normalizedModel.includes('haiku') ? 'gpt-4.1-mini' : 'gpt-4.1'
}

function normalizeTextBlocks(blocks = []) {
  return blocks
    .filter((block) => block && (block.type === 'text' || block.type === 'thinking'))
    .map((block) => (block.type === 'thinking' ? block.thinking || '' : block.text || ''))
    .filter(Boolean)
}

function mapAnthropicContentToOpenAI(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return null
  }

  const hasImageBlocks = content.some((block) => block?.type === 'image')
  if (!hasImageBlocks) {
    const text = normalizeTextBlocks(content).join('\n\n')
    return text || null
  }

  const parts = []
  for (const block of content) {
    if (!block) {
      continue
    }

    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text || '' })
      continue
    }

    if (block.type === 'thinking') {
      parts.push({ type: 'text', text: block.thinking || '' })
      continue
    }

    if (
      block.type === 'image' &&
      block.source?.type === 'base64' &&
      block.source?.media_type &&
      block.source?.data
    ) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`
        }
      })
    }
  }

  return parts.length > 0 ? parts : null
}

function mapToolResultContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const text = normalizeTextBlocks(content).join('\n\n')
    return text || JSON.stringify(content)
  }

  if (content && typeof content === 'object') {
    return JSON.stringify(content)
  }

  return ''
}

function mapAnthropicToolChoice(toolChoice) {
  if (!toolChoice) {
    return undefined
  }

  if (toolChoice.type === 'auto') {
    return 'auto'
  }

  if (toolChoice.type === 'none') {
    return 'none'
  }

  if (toolChoice.type === 'any') {
    return 'required'
  }

  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: {
        name: toolChoice.name
      }
    }
  }

  return undefined
}

function anthropicMessagesToOpenAI(payload = {}) {
  const translatedRequest = protocolBridge.translateRequest({
    sourceProtocol: 'anthropic.messages',
    targetProtocol: 'openai.chat_completions',
    body: payload,
    options: {
      modelMapping: {
        [payload.model]: mapAnthropicModel(payload.model)
      }
    }
  })

  const translatedBody = translatedRequest.body || {}
  const openAIMessages = []

  if (payload.system) {
    const systemBlocks = Array.isArray(payload.system)
      ? payload.system
      : [{ type: 'text', text: payload.system }]
    const systemText = normalizeTextBlocks(systemBlocks).join('\n\n')
    if (systemText) {
      openAIMessages.push({ role: 'system', content: systemText })
    }
  }

  for (const message of payload.messages || []) {
    if (message.role === 'user') {
      if (!Array.isArray(message.content)) {
        openAIMessages.push({ role: 'user', content: message.content || '' })
        continue
      }

      const toolResultBlocks = message.content.filter((block) => block?.type === 'tool_result')
      const otherBlocks = message.content.filter((block) => block?.type !== 'tool_result')

      for (const block of toolResultBlocks) {
        openAIMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: mapToolResultContent(block.content)
        })
      }

      if (otherBlocks.length > 0) {
        openAIMessages.push({
          role: 'user',
          content: mapAnthropicContentToOpenAI(otherBlocks)
        })
      }
      continue
    }

    if (message.role === 'assistant') {
      if (!Array.isArray(message.content)) {
        openAIMessages.push({ role: 'assistant', content: message.content || null })
        continue
      }

      const toolUseBlocks = message.content.filter((block) => block?.type === 'tool_use')
      const textBlocks = message.content.filter((block) => block?.type !== 'tool_use')
      const textContent = mapAnthropicContentToOpenAI(textBlocks)

      if (toolUseBlocks.length > 0) {
        openAIMessages.push({
          role: 'assistant',
          content: textContent,
          tool_calls: toolUseBlocks.map((block) => ({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          }))
        })
      } else {
        openAIMessages.push({
          role: 'assistant',
          content: textContent
        })
      }
    }
  }

  translatedBody.messages = openAIMessages

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    translatedBody.tools = payload.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    }))
  }

  const toolChoice = mapAnthropicToolChoice(payload.tool_choice)
  if (toolChoice !== undefined) {
    translatedBody.tool_choice = toolChoice
  }

  if (translatedBody.stream) {
    translatedBody.stream_options = {
      include_usage: true
    }
  }

  return translatedBody
}

function mapOpenAIStopReason(stopReason) {
  if (stopReason === 'tool_calls') {
    return 'tool_use'
  }

  if (stopReason === 'length') {
    return 'max_tokens'
  }

  if (stopReason === 'content_filter') {
    return 'refusal'
  }

  if (stopReason === 'stop') {
    return 'end_turn'
  }

  return stopReason || null
}

function parseToolArguments(argumentsText) {
  if (!argumentsText) {
    return {}
  }

  try {
    return JSON.parse(argumentsText)
  } catch (error) {
    logger.warn('Failed to parse GitHub Copilot tool call arguments as JSON')
    return {}
  }
}

function openAIResponseToAnthropic(response = {}) {
  const choice = response.choices?.[0] || {}
  const message = choice.message || {}
  const content = []

  if (typeof message.content === 'string' && message.content.length > 0) {
    content.push({
      type: 'text',
      text: message.content
    })
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        content.push({ type: 'text', text: part.text })
      }
    }
  }

  for (const toolCall of message.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function?.name,
      input: parseToolArguments(toolCall.function?.arguments)
    })
  }

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason: mapOpenAIStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      ...(response.usage?.prompt_tokens_details?.cached_tokens
        ? { cache_read_input_tokens: response.usage.prompt_tokens_details.cached_tokens }
        : {})
    }
  }
}

function openAIErrorToAnthropic(errorPayload = {}, statusCode = 500) {
  const error = errorPayload?.error || errorPayload || {}
  return {
    error: {
      type: error.type || 'api_error',
      message: error.message || 'GitHub Copilot relay request failed',
      ...(statusCode ? { status: statusCode } : {})
    }
  }
}

function buildAnthropicStreamError(message = 'GitHub Copilot stream translation failed') {
  return `event: error\ndata: ${JSON.stringify({
    type: 'error',
    error: {
      type: 'api_error',
      message
    }
  })}\n\n`
}

function extractDataPayloadsFromSSE(eventText = '') {
  return eventText
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .filter(Boolean)
}

function captureOpenAIStreamUsage(eventText, streamState) {
  for (const payload of extractDataPayloadsFromSSE(eventText)) {
    if (payload === '[DONE]') {
      streamState.doneReceived = true
      continue
    }

    try {
      const data = JSON.parse(payload)
      if (data?.model) {
        streamState.model = data.model
      }
      if (data?.usage) {
        streamState.usage = data.usage
        if (data.model) {
          streamState.usageModel = data.model
        }
      }
    } catch (error) {
      // Parsing errors are handled by bridge translation; do not log payload contents.
    }
  }
}

function recordStreamUsageFireAndForget({ req, account, apiKeyData, streamState, mappedModel }) {
  const usageData = streamState.usage
  if (!usageData || !apiKeyData?.id || !account?.id) {
    return
  }

  const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
  const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
  const cacheReadTokens = extractOpenAICacheReadTokens(usageData)
  const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)
  const cacheCreateTokens = usageData.cache_creation_input_tokens || 0
  const usageObject = {
    input_tokens: actualInputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreateTokens,
    cache_read_input_tokens: cacheReadTokens
  }
  const model = streamState.usageModel || streamState.model || mappedModel || 'unknown'

  apiKeyService
    .recordUsageWithDetails(
      apiKeyData.id,
      usageObject,
      model,
      account.id,
      'github-copilot',
      createRequestDetailMeta(req, {
        requestBody: req.body,
        stream: true,
        statusCode: 200
      })
    )
    .then((costs) => {
      if (!req.rateLimitInfo) {
        return null
      }

      return updateRateLimitCounters(
        req.rateLimitInfo,
        {
          inputTokens: actualInputTokens,
          outputTokens,
          cacheCreateTokens,
          cacheReadTokens
        },
        model,
        apiKeyData.id,
        'github-copilot',
        costs
      )
    })
    .catch((error) => {
      logger.error('Failed to record GitHub Copilot Claude stream usage:', {
        message: error?.message,
        code: error?.code
      })
    })
}

function createCaptureResponse(res, sessionId, options = {}) {
  let streamBuffer = ''
  let streamFailed = false
  let usageRecorded = false
  let streamHeadersPrepared = false
  let streamHeadersFlushed = false
  const { req, account, apiKeyData, streamState = {}, mappedModel } = options

  const ensureAnthropicStreamHeaders = () => {
    if (streamHeadersFlushed || res.writableEnded || res.destroyed) {
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    if (!res.getHeader('Connection')) {
      res.setHeader('Connection', 'keep-alive')
    }
    res.setHeader('X-Accel-Buffering', 'no')
    if (res.socket && typeof res.socket.setNoDelay === 'function') {
      res.socket.setNoDelay(true)
    }
    if (typeof res.flushHeaders === 'function' && !res.headersSent) {
      res.flushHeaders()
    }
    captureRes.headersSent = true
    streamHeadersFlushed = true
  }

  const writeAnthropicStreamError = (message) => {
    if (!streamFailed && !res.writableEnded && !res.destroyed) {
      streamFailed = true
      ensureAnthropicStreamHeaders()
      res.write(buildAnthropicStreamError(message))
    }
  }

  const translateCompleteSSEEvent = (eventText) => {
    captureOpenAIStreamUsage(eventText, streamState)

    try {
      const translated = protocolBridge.translateStreamChunk({
        sourceProtocol: 'openai.chat_completions',
        targetProtocol: 'anthropic.messages',
        chunk: `${eventText}\n\n`,
        sessionId
      })

      if (translated?.chunk && !res.writableEnded && !res.destroyed) {
        ensureAnthropicStreamHeaders()
        captureRes.headersSent = true
        res.write(translated.chunk)
      }
    } catch (error) {
      logger.warn('Failed to translate GitHub Copilot stream chunk:', {
        message: error?.message,
        code: error?.code
      })
      writeAnthropicStreamError('GitHub Copilot stream translation failed')
    }

    return true
  }

  const flushCompleteSSEEvents = () => {
    let separatorIndex = streamBuffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const eventText = streamBuffer.slice(0, separatorIndex)
      streamBuffer = streamBuffer.slice(separatorIndex + 2)
      if (eventText.trim()) {
        translateCompleteSSEEvent(eventText)
      }
      separatorIndex = streamBuffer.indexOf('\n\n')
    }
  }

  const finishStream = () => {
    if (streamBuffer.trim()) {
      writeAnthropicStreamError('GitHub Copilot stream ended with an incomplete SSE event')
      streamBuffer = ''
    }

    protocolBridge.resetStream(sessionId)

    if (!usageRecorded && req && account && apiKeyData) {
      usageRecorded = true
      recordStreamUsageFireAndForget({ req, account, apiKeyData, streamState, mappedModel })
    }
  }

  const captureRes = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    once: (...args) => {
      if (typeof res.once === 'function') {
        return res.once(...args)
      }
      return captureRes
    },
    removeListener: (...args) => {
      if (typeof res.removeListener === 'function') {
        return res.removeListener(...args)
      }
      return captureRes
    },
    status(code) {
      captureRes.statusCode = code
      return captureRes
    },
    setHeader(key, value) {
      captureRes.headers[key] = value
      if (key.toLowerCase() === 'content-type' && value === 'text/event-stream') {
        streamHeadersPrepared = true
      } else if (!res.headersSent) {
        res.setHeader(key, value)
      }
      return captureRes
    },
    getHeader(key) {
      if (captureRes.headers[key] !== undefined) {
        return captureRes.headers[key]
      }
      return typeof res.getHeader === 'function' ? res.getHeader(key) : undefined
    },
    json(payload) {
      if (captureRes.statusCode >= 400) {
        if (streamHeadersPrepared || streamHeadersFlushed) {
          writeAnthropicStreamError(payload?.error?.message || 'GitHub Copilot relay request failed')
          captureRes.writableEnded = true
          if (!res.writableEnded) {
            res.end()
          }
          return captureRes
        }

        return res.status(captureRes.statusCode).json(openAIErrorToAnthropic(payload, captureRes.statusCode))
      }

      return res.status(captureRes.statusCode).json(openAIResponseToAnthropic(payload))
    },
    write(chunk) {
      if (streamFailed) {
        return true
      }

      const textChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      streamBuffer += textChunk.replace(/\r\n/g, '\n')
      flushCompleteSSEEvents()
      return true
    },
    end(chunk) {
      if (chunk) {
        captureRes.write(chunk)
      }
      finishStream()
      captureRes.writableEnded = true
      if (!res.writableEnded) {
        res.end()
      }
      return captureRes
    }
  }

  return captureRes
}


async function handleMessages(req, res, apiKeyData = {}) {
  const openaiAccountBinding = apiKeyData?.openaiAccountId || ''
  const accountId = openaiAccountBinding.startsWith('copilot:')
    ? openaiAccountBinding.slice('copilot:'.length)
    : null

  if (!accountId) {
    return res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: 'Invalid GitHub Copilot account binding'
      }
    })
  }

  const account = await githubCopilotAccountService.getAccount(accountId)
  if (!account) {
    return res.status(404).json({
      error: {
        type: 'not_found_error',
        message: 'GitHub Copilot account not found'
      }
    })
  }

  const openAIBody = anthropicMessagesToOpenAI(req.body)
  const sessionId = req.requestId || `github-copilot-claude-${Date.now()}-${Math.random()}`
  const captureRes = createCaptureResponse(res, sessionId, {
    req,
    account,
    apiKeyData,
    streamState: {},
    mappedModel: openAIBody.model
  })
  const openAIReq = {
    ...req,
    body: openAIBody,
    on: typeof req.on === 'function' ? req.on.bind(req) : undefined,
    once: typeof req.once === 'function' ? req.once.bind(req) : undefined,
    emit: typeof req.emit === 'function' ? req.emit.bind(req) : undefined,
    removeListener:
      typeof req.removeListener === 'function' ? req.removeListener.bind(req) : undefined
  }

  return await githubCopilotRelayService.handleRequest(openAIReq, captureRes, account, apiKeyData)
}

module.exports = {
  handleMessages,
  _testOnly: {
    anthropicMessagesToOpenAI,
    openAIResponseToAnthropic,
    mapAnthropicModel
  }
}
