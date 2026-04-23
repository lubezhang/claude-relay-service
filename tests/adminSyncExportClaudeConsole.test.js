const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: (req, res, next) => next()
}))

jest.mock('../src/models/redis', () => ({
  getAllClaudeAccounts: jest.fn(async () => []),
  getAllIdsByIndex: jest.fn(async () => [])
}))

jest.mock('../src/services/account/claudeAccountService', () => ({
  _decryptSensitiveData: jest.fn()
}))

jest.mock('../src/services/account/claudeConsoleAccountService', () => ({
  getAllAccounts: jest.fn(async () => [{ id: 'console-1' }]),
  getAccount: jest.fn(async () => ({
    id: 'console-1',
    name: 'Claude Console',
    description: '',
    platform: 'claude-console',
    isActive: true,
    schedulable: true,
    priority: 50,
    status: 'active',
    proxy: null,
    apiKey: 'console-key',
    apiUrl: 'https://openai.example.com/v1/chat/completions',
    userAgent: 'claude-cli',
    maxConcurrentTasks: 0,
    supportedModels: [],
    enableOpenAIProtocolBridge: true,
    claudeCodeBridgeBasePath: '/api/console/console-1'
  }))
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  decrypt: jest.fn()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  error: jest.fn()
}))

const syncRouter = require('../src/routes/admin/sync')

function buildApp() {
  const app = express()
  app.use('/admin', syncRouter)
  return app
}

describe('admin sync export for Claude Console bridge path', () => {
  test('includes a Claude Code base path for bridge-enabled Claude Console accounts', async () => {
    const app = buildApp()
    const response = await request(app).get('/admin/sync/export-accounts?include_secrets=true')

    expect(response.status).toBe(200)
    expect(response.body.data.claudeConsoleAccounts).toHaveLength(1)
    expect(response.body.data.claudeConsoleAccounts[0].credentials).toEqual(
      expect.objectContaining({
        api_key: 'console-key',
        base_url: 'https://openai.example.com/v1/chat/completions',
        claude_code_base_path: '/api/console/console-1'
      })
    )
  })
})
