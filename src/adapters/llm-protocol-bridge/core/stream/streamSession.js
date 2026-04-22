function openBlock(state, blockType) {
  state.currentBlockIndex += 1
  state.currentBlockType = blockType
  return state.currentBlockIndex
}

function closeBlock(state) {
  const index = state.currentBlockIndex
  state.currentBlockType = null
  return index
}

module.exports = {
  closeBlock,
  openBlock
}
