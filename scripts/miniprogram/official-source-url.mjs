const RELEASE_PATH_PREFIXES = ['/sj/zxfb/', '/xxgk/sjfb/zxfb2020/']
const RAW_UNSAFE = /[\u0000-\u0020\u007f"'`$;&|<>\\]/

export function validateOfficialReleaseUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || RAW_UNSAFE.test(value)) {
    throw new Error('Official source URL contains unsafe characters')
  }
  let url
  try { url = new URL(value) } catch { throw new Error('Official source URL is invalid') }
  if (url.protocol !== 'https:' || url.hostname !== 'www.stats.gov.cn' || url.port || url.username || url.password || url.hash) {
    throw new Error('Official source URL origin is not allowlisted')
  }
  if (!url.pathname.endsWith('.html') || !RELEASE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new Error('Official source URL path is not allowlisted')
  }
  return url
}

export function isOfficialReleaseUrl(value) {
  try {
    validateOfficialReleaseUrl(value)
    return true
  } catch {
    return false
  }
}
