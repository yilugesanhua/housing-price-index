const PROVINCE_CAPITALS = {
  北京: 'beijing', 天津: 'tianjin', 河北: 'shijiazhuang', 山西: 'taiyuan', 内蒙古: 'huhehaote',
  辽宁: 'shenyang', 吉林: 'changchun', 黑龙江: 'haerbin', 上海: 'shanghai', 江苏: 'nanjing',
  浙江: 'hangzhou', 安徽: 'hefei', 福建: 'fuzhou', 江西: 'nanchang', 山东: 'jinan',
  河南: 'zhengzhou', 湖北: 'wuhan', 湖南: 'changsha', 广东: 'guangzhou', 广西: 'nanning',
  海南: 'haikou', 重庆: 'chongqing', 四川: 'chengdu', 贵州: 'guiyang', 云南: 'kunming',
  陕西: 'xian', 甘肃: 'lanzhou', 青海: 'xining', 宁夏: 'yinchuan', 新疆: 'wulumuqi',
}

function normalizeProvince(value) {
  return String(value || '').trim()
    .replace(/(壮族|回族|维吾尔)自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '')
}

function normalizeCity(value) {
  return String(value || '').trim()
    .replace(/特别行政区$/, '')
    .replace(/自治州$/, '')
    .replace(/地区$/, '')
    .replace(/盟$/, '')
    .replace(/市$/, '')
}

function resolveCityId(cityMap, cityName, provinceName) {
  const normalizedCity = normalizeCity(cityName)
  const direct = Object.entries(cityMap).find(([, profile]) => {
    const name = normalizeCity(profile.name)
    return normalizedCity === name || normalizedCity.startsWith(name)
  })
  if (direct) return direct[0]

  const province = normalizeProvince(provinceName)
  const candidates = Object.entries(cityMap)
    .filter(([, profile]) => normalizeProvince(profile.province) === province)
    .map(([id]) => id)
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]
  const capital = PROVINCE_CAPITALS[province]
  return capital && candidates.includes(capital) ? capital : candidates[0]
}

module.exports = { normalizeProvince, normalizeCity, resolveCityId }
