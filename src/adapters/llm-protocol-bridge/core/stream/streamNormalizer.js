const {
  createBlockDeltaEvent,
  createBlockStartEvent,
  createBlockStopEvent,
  createMessageDeltaEvent,
  createMessageStopEvent
} = require('./eventFactory')
const { closeBlock, openBlock } = require('./streamSession')

function normalizeStreamEvents(events = [], { sessionId, stateStore }) {
  const state = stateStore.getOrCreate(sessionId)
  const normalized = []

  for (const event of events) {
    if (event.type === 'message_start') {
      state.started = true
      normalized.push(event)
      continue
    }

    if (event.type === 'block_delta') {
      if (state.currentBlockType && state.currentBlockType !== event.block.type) {
        normalized.push(createBlockStopEvent(closeBlock(state)))
      }

      if (!state.currentBlockType) {
        const nextIndex = openBlock(state, event.block.type)
        normalized.push(createBlockStartEvent(nextIndex, { type: event.block.type }))
      }

      normalized.push(createBlockDeltaEvent(state.currentBlockIndex, event.block))
      continue
    }

    if (event.type === 'message_stop') {
      normalized.push(createMessageDeltaEvent(event.stop || {}, event.usage || null))
      if (state.currentBlockType) {
        normalized.push(createBlockStopEvent(closeBlock(state)))
      }
      normalized.push(createMessageStopEvent(event.stop || { reason: 'end_turn' }))
      stateStore.reset(sessionId)
    }
  }

  return normalized
}

module.exports = {
  normalizeStreamEvents
}
