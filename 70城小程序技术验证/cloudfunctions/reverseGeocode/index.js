const https = require('node:https')

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
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
