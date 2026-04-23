function decodeTokenCountRequest(body) {
  return {
    model: body.model,
    system: body.instructions || null,
    messages: (body.input || []).map((message) => ({
      role: message.role,
      content: (message.content || [])
        .map((item) => {
          if (item.type === 'input_text') {
            return {
              type: 'text',
              text: item.text
            }
          }

          return null
        })
        .filter(Boolean)
    }))
  }
}

function encodeTokenCountRequest(normalized) {
  return {
    body: {
      model: normalized.model,
      ...(normalized.system ? { instructions: normalized.system } : {}),
      input: (normalized.messages || []).map((message) => ({
        role: message.role,
        content: (message.content || [])
          .map((item) => {
            if (typeof item === 'string') {
              return {
                type: 'input_text',
                text: item
              }
            }

            if (item.type === 'text') {
              return {
                type: 'input_text',
                text: item.text || ''
              }
            }

            return null
          })
          .filter(Boolean)
      }))
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

function decodeTokenCountResponse(body) {
  const usage = body.usage || {}

  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens:
      usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
    cacheReadTokens: usage.input_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0
  }
}

function encodeTokenCountResponse(tokenCount) {
  return {
    body: {
      usage: {
        input_tokens: tokenCount.inputTokens,
        output_tokens: tokenCount.outputTokens,
        total_tokens: tokenCount.totalTokens
      }
    },
    headers: {},
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  decodeTokenCountRequest,
  encodeTokenCountRequest,
  decodeTokenCountResponse,
  encodeTokenCountResponse
}
