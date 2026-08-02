const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']
const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/
const TIER_LABELS = Object.freeze({
  first: '一线城市',
  second: '二线城市',
  third: '三线城市',
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function assertExactSet(actual, expected, label) {
  assert(Array.isArray(actual), `${label} is not an array`)
  assert(actual.length === expected.length && new Set(actual).size === actual.length, `${label} has an invalid size or duplicate`)
  assert(sameValues(sorted(actual), sorted(expected)), `${label} differs from the authoritative city set`)
}

function assertFiniteOrNull(value, label) {
  assert(value === null || (typeof value === 'number' && Number.isFinite(value)), `${label} must be a finite number or null`)
}

function assertIsoDate(value, label) {
  assert(/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value || ''), `${label} is invalid`)
  assert(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, `${label} is invalid`)
}

function validateSnapshotMetadata(snapshot, label) {
  assert(/^1\.\d+\.\d+$/.test(snapshot.schemaVersion || ''), `${label} schema version is unsupported`)
  assert(MONTH_PATTERN.test(snapshot.datasetAsOf || ''), `${label} dataset month is invalid`)
  assert(DATASET_PATTERN.test(snapshot.datasetVersion || ''), `${label} dataset version is invalid`)
  assert(snapshot.datasetVersion.startsWith(`${snapshot.datasetAsOf}-`), `${label} dataset version does not match its month`)
  assertIsoDate(snapshot.releaseDate, `${label} release date`)
  assert(/^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(snapshot.latestOfficialUrl || ''), `${label} official URL is invalid`)
  assert(Number.isFinite(Date.parse(snapshot.generatedAt || '')), `${label} generation timestamp is invalid`)
  assert(['current', 'stale'].includes(snapshot.dataStatus), `${label} data status is invalid`)
  assert(typeof snapshot.statusReason === 'string' && snapshot.statusReason.trim(), `${label} status reason is invalid`)
  if (snapshot.nextCheckDueAt !== undefined && snapshot.nextCheckDueAt !== null && snapshot.nextCheckDueAt !== '') {
    assert(Number.isFinite(Date.parse(snapshot.nextCheckDueAt)), `${label} next-check timestamp is invalid`)
  }
}

function validateCityProfiles(cityMap, cityIds, label) {
  const names = []
  for (const cityId of cityIds) {
    const profile = cityMap?.[cityId]
    assert(profile && typeof profile === 'object' && !Array.isArray(profile), `${label} city profile is invalid: ${cityId}`)
    for (const field of ['name', 'search', 'province', 'tier', 'tierLabel']) {
      assert(typeof profile[field] === 'string' && profile[field].trim(), `${label} city profile field is invalid: ${cityId}/${field}`)
    }
    assert(TIER_LABELS[profile.tier] === profile.tierLabel, `${label} city tier is invalid: ${cityId}`)
    names.push(profile.name)
  }
  assert(new Set(names).size === names.length, `${label} city names contain duplicates`)
}

function derivedChange(index) {
  return Number((index - 100).toFixed(1))
}

function validateSeries(values, monthCount, label) {
  assert(Array.isArray(values) && values.length === monthCount * 4, `${label} has an invalid length`)
  for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
    const offset = monthIndex * 4
    for (let field = 0; field < 4; field += 1) assertFiniteOrNull(values[offset + field], `${label}[${offset + field}]`)
    for (const [indexOffset, changeOffset, metric] of [[0, 2, 'mom'], [1, 3, 'yoy']]) {
      const index = values[offset + indexOffset]
      const change = values[offset + changeOffset]
      assert((index === null) === (change === null), `${label}/${metric} index and change nullability differ`)
      if (index !== null) assert(change === derivedChange(index), `${label}/${metric} change differs from its index`)
    }
  }
}

