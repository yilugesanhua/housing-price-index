import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshotPath = resolve(root, 'apps/miniprogram/data/snapshot.js')
const publishedManifest = JSON.parse(readFileSync(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))

function loadPageConfig(relativePath) {
  let pageConfig
  globalThis.Page = (config) => { pageConfig = config }
  const pagePath = resolve(root, relativePath)
  const pageModulePath = require.resolve(pagePath)
  let runtimeModule = null
  let originalRuntime = null
  if (relativePath === 'apps/miniprogram/pages/index/index.js') {
    const bundled = require(snapshotPath)
    const runtimePath = require.resolve(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))
    require(runtimePath)
    runtimeModule = require.cache[runtimePath]
    originalRuntime = runtimeModule.exports
    runtimeModule.exports = {
      getSnapshot: () => bundled,
      getSource: () => 'bundled',
      hasCity: (cityId) => Boolean(bundled.series[cityId]),
      refresh: async () => ({ updated: false, source: 'bundled', reason: 'not-due' }),
      ensureCities: async () => true,
    }
  }
  try {
    delete require.cache[pageModulePath]
    require(pageModulePath)
  } finally {
    if (runtimeModule) runtimeModule.exports = originalRuntime
    delete globalThis.Page
  }
  return pageConfig
}

function loadHomeWithRuntime(runtime) {
  const pagePath = resolve(root, 'apps/miniprogram/pages/index/index.js')
  const pageDirectory = resolve(root, 'apps/miniprogram/pages/index')
  let pageConfig
  const context = {
    Page(config) { pageConfig = config },
    console: { info() {}, error() {} },
    Date,
    setTimeout,
    clearTimeout,
    require(specifier) {
      if (specifier === '../../utils/data-runtime.js') return runtime
      return require(resolve(pageDirectory, specifier))
    },
  }
  runInNewContext(readFileSync(pagePath, 'utf8'), context, { filename: pagePath })
  return { pageConfig, context }
}

function pageHarness(config) {
  return {
    ...config,
    data: {
      ...config.data,
      state: { ...config.data.state, cities: [...config.data.state.cities] },
      hiddenCityIds: [...config.data.hiddenCityIds],
      selectedCities: config.data.selectedCities.map((city) => ({ ...city })),
      cityOptions: config.data.cityOptions.map((city) => ({ ...city })),
    },
    setData(update, callback) {
      Object.assign(this.data, update)
      callback?.()
    },
    drawSparklines() {},
  }
}

function canvasContextStub() {
  return {
    setStrokeStyle() {},
    setLineWidth() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    draw() {},
  }
}

async function directorySize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size
  }
  return total
}

test('mini program snapshot covers 70 cities and 120 months', async () => {
  const snapshot = require(snapshotPath)
  assert.equal(snapshot.cityIds.length, 70)
  assert.equal(snapshot.featuredCityIds.length, 6)
  assert.equal(snapshot.months.length, 120)
  assert.equal(snapshot.months.at(-1), snapshot.datasetAsOf)
  assert.match(snapshot.datasetVersion, /^2026-06-[a-f0-9]{12}$/)
  assert.equal(snapshot.sourceDatasetVersion, publishedManifest.source_dataset_version)
  assert.equal(snapshot.coverageStart, snapshot.months[0])
  assert.match(snapshot.sourceCoverageStart, /^20\d{2}-(0[1-9]|1[0-2])$/)
  assert.ok(snapshot.sourceCoverageStart <= snapshot.coverageStart)
  for (const id of snapshot.cityIds) {
    assert.equal(Object.keys(snapshot.series[id]).length, 8)
    for (const values of Object.values(snapshot.series[id])) assert.equal(values.length, 480)
    assert.equal(typeof snapshot.cityMap[id].province, 'string')
    assert.equal(typeof snapshot.cityMap[id].tierLabel, 'string')
  }
})

test('bundled snapshot leaves room for app code and chart library', async () => {
  const file = await stat(snapshotPath)
  assert.ok(file.size < 1_600_000, `snapshot is ${file.size} bytes`)
})

test('mini program main package remains below the 2 MB upload limit', async () => {
  const bytes = await directorySize(resolve(root, 'apps/miniprogram'))
  assert.ok(bytes < 2 * 1024 * 1024, `main package is ${bytes} bytes`)
})

test('wx-f2 uses a reset high-DPI canvas for real-device compatibility', async () => {
  const [wrapper, syncScript] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/miniprogram_npm/@antv/wx-f2/index.js'), 'utf8'),
    readFile(resolve(root, 'scripts/miniprogram/sync-devtools-project.mjs'), 'utf8'),
  ])

  assert.match(wrapper, /const pixelRatio = wx\.getSystemInfoSync\(\)\.pixelRatio \|\| 1;\s*node\.width = width \* pixelRatio;\s*node\.height = height \* pixelRatio;/)
  assert.match(wrapper, /context\.setTransform\(1, 0, 0, 1, 0, 0\)/)
  assert.match(wrapper, /if \(this\.chart\) return;/)
  assert.match(wrapper, /onInit:\s*\{\s*type:\s*null/)
  assert.doesNotMatch(wrapper, /type:\s*'Function'/)
  assert.doesNotMatch(wrapper, /const pixelRatio = wx\.getSystemInfoSync\(\)\.pixelRatio;/)
  assert.match(syncScript, /import\('\.\/patch-wx-f2-canvas\.mjs'\)/)
})

