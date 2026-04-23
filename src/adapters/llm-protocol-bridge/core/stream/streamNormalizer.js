const {
  createBlockDeltaEvent,
  createBlockStartEvent,
  createBlockStopEvent,
  createMessageDeltaEvent,
  createMessageStopEvent
} = require('./eventFactory')
const { closeBlock, openBlock } = require('./streamSession')
const { normalizeUsage } = require('../usageNormalizer')

function normalizeBlock(block = {}) {
  if (block.type === 'tool_use') {
    return {
      ...block,
      type: 'tool_call'
    }
  }

  return block
}

function normalizeStopReason(reason, state) {
  if (!reason || reason === 'end_turn') {
    if (state.currentBlockType === 'tool_call') {
      return 'tool_use'
    }
    return 'end_turn'
  }

  return reason
}

function normalizeStreamEvents(events = [], { sessionId, stateStore }) {
  const state = stateStore.getOrCreate(sessionId)
  const normalized = []

  for (const event of events) {
    if (event.type === 'message_start') {
      state.started = true
      normalized.push(event)
      continue
    }

    if (event.type === 'block_start') {
      const normalizedBlock = normalizeBlock(event.block)

      if (state.currentBlockType) {
        normalized.push(createBlockStopEvent(closeBlock(state)))
      }

      const nextIndex = openBlock(state, normalizedBlock)
      normalized.push(createBlockStartEvent(nextIndex, normalizedBlock))
      continue
    }

    if (event.type === 'block_delta') {
      const normalizedBlock = normalizeBlock(event.block)

      if (state.currentBlockType && state.currentBlockType !== normalizedBlock.type) {
        normalized.push(createBlockStopEvent(closeBlock(state)))
      }

      if (!state.currentBlockType) {
        const nextIndex = openBlock(state, normalizedBlock)
        normalized.push(createBlockStartEvent(nextIndex, normalizedBlock))
      }

      normalized.push(createBlockDeltaEvent(state.currentBlockIndex, normalizedBlock))
      continue
    }

    if (event.type === 'message_delta') {
      state.pendingMessageDelta = event.delta || {}
      state.pendingUsage = event.usage ? normalizeUsage(event.usage) : state.pendingUsage
      state.sawMessageDelta = true
      normalized.push(createMessageDeltaEvent(event.delta || {}, state.pendingUsage))
      continue
    }

    if (event.type === 'message_stop') {
      const usage = event.usage ? normalizeUsage(event.usage) : state.pendingUsage
      const reason = normalizeStopReason(
        event.stop?.reason || event.stop?.stop_reason || state.pendingMessageDelta?.reason || state.pendingMessageDelta?.stop_reason,
        state
      )

      if (!state.sawMessageDelta) {
        normalized.push(
          createMessageDeltaEvent(
            {
              stop_reason: reason
            },
            usage
          )
        )
      }

      if (state.currentBlockType) {
        normalized.push(createBlockStopEvent(closeBlock(state)))
      }
      normalized.push(createMessageStopEvent({ reason }, usage))
      stateStore.reset(sessionId)
    }
  }

  return normalized
}

module.exports = {
  normalizeStreamEvents
}
