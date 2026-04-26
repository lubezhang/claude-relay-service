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

    jest.doMock('../src/utils/logger', () => ({
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      success: jest.fn()
    }))

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
      authSessionId: expect.any(String),
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 600,
      interval: 5
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
})