test('mini program shows and logs one explicit candidate build version', async () => {
  const [appScript, appConfig, versionScript, homeScript, homeMarkup, homeConfig, projectConfig] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/app.js'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/app.json'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/config/version.js'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.js'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.wxml'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.json'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/project.config.json'), 'utf8'),
  ])
  const configuredVersion = require(resolve(root, 'apps/miniprogram/config/version.js')).version
  assert.match(configuredVersion, /^v\d+\.\d+\.\d+$/)
  assert.match(versionScript, new RegExp(`version: '${configuredVersion.replaceAll('.', '\\.').replace('v', 'v')}'`))
  assert.match(appScript, /versionConfig\.version/)
  assert.match(appScript, /wx-f2 exparser compatibility enabled/)
  assert.match(homeScript, /appVersion: versionConfig\.version/)
  assert.match(homeMarkup, /版本 \{\{appVersion\}\}/)
  assert.equal(JSON.parse(appConfig).window.navigationBarTitleText, '住房小二')
  assert.equal(JSON.parse(homeConfig).navigationBarTitleText, '住房小二')
  assert.equal(JSON.parse(projectConfig).projectname, '住房小二')
  assert.equal(JSON.parse(projectConfig).libVersion, '3.17.0')
  assert.match(homeScript, /this\.data\.dataUnavailable \? '住房小二 · 数据暂不可用' : `住房小二 · 数据截至\$\{snapshot\.datasetAsOf\}`/)
  assert.match(homeMarkup, /<image class="brand-mark" src="\/assets\/housing-assistant\.png"/)
})

test('legacy wx-f2 runs on its compatible component framework', async () => {
  const [appConfig, homeScript] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/app.json'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.js'), 'utf8'),
  ])
  assert.equal(JSON.parse(appConfig).componentFramework, 'exparser')
  assert.equal(homeScript.match(/\[chart:init\]/g)?.length, 3)
})