function validateBundledSnapshot(snapshot, { cityIds, featuredCityIds } = {}) {
  assert(snapshot && typeof snapshot === 'object', 'bundled snapshot is missing')
  validateSnapshotMetadata(snapshot, 'bundled snapshot')
  const expectedCityIds = cityIds || snapshot.cityIds
  assertExactSet(snapshot.cityIds, expectedCityIds, 'bundled snapshot city IDs')
  assertExactSet(Object.keys(snapshot.cityMap || {}), expectedCityIds, 'bundled snapshot city map')
  validateCityProfiles(snapshot.cityMap, expectedCityIds, 'bundled snapshot')
  assertExactSet(Object.keys(snapshot.series || {}), expectedCityIds, 'bundled snapshot series city IDs')
  assert(Array.isArray(snapshot.featuredCityIds) && new Set(snapshot.featuredCityIds).size === snapshot.featuredCityIds.length, 'bundled snapshot featured cities are invalid')
  assert(sameValues(snapshot.featuredCityIds, featuredCityIds || snapshot.featuredCityIds), 'bundled snapshot featured cities differ from the product baseline')
  assert(snapshot.featuredCityIds.every((cityId) => snapshot.cityMap[cityId]), 'bundled snapshot contains an unknown featured city')
  assert(snapshot.dataStatus === 'current', 'bundled snapshot data status is invalid')

  const monthCount = snapshot.months?.length
  assert(monthCount === 120, 'bundled snapshot must contain 120 months')
  assert(snapshot.months.at(-1) === snapshot.datasetAsOf, 'bundled snapshot month does not match its dataset month')
  assert(snapshot.coverageStart === snapshot.months[0], 'bundled snapshot coverage start is inconsistent')
  assert(MONTH_PATTERN.test(snapshot.sourceCoverageStart || ''), 'bundled snapshot source coverage start is invalid')
  assert(snapshot.sourceCoverageStart <= snapshot.months.at(-1), 'bundled snapshot source coverage cannot start after the client window')
  const sourceCoverageIndex = Math.max(0, snapshot.months.indexOf(snapshot.sourceCoverageStart))
  for (let index = 1; index < monthCount; index += 1) {
    const previous = new Date(`${snapshot.months[index - 1]}-01T00:00:00Z`)
    previous.setUTCMonth(previous.getUTCMonth() + 1)
    assert(snapshot.months[index] === previous.toISOString().slice(0, 7), 'bundled snapshot months are not continuous')
  }
  assert(Array.isArray(snapshot.releaseDates) && snapshot.releaseDates.length === monthCount, 'bundled snapshot release dates are invalid')
  snapshot.releaseDates.forEach((value, index) => {
    if (index < sourceCoverageIndex) assert(value === '', `bundled snapshot pre-source release date must be empty: ${index}`)
    else assertIsoDate(value, `bundled snapshot release date: ${index}`)
  })
  assert(snapshot.releaseDate === snapshot.releaseDates.at(-1), 'bundled snapshot release date does not match the latest month')

  for (const cityId of expectedCityIds) {
    const series = snapshot.series[cityId]
    assert(series && sameValues(sorted(Object.keys(series)), sorted(SERIES_CODES)), `bundled snapshot series codes are invalid: ${cityId}`)
    for (const code of SERIES_CODES) {
      validateSeries(series[code], monthCount, `${cityId}/${code}`)
      assert(series[code].slice(0, sourceCoverageIndex * 4).every((value) => value === null), `bundled snapshot pre-source padding must be null: ${cityId}/${code}`)
      cumulative(series[code], monthCount)
    }
  }
  for (const code of SERIES_CODES) {
    for (const valueOffset of [2, 3]) {
      for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
        const values = expectedCityIds.map((cityId) => snapshot.series[cityId][code][monthIndex * 4 + valueOffset])
        const counts = directionCounts(values)
        assert(counts.reduce((sum, value) => sum + value, 0) === expectedCityIds.length, `bundled derived breadth is invalid: ${code}/${monthIndex}`)
        rank(expectedCityIds.map((cityId, index) => ({ cityId, value: values[index] })))
      }
    }
  }
  return snapshot
}

function rank(values) {
  const ordered = values
    .filter((item) => item.value !== null)
    .sort((left, right) => right.value - left.value || left.cityId.localeCompare(right.cityId, 'en'))
  let lastValue = null
  let lastRank = 0
  return ordered.map((item, index) => {
    const currentRank = item.value === lastValue ? lastRank : index + 1
    lastValue = item.value
    lastRank = currentRank
    return { ...item, rank: currentRank }
  })
}

function cumulative(values, monthCount) {
  const result = new Array(monthCount).fill(null)
  let current = 100
  let broken = false
  for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
    if (monthIndex > 0) {
      const momIndex = values[monthIndex * 4]
      if (broken || momIndex === null) broken = true
      else current = current * momIndex / 100
    }
    result[monthIndex] = broken ? null : Number(current.toFixed(4))
    assert(result[monthIndex] === null || Number.isFinite(result[monthIndex]), 'derived cumulative value is invalid')
  }
  return result
}

function directionCounts(values) {
  return values.reduce((counts, value) => {
    if (value === null) counts[3] += 1
    else if (value > 0) counts[0] += 1
    else if (value < 0) counts[2] += 1
    else counts[1] += 1
    return counts
  }, [0, 0, 0, 0])
}

