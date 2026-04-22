function encodeResponse(unified) {
  const message = {
    role: 'assistant',
    content:
      unified.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n') || null
  }

  const reasoningText = unified.blocks
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text)
    .join('\n\n')
  if (reasoningText) {
    message.reasoning_content = reasoningText
  }

  const toolCalls = unified.blocks.filter((block) => block.type === 'tool_call')
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((block) => ({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input || {})
      }
    }))
  }

  return {
    body: {
      id: unified.id,
      object: 'chat.completion',
      model: unified.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: unified.stop.reason === 'tool_use' ? 'tool_calls' : 'stop'
        }
      ],
      usage: {
        prompt_tokens: unified.usage.inputTokens,
        completion_tokens: unified.usage.outputTokens,
        total_tokens: unified.usage.totalTokens,
        completion_tokens_details:
          unified.usage.reasoningTokens > 0
            ? { reasoning_tokens: unified.usage.reasoningTokens }
            : undefined
      }
    },
    headers: {},
    meta: {
      sourceProtocol: unified.protocol || 'unified',
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeResponse
}
