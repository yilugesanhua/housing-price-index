function isReleaseBuild(wxApi) {
  try {
    return typeof wxApi?.getAccountInfoSync === 'function'
      && wxApi.getAccountInfoSync()?.miniProgram?.envVersion === 'release'
  } catch (_) {
    return false
  }
}

function isDevToolsSimulation(wxApi) {
  try {
    return typeof wxApi?.getAccountInfoSync === 'function'
      && wxApi.getAccountInfoSync()?.miniProgram?.envVersion === 'develop'
      && typeof wxApi?.getSystemInfoSync === 'function'
      && wxApi.getSystemInfoSync()?.platform === 'devtools'
  } catch (_) {
    return false
  }
}

function installReleaseUpdatePrompt(wxApi) {
  if ((!isReleaseBuild(wxApi) && !isDevToolsSimulation(wxApi))
    || typeof wxApi?.getUpdateManager !== 'function') {
    return false
  }

  let updateManager
  try {
    updateManager = wxApi.getUpdateManager()
  } catch (error) {
    console.warn('[70-city] package update manager unavailable', error)
    return false
  }

  if (!updateManager
    || typeof updateManager.onUpdateReady !== 'function'
    || typeof updateManager.applyUpdate !== 'function') {
    return false
  }

  if (typeof updateManager.onCheckForUpdate === 'function') {
    updateManager.onCheckForUpdate((result) => {
      console.info(`[70-city] package update available: ${Boolean(result?.hasUpdate)}`)
    })
  }

  updateManager.onUpdateReady(() => {
    wxApi.showModal({
      title: '发现新版本',
      content: '新版本已准备好。点击“立即更新”后，小程序将重新打开。',
      confirmText: '立即更新',
      cancelText: '稍后',
      success(result) {
        if (result?.confirm) updateManager.applyUpdate()
      },
    })
  })

  if (typeof updateManager.onUpdateFailed === 'function') {
    updateManager.onUpdateFailed(() => {
      console.warn('[70-city] package update download failed; keeping current package')
    })
  }

  return true
}

module.exports = Object.freeze({
  installReleaseUpdatePrompt,
  isDevToolsSimulation,
  isReleaseBuild,
})
