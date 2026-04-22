function encodeResponse(unified) {
  const output = []

  for (const block of unified.blocks) {
    if (block.type === 'reasoning') {
      output.push({
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: block.text }],
        ...(block.signature ? { signature: block.signature } : {})
      })
    }

    if (block.type === 'tool_call') {
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input || {})
      })
    }

    if (block.type === 'text') {
      output.push({
        type: 'output_text',
        text: block.text
      })
    }
  }

  return {
    body: {
      id: unified.id,
      object: 'response',
      model: unified.model,
      output,
      usage: {
        input_tokens: unified.usage.inputTokens,
        output_tokens: unified.usage.outputTokens,
        total_tokens: unified.usage.totalTokens
      }
    },
    headers: {},
    meta: {
      sourceProtocol: unified.protocol || 'unified',
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeResponse
}
