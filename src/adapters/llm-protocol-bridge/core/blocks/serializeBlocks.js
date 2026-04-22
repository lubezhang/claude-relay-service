const { toChatImagePart } = require('./imageBlock')
const { extractReasoningText } = require('./reasoningBlock')

function serializeBlocks(blocks = [], options = {}) {
  const warnings = []
  const content = []

  for (const block of blocks) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
    }

    if (block.type === 'image' && options.targetProtocol === 'openai.chat_completions') {
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
