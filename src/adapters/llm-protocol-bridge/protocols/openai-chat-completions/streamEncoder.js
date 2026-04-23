const { normalizeUsage } = require('../../core/usageNormalizer')

function encodeStream(events) {
  const payloads = []

  for (const event of events) {
    if (event.type === 'message_start') {
      payloads.push(
        `data: ${JSON.stringify({
          id: event.message?.id,
          model: event.message?.model,
          choices: [{ delta: { role: 'assistant' } }]
        })}\n\n`
      )
      continue
    }

    if (event.type === 'block_start' && event.block.type === 'tool_call') {
      payloads.push(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: event.index,
                    id: event.block.id,
                    type: 'function',
                    function: {
                      name: event.block.name,
                      arguments: ''
                    }
                  }
                ]
              }
            }
          ]
        })}\n\n`
      )
      continue
    }

    if (event.type === 'block_delta' && event.block.type === 'reasoning') {
      payloads.push(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: event.block.text } }] })}\n\n`
      )
      continue
    }

    if (event.type === 'block_delta' && event.block.type === 'text') {
      payloads.push(
        `data: ${JSON.stringify({ choices: [{ delta: { content: event.block.text } }] })}\n\n`
      )
      continue
    }

    if (event.type === 'block_delta' && event.block.type === 'tool_call') {
      payloads.push(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: event.index,
                    function: {
                      arguments: event.block.partialJson || ''
                    }
                  }
                ]
              }
            }
          ]
        })}\n\n`
      )
      continue
    }

    if (event.type === 'message_stop') {
      const usage = normalizeUsage(event.usage || {})
      payloads.push(
        `data: ${JSON.stringify({
          choices: [
            {
              finish_reason: event.stop?.reason === 'tool_use' ? 'tool_calls' : 'stop',
              delta: {}
            }
          ],
          usage: {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens
          }
        })}\n\n`
      )
      payloads.push('data: [DONE]\n\n')
    }
  }

  return {
    chunk: payloads.join(''),
    meta: {
      targetProtocol: 'openai.chat_completions',
      degraded: false,
      warnings: []
    }
  }
}

module.exports = {
  encodeStream
}
