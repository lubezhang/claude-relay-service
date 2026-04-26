jest.mock(
  '../config/config',
  () => ({
    security: { encryptionKey: '12345678901234567890123456789012' },
    session: { stickyTtlHours: 1, renewalThresholdMinutes: 0 }
  }),
  { virtual: true }
)

const mockRedisClient = {
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
  expire: jest.fn()
}

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  getAllAccounts: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  refreshAccountToken: jest.fn(),
  recordUsage: jest.fn(),
  setAccountRateLimited: jest.fn(),
  markAccountUnauthorized: jest.fn()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  getAllAccounts: jest.fn(),
  checkAndClearRateLimit: jest.fn(async () => true),
  isSubscriptionExpired: jest.fn(() => false),
  recordUsage: jest.fn(),
  updateAccount: jest.fn(),
  markAccountRateLimited: jest.fn(),
  markAccountUnauthorized: jest.fn()
}))

jest.mock('../src/services/account/githubCopilotAccountService', () => ({
  getAccount: jest.fn(),
  getAllAccounts: jest.fn(),
  updateAccount: jest.fn()
}))

jest.mock('../src/services/accountGroupService', () => ({
  getGroup: jest.fn(),
  getGroupMembers: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn(() => mockRedisClient)
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn(async () => false)
}))

const loadScheduler = () => {
  jest.resetModules()

  return {
    scheduler: require('../src/services/scheduler/unifiedOpenAIScheduler'),
    openaiAccountService: require('../src/services/account/openaiAccountService'),
    openaiResponsesAccountService: require('../src/services/account/openaiResponsesAccountService'),
    githubCopilotAccountService: require('../src/services/account/githubCopilotAccountService'),
    upstreamErrorHelper: require('../src/utils/upstreamErrorHelper')
  }
}

const buildCopilotAccount = (overrides = {}) => ({
  id: 'copilot-1',
  name: 'Copilot One',
  isActive: 'true',
  status: 'active',
  schedulable: 'true',
  priority: '30',
  lastUsedAt: '0',
  rateLimitStatus: '',
  rateLimitedAt: '',
  rateLimitResetAt: '',
  ...overrides
})

const buildResponsesAccount = (overrides = {}) => ({
  id: 'responses-1',
  name: 'Responses One',
  isActive: 'true',
  status: 'active',
  schedulable: 'true',
  priority: '30',
  lastUsedAt: '0',
  rateLimitStatus: '',
  rateLimitedAt: '',
  rateLimitResetAt: '',
  ...overrides
})

