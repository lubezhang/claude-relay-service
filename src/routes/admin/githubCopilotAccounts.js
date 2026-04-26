const crypto = require('crypto')
const express = require('express')

const githubCopilotAccountService = require('../../services/account/githubCopilotAccountService')
const redis = require('../../models/redis')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')

const router = express.Router()
const AUTH_SESSION_KEY_PREFIX = 'github_copilot_auth_session:'
const DEFAULT_DEVICE_AUTH_TTL = 900

const getAuthSessionKey = (authSessionId) => `${AUTH_SESSION_KEY_PREFIX}${authSessionId}`

router.post('/github-copilot-accounts/auth/start', authenticateAdmin, async (req, res) => {
  try {
    const client = redis.getClientSafe()
    const accountData = req.body?.accountData || {}
    const authResult = await githubCopilotAccountService.startDeviceAuthorization()
    const authSessionId = crypto.randomUUID()
    const expiresIn = Number(authResult?.expires_in) || DEFAULT_DEVICE_AUTH_TTL
    const interval = Number(authResult?.interval) || 5

    const sessionData = {
      device_code: authResult?.device_code || '',
      accountData,
      interval,
      createdAt: new Date().toISOString()
    }

    await client.setex(getAuthSessionKey(authSessionId), expiresIn, JSON.stringify(sessionData))

    logger.info('Started GitHub Copilot device authorization session', {
      authSessionId,
      expiresIn,
      interval
    })

    return res.json({
      success: true,
      authSessionId,
      user_code: authResult?.user_code,
      verification_uri: authResult?.verification_uri,
      expires_in: expiresIn,
      interval
    })
  } catch (error) {
    logger.error('Failed to start GitHub Copilot device authorization:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to start device authorization',
      message: error.message
    })
  }
})

router.post('/github-copilot-accounts/auth/poll', authenticateAdmin, async (req, res) => {
  try {
    const { authSessionId } = req.body || {}

    if (!authSessionId) {
      return res.status(400).json({
        success: false,
        error: 'authSessionId is required'
      })
    }

    const client = redis.getClientSafe()
    const sessionKey = getAuthSessionKey(authSessionId)
    const rawSession = await client.get(sessionKey)

    if (!rawSession) {
      return res.status(404).json({
        success: false,
        status: 'expired',
        error: 'Authorization session expired'
      })
    }

    const session = JSON.parse(rawSession)
    const pollResult = await githubCopilotAccountService.pollDeviceAuthorization(session.device_code)

    if (pollResult?.error === 'authorization_pending') {
      return res.json({
        success: true,
        status: 'pending'
      })
    }

    if (pollResult?.error === 'slow_down') {
      return res.json({
        success: true,
        status: 'slow_down',
        interval: (Number(session.interval) || 5) + 5
      })
    }

    if (pollResult?.error === 'expired_token') {
      await client.del(sessionKey)
      return res.json({
        success: true,
        status: 'expired'
      })
    }

    if (!pollResult?.access_token) {
      return res.status(400).json({
        success: false,
        status: 'failed',
        error: pollResult?.error || 'Device authorization failed'
      })
    }

    const githubUser = await githubCopilotAccountService.getGitHubUser(pollResult.access_token)
    const account = await githubCopilotAccountService.createAccount({
      ...session.accountData,
      githubToken: pollResult.access_token,
      githubUsername: githubUser?.login || ''
    })

    await githubCopilotAccountService.ensureCopilotToken(account.id)
    await client.del(sessionKey)

    logger.success('GitHub Copilot device authorization completed', {
      authSessionId,
      accountId: account.id,
      githubUsername: githubUser?.login || ''
    })

    return res.json({
      success: true,
      status: 'authorized',
      data: account
    })
  } catch (error) {
    logger.error('Failed to poll GitHub Copilot device authorization:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to poll device authorization',
      message: error.message
    })
  }
})

router.get('/github-copilot-accounts', authenticateAdmin, async (_req, res) => {
  try {
    const accounts = await githubCopilotAccountService.getAllAccounts(true)
    return res.json({ success: true, data: accounts })
  } catch (error) {
    logger.error('Failed to get GitHub Copilot accounts:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get accounts',
      message: error.message
    })
  }
})

router.put('/github-copilot-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await githubCopilotAccountService.updateAccount(id, req.body)
    const account = await githubCopilotAccountService.getAccount(id)
    return res.json({ success: true, data: account })
  } catch (error) {
    logger.error(`Failed to update GitHub Copilot account ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to update account',
      message: error.message
    })
  }
})

router.delete('/github-copilot-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await githubCopilotAccountService.deleteAccount(id)
    return res.json({
      success: true,
      message: 'GitHub Copilot account deleted successfully'
    })
  } catch (error) {
    logger.error(`Failed to delete GitHub Copilot account ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    })
  }
})

router.post('/github-copilot-accounts/:id/refresh-token', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await githubCopilotAccountService.ensureCopilotToken(id)
    return res.json({
      success: true,
      message: 'GitHub Copilot token refreshed successfully'
    })
  } catch (error) {
    logger.error(`Failed to refresh GitHub Copilot account token ${req.params.id}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh token',
      message: error.message
    })
  }
})

module.exports = router
