const { normalizeUsage } = require('../../core/usageNormalizer')

function encodeStream(events) {
  const chunks = []

  for (const event of events) {
    if (event.type === 'message_start') {
      chunks.push(
        `data: ${JSON.stringify({
          type: 'response.created',
          response: {
            id: event.message?.id,
            model: event.message?.model
          }
        })}\n\n`
      )
    }

    if (event.type === 'block_start' && event.block.type === 'tool_call') {
      chunks.push(
        `data: ${JSON.stringify({
          type: 'response.function_call_arguments.delta',
          call_id: event.block.id,
          name: event.block.name,
          delta: ''
        })}\n\n`
      )
    }

    if (event.type === 'block_delta' && event.block.type === 'reasoning') {
      chunks.push(
        `data: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: event.block.text })}\n\n`
      )
    }

    if (event.type === 'block_delta' && event.block.type === 'text') {
      chunks.push(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: event.block.text })}\n\n`
      )
    }

    if (event.type === 'block_delta' && event.block.type === 'tool_call') {
      chunks.push(
        `data: ${JSON.stringify({
          type: 'response.function_call_arguments.delta',
          call_id: event.block.id,
          name: event.block.name,
          delta: event.block.partialJson || ''
        })}\n\n`
      )
    }

    if (event.type === 'message_stop') {
      const usage = normalizeUsage(event.usage || {})
      chunks.push(
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              total_tokens: usage.totalTokens
            }
          }
        })}\n\n`
      )
    }
  }

  return {
    chunk: chunks.join(''),
    meta: {
      targetProtocol: 'openai.responses',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeStream
}
