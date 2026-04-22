const { normalizeUnifiedRequest } = require('../../core/requestNormalizer')

function decodeResponseItems(items = []) {
  return items.map((item) => {
    const blocks = []
    for (const contentItem of item.content || []) {
      if (contentItem.type === 'input_text') {
        blocks.push({ type: 'text', text: contentItem.text })
      }
      if (contentItem.type === 'input_image') {
        blocks.push({
          type: 'image',
          sourceType: 'url',
          mediaType: null,
          data: null,
          url: contentItem.image_url
        })
      }
      if (contentItem.type === 'function_call') {
        blocks.push({
          type: 'tool_call',
          id: contentItem.call_id,
          name: contentItem.name,
          input: JSON.parse(contentItem.arguments || '{}')
        })
      }
      if (contentItem.type === 'function_call_output') {
        blocks.push({
          type: 'tool_result',
          toolCallId: contentItem.call_id,
          content: contentItem.output,
          isError: false
        })
      }
    }
    return {
      role: item.role,
      blocks
    }
  })
}

function decodeRequest(body) {
  return normalizeUnifiedRequest({
    protocol: 'openai.responses',
    model: body.model,
    system: body.instructions ? [body.instructions] : [],
    messages: decodeResponseItems(body.input || []),
    tools: body.tools || [],
    output: {
      reasoning: body.reasoning || null,
      modalities: body.modalities || null
    },
    stream: body.stream,
    raw: body
  })
}

module.exports = {
  decodeRequest
}
