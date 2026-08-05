import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const { installReleaseUpdatePrompt } = require(resolve(root, 'apps/miniprogram/utils/app-update.js'))

function createWx(envVersion, updateManager, platform = 'ios') {
  const modals = []
  return {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getSystemInfoSync: () => ({ platform }),
    getUpdateManager: () => updateManager,
    showModal: (options) => modals.push(options),
    modals,
  }
}

test('release build prompts and applies a downloaded package only after confirmation', () => {
  let readyHandler
  let failedHandler
  let checkHandler
  let applyCalls = 0
  const manager = {
    onCheckForUpdate: (handler) => { checkHandler = handler },
    onUpdateReady: (handler) => { readyHandler = handler },
    onUpdateFailed: (handler) => { failedHandler = handler },
    applyUpdate: () => { applyCalls += 1 },
  }
  const wxApi = createWx('release', manager)

  assert.equal(installReleaseUpdatePrompt(wxApi), true)
  checkHandler({ hasUpdate: true })
  failedHandler()
  readyHandler()
  assert.equal(wxApi.modals.length, 1)
  assert.equal(wxApi.modals[0].title, '发现新版本')

  wxApi.modals[0].success({ confirm: false })
  assert.equal(applyCalls, 0)
  wxApi.modals[0].success({ confirm: true })
  assert.equal(applyCalls, 1)
})

test('only the Developer Tools simulator may test the update prompt outside release', () => {
  let devToolsCalls = 0
  const devToolsWx = createWx('develop', {
    onUpdateReady() {},
    applyUpdate() {},
  }, 'devtools')
  devToolsWx.getUpdateManager = () => {
    devToolsCalls += 1
    return {
      onUpdateReady() {},
      applyUpdate() {},
    }
  }
  assert.equal(installReleaseUpdatePrompt(devToolsWx), true)
  assert.equal(devToolsCalls, 1)

  for (const [envVersion, platform] of [['develop', 'ios'], ['trial', 'devtools']]) {
    let managerCalls = 0
    const wxApi = createWx(envVersion, {})
    wxApi.getUpdateManager = () => {
      managerCalls += 1
      return {}
    }
    assert.equal(installReleaseUpdatePrompt(wxApi), false)
    assert.equal(managerCalls, 0)
  }
})

test('missing or incomplete update APIs safely keep the current package', () => {
  assert.equal(installReleaseUpdatePrompt(createWx('release', null)), false)
  assert.equal(installReleaseUpdatePrompt({ getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) }), false)
})
