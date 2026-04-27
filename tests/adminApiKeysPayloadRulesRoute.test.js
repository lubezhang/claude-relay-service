const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: jest.fn((_req, _res, next) => next())
}))

jest.mock('../src/services/apiKeyService', () => ({
  updateApiKey: jest.fn()
}))

jest.mock('../src/models/redis', () => ({}))

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/utils/costCalculator', () => ({
  calculateCost: jest.fn(),
  formatCost: jest.fn()
}))

jest.mock(
  '../config/config',
  () => ({
    system: {
      timezoneOffset: 8
    }
  }),
  { virtual: true }
)

jest.mock('../src/services/requestBodyRuleService', () => ({
  validateAndNormalizeRules: jest.fn()
}))

let apiKeyService
let requestBodyRuleService
let apiKeysRouter

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', apiKeysRouter)
  return app
}

describe('admin api keys route payload rule updates', () => {
  beforeEach(() => {
    jest.resetModules()

    jest.isolateModules(() => {
      apiKeyService = require('../src/services/apiKeyService')
      requestBodyRuleService = require('../src/services/requestBodyRuleService')
      apiKeysRouter = require('../src/routes/admin/apiKeys')
    })

    apiKeyService.updateApiKey.mockReset()
    apiKeyService.updateApiKey.mockResolvedValue()

    requestBodyRuleService.validateAndNormalizeRules.mockReset()
    requestBodyRuleService.validateAndNormalizeRules.mockImplementation((rules) => ({
      valid: true,
      rules
    }))
  })

  test('does not clear stored payload rules when the toggle is disabled without sending rules', async () => {
    const app = buildApp()

    const response = await request(app).put('/api-keys/key-1').send({
      name: 'Renamed Key',
      enableOpenAIResponsesPayloadRules: false
    })

    expect(requestBodyRuleService.validateAndNormalizeRules).not.toHaveBeenCalled()
    expect(apiKeyService.updateApiKey).toHaveBeenCalledWith('key-1', {
      name: 'Renamed Key',
      enableOpenAIResponsesPayloadRules: false
    })
    expect(apiKeyService.updateApiKey.mock.calls[0][1]).not.toHaveProperty(
      'openaiResponsesPayloadRules'
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      message: 'API key updated successfully'
    })
  })

  test('accepts payload rules even when the toggle is disabled', async () => {
    const app = buildApp()
    const rules = [{ path: 'model', valueType: 'string', value: 'gpt-5' }]

    const response = await request(app).put('/api-keys/key-2').send({
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: rules
    })

    expect(requestBodyRuleService.validateAndNormalizeRules).toHaveBeenCalledWith(rules)
    expect(apiKeyService.updateApiKey).toHaveBeenCalledWith('key-2', {
      enableOpenAIResponsesPayloadRules: false,
      openaiResponsesPayloadRules: rules
    })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  test('allows explicitly clearing payload rules with an empty array', async () => {
    const app = buildApp()

    const response = await request(app).put('/api-keys/key-3').send({
      openaiResponsesPayloadRules: []
    })

    expect(requestBodyRuleService.validateAndNormalizeRules).toHaveBeenCalledWith([])
    expect(apiKeyService.updateApiKey).toHaveBeenCalledWith('key-3', {
      openaiResponsesPayloadRules: []
    })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })
})
