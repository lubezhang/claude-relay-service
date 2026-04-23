const { toChatImagePart } = require('./imageBlock')
const { extractReasoningText } = require('./reasoningBlock')

function createImageFallbackText(block) {
  if (block.url) {
    return `[image omitted: ${block.url}]`
  }

  return `[image omitted: ${block.mediaType || 'application/octet-stream'}]`
}

function serializeBlocks(blocks = [], options = {}) {
  const warnings = []
  const content = []

  for (const block of blocks) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'image' && options.targetProtocol === 'openai.chat_completions') {
      if (options.allowImageParts === false) {
        warnings.push('image block downgraded to text note for openai.chat_completions')
        content.push({ type: 'text', text: createImageFallbackText(block) })
        continue
      }

      content.push(toChatImagePart(block))
    }
  }

  return {
    content,
    reasoning: options.includeReasoningField ? extractReasoningText(blocks) : null,
    warnings
  }
}

module.exports = {
  serializeBlocks
}
