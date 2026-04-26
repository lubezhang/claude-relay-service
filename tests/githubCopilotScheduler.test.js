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
  getClientSafe: jest.fn(() => ({
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    ttl: jest.fn(),
    expire: jest.fn()
  }))
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

jest.mock('../src/utils/commonHelper', () => ({
  isSchedulable: jest.fn((value) => value === true || value === 'true'),
  sortAccountsByPriority: jest.fn((accounts) =>
    [...accounts].sort((a, b) => {
      const priorityDiff = (a.priority || 50) - (b.priority || 50)
      if (priorityDiff !== 0) {
        return priorityDiff
      }
      return String(a.lastUsedAt || '0').localeCompare(String(b.lastUsedAt || '0'))
    })
  )
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

describe('unifiedOpenAIScheduler GitHub Copilot support', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

  test.each([
    ['missing account', null, 404, 'not found'],
    ['inactive account', buildCopilotAccount({ isActive: 'false' }), 403, 'not active'],
    ['unauthorized account', buildCopilotAccount({ status: 'unauthorized' }), 403, 'unauthorized'],
    ['error account', buildCopilotAccount({ status: 'error' }), 403, 'not available'],
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
