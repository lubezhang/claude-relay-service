function createDefaultState() {
  return {
    started: false,
    currentBlockIndex: -1,
    currentBlockType: null,
    currentBlock: null,
    openToolCalls: {},
    messageStopped: false,
    pendingMessageDelta: null,
    pendingUsage: null,
    sawMessageDelta: false
  }
}

class StreamStateStore {
  constructor() {
    this.states = new Map()
  }

  getOrCreate(sessionId) {
    const key = sessionId || '__default__'
    if (!this.states.has(key)) {
      this.states.set(key, createDefaultState())
    }
    return this.states.get(key)
  }

  reset(sessionId) {
    const key = sessionId || '__default__'
    this.states.delete(key)
  }

  resetAll() {
    this.states.clear()
  }

  snapshot(sessionId) {
    const key = sessionId || '__default__'
    const state = this.states.get(key)
    return state ? { ...state, openToolCalls: { ...state.openToolCalls } } : null
  }
}

module.exports = {
  StreamStateStore,
  createDefaultState
}
