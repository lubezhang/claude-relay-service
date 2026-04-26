const axios = require('axios')
const config = require('../../../config/config')
const logger = require('../../utils/logger')
const ProxyHelper = require('../../utils/proxyHelper')
const githubCopilotAccountService = require('../account/githubCopilotAccountService')
const {
  buildCopilotBaseUrl,
  buildCopilotHeaders,
  hasVisionContent
} = require('../githubCopilotProtocol')

class GithubCopilotRelayService {
  constructor() {
    this.defaultTimeout = config.requestTimeout || 600000
  }

  async handleRequest(req, res, account, _apiKeyData) {
    const abortController = new AbortController()
    const handleClientClose = () => {
      if (!abortController.signal.aborted) {
        logger.info(`GitHub Copilot client disconnected: ${account?.id || 'unknown'}`)
        abortController.abort()
      }
    }

    req.once('close', handleClientClose)

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
        return await this._handleStreamResponse(req, res, upstream, handleClientClose)
      }

      req.removeListener('close', handleClientClose)
      return res.status(upstream.status).json(upstream.data)
    } catch (error) {
      req.removeListener('close', handleClientClose)
      logger.error('GitHub Copilot relay request failed:', error)

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

    try {
      const copilotToken = await githubCopilotAccountService.ensureCopilotToken(account.id)
      const upstream = await axios.get(`${buildCopilotBaseUrl(account)}/models`, {
        ...this._buildRequestConfig(account, copilotToken, {
          stream: false,
          vision: false,
          signal: abortController.signal
        })
      })

      req.removeListener('close', handleClientClose)
      return res.status(upstream.status).json(upstream.data)
    } catch (error) {
      req.removeListener('close', handleClientClose)
      logger.error('GitHub Copilot models request failed:', error)
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

  async _handleStreamResponse(req, res, upstream, handleClientClose) {
    res.status(upstream.status)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders()
    }

    return await new Promise((resolve) => {
      upstream.data.on('data', (chunk) => {
        if (!res.destroyed) {
          res.write(chunk)
        }
      })

      upstream.data.on('end', () => {
        req.removeListener('close', handleClientClose)
        if (!res.destroyed) {
          res.end()
        }
        resolve()
      })

      upstream.data.on('error', () => {
        req.removeListener('close', handleClientClose)
        if (!res.headersSent) {
          res.status(502).json({ error: { message: 'Upstream stream error' } })
        } else if (!res.destroyed) {
          res.end()
        }
        resolve()
      })
    })
  }
}

module.exports = new GithubCopilotRelayService()