test('home uses native page scrolling and stable chart hosts', async () => {
  const [wxml, wxss, script] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.wxml'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.wxss'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.js'), 'utf8'),
  ])

  assert.match(wxml, /^<view class="page">/)
  assert.doesNotMatch(wxml, /^<scroll-view class="page"/)
  assert.doesNotMatch(wxml, /open-type=["']share["']/)
  assert.match(script, /onShareAppMessage\(\)/)
  assert.match(wxml, /<view class="location-refresh" bindtap="locateCurrentCity" aria-label="重新定位当前城市" role="button">/)
  assert.doesNotMatch(wxml, /<button class="location-refresh"/)
  assert.equal(wxml.match(/<picker[^>]+aria-label=/g)?.length, 6)
  assert.match(wxml, /<input class="search"[^>]+aria-label="搜索趋势城市"/)
  assert.equal(wxml.match(/class="ranking-scroll" scroll-y/g)?.length, 3)
  assert.match(wxml, /scroll-into-view="national-rank-\{\{rankingScrollCity\}\}"/)
  assert.match(wxml, /scroll-into-view="tier-rank-\{\{rankingScrollCity\}\}"/)
  assert.match(wxml, /scroll-into-view="province-rank-\{\{rankingScrollCity\}\}"/)
  assert.doesNotMatch(wxml, /class="focus-entry"/)
  assert.match(wxss, /\.f2-chart\s*\{[^}]*display:\s*block[^}]*position:\s*relative[^}]*height:\s*100%/s)
  assert.match(wxss, /\.nav-row\s*\{[^}]*display:\s*flex[^}]*gap:\s*8rpx/s)
  assert.match(wxss, /\.nav-button, \.reset-button\s*\{[^}]*min-width:\s*0/s)
  assert.match(wxss, /\.nav-button\s*\{[^}]*width:\s*0[^}]*flex:\s*1\s+1\s+0[^}]*background:\s*var\(--color-surface-subtle\)/s)
  assert.match(wxss, /\.nav-button\.active\s*\{[^}]*background:\s*var\(--color-accent-soft\)/s)
  assert.match(wxss, /\.reset-button\s*\{[^}]*width:\s*128rpx[^}]*flex:\s*0\s+0\s+128rpx/s)
  assert.match(wxml, /class="analysis-nav \{\{analysisNavFixed \? 'is-fixed' : ''\}\}"/)
  assert.match(wxml, /class="analysis-nav-spacer" wx:if="\{\{analysisNavFixed\}\}"/)
  assert.match(wxss, /\.analysis-nav\.is-fixed\s*\{[^}]*position:\s*fixed[^}]*top:\s*0[^}]*left:\s*0[^}]*right:\s*0/s)
  assert.match(script, /event\.scrollTop >= this\._analysisNavTop/)
  assert.match(wxss, /\.trend-head\s*\{[^}]*display:\s*flex/s)
  assert.match(wxss, /\.trend-city-row\s*\{[^}]*display:\s*flex/s)
  assert.match(wxml, /已选 \{\{selectedCities\.length\}\}\/3 城市/)
  assert.match(wxml, /class="trend-city-add" bindtap="openPicker"/)
  assert.doesNotMatch(wxml, /class="trend-city-label"|显示中|已隐藏/)
  assert.match(wxml, /item\.hidden \? '#8e8e93' : item\.color/)
  assert.match(wxss, /\.trend-city-row\s*\{[^}]*display:\s*flex[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s)
  assert.match(wxss, /\.trend-city-add\s*\{[^}]*width:\s*144rpx[^}]*height:\s*52rpx[^}]*background:\s*var\(--color-accent\)[^}]*white-space:\s*nowrap/s)
  assert.match(wxss, /\.legend-item\.legend-hidden text\s*\{[^}]*text-decoration:\s*line-through/s)
  assert.match(wxss, /\.market-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(wxml, /class="market-panel comparison-panel national-panel"/)
  assert.match(wxml, /class="market-panel comparison-panel tier-panel"/)
  assert.match(wxml, /class="market-panel comparison-panel province-panel"/)
  assert.match(wxml, /城市涨跌分布与\{\{focusCityName\}\}排名 · 最新月份/)
  assert.doesNotMatch(wxml, /定位城市排名|class="market-focus"/)
  assert.doesNotMatch(wxss, /\.market-focus/)
  assert.match(wxss, /\.comparison-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
  assert.doesNotMatch(wxml, /同级平均|market\.tierAverage/)
  assert.doesNotMatch(script, /tierAverage/)
  assert.match(wxss, /\.comparison-panel \.ranking-name\s*\{[^}]*font-size:\s*21rpx[^}]*white-space:\s*nowrap/s)
  assert.match(wxss, /\.comparison-panel \.current-tag\s*\{[^}]*font-size:\s*13rpx/s)
  assert.match(wxss, /\.trend-city-row \.legend-item\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*line-height:\s*1\.2/s)
  assert.match(wxss, /\.trend-city-row \.legend-item\s*\{[^}]*min-height:\s*58rpx[^}]*margin:\s*0[^}]*padding:/s)
  assert.doesNotMatch(wxml, /不要求登录/)
  assert.match(wxml, />70城温度<\/button>/)
  assert.doesNotMatch(wxml, />市场位置<\/button>|class="section-title">市场位置/)
  assert.ok(wxml.indexOf('70城温度走势') < wxml.indexOf('class="market-grid comparison-grid"'))
  assert.match(wxss, /\.trend-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(wxss, /@media\s*\(orientation:\s*landscape\)[\s\S]*\.city-grid\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)[\s\S]*\.chart-shell\s*\{[^}]*height:\s*460rpx/s)
  assert.match(script, /wx\.pageScrollTo\(\{\s*selector:/)
  assert.match(script, /onPageScroll\(event\)/)
  assert.equal(script.match(/chart\.legend\(false\)/g)?.length, 3)
  assert.doesNotMatch(wxml, /有效城市数\s*\/\s*70/)
  assert.match(script, /MOBILE_STANDARD_CHART_PADDING = \[28, 24, 42, 48\]/)
  assert.match(script, /MOBILE_BREADTH_CHART_PADDING = \[28, 12, 34, 32\]/)
  assert.match(script, /DESKTOP_STANDARD_CHART_PADDING = \[28, 48, 60, 48\]/)
  assert.match(script, /DESKTOP_BREADTH_CHART_PADDING = \[28, 32, 46, 32\]/)
  assert.match(script, /function chartMonthAxis\(\)/)
  assert.match(script, /function chartAxisLabels\(months, count = 5\)/)
  assert.match(wxml, /class="desktop-chart-axis desktop-breadth-chart-axis" wx:if="\{\{desktopChartMode\}\}"/)
  assert.match(wxml, /class="desktop-chart-axis" wx:if="\{\{desktopChartMode\}\}"/)
  assert.match(wxml, /<block wx:if="\{\{!breadthChartError\}\}"><f2 class="f2-chart" onInit="\{\{onInitBreadthChart\}\}" \/><view class="desktop-chart-axis desktop-breadth-chart-axis"/)
  assert.match(wxml, /<block wx:if="\{\{!trendChartError\}\}"><f2 class="f2-chart" onInit="\{\{onInitChart\}\}" \/><view class="desktop-chart-axis"/)
  assert.match(wxml, /<block wx:if="\{\{!cumulativeChartError\}\}"><f2 class="f2-chart" onInit="\{\{onInitCumulativeChart\}\}" \/><view class="desktop-chart-axis"/)
  assert.match(wxss, /\.desktop-chart-axis\s*\{[^}]*position:\s*absolute[^}]*right:\s*48px[^}]*left:\s*48px[^}]*font-size:\s*9px/s)
  assert.match(wxss, /\.desktop-breadth-chart-axis\s*\{[^}]*right:\s*32px[^}]*left:\s*32px/s)
  assert.match(script, /count:\s*\{\s*min:\s*0,\s*max:\s*70,\s*ticks:\s*\[0, 20, 40, 60, 70\],\s*nice:\s*false\s*\}/)
  assert.match(wxss, /\.history-chart\s*\{[^}]*height:\s*376rpx[^}]*margin-top:\s*2rpx/)
  assert.match(wxml, /全国城市观察/)
  assert.match(wxml, /发布于 \{\{releaseDate\}\}/)
  assert.doesNotMatch(script, /activeRankScope|switchRankingScope/)
})

test('location mapping prefers an exact 70-city match and otherwise uses the provincial capital', () => {
  const snapshot = require(snapshotPath)
  const { normalizeProvince, resolveCityId } = require(resolve(root, 'apps/miniprogram/utils/location.js'))

  assert.equal(normalizeProvince('广西壮族自治区'), '广西')
  assert.equal(resolveCityId(snapshot.cityMap, '北京市', '北京市'), 'beijing')
  assert.equal(resolveCityId(snapshot.cityMap, '泉州市', '福建省'), 'quanzhou')
  assert.equal(resolveCityId(snapshot.cityMap, '东莞市', '广东省'), 'guangzhou')
  assert.equal(resolveCityId(snapshot.cityMap, '未知地区', '不存在省份'), null)
})

