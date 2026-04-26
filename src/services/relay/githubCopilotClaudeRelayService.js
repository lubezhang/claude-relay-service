const protocolBridge = require('../../adapters/llm-protocol-bridge')
const logger = require('../../utils/logger')
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
  const openAIMessages = []

  if (payload.system) {
    const systemBlocks = Array.isArray(payload.system) ? payload.system : [{ type: 'text', text: payload.system }]
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

  const translated = {
    model: mapAnthropicModel(payload.model),
    messages: openAIMessages,
    stream: payload.stream === true
  }

  if (payload.max_tokens !== undefined) {
    translated.max_tokens = payload.max_tokens
  }

  if (payload.temperature !== undefined) {
    translated.temperature = payload.temperature
  }

  if (payload.top_p !== undefined) {
    translated.top_p = payload.top_p
  }

  if (payload.stop_sequences !== undefined) {
    translated.stop = payload.stop_sequences
  }

  if (payload.metadata?.user_id) {
    translated.user = payload.metadata.user_id
  }

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    translated.tools = payload.tools.map((tool) => ({
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
    translated.tool_choice = toolChoice
  }

  if (translated.stream) {
    translated.stream_options = {
      include_usage: true
    }
  }

  return translated
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

function createCaptureResponse(res, sessionId) {
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
        return res.status(captureRes.statusCode).json(openAIErrorToAnthropic(payload, captureRes.statusCode))
      }

      return res.status(captureRes.statusCode).json(openAIResponseToAnthropic(payload))
    },
    write(chunk) {
      const textChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      const translated = protocolBridge.translateStreamChunk({
        sourceProtocol: 'openai.chat_completions',
        targetProtocol: 'anthropic.messages',
        chunk: textChunk,
        sessionId
      })

      if (translated?.chunk) {
        captureRes.headersSent = true
        return res.write(translated.chunk)
      }

      return true
    },
    end(chunk) {
      if (chunk) {
        captureRes.write(chunk)
      }
      protocolBridge.resetStream(sessionId)
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
  const captureRes = createCaptureResponse(res, sessionId)
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
