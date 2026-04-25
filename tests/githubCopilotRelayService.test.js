const protocol = require('../src/services/githubCopilotProtocol')

describe('githubCopilotProtocol', () => {
  test('buildCopilotBaseUrl resolves individual, business, and enterprise accounts', () => {
    expect(protocol.buildCopilotBaseUrl({ accountType: 'individual' })).toBe(
      'https://api.githubcopilot.com'
    )
    expect(protocol.buildCopilotBaseUrl({ accountType: 'business' })).toBe(
      'https://api.business.githubcopilot.com'
    )
    expect(protocol.buildCopilotBaseUrl({ accountType: 'enterprise' })).toBe(
      'https://api.enterprise.githubcopilot.com'
    )
  })

  test('buildCopilotBaseUrl uses baseApi override and removes trailing slash', () => {
    expect(protocol.buildCopilotBaseUrl({ baseApi: 'https://custom.example.com/' })).toBe(
      'https://custom.example.com'
    )
  })

  test('buildGitHubHeaders uses GitHub token authorization scheme', () => {
    const headers = protocol.buildGitHubHeaders('github-token-1')

    expect(headers.authorization).toBe('token github-token-1')
  })

  test('buildCopilotHeaders includes required Copilot client headers', () => {
    const headers = protocol.buildCopilotHeaders({ vsCodeVersion: '1.99.0' }, 'copilot-token-1', {
      stream: true,
      vision: true
    })

    expect(headers.authorization).toBe('Bearer copilot-token-1')
    expect(headers.accept).toBe('text/event-stream')
    expect(headers['copilot-integration-id']).toBe('vscode-chat')
    expect(headers['editor-version']).toBe('vscode/1.99.0')
    expect(headers['editor-plugin-version']).toBe('copilot-chat/0.26.7')
    expect(headers['user-agent']).toBe('GitHubCopilotChat/0.26.7')
    expect(headers['openai-intent']).toBe('conversation-panel')
    expect(headers['x-github-api-version']).toBe('2025-04-01')
    expect(headers['copilot-vision-request']).toBe('true')
    expect(headers['x-request-id']).toEqual(expect.any(String))
  })

  test('hasVisionContent detects image_url content blocks', () => {
    expect(
      protocol.hasVisionContent({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }]
      })
    ).toBe(true)
  })
})