test('fuzzy location capability is declared and reverse geocoding keeps the map key server-side', async () => {
  const [appConfig, cloudFunction, locationConfig] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/app.json'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/cloudfunctions/reverseGeocode/index.js'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/config/location.js'), 'utf8'),
  ])

  const app = JSON.parse(appConfig)
  assert.equal(app.permission['scope.userFuzzyLocation'].desc.includes('腾讯位置服务'), true)
  assert.equal(app.permission['scope.userFuzzyLocation'].desc.includes('最长24小时'), true)
  assert.equal(app.requiredPrivateInfos.includes('getFuzzyLocation'), true)
  assert.equal(app.requiredPrivateInfos.includes('getLocation'), false)
  assert.match(await readFile(resolve(root, 'apps/miniprogram/pages/index/index.js'), 'utf8'), /\[location:fuzzy\] getFuzzyLocation failed/)
  assert.match(cloudFunction, /process\.env\.TENCENT_LBS_KEY/)
  assert.match(cloudFunction, /\.trim\(\)/)
  assert.match(cloudFunction, /REQUEST_TIMEOUT_MS\s*=\s*5000/)
  assert.match(cloudFunction, /MAX_RESPONSE_BYTES\s*=\s*64 \* 1024/)
  assert.match(cloudFunction, /response\.statusCode !== 200/)
  assert.match(cloudFunction, /request\.setTimeout\(REQUEST_TIMEOUT_MS/)
  assert.doesNotMatch(cloudFunction, /key=[A-Za-z0-9]{20,}/)
  assert.match(locationConfig, /cloudEnvId:\s*'cloud1-[a-z0-9]+'/)
})

test('home uses the global range for trends and exposes chart failure fallbacks', async () => {
  const [wxml, script] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.wxml'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/index/index.js'), 'utf8'),
  ])

  assert.match(script, /snapshot\.months\.length - state\.range/)
  assert.doesNotMatch(wxml, /class="chart-toolbar"|class="zoom-slider"|bindtap="zoomIn"|bindtap="zoomOut"/)
  assert.doesNotMatch(script, /zoomIn\(\)|zoomOut\(\)|onTrendWindowChange\(event\)/)
  for (const name of ['breadthChartError', 'trendChartError', 'cumulativeChartError']) {
    assert.match(wxml, new RegExp(`!${name}`))
    assert.match(script, new RegExp(`${name}: false`))
  }
  assert.equal((wxml.match(/bindtap="retryChart"/g) || []).length, 3)
  assert.match(script, /retryChart\(event\)/)
  assert.match(wxml, /counts\.missing > 0/)
  assert.doesNotMatch(wxml, /bindchanging="onBreadthChange"/)
  assert.doesNotMatch(wxml, /class="slider-label-row"|aria-label="选择温度月份"/)
  assert.match(script, /showTitle:\s*false/)
  assert.match(script, /function formatChartMonth\(value\)/)
  assert.match(script, /value:\s*\{\s*tickCount:\s*5,\s*formatter:\s*formatIndex\s*\}/)
  assert.match(script, /item\.value\s*=\s*formatChange\(item\.origin\s*&&\s*item\.origin\.change\)/)
  assert.match(script, /`\$\{formatChartMonth\(month\)\}涨跌幅 \$\{item\.name\}`/)
  assert.match(wxml, /class="unavailable-state" wx:if="\{\{dataUnavailable\}\}"/)
  assert.match(wxml, /bindtap="retryData"/)
  assert.match(wxml, /查看数据来源与审计说明/)
  assert.doesNotMatch(wxml, /可展开“查看精确数据”读取对应月份数值/)
  assert.doesNotMatch(wxml, /class="history-detail"/)
  assert.doesNotMatch(wxml, /缺失月份会断线|不按0计算|颜色与线型共同用于区分城市|中途缺少环比数据时停止后续计算|不跨越缺口拼接/)
  assert.match(wxml, /class="chart-note" wx:if="\{\{selectedCities\.length\}\}">注：虚线为0%基准线；曲线位于基准线上方表示上涨，位于下方表示下跌。<\/text>/)
  assert.match(wxml, /\{\{cumulativeStartMonth\}\}为基期（指数=100），按月度环比复合计算；高于100表示较基期上涨，低于100表示较基期下跌，不代表实际元\/㎡房价。/)
  assert.match(wxml, /class="breadth-legend"/)
  assert.equal(script.match(/chart\.legend\(false\)/g)?.length, 3)
})

test('city picker starts with six featured cities and then alphabetic groups', () => {
  const pageConfig = loadPageConfig('apps/miniprogram/pages/index/index.js')
  const options = pageConfig.data.cityOptions
  assert.equal(options.length, 70)
  assert.equal(new Set(options.slice(0, 6).map((item) => item.group)).size, 1)
  assert.equal(options[0].showGroup, true)
  assert.equal(options.slice(1, 6).every((item) => !item.showGroup), true)
  assert.equal(options.slice(6).every((item) => /^[A-Z]$/.test(item.group)), true)
  assert.equal(options.slice(6).some((item) => item.showGroup), true)
})

test('manual location picker sorts cities by pinyin and preserves index mapping', () => {
  const snapshot = require(snapshotPath)
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const sortedIds = [...snapshot.cityIds].sort((left, right) => left.localeCompare(right, 'en'))
  const sortedNames = sortedIds.map((id) => snapshot.cityMap[id].name)
  globalThis.wx = { setStorageSync() {}, createCanvasContext: canvasContextStub }

  assert.deepEqual(page.data.focusCityNames, sortedNames)
  page.onFocusCityChange({ detail: { value: '0' } })
  assert.equal(page.data.state.focusCity, sortedIds[0])
  assert.equal(page.data.focusCityName, '安庆')
  delete globalThis.wx
})

