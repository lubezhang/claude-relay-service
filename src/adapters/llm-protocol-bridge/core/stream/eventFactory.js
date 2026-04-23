function createMessageStartEvent(message) {
  return { type: 'message_start', message }
}

function createBlockStartEvent(index, block) {
  return { type: 'block_start', index, block }
}

function createBlockDeltaEvent(index, block) {
  return { type: 'block_delta', index, block }
}

function createBlockStopEvent(index) {
  return { type: 'block_stop', index }
}

function createMessageDeltaEvent(delta, usage) {
  return { type: 'message_delta', delta, usage }
}

function createMessageStopEvent(stop, usage = null) {
  return { type: 'message_stop', stop, usage }
}

module.exports = {
  createBlockDeltaEvent,
  createBlockStartEvent,
  createBlockStopEvent,
  createMessageDeltaEvent,
  createMessageStartEvent,
  createMessageStopEvent
}
