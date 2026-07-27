const dataRuntime = require('../../utils/data-runtime.js')
const STORAGE_KEY = 'housing-view-state-v1'

function sourceView() {
  const snapshot = dataRuntime.getSnapshot()
  return {
    datasetAsOf: snapshot.datasetAsOf,
    releaseDate: snapshot.releaseDate,
    coverageStart: snapshot.coverageStart,
    latestOfficialUrl: snapshot.latestOfficialUrl,
    sourceDisplay: snapshot.latestOfficialUrl.replace(/^https?:\/\//, ''),
    statusLabel: snapshot.dataStatus === 'current' ? '数据已更新' : snapshot.dataStatus === 'stale' ? '数据已过期' : '数据更新中',
    statusTone: snapshot.dataStatus === 'current' ? 'current' : 'stale',
    statusReason: snapshot.statusReason || '请以国家统计局最新发布为准。',
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
      title: '清除本地筛选记录？',
      content: '下次打开首页将恢复默认筛选，公开数据不会被删除。',
      confirmText: '清除',
      success(result) {
        if (!result.confirm) return
        try { wx.removeStorageSync(STORAGE_KEY) } catch (_) {}
        wx.showToast({ title: '已清除', icon: 'success' })
      },
    })
  },
})
