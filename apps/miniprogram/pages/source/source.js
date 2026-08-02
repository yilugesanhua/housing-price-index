const dataRuntime = require('../../utils/data-runtime.js')
const LOCAL_STORAGE_KEYS = [
  'housing-view-state-v1',
  'housing-focus-source-v1',
  'housing-location-cache-v1',
]

function sourceView() {
  const snapshot = dataRuntime.getSnapshot()
  return {
    datasetAsOf: snapshot.datasetAsOf,
    releaseDate: snapshot.releaseDate,
    coverageStart: snapshot.sourceCoverageStart || snapshot.coverageStart,
    latestOfficialUrl: snapshot.latestOfficialUrl,
    sourceDisplay: snapshot.latestOfficialUrl.replace(/^https?:\/\//, ''),
    statusLabel: snapshot.dataStatus === 'current' ? '数据已更新' : snapshot.dataStatus === 'stale' ? '数据已过期' : '数据暂不可用',
    statusTone: snapshot.dataStatus === 'current' ? 'current' : 'stale',
    statusReason: snapshot.dataStatus === 'unavailable'
      ? '当前没有通过撤销状态和完整性校验的可用数据，请联网后返回首页重试。'
      : snapshot.statusReason || '请以国家统计局最新发布为准。',
  }
}

Page({
  data: sourceView(),
  onShow() { this.setData(sourceView()) },
  copySource() {
    wx.setClipboardData({ data: dataRuntime.getSnapshot().latestOfficialUrl })
  },
  clearSavedState() {
    wx.showModal({
      title: '清除本地记录？',
      content: '将清除筛选、城市选择来源和定位城市缓存；公开数据不会被删除。',
      confirmText: '清除',
      success(result) {
        if (!result.confirm) return
        for (const key of LOCAL_STORAGE_KEYS) {
          try { wx.removeStorageSync(key) } catch (_) {}
        }
        wx.showToast({ title: '已清除', icon: 'success' })
      },
    })
  },
})