describe('unifiedOpenAIScheduler GitHub Copilot support', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.values(mockRedisClient).forEach((method) => method.mockReset())
  })

  test('selectAccountForApiKey returns github-copilot account for dedicated copilot binding', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAccount.mockResolvedValue(buildCopilotAccount())
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Copilot Key',
        openaiAccountId: 'copilot:copilot-1'
      })
    ).resolves.toEqual({
      accountId: 'copilot-1',
      accountType: 'github-copilot'
    })

    expect(githubCopilotAccountService.getAccount).toHaveBeenCalledWith('copilot-1')
    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith(
      'copilot-1',
      expect.objectContaining({
        lastUsedAt: expect.any(String)
      })
    )
  })

  test('bound copilot temp unavailable throws and does not fall back to shared pool', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService,
      upstreamErrorHelper
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAccount.mockResolvedValue(buildCopilotAccount())
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({ id: 'copilot-shared', name: 'Fallback Copilot', priority: '1' })
    ])
    upstreamErrorHelper.isTempUnavailable.mockResolvedValue(true)

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Temp Unavailable Copilot Key',
        openaiAccountId: 'copilot:copilot-1'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('temporarily unavailable')
    })

    expect(githubCopilotAccountService.getAllAccounts).not.toHaveBeenCalled()
    expect(githubCopilotAccountService.updateAccount).not.toHaveBeenCalled()
  })

  test('selectAccountForApiKey includes schedulable GitHub Copilot accounts in the shared pool', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({ id: 'copilot-1', name: 'Shared Copilot', priority: '10' })
    ])
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Shared Pool Key'
      })
    ).resolves.toEqual({
      accountId: 'copilot-1',
      accountType: 'github-copilot'
    })

    expect(githubCopilotAccountService.getAllAccounts).toHaveBeenCalledWith(true)
  })

  test('shared pool uses real priority sorting for GitHub Copilot accounts', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({ id: 'copilot-low-priority', priority: '90' }),
      buildCopilotAccount({ id: 'copilot-high-priority', priority: '5' })
    ])
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Shared Pool Key'
      })
    ).resolves.toEqual({
      accountId: 'copilot-high-priority',
      accountType: 'github-copilot'
    })
  })

  test('bound openai-responses account clears rate limit before selection', async () => {
    const { scheduler, openaiResponsesAccountService, githubCopilotAccountService } =
      loadScheduler()

    const refreshedAccount = buildResponsesAccount({
      id: 'responses-limited',
      name: 'Responses Limited',
      rateLimitStatus: '',
      schedulable: 'true'
    })

    openaiResponsesAccountService.getAccount
      .mockResolvedValueOnce(
        buildResponsesAccount({
          id: 'responses-limited',
          name: 'Responses Limited',
          rateLimitStatus: 'limited',
          schedulable: 'true'
        })
      )
      .mockResolvedValueOnce(refreshedAccount)
    openaiResponsesAccountService.checkAndClearRateLimit.mockResolvedValue(true)
    openaiResponsesAccountService.recordUsage.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Responses Key',
        openaiAccountId: 'responses:responses-limited'
      })
    ).resolves.toEqual({
      accountId: 'responses-limited',
      accountType: 'openai-responses'
    })

    expect(openaiResponsesAccountService.checkAndClearRateLimit).toHaveBeenCalledWith(
      'responses-limited'
    )
    expect(openaiResponsesAccountService.getAccount).toHaveBeenNthCalledWith(1, 'responses-limited')
    expect(openaiResponsesAccountService.getAccount).toHaveBeenNthCalledWith(2, 'responses-limited')
    expect(openaiResponsesAccountService.isSubscriptionExpired).toHaveBeenCalledWith(
      refreshedAccount
    )
    expect(githubCopilotAccountService.getAccount).not.toHaveBeenCalled()
  })

  test('bound openai-responses account with expired subscription throws 403', async () => {
    const { scheduler, openaiResponsesAccountService, githubCopilotAccountService } =
      loadScheduler()

    const account = buildResponsesAccount({
      id: 'responses-expired',
      name: 'Responses Expired'
    })

    openaiResponsesAccountService.getAccount.mockResolvedValue(account)
    openaiResponsesAccountService.isSubscriptionExpired.mockReturnValue(true)

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Responses Key',
        openaiAccountId: 'responses:responses-expired'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('subscription has expired')
    })

    expect(openaiResponsesAccountService.checkAndClearRateLimit).not.toHaveBeenCalled()
    expect(githubCopilotAccountService.getAccount).not.toHaveBeenCalled()
  })

  test('bound openai-responses account with schedulable false throws 403', async () => {
    const { scheduler, openaiResponsesAccountService, githubCopilotAccountService } =
      loadScheduler()

    const account = buildResponsesAccount({
      id: 'responses-unschedulable',
      name: 'Responses Unschedulable',
      schedulable: 'false'
    })

    openaiResponsesAccountService.getAccount.mockResolvedValue(account)

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Responses Key',
        openaiAccountId: 'responses:responses-unschedulable'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('not schedulable')
    })

    expect(openaiResponsesAccountService.checkAndClearRateLimit).not.toHaveBeenCalled()
    expect(openaiResponsesAccountService.isSubscriptionExpired).not.toHaveBeenCalled()
    expect(githubCopilotAccountService.getAccount).not.toHaveBeenCalled()
  })

  test('shared pool skips copilot account with status not equal to active', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({ id: 'copilot-paused', status: 'paused' })
    ])

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Shared Pool Key'
      })
    ).rejects.toMatchObject({
      statusCode: 402,
      message: 'No available OpenAI accounts'
    })

    expect(githubCopilotAccountService.updateAccount).not.toHaveBeenCalled()
  })

  test.each([
    ['missing account', null, 404, 'not found'],
    ['inactive account', buildCopilotAccount({ isActive: 'false' }), 403, 'not active'],
    ['non-active status account', buildCopilotAccount({ status: 'paused' }), 403, 'not active'],
    ['unauthorized account', buildCopilotAccount({ status: 'unauthorized' }), 403, 'unauthorized'],
    ['error account', buildCopilotAccount({ status: 'error' }), 403, 'not available'],
    [
      'rate-limited account',
      buildCopilotAccount({ rateLimitStatus: 'limited' }),
      403,
      'currently rate limited'
    ],
    [
      'not schedulable account',
      buildCopilotAccount({ schedulable: 'false' }),
      403,
      'not schedulable'
    ]
  ])(
    'selectAccountForApiKey rejects dedicated copilot binding for %s',
    async (_label, account, statusCode, messageFragment) => {
      const { scheduler, githubCopilotAccountService } = loadScheduler()

      githubCopilotAccountService.getAccount.mockResolvedValue(account)

      await expect(
        scheduler.selectAccountForApiKey({
          name: 'Dedicated Copilot Key',
          openaiAccountId: 'copilot:copilot-1'
        })
      ).rejects.toMatchObject({
        statusCode,
        message: expect.stringContaining(messageFragment)
      })
    }
  )

  test('sticky mapped copilot status not active is unavailable and mapping is deleted', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({ accountId: 'copilot-1', accountType: 'github-copilot' })
    )
    githubCopilotAccountService.getAccount.mockResolvedValue(
      buildCopilotAccount({ status: 'paused' })
    )
    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([])

    await expect(
      scheduler.selectAccountForApiKey(
        {
          name: 'Sticky Key'
        },
        'session-1'
      )
    ).rejects.toMatchObject({
      statusCode: 402,
      message: 'No available OpenAI accounts'
    })

    expect(mockRedisClient.del).toHaveBeenCalledWith('unified_openai_session_mapping:session-1')
  })

  test('sticky mapped copilot active but schedulable false is unavailable and mapping deleted', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({ accountId: 'copilot-1', accountType: 'github-copilot' })
    )
    githubCopilotAccountService.getAccount.mockResolvedValue(
      buildCopilotAccount({ schedulable: 'false' })
    )
    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([])

    await expect(
      scheduler.selectAccountForApiKey(
        {
          name: 'Sticky Key'
        },
        'session-1'
      )
    ).rejects.toMatchObject({
      statusCode: 402,
      message: 'No available OpenAI accounts'
    })

    expect(mockRedisClient.del).toHaveBeenCalledWith('unified_openai_session_mapping:session-1')
    expect(githubCopilotAccountService.updateAccount).not.toHaveBeenCalled()
  })

  test('copilot rate limit reset expired clears limited state and restores scheduling', async () => {
    const { scheduler, githubCopilotAccountService } = loadScheduler()

    githubCopilotAccountService.getAccount.mockResolvedValue(
      buildCopilotAccount({
        schedulable: 'false',
        status: 'rateLimited',
        rateLimitStatus: 'limited',
        rateLimitedAt: new Date(Date.now() - 3600000).toISOString(),
        rateLimitResetAt: new Date(Date.now() - 60000).toISOString()
      })
    )
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(scheduler.isAccountRateLimited('copilot-1', 'github-copilot')).resolves.toBe(false)

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith('copilot-1', {
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitResetAt: '',
      status: 'active',
      errorMessage: '',
      schedulable: 'true'
    })
  })

  test('shared pool restores and selects rate-limited copilot account with schedulable false when reset expired', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({
        id: 'copilot-restored',
        schedulable: 'false',
        status: 'rateLimited',
        rateLimitStatus: 'limited',
        rateLimitedAt: new Date(Date.now() - 3600000).toISOString(),
        rateLimitResetAt: new Date(Date.now() - 60000).toISOString(),
        priority: '5'
      })
    ])
    githubCopilotAccountService.getAccount.mockResolvedValue(
      buildCopilotAccount({
        id: 'copilot-restored',
        schedulable: 'false',
        status: 'rateLimited',
        rateLimitStatus: 'limited',
        rateLimitedAt: new Date(Date.now() - 3600000).toISOString(),
        rateLimitResetAt: new Date(Date.now() - 60000).toISOString(),
        priority: '5'
      })
    )
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Recovered Shared Pool Key'
      })
    ).resolves.toEqual({
      accountId: 'copilot-restored',
      accountType: 'github-copilot'
    })

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith('copilot-restored', {
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitResetAt: '',
      status: 'active',
      errorMessage: '',
      schedulable: 'true'
    })
  })

  test('shared pool restores rate-limited copilot after reset expiry', async () => {
    const {
      scheduler,
      openaiAccountService,
      openaiResponsesAccountService,
      githubCopilotAccountService
    } = loadScheduler()

    openaiAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    githubCopilotAccountService.getAllAccounts.mockResolvedValue([
      buildCopilotAccount({
        id: 'copilot-restored',
        schedulable: 'true',
        status: 'rateLimited',
        rateLimitStatus: 'limited',
        rateLimitedAt: new Date(Date.now() - 3600000).toISOString(),
        rateLimitResetAt: new Date(Date.now() - 60000).toISOString(),
        priority: '5'
      })
    ])
    githubCopilotAccountService.getAccount.mockResolvedValue(
      buildCopilotAccount({
        id: 'copilot-restored',
        schedulable: 'false',
        status: 'rateLimited',
        rateLimitStatus: 'limited',
        rateLimitedAt: new Date(Date.now() - 3600000).toISOString(),
        rateLimitResetAt: new Date(Date.now() - 60000).toISOString(),
        priority: '5'
      })
    )
    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.selectAccountForApiKey({
        name: 'Recovered Shared Pool Key'
      })
    ).resolves.toEqual({
      accountId: 'copilot-restored',
      accountType: 'github-copilot'
    })

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith('copilot-restored', {
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitResetAt: '',
      status: 'active',
      errorMessage: '',
      schedulable: 'true'
    })
  })

  test('updateAccountLastUsed writes through githubCopilotAccountService.updateAccount', async () => {
    const { scheduler, githubCopilotAccountService } = loadScheduler()

    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await scheduler.updateAccountLastUsed('copilot-1', 'github-copilot')

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith(
      'copilot-1',
      expect.objectContaining({
        lastUsedAt: expect.any(String)
      })
    )
  })

  test('markAccountRateLimited writes through githubCopilotAccountService.updateAccount', async () => {
    const { scheduler, githubCopilotAccountService } = loadScheduler()

    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.markAccountRateLimited('copilot-1', 'github-copilot', null, 120)
    ).resolves.toEqual({ success: true })

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith(
      'copilot-1',
      expect.objectContaining({
        schedulable: 'false',
        rateLimitStatus: 'limited',
        rateLimitedAt: expect.any(String),
        rateLimitResetAt: expect.any(String)
      })
    )
  })

  test('markAccountUnauthorized writes through githubCopilotAccountService.updateAccount', async () => {
    const { scheduler, githubCopilotAccountService } = loadScheduler()

    githubCopilotAccountService.updateAccount.mockResolvedValue({ success: true })

    await expect(
      scheduler.markAccountUnauthorized(
        'copilot-1',
        'github-copilot',
        null,
        'GitHub Copilot unauthorized'
      )
    ).resolves.toEqual({ success: true })

    expect(githubCopilotAccountService.updateAccount).toHaveBeenCalledWith(
      'copilot-1',
      expect.objectContaining({
        status: 'unauthorized',
        schedulable: 'false',
        errorMessage: 'GitHub Copilot unauthorized'
      })
    )
  })

  test('isAccountAvailable checks github-copilot account readiness via getAccount', async () => {
    const { scheduler, githubCopilotAccountService, upstreamErrorHelper } = loadScheduler()

    githubCopilotAccountService.getAccount.mockResolvedValue(buildCopilotAccount())
    upstreamErrorHelper.isTempUnavailable.mockResolvedValue(false)

    await expect(scheduler._isAccountAvailable('copilot-1', 'github-copilot')).resolves.toBe(true)
    expect(githubCopilotAccountService.getAccount).toHaveBeenCalledWith('copilot-1')
  })

  test('isAccountAvailable rejects temporarily unavailable github-copilot accounts', async () => {
    const { scheduler, githubCopilotAccountService, upstreamErrorHelper } = loadScheduler()

    githubCopilotAccountService.getAccount.mockResolvedValue(buildCopilotAccount())
    upstreamErrorHelper.isTempUnavailable.mockResolvedValue(true)

    await expect(scheduler._isAccountAvailable('copilot-1', 'github-copilot')).resolves.toBe(false)
  })
})
