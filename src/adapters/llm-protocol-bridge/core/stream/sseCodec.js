function parseSSE(payload = '') {
  return payload
    .split('\n\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eventLine = part.split('\n').find((line) => line.startsWith('event: '))
      const dataLine = part.split('\n').find((line) => line.startsWith('data: '))
      return {
        event: eventLine ? eventLine.slice(7) : 'message',
        data: dataLine ? JSON.parse(dataLine.slice(6)) : null
      }
    })
}

function encodeSSE(events = []) {
  return events
    .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
    .join('')
}

module.exports = {
  encodeSSE,
  parseSSE
}
