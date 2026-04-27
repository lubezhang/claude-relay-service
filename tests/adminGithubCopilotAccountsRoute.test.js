const request = require('supertest')

const mockRedisClient = {
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn()
}

const mockGithubCopilotAccountService = {
  startDeviceAuthorization: jest.fn(),
  pollDeviceAuthorization: jest.fn(),
  getGitHubUser: jest.fn(),
  createAccount: jest.fn(),
  ensureCopilotToken: jest.fn(),
  getAllAccounts: jest.fn(),
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  deleteAccount: jest.fn()
}

const mockAxios = {
  post: jest.fn()
}

const mockProxyHelper = {
  createProxyAgent: jest.fn()
}

const mockGithubCopilotProtocol = {
  buildCopilotBaseUrl: jest.fn(),
  buildCopilotHeaders: jest.fn()
}

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}

const emptyRouteModules = [
  '../src/routes/admin/apiKeys',
  '../src/routes/admin/accountGroups',
  '../src/routes/admin/claudeAccounts',
  '../src/routes/admin/claudeConsoleAccounts',
  '../src/routes/admin/ccrAccounts',
  '../src/routes/admin/bedrockAccounts',
  '../src/routes/admin/geminiAccounts',
  '../src/routes/admin/geminiApiAccounts',
  '../src/routes/admin/openaiAccounts',
  '../src/routes/admin/azureOpenaiAccounts',
  '../src/routes/admin/openaiResponsesAccounts',
  '../src/routes/admin/droidAccounts',
  '../src/routes/admin/dashboard',
  '../src/routes/admin/usageStats',
  '../src/routes/admin/accountBalance',
  '../src/routes/admin/system',
  '../src/routes/admin/concurrency',
  '../src/routes/admin/claudeRelayConfig',
  '../src/routes/admin/sync',
  '../src/routes/admin/serviceRates',
  '../src/routes/admin/quotaCards',
  '../src/routes/admin/errorHistory',
  '../src/routes/admin/requestDetails'
]

const mockUnusedAdminRoutes = () => {
  for (const modulePath of emptyRouteModules) {
    jest.doMock(modulePath, () => {
      const express = jest.requireActual('express')
      return express.Router()
    })
  }
}

const createApp = () => {
  const express = require('express')
  const adminRouter = require('../src/routes/admin')
  const app = express()
  app.use(express.json())
  app.use('/admin', adminRouter)
  return app
}

