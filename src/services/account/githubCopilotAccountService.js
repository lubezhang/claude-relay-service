const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const axios = require('axios')

const redis = require('../../models/redis')
const logger = require('../../utils/logger')
const ProxyHelper = require('../../utils/proxyHelper')
const config = require('../../../config/config')
const {
  GITHUB_API_BASE_URL,
  GITHUB_BASE_URL,
  GITHUB_COPILOT_CLIENT_ID,
  GITHUB_COPILOT_SCOPE,
  DEFAULT_VSCODE_VERSION,
  buildGitHubHeaders
} = require('../githubCopilotProtocol')

class GithubCopilotAccountService {
  constructor() {
    this.ENCRYPTION_ALGORITHM = 'aes-256-cbc'
    this.ENCRYPTION_SALT = 'github-copilot-salt'
    this.ACCOUNT_KEY_PREFIX = 'github_copilot_account:'
    this.SHARED_ACCOUNTS_KEY = 'shared_github_copilot_accounts'
    this.ACCOUNT_INDEX_KEY = 'github_copilot_account:index'
    this._refreshPromises = new Map()
  }

  async createAccount(options = {}) {
    const { githubToken = '', copilotToken = '' } = options

    if (!githubToken) {
      throw new Error('GitHub token is required for GitHub Copilot account')
    }

    const now = new Date().toISOString()
    const accountId = uuidv4()
    const accountData = {
      id: accountId,
      platform: 'github-copilot',
      name: options.name || 'GitHub Copilot Account',
      description: options.description || '',
      githubUsername: options.githubUsername || '',
      githubToken: this._encryptSensitiveData(githubToken),
      copilotToken: this._encryptSensitiveData(copilotToken),
      copilotTokenExpiresAt: options.copilotTokenExpiresAt || '',
      copilotTokenRefreshIn: String(options.copilotTokenRefreshIn || 0),
      accountType: options.accountType || 'individual',
      baseApi: this._normalizeBaseApi(options.baseApi || ''),
      vsCodeVersion: options.vsCodeVersion || DEFAULT_VSCODE_VERSION,
      priority: String(options.priority || 50),
      proxy: options.proxy ? JSON.stringify(options.proxy) : '',
      isActive: String(options.isActive !== false),
      schedulable: String(options.schedulable !== false),
      status: options.status || 'active',
      errorMessage: options.errorMessage || '',
      rateLimitedAt: options.rateLimitedAt || '',
      rateLimitStatus: options.rateLimitStatus || '',
      rateLimitDuration: String(options.rateLimitDuration || 60),
      dailyQuota: String(options.dailyQuota || 0),
      dailyUsage: String(options.dailyUsage || 0),
      lastResetDate: options.lastResetDate || redis.getDateStringInTimezone(),
      quotaResetTime: options.quotaResetTime || '00:00',
      quotaStoppedAt: options.quotaStoppedAt || '',
      disableAutoProtection: String(options.disableAutoProtection === true),
      createdAt: options.createdAt || now,
      lastUsedAt: options.lastUsedAt || ''
    }

    await this._saveAccount(accountId, accountData)
    logger.success(`Created GitHub Copilot account: ${accountData.name} (${accountId})`)

    return this._sanitizeAccount(accountData)
  }

  async getAccount(accountId) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
    const accountData = await client.hgetall(key)

    if (!accountData || !accountData.id) {
      return null
    }

