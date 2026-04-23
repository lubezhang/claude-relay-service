function openBlock(state, block) {
  state.currentBlockIndex += 1
  state.currentBlockType = block.type
  state.currentBlock = block
  return state.currentBlockIndex
}

function closeBlock(state) {
  const index = state.currentBlockIndex
  state.currentBlockType = null
  state.currentBlock = null
  return index
}

module.exports = {
  closeBlock,
  openBlock
}
