const path = require('path')
const { pathToFileURL } = require('url')
const { app, BrowserWindow } = require('electron')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

async function run() {
  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 600,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  await window.loadURL('data:text/html,<canvas id="pet" width="400" height="600" style="width:400px;height:600px"></canvas>')

  const modulePath = path.resolve(__dirname, '..', 'renderer', 'video-pet-model.js')
  const manifestURL = pathToFileURL(path.resolve(__dirname, '..', 'models', 'deepseek-pet', 'pet.json')).href
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { VideoPetModel } = require(${JSON.stringify(modulePath)})
    const canvas = document.getElementById('pet')
    const model = new VideoPetModel(canvas)
    await model.load(${JSON.stringify(manifestURL)})
    const exactAction = model.previewCatalog().actions.some(action => action.id === 'video:写代码.webm' && action.type === 'video')
    await new Promise(resolve => setTimeout(resolve, 300))
    model.update()
    const countPixels = () => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let visible = 0
      let transparent = 0
      let minY = canvas.height
      let maxY = -1
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 8) {
          visible++
          const y = Math.floor((index / 4) / canvas.width)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        } else transparent++
      }
      return { visible, transparent, centerY: maxY >= minY ? (minY + maxY) / 2 : -1 }
    }
    const initial = countPixels()
    const reactionPromise = model.playReaction('greet')
    model.update()
    const switching = countPixels()
    await reactionPromise
    const reaction = model._currentAnimation
    model.destroy()
    return {
      visible: initial.visible,
      transparent: initial.transparent,
      centerY: initial.centerY,
      visibleDuringSwitch: switching.visible,
      exactAction,
      reaction,
    }
  })()`)

  if (result.visible < 100 || result.transparent < 100 || Math.abs(result.centerY - 300) > 24 || result.visibleDuringSwitch < 100 || !result.exactAction || !result.reaction.includes('元气挥手')) {
    throw new Error(`视频宠物冒烟检查失败：${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify(result))
  window.destroy()
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(error => {
    console.error(error.stack || error.message)
    app.exit(1)
  })
