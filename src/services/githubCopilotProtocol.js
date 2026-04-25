const { v4: uuidv4 } = require('uuid')

const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const GITHUB_COPILOT_SCOPE = 'read:user'
const GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_BASE_URL = 'https://github.com'
const COPILOT_CHAT_VERSION = '0.26.7'
const DEFAULT_VSCODE_VERSION = '1.99.0'
const GITHUB_API_VERSION = '2025-04-01'

function buildCopilotBaseUrl(account = {}) {
  if (account.baseApi) {
    return String(account.baseApi).replace(/\/+$/, '')
  }

  const accountType = String(account.accountType || 'individual').toLowerCase()

  if (accountType === 'business') {
    return 'https://api.business.githubcopilot.com'
  }

  if (accountType === 'enterprise') {
    return 'https://api.enterprise.githubcopilot.com'
  }

  return 'https://api.githubcopilot.com'
}

function buildGitHubHeaders(token, extraHeaders = {}) {
  return {
    authorization: `token ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    ...extraHeaders
  }
}

function buildCopilotHeaders(account = {}, token, options = {}) {
  const vsCodeVersion = account.vsCodeVersion || DEFAULT_VSCODE_VERSION
  const headers = {
    authorization: `Bearer ${token}`,
    accept: options.stream ? 'text/event-stream' : 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'editor-version': `vscode/${vsCodeVersion}`,
    'editor-plugin-version': `copilot-chat/${COPILOT_CHAT_VERSION}`,
    'user-agent': `GitHubCopilotChat/${COPILOT_CHAT_VERSION}`,
    'openai-intent': options.intent || 'conversation-panel',
    'x-github-api-version': GITHUB_API_VERSION,
    'x-request-id': uuidv4()
  }

  if (options.vision) {
    headers['copilot-vision-request'] = 'true'
  }

  return headers
}

function hasVisionContent(payload = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : []

  return messages.some((message) => {
    const contentBlocks = Array.isArray(message?.content) ? message.content : []

    return contentBlocks.some(
      (block) => block && block.type === 'image_url' && block.image_url && block.image_url.url
    )
  })
}

function normalizeDeviceCodeError(error) {
  const responseData = error?.response?.data || {}
  const code = responseData.error || error?.code || 'unknown_error'
  const message =
    responseData.error_description ||
    responseData.message ||
    error?.message ||
    'GitHub Copilot device authorization failed'
  const retryAfter =
    Number(responseData.interval) || Number(error?.response?.headers?.['retry-after']) || null

  return {
    code,
    message,
    retryAfter
  }
}

module.exports = {
  GITHUB_COPILOT_CLIENT_ID,
  GITHUB_COPILOT_SCOPE,
  GITHUB_API_BASE_URL,
  GITHUB_BASE_URL,
  COPILOT_CHAT_VERSION,
  DEFAULT_VSCODE_VERSION,
  GITHUB_API_VERSION,
  buildCopilotBaseUrl,
  buildGitHubHeaders,
  buildCopilotHeaders,
  hasVisionContent,
  normalizeDeviceCodeError
}