test('an older location response cannot overwrite a newer manual city choice', async () => {
  const snapshot = require(snapshotPath)
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  let fuzzySuccess
  let cloudSuccess
  globalThis.wx = {
    cloud: { callFunction(options) { cloudSuccess = options.success } },
    getFuzzyLocation(options) { fuzzySuccess = options.success },
    setStorageSync() {},
    showToast() {},
    createCanvasContext: canvasContextStub,
  }

  page.locateCurrentCity()
  fuzzySuccess({ latitude: 39.9, longitude: 116.4 })
  page.onFocusCityChange({ detail: { value: '0' } })
  const manuallySelected = page.data.state.focusCity
  cloudSuccess({ result: { city: '北京市', province: '北京市' } })
  await Promise.resolve()

  assert.equal(manuallySelected, [...snapshot.cityIds].sort((left, right) => left.localeCompare(right, 'en'))[0])
  assert.equal(page.data.state.focusCity, manuallySelected)
  assert.equal(page.data.locationStatus, 'idle')
  delete globalThis.wx
})

test('chart retry clears only the requested chart failure and destroys its stale instance', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  let destroyed = 0
  page.chart = { destroy() { destroyed += 1 } }
  page.data.trendChartError = true
  page.data.cumulativeChartError = true

  page.retryChart({ currentTarget: { dataset: { type: 'trend' } } })

  assert.equal(destroyed, 1)
  assert.equal(page.chart, null)
  assert.equal(page.data.trendChartError, false)
  assert.equal(page.data.cumulativeChartError, true)
})

test('legend hiding keeps at least one visible series', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const toasts = []
  globalThis.wx = { showToast: (options) => toasts.push(options.title) }

  for (const id of page.data.state.cities) page.toggleLegend({ currentTarget: { dataset: { id } } })

  assert.equal(page.data.hiddenCityIds.length, page.data.state.cities.length - 1)
  assert.equal(toasts.length, 1)
  delete globalThis.wx
})

test('city picker search supports pinyin and enforces the three-city limit', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const toasts = []
  globalThis.wx = { showToast: (options) => toasts.push(options.title), setStorageSync() {}, createCanvasContext: canvasContextStub }

  page.onSearch({ detail: { value: 'beijing' } })
  assert.deepEqual(page.data.cityOptions.map((item) => item.id), ['beijing'])
  page.toggleCity({ currentTarget: { dataset: { id: 'shenzhen' } } })
  page.toggleCity({ currentTarget: { dataset: { id: 'fuzhou' } } })
  page.toggleCity({ currentTarget: { dataset: { id: 'xiamen' } } })
  assert.equal(page.data.state.cities.length, 3)
  assert.equal(toasts.length, 1)
  delete globalThis.wx
})

test('resize and unload update and destroy all chart instances', async () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const sizes = []
  let destroyed = 0
  const chart = () => ({
    changeSize: (width, height) => sizes.push([width, height]),
    destroy: () => { destroyed += 1 },
  })
  page.chart = chart()
  page.cumulativeChart = chart()
  page.breadthChart = chart()
  globalThis.wx = {
    getSystemInfoSync: () => ({ platform: 'ios' }),
    createSelectorQuery: () => ({
      select() { return this },
      boundingClientRect() { return this },
      exec(callback) { callback([{ width: 320, height: 240 }, { width: 320, height: 200 }, { width: 320, height: 180 }]) },
    }),
  }

  page.resizeCharts()
  assert.deepEqual(sizes, [[320, 240], [320, 200], [320, 180]])
  page.onUnload()
  assert.equal(destroyed, 3)
  delete globalThis.wx
})

test('desktop chart resize never reinitializes the wx-f2 canvas', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const sizes = []
  const chart = { changeSize: (width, height) => sizes.push([width, height]) }
  page.chart = chart
  page.cumulativeChart = chart
  page.breadthChart = chart
  globalThis.wx = {
    getSystemInfoSync: () => ({ platform: 'windows' }),
    createSelectorQuery() { throw new Error('desktop charts must not query or resize canvas') },
  }

  page.resizeCharts()
  page.onResize()
  assert.deepEqual(sizes, [])
  delete globalThis.wx
})

