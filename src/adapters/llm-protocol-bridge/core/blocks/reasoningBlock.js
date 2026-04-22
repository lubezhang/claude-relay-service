function toUnifiedReasoningBlock(block) {
  if (!block) {
    return null
  }

  if (block.type === 'thinking') {
    return {
      type: 'reasoning',
      text: block.thinking || '',
      signature: block.signature || null
    }
  }

  if (block.type === 'reasoning') {
    return {
      type: 'reasoning',
      text: block.text || block.summary?.[0]?.text || '',
      signature: block.signature || null
    }
  }

  return null
}

function extractReasoningText(blocks = []) {
  return blocks
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text)
    .join('\n\n')
}

module.exports = {
  extractReasoningText,
  toUnifiedReasoningBlock
}