function validateCompleteSnapshot(snapshot, { cityIds, featuredCityIds } = {}) {
  assert(snapshot && typeof snapshot === 'object', 'complete snapshot is missing')
  validateSnapshotMetadata(snapshot, 'complete snapshot')
  const expectedCityIds = cityIds || snapshot.cityIds
  assertExactSet(snapshot.cityIds, expectedCityIds, 'snapshot city IDs')
  assertExactSet(Object.keys(snapshot.cityMap || {}), expectedCityIds, 'snapshot city map')
  validateCityProfiles(snapshot.cityMap, expectedCityIds, 'complete snapshot')
  assertExactSet(Object.keys(snapshot.series || {}), expectedCityIds, 'snapshot series city IDs')
  assertExactSet(Object.keys(snapshot.latestSeries || {}), expectedCityIds, 'snapshot latest-series city IDs')
  if (featuredCityIds) assert(sameValues(snapshot.featuredCityIds, featuredCityIds), 'snapshot featured cities differ from the bundled product baseline')
  const monthCount = snapshot.months.length
  assert(monthCount === 120, 'complete snapshot must contain 120 months')
  assert(snapshot.coverageStart === snapshot.months[0], 'complete snapshot coverage start is inconsistent')
  assert(MONTH_PATTERN.test(snapshot.sourceCoverageStart || ''), 'complete snapshot source coverage start is invalid')
  assert(snapshot.sourceCoverageStart <= snapshot.months.at(-1), 'complete snapshot source coverage cannot start after the client window')
  const sourceCoverageIndex = Math.max(0, snapshot.months.indexOf(snapshot.sourceCoverageStart))
  assert(Array.isArray(snapshot.releaseDates) && snapshot.releaseDates.length === monthCount, 'snapshot release dates are invalid')
  snapshot.releaseDates.forEach((value, index) => {
    if (index < sourceCoverageIndex) assert(value === '', `snapshot pre-source release date must be empty: ${index}`)
    else assertIsoDate(value, `snapshot release date: ${index}`)
  })
  assert(snapshot.releaseDate === snapshot.releaseDates.at(-1), 'snapshot release date does not match the latest month')

  const expectedBreadth = {}
  for (const code of SERIES_CODES) {
    expectedBreadth[`${code}_mom`] = []
    expectedBreadth[`${code}_yoy`] = []
  }
  for (const cityId of expectedCityIds) {
    const series = snapshot.series[cityId]
    const latest = snapshot.latestSeries[cityId]
    assert(series && sameValues(sorted(Object.keys(series)), sorted(SERIES_CODES)), `snapshot series codes are invalid: ${cityId}`)
    assert(latest && sameValues(sorted(Object.keys(latest)), sorted(SERIES_CODES)), `snapshot latest-series codes are invalid: ${cityId}`)
    for (const code of SERIES_CODES) {
      validateSeries(series[code], monthCount, `${cityId}/${code}`)
      assert(series[code].slice(0, sourceCoverageIndex * 4).every((value) => value === null), `snapshot pre-source padding must be null: ${cityId}/${code}`)
      assert(sameValues(latest[code], series[code].slice(-4)), `snapshot latest values differ from full history: ${cityId}/${code}`)
      cumulative(series[code], monthCount)
    }
  }

  for (const code of SERIES_CODES) {
    for (const [metric, valueOffset] of [['mom', 2], ['yoy', 3]]) {
      const key = `${code}_${metric}`
      for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
        const values = expectedCityIds.map((cityId) => snapshot.series[cityId][code][monthIndex * 4 + valueOffset])
        const counts = directionCounts(values)
        assert(counts.reduce((sum, value) => sum + value, 0) === expectedCityIds.length, `derived breadth does not cover every city: ${key}/${monthIndex}`)
        expectedBreadth[key].push(...counts)
        rank(expectedCityIds.map((cityId, index) => ({ cityId, value: values[index] })))
      }
      assert(sameValues(snapshot.breadthSeries?.[key], expectedBreadth[key]), `snapshot breadth differs from full-history values: ${key}`)
    }
  }
  assert(sameValues(sorted(Object.keys(snapshot.breadthSeries || {})), sorted(Object.keys(expectedBreadth))), 'snapshot breadth fields are invalid')
  return snapshot
}

module.exports = { SERIES_CODES, validateBundledSnapshot, validateCompleteSnapshot }