describe('admin GitHub Copilot accounts routes', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    mockRedisClient.setex.mockResolvedValue('OK')
    mockRedisClient.get.mockResolvedValue(null)
    mockRedisClient.del.mockResolvedValue(1)

    mockGithubCopilotAccountService.startDeviceAuthorization.mockReset()
    mockGithubCopilotAccountService.pollDeviceAuthorization.mockReset()
    mockGithubCopilotAccountService.getGitHubUser.mockReset()
    mockGithubCopilotAccountService.createAccount.mockReset()
    mockGithubCopilotAccountService.ensureCopilotToken.mockReset()
    mockGithubCopilotAccountService.getAllAccounts.mockReset()
    mockGithubCopilotAccountService.getAccount.mockReset()
    mockGithubCopilotAccountService.updateAccount.mockReset()
    mockGithubCopilotAccountService.deleteAccount.mockReset()

    mockAxios.post.mockReset()
    mockProxyHelper.createProxyAgent.mockReset()
    mockGithubCopilotProtocol.buildCopilotBaseUrl.mockReset()
    mockGithubCopilotProtocol.buildCopilotHeaders.mockReset()

    jest.doMock('../src/middleware/auth', () => ({
      authenticateAdmin: jest.fn((_req, _res, next) => next())
    }))

    jest.doMock('../src/models/redis', () => ({
      getClientSafe: jest.fn(() => mockRedisClient)
    }))

    jest.doMock(
      '../src/services/account/githubCopilotAccountService',
      () => mockGithubCopilotAccountService
    )

    jest.doMock('../src/services/githubCopilotProtocol', () => mockGithubCopilotProtocol)
    jest.doMock('../src/utils/proxyHelper', () => mockProxyHelper)
    jest.doMock('axios', () => mockAxios)

    jest.doMock('../src/utils/logger', () => mockLogger)

    mockUnusedAdminRoutes()
  })

  test('POST /admin/github-copilot-accounts/auth/start starts device auth and stores session', async () => {
    mockGithubCopilotAccountService.startDeviceAuthorization.mockResolvedValue({
      device_code: 'device-code-123',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 600,
      interval: 5
    })

    const app = createApp()
    const response = await request(app)
      .post('/admin/github-copilot-accounts/auth/start')
      .send({ accountData: { name: 'Copilot Account', proxy: { host: '127.0.0.1', port: 7890 } } })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: {
        authSessionId: expect.any(String),
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 600,
        interval: 5
      }
    })

    expect(mockGithubCopilotAccountService.startDeviceAuthorization).toHaveBeenCalledTimes(1)
    expect(mockRedisClient.setex).toHaveBeenCalledTimes(1)

    const [sessionKey, ttl, sessionValue] = mockRedisClient.setex.mock.calls[0]
    expect(sessionKey).toMatch(/^github_copilot_auth_session:/)
    expect(ttl).toBe(600)
    expect(JSON.parse(sessionValue)).toEqual({
      device_code: 'device-code-123',
      accountData: { name: 'Copilot Account', proxy: { host: '127.0.0.1', port: 7890 } },
      interval: 5,
      createdAt: expect.any(String)
    })
  })

  test('POST /admin/github-copilot-accounts/auth/poll returns pending for authorization_pending', async () => {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        device_code: 'device-code-123',
        accountData: { name: 'Copilot Account' },
        interval: 5,
        createdAt: '2026-04-25T00:00:00.000Z'
      })
    )
    mockGithubCopilotAccountService.pollDeviceAuthorization.mockResolvedValue({
      error: 'authorization_pending'
    })

    const app = createApp()
    const response = await request(app)
      .post('/admin/github-copilot-accounts/auth/poll')
      .send({ authSessionId: 'session-1' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      status: 'pending'
    })
    expect(mockGithubCopilotAccountService.pollDeviceAuthorization).toHaveBeenCalledWith(
      'device-code-123'
    )
    expect(mockRedisClient.del).not.toHaveBeenCalled()
  })

  test('POST /admin/github-copilot-accounts/auth/poll authorizes account after access token arrives', async () => {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        device_code: 'device-code-123',
        accountData: { name: 'Copilot Account', description: 'from admin' },
        interval: 5,
        createdAt: '2026-04-25T00:00:00.000Z'
      })
    )
    mockGithubCopilotAccountService.pollDeviceAuthorization.mockResolvedValue({
      access_token: 'ghu_test_access_token'
    })
    mockGithubCopilotAccountService.getGitHubUser.mockResolvedValue({
      login: 'octocat'
    })

    const createdAccount = {
      id: 'account-1',
      name: 'Copilot Account',
      githubUsername: 'octocat',
      githubToken: '***',
      copilotToken: '***'
    }

    mockGithubCopilotAccountService.createAccount.mockResolvedValue(createdAccount)
    mockGithubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')

    const app = createApp()
    const response = await request(app)
      .post('/admin/github-copilot-accounts/auth/poll')
      .send({ authSessionId: 'session-1' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      status: 'authorized',
      data: createdAccount
    })

    expect(mockGithubCopilotAccountService.getGitHubUser).toHaveBeenCalledWith(
      'ghu_test_access_token'
    )
    expect(mockGithubCopilotAccountService.createAccount).toHaveBeenCalledWith({
      name: 'Copilot Account',
      description: 'from admin',
      githubToken: 'ghu_test_access_token',
      githubUsername: 'octocat'
    })
    expect(mockGithubCopilotAccountService.ensureCopilotToken).toHaveBeenCalledWith('account-1')
    expect(mockRedisClient.del).toHaveBeenCalledWith('github_copilot_auth_session:session-1')
  })

  test('GET /admin/github-copilot-accounts returns accounts', async () => {
    const accounts = [{ id: 'account-1', name: 'Copilot Account' }]
    mockGithubCopilotAccountService.getAllAccounts.mockResolvedValue(accounts)

    const app = createApp()
    const response = await request(app).get('/admin/github-copilot-accounts')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: accounts
    })
    expect(mockGithubCopilotAccountService.getAllAccounts).toHaveBeenCalledWith(true)
  })

  test('PUT /admin/github-copilot-accounts/:id updates an account', async () => {
    mockGithubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })
    mockGithubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'account-1',
      name: 'Updated Copilot Account'
    })

    const app = createApp()
    const response = await request(app)
      .put('/admin/github-copilot-accounts/account-1')
      .send({ name: 'Updated Copilot Account' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: {
        id: 'account-1',
        name: 'Updated Copilot Account'
      }
    })
    expect(mockGithubCopilotAccountService.updateAccount).toHaveBeenCalledWith('account-1', {
      name: 'Updated Copilot Account'
    })
  })

  test('DELETE /admin/github-copilot-accounts/:id deletes an account', async () => {
    mockGithubCopilotAccountService.deleteAccount.mockResolvedValue({ success: true })

    const app = createApp()
    const response = await request(app).delete('/admin/github-copilot-accounts/account-1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      message: 'GitHub Copilot account deleted successfully'
    })
    expect(mockGithubCopilotAccountService.deleteAccount).toHaveBeenCalledWith('account-1')
  })

  test('POST /admin/github-copilot-accounts/:id/refresh-token refreshes Copilot token', async () => {
    mockGithubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token')

    const app = createApp()
    const response = await request(app).post(
      '/admin/github-copilot-accounts/account-1/refresh-token'
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      message: 'GitHub Copilot token refreshed successfully'
    })
    expect(mockGithubCopilotAccountService.ensureCopilotToken).toHaveBeenCalledWith('account-1')
  })

  test('POST /admin/github-copilot-accounts/:accountId/test returns 404 when account is missing', async () => {
    mockGithubCopilotAccountService.getAccount.mockResolvedValue(null)

    const app = createApp()
    const response = await request(app).post('/admin/github-copilot-accounts/missing-account/test')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Account not found' })
    expect(mockGithubCopilotAccountService.ensureCopilotToken).not.toHaveBeenCalled()
    expect(mockAxios.post).not.toHaveBeenCalled()
  })

  test('POST /admin/github-copilot-accounts/:accountId/test maps authorization failures to 401', async () => {
    mockGithubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'account-1',
      name: 'Copilot Account'
    })
    mockGithubCopilotAccountService.ensureCopilotToken.mockRejectedValue(
      new Error('GitHub Copilot authorization failed')
    )

    const app = createApp()
    const response = await request(app).post('/admin/github-copilot-accounts/account-1/test')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      success: false,
      error: 'Test failed',
      message: 'GitHub Copilot authorization failed',
      latency: expect.any(Number)
    })
    expect(mockAxios.post).not.toHaveBeenCalled()
  })

  test('POST /admin/github-copilot-accounts/:accountId/test preserves upstream error message and status', async () => {
    mockGithubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'account-1',
      name: 'Copilot Account'
    })
    mockGithubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token-123')
    mockGithubCopilotProtocol.buildCopilotBaseUrl.mockReturnValue('https://api.githubcopilot.com')
    mockGithubCopilotProtocol.buildCopilotHeaders.mockReturnValue({
      authorization: 'Bearer copilot-token-123',
      accept: 'application/json'
    })

    const upstreamError = new Error('upstream fallback message')
    upstreamError.response = {
      status: 429,
      data: {
        error: {
          message: 'Copilot rate limit exceeded'
        }
      }
    }
    mockAxios.post.mockRejectedValue(upstreamError)

    const app = createApp()
    const response = await request(app).post('/admin/github-copilot-accounts/account-1/test')

    expect(response.status).toBe(429)
    expect(response.body).toEqual({
      success: false,
      error: 'Test failed',
      message: 'Copilot rate limit exceeded',
      latency: expect.any(Number)
    })
  })

  test('POST /admin/github-copilot-accounts/:accountId/test tests Copilot account connectivity', async () => {
    mockGithubCopilotAccountService.getAccount.mockResolvedValue({
      id: 'account-1',
      name: 'Copilot Account',
      proxy: { type: 'http', host: '127.0.0.1', port: 7890 }
    })
    mockGithubCopilotAccountService.ensureCopilotToken.mockResolvedValue('copilot-token-123')
    mockProxyHelper.createProxyAgent.mockReturnValue('proxy-agent')
    mockGithubCopilotProtocol.buildCopilotBaseUrl.mockReturnValue('https://api.githubcopilot.com')
    mockGithubCopilotProtocol.buildCopilotHeaders.mockReturnValue({
      authorization: 'Bearer copilot-token-123',
      accept: 'application/json'
    })
    mockAxios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: 'Hello from Copilot'
            }
          }
        ]
      }
    })

    const app = createApp()
    const response = await request(app)
      .post('/admin/github-copilot-accounts/account-1/test')
      .send({ model: 'gpt-4.1' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: {
        accountId: 'account-1',
        accountName: 'Copilot Account',
        model: 'gpt-4.1',
        latency: expect.any(Number),
        responseText: 'Hello from Copilot'
      }
    })

    expect(mockGithubCopilotAccountService.getAccount).toHaveBeenCalledWith('account-1')
    expect(mockGithubCopilotAccountService.ensureCopilotToken).toHaveBeenCalledWith('account-1')
    expect(mockGithubCopilotProtocol.buildCopilotBaseUrl).toHaveBeenCalledWith({
      id: 'account-1',
      name: 'Copilot Account',
      proxy: { type: 'http', host: '127.0.0.1', port: 7890 }
    })
    expect(mockGithubCopilotProtocol.buildCopilotHeaders).toHaveBeenCalledWith(
      {
        id: 'account-1',
        name: 'Copilot Account',
        proxy: { type: 'http', host: '127.0.0.1', port: 7890 }
      },
      'copilot-token-123',
      {
        stream: false,
        intent: 'conversation-panel'
      }
    )
    expect(mockProxyHelper.createProxyAgent).toHaveBeenCalledWith({
      type: 'http',
      host: '127.0.0.1',
      port: 7890
    })
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      {
        model: 'gpt-4.1',
        stream: false,
        n: 1,
        messages: [{ role: 'user', content: 'Say "Hello" in one short sentence.' }]
      },
      {
        headers: {
          authorization: 'Bearer copilot-token-123',
          accept: 'application/json'
        },
        timeout: 30000,
        httpAgent: 'proxy-agent',
        httpsAgent: 'proxy-agent',
        proxy: false
      }
    )
  })

  test('auth/start logs sanitized errors without access token or device code', async () => {
    const error = new Error('upstream rejected request')
    error.code = 'EUPSTREAM'
    error.access_token = 'ghu_secret_access_token'
    error.device_code = 'secret-device-code'
    error.response = {
      status: 502,
      data: {
        access_token: 'nested_secret_access_token',
        device_code: 'nested-secret-device-code'
      }
    }
    mockGithubCopilotAccountService.startDeviceAuthorization.mockRejectedValue(error)

    const app = createApp()
    const response = await request(app).post('/admin/github-copilot-accounts/auth/start').send({})

    expect(response.status).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledTimes(1)

    const loggedPayload = JSON.stringify(mockLogger.error.mock.calls[0])
    expect(loggedPayload).not.toContain('ghu_secret_access_token')
    expect(loggedPayload).not.toContain('secret-device-code')
    expect(loggedPayload).not.toContain('nested_secret_access_token')
    expect(loggedPayload).not.toContain('nested-secret-device-code')
    expect(loggedPayload).toContain('EUPSTREAM')
    expect(loggedPayload).toContain('502')
  })

  test('auth/poll logs sanitized errors without access token or device code', async () => {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        device_code: 'stored-secret-device-code',
        accountData: { name: 'Copilot Account' },
        interval: 5,
        createdAt: '2026-04-25T00:00:00.000Z'
      })
    )

    const error = new Error('GitHub poll failed')
    error.code = 'EPOLL'
    error.access_token = 'ghu_poll_secret_access_token'
    error.device_code = 'poll-secret-device-code'
    error.response = {
      status: 500,
      data: {
        access_token: 'nested_poll_secret_access_token',
        device_code: 'nested-poll-secret-device-code'
      }
    }
    mockGithubCopilotAccountService.pollDeviceAuthorization.mockRejectedValue(error)

    const app = createApp()
    const response = await request(app)
      .post('/admin/github-copilot-accounts/auth/poll')
      .send({ authSessionId: 'session-1' })

    expect(response.status).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledTimes(1)

    const loggedPayload = JSON.stringify(mockLogger.error.mock.calls[0])
    expect(loggedPayload).not.toContain('ghu_poll_secret_access_token')
    expect(loggedPayload).not.toContain('poll-secret-device-code')
    expect(loggedPayload).not.toContain('stored-secret-device-code')
    expect(loggedPayload).not.toContain('nested_poll_secret_access_token')
    expect(loggedPayload).not.toContain('nested-poll-secret-device-code')
    expect(loggedPayload).toContain('EPOLL')
    expect(loggedPayload).toContain('500')
  })
})