    return this._deserializeAccount(accountData)
  }

  async getAllAccounts(sanitizeSensitive = false) {
    const accountIds = await redis.getAllIdsByIndex(
      this.ACCOUNT_INDEX_KEY,
      `${this.ACCOUNT_KEY_PREFIX}*`,
      /^github_copilot_account:(.+)$/
    )

    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      return []
    }

    const accounts = []
    for (const accountId of accountIds) {
      const account = await this.getAccount(accountId)
      if (account) {
        accounts.push(sanitizeSensitive ? this._sanitizeAccount(account) : account)
      }
    }

    return accounts
  }

  async updateAccount(accountId, updates = {}) {
    const currentAccount = await this.getAccount(accountId)
    if (!currentAccount) {
      throw new Error('Account not found')
    }

    const payload = { ...updates }

    if (payload.githubToken !== undefined) {
      payload.githubToken = this._encryptSensitiveData(payload.githubToken)
    }

    if (payload.copilotToken !== undefined) {
      payload.copilotToken = this._encryptSensitiveData(payload.copilotToken)
    }

    if (payload.proxy !== undefined) {
      payload.proxy = payload.proxy ? JSON.stringify(payload.proxy) : ''
    }

    if (payload.baseApi !== undefined) {
      payload.baseApi = this._normalizeBaseApi(payload.baseApi)
    }

    this._stringifyBooleanField(payload, 'isActive')
    this._stringifyBooleanField(payload, 'schedulable')
    this._stringifyBooleanField(payload, 'disableAutoProtection')
    this._stringifyField(payload, 'priority')
    this._stringifyField(payload, 'copilotTokenRefreshIn')
    this._stringifyField(payload, 'rateLimitDuration')
    this._stringifyField(payload, 'dailyQuota')
    this._stringifyField(payload, 'dailyUsage')

    const client = redis.getClientSafe()
    await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, payload)

    logger.info(`Updated GitHub Copilot account: ${currentAccount.name} (${accountId})`)
    return { success: true }
  }

  async deleteAccount(accountId) {
    const client = redis.getClientSafe()

    await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
    await redis.removeFromIndex(this.ACCOUNT_INDEX_KEY, accountId)
    await client.del(`${this.ACCOUNT_KEY_PREFIX}${accountId}`)

    logger.info(`Deleted GitHub Copilot account: ${accountId}`)
    return { success: true }
  }

  isCopilotTokenExpired(account = {}) {
    if (!account.copilotToken || !account.copilotTokenExpiresAt) {
      return true
    }

    const expiresAt = new Date(account.copilotTokenExpiresAt).getTime()
    if (Number.isNaN(expiresAt)) {
      return true
    }

    return expiresAt - Date.now() <= 60 * 1000
  }

  async ensureCopilotToken(accountId) {
    const pendingRefresh = this._refreshPromises.get(accountId)
    if (pendingRefresh) {
      return pendingRefresh
    }

    const account = await this.getAccount(accountId)
    if (!account) {
      throw new Error('GitHub Copilot account not found')
    }

    if (!this.isCopilotTokenExpired(account)) {
      return account.copilotToken
    }

    const existingRefresh = this._refreshPromises.get(accountId)
    if (existingRefresh) {
      return existingRefresh
    }

    if (!account.githubToken) {
      throw new Error('GitHub token is missing for GitHub Copilot account')
    }

    const refreshPromise = this._refreshCopilotToken(accountId, account)
    this._refreshPromises.set(accountId, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      this._refreshPromises.delete(accountId)
    }
  }

  async startDeviceAuthorization() {
    const response = await axios.post(
      `${GITHUB_BASE_URL}/login/device/code`,
      new URLSearchParams({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        scope: GITHUB_COPILOT_SCOPE
      }).toString(),
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        timeout: config.requestTimeout || 600000
      }
    )

    return response.data
  }

  async pollDeviceAuthorization(deviceCode) {
    const response = await axios.post(
      `${GITHUB_BASE_URL}/login/oauth/access_token`,
      new URLSearchParams({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }).toString(),
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        timeout: config.requestTimeout || 600000
      }
    )

    return response.data
  }

  async getGitHubUser(githubToken) {
    const response = await axios.get(`${GITHUB_API_BASE_URL}/user`, {
      headers: buildGitHubHeaders(githubToken),
      timeout: config.requestTimeout || 600000
    })

    return response.data
  }

  async _saveAccount(accountId, accountData) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

    await client.hset(key, accountData)
    await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
    await redis.addToIndex(this.ACCOUNT_INDEX_KEY, accountId)
  }

  async _refreshCopilotToken(accountId, account) {
    let response
    try {
      response = await axios.get(
        `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
        this._buildCopilotTokenRequestConfig(account)
      )
    } catch (error) {
      const status = error?.response?.status
      if (status === 401 || status === 403) {
        await this.updateAccount(accountId, {
          status: 'unauthorized',
          schedulable: false,
          errorMessage: 'GitHub Copilot authorization failed'
        })
        throw new Error('GitHub Copilot authorization failed')
      }
      throw error
    }

    if (response?.status === 401 || response?.status === 403) {
      await this.updateAccount(accountId, {
        status: 'unauthorized',
        schedulable: false,
        errorMessage: 'GitHub Copilot authorization failed'
      })
      throw new Error('GitHub Copilot authorization failed')
    }

    if (!response?.data?.token) {
      throw new Error('GitHub Copilot token refresh returned no token')
    }

    const expiresAt = this._normalizeCopilotExpiry(response.data.expires_at)

    await this.updateAccount(accountId, {
      copilotToken: response.data.token,
      copilotTokenExpiresAt: expiresAt,
      copilotTokenRefreshIn: response.data.refresh_in || 0,
      status: 'active',
      schedulable: true,
      errorMessage: ''
    })

    return response.data.token
  }

  _buildCopilotTokenRequestConfig(account) {
    const requestConfig = {
      headers: buildGitHubHeaders(account.githubToken),
      timeout: config.requestTimeout || 600000
    }

    if (!account.proxy) {
      return requestConfig
    }

    const proxyAgent = ProxyHelper.createProxyAgent(account.proxy)
    if (!proxyAgent) {
      return requestConfig
    }

    return {
      ...requestConfig,
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      proxy: false
    }
  }

  _deserializeAccount(accountData) {
    const account = { ...accountData }
    account.githubToken = this._decryptSensitiveData(account.githubToken)
    account.copilotToken = this._decryptSensitiveData(account.copilotToken)

    if (typeof account.proxy === 'string' && account.proxy) {
      try {
        account.proxy = JSON.parse(account.proxy)
      } catch (_error) {
        account.proxy = null
      }
    }

    return account
  }

  _sanitizeAccount(account) {
    const normalized = this._deserializeAccount(account)

    return {
      ...normalized,
      githubToken: normalized.githubToken ? '***' : '',
      copilotToken: normalized.copilotToken ? '***' : ''
    }
  }

  _encryptSensitiveData(text) {
    if (!text) {
      return ''
    }

    const key = this._getEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv)

    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    return `${iv.toString('hex')}:${encrypted}`
  }

  _decryptSensitiveData(text) {
    if (!text) {
      return ''
    }

    if (!text.includes(':')) {
      return text
    }

    const [ivHex, encrypted] = text.split(':')
    const key = this._getEncryptionKey()
    const decipher = crypto.createDecipheriv(
      this.ENCRYPTION_ALGORITHM,
      key,
      Buffer.from(ivHex, 'hex')
    )

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  _getEncryptionKey() {
    if (!this._encryptionKeyCache) {
      this._encryptionKeyCache = crypto.scryptSync(
        config.security.encryptionKey,
        this.ENCRYPTION_SALT,
        32
      )
    }

    return this._encryptionKeyCache
  }

  _normalizeBaseApi(baseApi) {
    return String(baseApi || '').replace(/\/+$/, '')
  }

  _normalizeCopilotExpiry(expiresAt) {
    if (!expiresAt) {
      return ''
    }

    if (typeof expiresAt === 'number' || /^\d+$/.test(String(expiresAt))) {
      return new Date(Number(expiresAt) * 1000).toISOString()
    }

    return new Date(expiresAt).toISOString()
  }

  _stringifyBooleanField(payload, fieldName) {
    if (payload[fieldName] !== undefined) {
      payload[fieldName] = String(payload[fieldName])
    }
  }

  _stringifyField(payload, fieldName) {
    if (payload[fieldName] !== undefined && payload[fieldName] !== null) {
      payload[fieldName] = String(payload[fieldName])
    }
  }
}

module.exports = new GithubCopilotAccountService()
