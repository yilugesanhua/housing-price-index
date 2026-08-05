const locationConfig = require('./config/location.js')
const versionConfig = require('./config/version.js')
const { installReleaseUpdatePrompt } = require('./utils/app-update.js')

App({
  onLaunch() {
    console.info(`[70-city] build ${versionConfig.version}; wx-f2 exparser compatibility enabled`)
    if (locationConfig.cloudEnvId && wx.cloud) {
      wx.cloud.init({ env: locationConfig.cloudEnvId, traceUser: false })
    }
    installReleaseUpdatePrompt(wx)
  },
  globalData: {
    dataMode: "bundled-with-remote-updates",
    buildVersion: versionConfig.version,
  },
})
