const https = require('node:https')
const REQUEST_TIMEOUT_MS = 5000
const MAX_RESPONSE_BYTES = 64 * 1024

function requestJson(url) {
  return new Promise((resolve, reject) => {
    let settled = false
    const succeed = (value) => { if (!settled) { settled = true; resolve(value) } }
    const fail = (error) => { if (!settled) { settled = true; reject(error) } }
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        fail(new Error(`Reverse geocoding HTTP status ${response.statusCode || 'unknown'}`))
        return
      }
      const declaredLength = Number(response.headers['content-length'])
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        response.resume()
        fail(new Error('Reverse geocoding response is too large'))
        return
      }
      let body = ''
      let receivedBytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        receivedBytes += Buffer.byteLength(chunk, 'utf8')
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          fail(new Error('Reverse geocoding response is too large'))
          response.destroy()
          return
        }
        body += chunk
      })
      response.on('end', () => {
        if (settled) return
        try { succeed(JSON.parse(body)) } catch (error) { fail(error) }
      })
      response.on('error', fail)
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Reverse geocoding request timed out')))
    request.on('error', fail)
  })
}

exports.main = async (event) => {
  const latitude = Number(event && event.latitude)
  const longitude = Number(event && event.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid coordinates')
  }

  const key = String(process.env.TENCENT_LBS_KEY || '').trim()
  if (!key) throw new Error('TENCENT_LBS_KEY is not configured')
  if (!/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}$/.test(key)) {
    throw new Error('TENCENT_LBS_KEY has an invalid format after trimming')
  }
  const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${latitude},${longitude}&key=${encodeURIComponent(key)}&get_poi=0`
  const response = await requestJson(url)
  if (!response || response.status !== 0 || !response.result || !response.result.address_component) {
    const status = response && response.status !== undefined ? `status ${response.status}` : 'no status'
    const message = response && response.message ? `: ${String(response.message).slice(0, 120)}` : ''
    throw new Error(`Reverse geocoding failed (${status})${message}`)
  }
  const component = response.result.address_component
  return { province: component.province || '', city: component.city || '' }
}
