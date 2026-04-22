const { toChatImagePart, toUnifiedImageBlock } = require('./imageBlock')
const { toUnifiedReasoningBlock } = require('./reasoningBlock')
const { toUnifiedToolCallBlock, toUnifiedToolResultBlock } = require('./toolBlock')

function normalizeBlocks(content = []) {
  const blocks = []

  for (const item of content) {
    if (typeof item === 'string') {
      blocks.push({ type: 'text', text: item })
      continue
    }

    if (item.type === 'text') {
      blocks.push({ type: 'text', text: item.text || '' })
      continue
    }

    const reasoning = toUnifiedReasoningBlock(item)
    if (reasoning) {
      blocks.push(reasoning)
      continue
    }

    const image = toUnifiedImageBlock(item)
    if (image) {
      blocks.push(image)
      continue
    }

    const toolCall = toUnifiedToolCallBlock(item)
    if (toolCall) {
      blocks.push(toolCall)
      continue
    }

    const toolResult = toUnifiedToolResultBlock(item)
    if (toolResult) {
      blocks.push(toolResult)
    }
  }

  return blocks
}

module.exports = {
  normalizeBlocks,
  toChatImagePart
}
