const axios = require('axios')
const config = require('../../../config/config')
const logger = require('../../utils/logger')
const ProxyHelper = require('../../utils/proxyHelper')
const apiKeyService = require('../apiKeyService')
const { updateRateLimitCounters } = require('../../utils/rateLimitHelper')
const {
  createRequestDetailMeta,
  extractOpenAICacheReadTokens
} = require('../../utils/requestDetailHelper')
const githubCopilotAccountService = require('../account/githubCopilotAccountService')
const {
  buildCopilotBaseUrl,
  buildCopilotHeaders,
  hasVisionContent
} = require('../githubCopilotProtocol')

function sanitizeError(error) {
  return {
    message: error?.message,
    code: error?.code,
    status: error?.response?.status
  }
}

class GithubCopilotRelayService {
  constructor() {
    this.defaultTimeout = config.requestTimeout || 600000
  }

  async handleRequest(req, res, account, apiKeyData) {
    const abortController = new AbortController()
    let upstreamStream = null

    const destroyUpstream = () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }

      if (upstreamStream && typeof upstreamStream.destroy === 'function' && !upstreamStream.destroyed) {
        upstreamStream.destroy()
      }
    }

    const handleClientClose = () => {
      logger.info(`GitHub Copilot client disconnected: ${account?.id || 'unknown'}`)
      destroyUpstream()
    }

    const removeClientListeners = () => {
      req.removeListener('close', handleClientClose)
      req.removeListener('aborted', handleClientClose)
      if (typeof res.removeListener === 'function') {
        res.removeListener('close', handleClientClose)
      }
    }

    req.once('close', handleClientClose)
    req.once('aborted', handleClientClose)
    if (typeof res.once === 'function') {
      res.once('close', handleClientClose)
    }

    try {
      const copilotToken = await githubCopilotAccountService.ensureCopilotToken(account.id)
      const isStream = req.body?.stream === true
      const targetUrl = `${buildCopilotBaseUrl(account)}/chat/completions`
      const requestConfig = this._buildRequestConfig(account, copilotToken, {
        stream: isStream,
        vision: hasVisionContent(req.body),
        signal: abortController.signal
      })

      const upstream = await axios.post(targetUrl, req.body, requestConfig)

      if (isStream) {
        upstreamStream = upstream.data
        return await this._handleStreamResponse(res, upstream, removeClientListeners)
      }

      removeClientListeners()
      await this._recordNonStreamUsage(upstream, req, account, apiKeyData)
      return res.status(upstream.status).json(upstream.data)
    } catch (error) {
      removeClientListeners()
      logger.error('GitHub Copilot relay request failed:', sanitizeError(error))

      if (!res.headersSent) {
        return res.status(error.response?.status || 500).json(
          error.response?.data || {
            error: {
              message: error.message || 'GitHub Copilot relay request failed'
            }
          }
        )
      }

      return res.end()
    }
  }

  async handleModels(req, res, account) {
    const abortController = new AbortController()
    const handleClientClose = () => {
      if (!abortController.signal.aborted) {
        logger.info(`GitHub Copilot models request aborted: ${account?.id || 'unknown'}`)
        abortController.abort()
      }
    }

    req.once('close', handleClientClose)
    req.once('aborted', handleClientClose)
    if (typeof res.once === 'function') {
      res.once('close', handleClientClose)
    }

    const removeClientListeners = () => {
      req.removeListener('close', handleClientClose)
      req.removeListener('aborted', handleClientClose)
      if (typeof res.removeListener === 'function') {
        res.removeListener('close', handleClientClose)
      }
    }

    try {
      const copilotToken = await githubCopilotAccountService.ensureCopilotToken(account.id)
      const upstream = await axios.get(`${buildCopilotBaseUrl(account)}/models`, {
        ...this._buildRequestConfig(account, copilotToken, {
          stream: false,
          vision: false,
          signal: abortController.signal
        })
      })

      removeClientListeners()
      return res.status(upstream.status).json(upstream.data)
    } catch (error) {
      removeClientListeners()
      logger.error('GitHub Copilot models request failed:', sanitizeError(error))
      return res.status(error.response?.status || 500).json(
        error.response?.data || {
          error: {
            message: error.message || 'GitHub Copilot models request failed'
          }
        }
      )
    }
  }

  _buildRequestConfig(account, copilotToken, options) {
    const requestConfig = {
      headers: buildCopilotHeaders(account, copilotToken, {
        stream: options.stream,
        vision: options.vision
      }),
      timeout: this.defaultTimeout,
      validateStatus: () => true,
      signal: options.signal
    }

    if (options.stream) {
      requestConfig.responseType = 'stream'
    }

    if (account?.proxy) {
      const proxyAgent = ProxyHelper.createProxyAgent(account.proxy)
      if (proxyAgent) {
        requestConfig.httpAgent = proxyAgent
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
      }
    }

    return requestConfig
  }

  async _recordNonStreamUsage(upstream, req, account, apiKeyData) {
    const usageData = upstream.data?.usage
    if (!usageData || !apiKeyData?.id) {
      return
    }

    try {
      const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
      const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
      const cacheReadTokens = extractOpenAICacheReadTokens(usageData)
      const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)
      const usageObject = {
        input_tokens: actualInputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cacheReadTokens
      }
      const model = upstream.data?.model || req.body?.model || 'unknown'
      const costs = await apiKeyService.recordUsageWithDetails(
        apiKeyData.id,
        usageObject,
        model,
        account.id,
        'github-copilot',
        createRequestDetailMeta(req, {
          requestBody: req.body,
          stream: false,
          statusCode: upstream.status
        })
      )

      if (req.rateLimitInfo) {
        await updateRateLimitCounters(
          req.rateLimitInfo,
          {
            inputTokens: actualInputTokens,
            outputTokens,
            cacheCreateTokens: 0,
            cacheReadTokens
          },
          model,
          apiKeyData.id,
          'github-copilot',
          costs
        )
      }
    } catch (error) {
      logger.error('Failed to record GitHub Copilot usage:', sanitizeError(error))
    }
  }

  async _handleStreamResponse(res, upstream, removeClientListeners) {
    res.status(upstream.status)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders()
    }

    return await new Promise((resolve) => {
      let settled = false

      const finish = (error = null) => {
        if (settled) {
          return
        }

        settled = true
        removeClientListeners()

        if (error && !res.headersSent) {
          res.status(502).json({ error: { message: 'Upstream stream error' } })
        } else if (!res.destroyed && !res.writableEnded) {
          res.end()
        }

        resolve()
      }

      upstream.data.on('data', (chunk) => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(chunk)
        }
      })

      upstream.data.once('end', () => finish())
      upstream.data.once('close', () => finish())
      upstream.data.once('error', (error) => {
        logger.error('GitHub Copilot upstream stream error:', sanitizeError(error))
        finish(error)
      })
    })
  }
}

module.exports = new GithubCopilotRelayService()
