const PROTOCOLS = {
  ANTHROPIC_MESSAGES: 'anthropic.messages',
  ANTHROPIC_COUNT_TOKENS: 'anthropic.count_tokens',
  OPENAI_CHAT_COMPLETIONS: 'openai.chat_completions',
  OPENAI_RESPONSES: 'openai.responses'
}

const BLOCK_TYPES = {
  TEXT: 'text',
  REASONING: 'reasoning',
  IMAGE: 'image',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result'
}

const STOP_REASONS = {
  END_TURN: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  STOP_SEQUENCE: 'stop_sequence',
  TOOL_USE: 'tool_use',
  REFUSAL: 'refusal',
  ERROR: 'error',
  UNKNOWN: 'unknown'
}

const DEFAULT_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  serviceTier: null
}

module.exports = {
  BLOCK_TYPES,
  DEFAULT_USAGE,
  PROTOCOLS,
  STOP_REASONS
}