test('source page can confirm and clear saved filter state', async () => {
  const [wxml, script, appConfig] = await Promise.all([
    readFile(resolve(root, 'apps/miniprogram/pages/source/source.wxml'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/pages/source/source.js'), 'utf8'),
    readFile(resolve(root, 'apps/miniprogram/app.json'), 'utf8'),
  ])

  assert.match(wxml, /bindtap="clearSavedState"/)
  assert.match(wxml, /获取模糊位置信息，经项目云函数提交腾讯位置服务/)
  assert.match(wxml, /项目业务代码不持久化经纬度/)
  assert.match(wxml, /最长24小时/)
  assert.match(script, /clearSavedState\(\)/)
  assert.match(script, /snapshot\.sourceCoverageStart \|\| snapshot\.coverageStart/)
  assert.match(script, /wx\.showModal\(/)
  assert.match(script, /housing-view-state-v1/)
  assert.match(script, /housing-focus-source-v1/)
  assert.match(script, /housing-location-cache-v1/)
  const fuzzyLocationDescription = JSON.parse(appConfig).permission['scope.userFuzzyLocation'].desc
  assert.match(fuzzyLocationDescription, /项目云函数提交腾讯位置服务/)
  assert.match(fuzzyLocationDescription, /cityId\/locatedAt 最长24小时/)
})

test('source page describes validated remote updates instead of version-only data', async () => {
  const sourceWxml = await readFile(resolve(root, 'apps/miniprogram/pages/source/source.wxml'), 'utf8')
  assert.match(sourceWxml, /内置快照兜底，官方新月份通过完整校验后由云端更新/)
  assert.doesNotMatch(sourceWxml, /数据随小程序版本发布/)
})

test('source page clears local filters only after confirmation', () => {
  const pageConfig = loadPageConfig('apps/miniprogram/pages/source/source.js')
  const removed = []
  const toasts = []
  globalThis.wx = {
    showModal(options) { options.success({ confirm: true }) },
    removeStorageSync(key) { removed.push(key) },
    showToast(options) { toasts.push(options) },
  }

  pageConfig.clearSavedState()

  assert.deepEqual(removed, ['housing-view-state-v1', 'housing-focus-source-v1', 'housing-location-cache-v1'])
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].icon, 'success')
  delete globalThis.wx
})

test('every bundled value matches the published city shards', async () => {
  const snapshot = require(snapshotPath)
  const dataRoot = resolve(root, 'apps/web/public/data')
  const manifest = JSON.parse(await readFile(resolve(dataRoot, 'manifest.json'), 'utf8'))
  const bandCodes = { all: 'a', le90: 's', '90_144': 'm', gt144: 'l' }
  const allowedMonths = new Set(snapshot.months)
  for (const id of snapshot.cityIds) {
    const relative = manifest.city_data_url_template.replace('{city_id}', id).replace(/^\/data\//, '')
    const published = JSON.parse(await readFile(resolve(dataRoot, relative), 'utf8'))
    const grouped = {}
    for (const record of published.records.filter((item) => allowedMonths.has(item.stat_month))) {
      const key = `${record.property_type === 'new' ? 'n' : 'r'}_${bandCodes[record.size_band]}`
      ;(grouped[key] ??= []).push(record.mom_index, record.yoy_index, record.mom_change, record.yoy_change)
    }
    assert.deepEqual(snapshot.series[id], grouped, `${id} differs from published data`)
  }
})

test('mini program home view derives the final mobile overview model', () => {
  const pageConfig = loadPageConfig('apps/miniprogram/pages/index/index.js')

  assert.equal(pageConfig.data.cityOptions.length, 70)
  assert.equal(pageConfig.data.featuredCards.length, 6)
  assert.equal(pageConfig.data.featuredCards.every((card) => card.sparkValues.length === 12), true)
  assert.equal(Object.values(pageConfig.data.counts).reduce((sum, value) => sum + value, 0), 70)
  assert.equal(pageConfig.data.rangeLabel, '近5年')
  assert.equal(pageConfig.data.selectedCities.length, 1)
  assert.equal(pageConfig.data.selectedCities[0].seriesIndex, 0)
  assert.equal(pageConfig.data.cumulativeLatest[0].color, pageConfig.data.selectedCities[0].color)
  assert.equal(pageConfig.data.market.tierRows.length > 0, true)
  assert.equal(pageConfig.data.market.nationalRows.length, pageConfig.data.market.nationalCount)
  assert.equal(pageConfig.data.market.tierRows.length, pageConfig.data.market.tierCount)
  assert.equal(pageConfig.data.market.provinceRows.length, pageConfig.data.market.provinceCount)
  assert.equal(pageConfig.data.market.nationalRows.some((row) => row.current), true)
  assert.equal(pageConfig.data.market.tierRows.some((row) => row.current), true)
  assert.equal(pageConfig.data.breadthHistory.length, 60)
  assert.equal(pageConfig.data.cumulativeData.length, 60)
  assert.equal(pageConfig.data.exactData.length, 1)
  assert.equal(pageConfig.data.showExactData, false)
  assert.equal(typeof pageConfig.data.onInitCumulativeChart, 'function')
  assert.equal(typeof pageConfig.data.onInitBreadthChart, 'function')
})

test('home starts from the real bundled runtime without a remote control state', () => {
  const bundled = require(snapshotPath)
  const { createDataRuntime } = require(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))
  const runtime = createDataRuntime({ wxApi: null, bundled })
  const { pageConfig } = loadHomeWithRuntime(runtime)

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot(), bundled)
  assert.equal(pageConfig.data.dataUnavailable, false)
  assert.equal(pageConfig.data.featuredCards.length, 6)
  assert.equal(pageConfig.data.market.nationalRows.length, 70)
  assert.equal(Object.values(pageConfig.data.counts).reduce((sum, value) => sum + value, 0), 70)
})

test('home fails closed without trusted data and rebuilds the full view only after retry validation', async () => {
  const bundled = require(snapshotPath)
  const unavailable = {
    ...bundled,
    months: [],
    releaseDates: [],
    cityIds: [],
    featuredCityIds: [],
    cityMap: {},
    series: {},
    latestSeries: {},
    breadthSeries: {},
    dataStatus: 'unavailable',
  }
  let current = unavailable
  let allowRecovery = false
  const refreshOptions = []
  const runtime = {
    getSnapshot: () => current,
    getSource: () => current === bundled ? 'remote' : 'unavailable',
    hasCity: (cityId) => Boolean(current.series?.[cityId]),
    ensureCities: async () => true,
    refresh: async (options) => {
      refreshOptions.push(options)
      if (!allowRecovery) return { updated: false, source: 'unavailable', reason: 'failed' }
      current = bundled
      return { updated: true, source: 'remote' }
    },
  }
  const isolatedHome = loadHomeWithRuntime(runtime)
  const page = pageHarness(isolatedHome.pageConfig)
  isolatedHome.context.wx = {
    getStorageSync(key) { return key === 'housing-focus-source-v1' ? 'manual' : null },
    removeStorageSync() {},
    setStorageSync() {},
    createCanvasContext: canvasContextStub,
  }

  assert.equal(page.data.dataUnavailable, true)
  assert.equal(page.data.featuredCards.length, 0)
  assert.equal(page.data.market.nationalRows.length, 0)
  page.onLoad({})
  assert.equal(page.onShow(), undefined)
  const firstRefresh = page._refreshPromise
  assert.ok(firstRefresh && typeof firstRefresh.then === 'function')
  assert.equal(page.onShow(), undefined)
  assert.equal(page._refreshPromise, firstRefresh)
  await firstRefresh
  assert.equal(page._refreshPromise, null)
  assert.equal(refreshOptions.length, 1)
  assert.equal(page.data.dataUnavailable, true)

  allowRecovery = true
  await page.retryData()
  assert.equal(refreshOptions.at(-1).force, true)
  assert.equal(page.data.dataUnavailable, false)
  assert.equal(page.data.featuredCards.length, 6)
  assert.equal(page.data.market.nationalRows.length, 70)
})

test('home onShow keeps a trusted snapshot when the internal remote refresh rejects', async () => {
  const bundled = require(snapshotPath)
  const timeout = new Error('(in promise) SystemError timeout')
  const runtime = {
    getSnapshot: () => bundled,
    getSource: () => 'bundled',
    hasCity: (cityId) => Boolean(bundled.series?.[cityId]),
    ensureCities: async () => true,
    refresh: async () => { throw timeout },
  }
  const isolatedHome = loadHomeWithRuntime(runtime)
  const page = pageHarness(isolatedHome.pageConfig)
  isolatedHome.context.wx = {
    getStorageSync(key) { return key === 'housing-focus-source-v1' ? 'manual' : null },
    removeStorageSync() {},
    setStorageSync() {},
    createCanvasContext: canvasContextStub,
  }

  page.onLoad({})
  assert.equal(page.data.dataUnavailable, false)
  assert.equal(page.onShow(), undefined)
  const refresh = page._refreshPromise
  assert.ok(refresh && typeof refresh.then === 'function')
  const result = await refresh

  assert.equal(result.updated, false)
  assert.equal(result.source, 'bundled')
  assert.equal(result.reason, 'page-refresh-failed')
  assert.equal(result.error, timeout)
  assert.equal(page._refreshPromise, null)
  assert.equal(page.data.dataUnavailable, false)
  assert.equal(page.data.featuredCards.length, 6)
})

test('location cache is deleted when startup or locate-on-click finds an expired or invalid record', () => {
  const startupPage = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const startupStorage = new Map([
    ['housing-focus-source-v1', 'manual'],
    ['housing-location-cache-v1', { cityId: 'beijing', locatedAt: Date.now() - 25 * 60 * 60 * 1000 }],
  ])
  const startupRemoved = []
  globalThis.wx = {
    getStorageSync: (key) => startupStorage.get(key),
    removeStorageSync(key) { startupRemoved.push(key); startupStorage.delete(key) },
    setStorageSync() {},
    createCanvasContext: canvasContextStub,
  }
  startupPage.onLoad({})
  assert.deepEqual(startupRemoved, ['housing-location-cache-v1'])

  const locatePage = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const locateStorage = new Map([
    ['housing-location-cache-v1', { cityId: 'not-a-city', locatedAt: Date.now() + 60_000 }],
  ])
  const locateRemoved = []
  globalThis.wx = {
    cloud: { callFunction() {} },
    getStorageSync: (key) => locateStorage.get(key),
    removeStorageSync(key) { locateRemoved.push(key); locateStorage.delete(key) },
    getFuzzyLocation(options) { options.fail(new Error('permission denied')) },
    showToast() {},
  }
  locatePage.locateCurrentCity({ useCache: true })
  assert.deepEqual(locateRemoved, ['housing-location-cache-v1'])
  delete globalThis.wx
})

test('all F2 time-category values use iOS-safe complete dates', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  const chartRows = [
    ...page.getTrendData(),
    ...page.getCumulativeData(),
    ...page.data.breadthChartData,
  ]
  assert.ok(chartRows.length > 0)
  assert.equal(chartRows.every((item) => /^\d{4}-\d{2}-01$/.test(item.month)), true)
})

test('trend and cumulative charts send solid-dash-dash shapes to F2', async () => {
  const pageConfig = loadPageConfig('apps/miniprogram/pages/index/index.js')
  const charts = []
  class FakeGeometry {
    position() { return this }
    color() { return this }
    shape(field, callback) { this.shapeField = field; this.shapeCallback = callback; return this }
    size() { return this }
  }
  class FakeChart {
    constructor() { this.geometry = new FakeGeometry(); charts.push(this) }
    source() {}
    tooltip() {}
    legend() {}
    axis(field, config) { this.axisConfigs ||= {}; this.axisConfigs[field] = config }
    guide() { return { line() {} } }
    line() { return this.geometry }
    animate() {}
    render() {}
  }
  const page = {
    data: { state: { cities: ['fuzhou', 'hefei', 'changsha'] } },
    getTrendData() { return [] },
    getCumulativeData() { return [] },
  }
  globalThis.getCurrentPages = () => [page]

  pageConfig.data.onInitChart({ Chart: FakeChart }, {})
  pageConfig.data.onInitCumulativeChart({ Chart: FakeChart }, {})

  assert.equal(charts.length, 2)
  for (const chart of charts) {
    assert.equal(chart.geometry.shapeField, 'city')
    assert.deepEqual(['福州', '合肥', '长沙'].map(chart.geometry.shapeCallback), ['line', 'dash', 'dash'])
  }
  const wxss = await readFile(resolve(root, 'apps/miniprogram/pages/index/index.wxss'), 'utf8')
  assert.match(wxss, /\.legend-line\.pattern-1, \.legend-line\.pattern-2\s*\{\s*border-top-style:\s*dashed/)
  delete globalThis.getCurrentPages
})

test('desktop chart layout is isolated from the fixed mobile layout', () => {
  const pageConfig = loadPageConfig('apps/miniprogram/pages/index/index.js')
  class FakeGeometry {
    position() { return this }
    color() { return this }
    shape() { return this }
    size() { return this }
    adjust() { return this }
  }
  class FakeChart {
    constructor(config) { this.config = config; this.geometry = new FakeGeometry() }
    source() {}
    tooltip(config) { this.tooltipConfig = config }
    legend() {}
    axis(field, config) { this.axisConfigs ||= {}; this.axisConfigs[field] = config }
    guide() { return { line() {} } }
    line() { return this.geometry }
    interval() { return this.geometry }
    animate() {}
    render() {}
  }
  const createCharts = (platform) => {
    const charts = []
    const Chart = class extends FakeChart {
      constructor(config) { super(config); charts.push(this) }
    }
    globalThis.wx = { getSystemInfoSync: () => ({ platform }) }
    const page = {
      data: { state: { cities: ['fuzhou'] }, breadthChartData: [] },
      getTrendData() { return [] },
      getCumulativeData() { return [] },
    }
    globalThis.getCurrentPages = () => [page]
    pageConfig.data.onInitChart({ Chart }, {})
    pageConfig.data.onInitCumulativeChart({ Chart }, {})
    pageConfig.data.onInitBreadthChart({ Chart }, {})
    return charts
  }

  const mobileCharts = createCharts('ios')
  assert.deepEqual(mobileCharts.map((chart) => chart.config.padding), [
    [28, 24, 42, 48],
    [28, 24, 42, 48],
    [28, 12, 34, 32],
  ])
  assert.equal(mobileCharts.every((chart) => chart.tooltipConfig.fixed === undefined), true)

  for (const platform of ['windows', 'devtools']) {
    const desktopCharts = createCharts(platform)
    assert.deepEqual(desktopCharts.map((chart) => chart.config.padding), [
      [28, 48, 60, 48],
      [28, 48, 60, 48],
      [28, 32, 46, 32],
    ])
    assert.equal(desktopCharts.every((chart) => chart.tooltipConfig.fixed === true), true)
    assert.equal(desktopCharts.every((chart) => chart.axisConfigs.month.label === false), true)
  }
  delete globalThis.wx
  delete globalThis.getCurrentPages
})

test('desktop chart dates are supplied by the page while phones retain F2 labels', () => {
  globalThis.wx = { getSystemInfoSync: () => ({ platform: 'windows' }) }
  const desktopPage = loadPageConfig('apps/miniprogram/pages/index/index.js')
  assert.equal(desktopPage.data.desktopChartMode, true)
  assert.equal(desktopPage.data.trendChartAxisLabels.length, 5)
  assert.equal(desktopPage.data.cumulativeChartAxisLabels.length, 5)
  assert.equal(desktopPage.data.breadthChartAxisLabels.length, 5)
  assert.match(desktopPage.data.trendChartAxisLabels[0], /^\d{2}-\d{2}$/)
  delete globalThis.wx

  const mobilePage = loadPageConfig('apps/miniprogram/pages/index/index.js')
  assert.equal(mobilePage.data.desktopChartMode, false)
})

test('trend defaults to one city and location replaces the trend city', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  globalThis.wx = { setStorageSync() {}, createCanvasContext: canvasContextStub }

  assert.deepEqual(page.data.state.cities, ['beijing'])
  page.selectFocusCity('fuzhou', 'location')
  assert.deepEqual(page.data.state.cities, ['fuzhou'])
  assert.equal(page.data.locatedCityId, 'fuzhou')
  page.selectFocusCity('shanghai', 'manual')
  assert.deepEqual(page.data.state.cities, ['fuzhou', 'shanghai'])
  page.resetCities()
  assert.deepEqual(page.data.state.cities, ['fuzhou'])
  delete globalThis.wx
})

test('filter reset re-arms ranking scroll targets for an unchanged focus city', () => {
  const page = pageHarness(loadPageConfig('apps/miniprogram/pages/index/index.js'))
  globalThis.wx = { setStorageSync() {}, createCanvasContext: canvasContextStub }
  page.applyState({ ...page.data.state, focusCity: 'fuzhou', propertyType: 'resale', metric: 'yoy', range: 120 })
  const rankingTargets = []
  const setData = page.setData
  page.setData = function (update, callback) {
    if (Object.hasOwn(update, 'rankingScrollCity')) rankingTargets.push(update.rankingScrollCity)
    setData.call(this, update, callback)
  }

  page.resetFilters()

  assert.equal(page.data.state.focusCity, 'fuzhou')
  assert.deepEqual(rankingTargets, ['', 'fuzhou'])
  const nationalCurrent = page.data.market.nationalRows.find((item) => item.current)
  const tierCurrent = page.data.market.tierRows.find((item) => item.current)
  const provinceCurrent = page.data.market.provinceRows.find((item) => item.current)
  assert.equal(nationalCurrent?.id, 'fuzhou')
  assert.equal(nationalCurrent?.rank, page.data.market.nationalRank)
  assert.equal(tierCurrent?.id, 'fuzhou')
  assert.equal(tierCurrent?.rank, page.data.market.tierRank)
  assert.equal(provinceCurrent?.id, 'fuzhou')
  assert.equal(provinceCurrent?.rank, page.data.market.provinceRank)
  delete globalThis.wx
})
