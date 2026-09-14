const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow } = require('electron')
const sharp = require('sharp')
const { createExternalMessageServer } = require('../external-message-server')

app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-companion-external-tester-qa'))

const projectRoot = path.resolve(__dirname, '..')
const outputDirectory = path.join(os.tmpdir(), 'live2d-companion-external-tester-qa-output')

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function alphaAtCssPoints(png, viewport, points) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const scaleX = info.width / viewport.width
  const scaleY = info.height / viewport.height
  const alphaAt = ([x, y]) => {
    const pixelX = Math.min(info.width - 1, Math.max(0, Math.round(x * scaleX)))
    const pixelY = Math.min(info.height - 1, Math.max(0, Math.round(y * scaleY)))
    return data[(pixelY * info.width + pixelX) * 4 + 3]
  }
  return Object.fromEntries(Object.entries(points).map(([name, point]) => [name, alphaAt(point)]))
}

function silentWav() {
  const sampleRate = 8000
  const sampleCount = 800
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

async function waitFor(page, predicate, timeoutMs = 4000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await page.webContents.executeJavaScript(`Boolean(${predicate})`)) return true
    await wait(40)
  }
  return false
}

async function pageSnapshot(page) {
  return page.webContents.executeJavaScript(`(() => {
    const root = document.documentElement
    const shellRect = document.querySelector('.shell').getBoundingClientRect()
    const events = [...document.querySelectorAll('.event')]
    const eventOrder = events.map(item => {
      const group = item.closest('.event-group-card')
      return {
        timestamp: Number(item.dataset.timestamp) || 0,
        sequence: Number(item.dataset.sequence) || 0,
        summary: item.querySelector('.event-main strong')?.textContent || '',
        groupId: item.dataset.groupId || '',
        groupLabel: item.dataset.groupLabel || '',
        groupName: group?.querySelector('.event-group-name')?.textContent || '',
        groupTitle: group?.querySelector('.event-group-header')?.title || '',
        groupOpen: Boolean(group?.open),
        groupBorder: group ? getComputedStyle(group).borderLeftColor : '',
        groupInset: group ? getComputedStyle(group).boxShadow : '',
      }
    })
    const eventGroupCards = [...document.querySelectorAll('.event-group-card')].map(group => {
      const header = group.querySelector('.event-group-header')
      const toggle = group.querySelector('.event-group-toggle')
      const headerStyle = header ? getComputedStyle(header) : null
      const toggleStyle = toggle ? getComputedStyle(toggle) : null
      return {
        requestId: group.dataset.requestId || '',
        transport: group.dataset.transport || '',
        protocolText: group.querySelector('.event-group-protocol')?.textContent || '',
        name: group.querySelector('.event-group-name')?.textContent || '',
        count: group.querySelectorAll('.event').length,
        countText: group.querySelector('.event-group-count')?.textContent || '',
        toggleText: toggle?.textContent || '',
        toggleWidth: toggle?.getBoundingClientRect().width || 0,
        togglePaddingLeft: Number.parseFloat(toggleStyle?.paddingLeft) || 0,
        togglePaddingRight: Number.parseFloat(toggleStyle?.paddingRight) || 0,
        headerPosition: headerStyle?.position || '',
        open: group.open,
        timestamp: Number(group.dataset.timestamp) || 0,
        sequence: Number(group.dataset.sequence) || 0,
        groupBorder: getComputedStyle(group).borderLeftColor,
        groupBorderWidth: getComputedStyle(group).borderLeftWidth,
        groupInset: getComputedStyle(group).boxShadow,
      }
    })
    const eventGroupElements = [...document.querySelectorAll('.event-group-card')]
    const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')]
    const historyTabs = [...document.querySelectorAll('[data-history-type]')]
    const visibleScrollableRegions = [...document.body.querySelectorAll('*')]
      .filter(element => element.offsetParent !== null && element.getClientRects().length > 0)
      .filter(element => !element.closest('details:not([open])'))
      .filter(element => {
        const style = getComputedStyle(element)
        return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1
      })
      .map(element => element.id || element.className || element.tagName)
    const visibleScrollbarRegions = [...document.body.querySelectorAll('*')]
      .filter(element => element.offsetParent !== null && element.getClientRects().length > 0)
      .filter(element => !element.closest('details:not([open])'))
      .filter(element => {
        const style = getComputedStyle(element)
        return (
          (['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
          || (['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
        )
      })
      .filter(element => {
        const scrollbar = getComputedStyle(element, '::-webkit-scrollbar')
        return scrollbar.display !== 'none' && scrollbar.width !== '0px' && scrollbar.height !== '0px'
      })
      .map(element => element.id || element.className || element.tagName)
    return {
      title: document.title,
      language: root.lang,
      windowMode: root.dataset.windowMode,
      windowActionsVisible: document.getElementById('window-actions').offsetParent !== null,
      customHeaderDragRegion: getComputedStyle(document.querySelector('.app-bar')).webkitAppRegion,
      manualWindowDragAvailable: ['startWindowDrag', 'moveWindowDrag', 'endWindowDrag']
        .every(method => typeof window.externalTesterAPI?.[method] === 'function'),
      serviceState: document.getElementById('service-pill').dataset.state,
      serviceStatus: document.getElementById('service-status').textContent,
      websocketStatus: document.getElementById('websocket-status').textContent,
      requestState: document.getElementById('request-state').textContent,
      sendHttpText: document.getElementById('send-http').textContent.trim(),
      sendWebSocketText: document.getElementById('send-websocket').textContent.trim(),
      aiOptionsVisible: document.getElementById('ai-message-options').offsetParent !== null,
      shortcutText: document.querySelector('.shortcut-note').textContent.replace(/\s+/g, ' ').trim(),
      messageContentHeight: document.getElementById('message-content').getBoundingClientRect().height,
      canvasColor: getComputedStyle(root).backgroundColor,
      shellViewportInset: {
        top: shellRect.top,
        right: innerWidth - shellRect.right,
        bottom: innerHeight - shellRect.bottom,
        left: shellRect.left,
      },
      workspaceColumns: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
      activeTab: tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.tab || '',
      tabLabels: tabs.map(tab => tab.textContent.trim()),
      tabHeights: tabs.map(tab => tab.getBoundingClientRect().height),
      historyTabLabels: historyTabs.map(tab => tab.textContent.trim()),
      activeHistoryType: historyTabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.historyType || '',
      visibleTabPanels: [...document.querySelectorAll('[role="tabpanel"]')].filter(panel => !panel.hidden).map(panel => panel.dataset.tabPanel),
      apiReference: document.getElementById('api-reference-title').closest('section').textContent,
      docsLayout: (() => {
        const measure = selector => {
          const element = document.querySelector(selector)
          if (!element) return { top: 0, height: 0, bottom: 0 }
          const rect = element.getBoundingClientRect()
          return { top: rect.top, height: rect.height, bottom: rect.bottom }
        }
        const fitsInside = (child, parent, tolerance = 1.5) => {
          if (!child || !parent) return false
          const childRect = child.getBoundingClientRect()
          const parentRect = parent.getBoundingClientRect()
          const parentStyle = getComputedStyle(parent)
          const contentBox = {
            top: parentRect.top + (Number.parseFloat(parentStyle.paddingTop) || 0),
            right: parentRect.right - (Number.parseFloat(parentStyle.paddingRight) || 0),
            bottom: parentRect.bottom - (Number.parseFloat(parentStyle.paddingBottom) || 0),
            left: parentRect.left + (Number.parseFloat(parentStyle.paddingLeft) || 0),
          }
          return childRect.top >= contentBox.top - tolerance
            && childRect.right <= contentBox.right + tolerance
            && childRect.bottom <= contentBox.bottom + tolerance
            && childRect.left >= contentBox.left - tolerance
        }
        const containmentMargins = (child, parent) => {
          if (!child || !parent) return null
          const childRect = child.getBoundingClientRect()
          const parentRect = parent.getBoundingClientRect()
          const parentStyle = getComputedStyle(parent)
          return {
            top: childRect.top - parentRect.top - (Number.parseFloat(parentStyle.paddingTop) || 0),
            right: parentRect.right - (Number.parseFloat(parentStyle.paddingRight) || 0) - childRect.right,
            bottom: parentRect.bottom - (Number.parseFloat(parentStyle.paddingBottom) || 0) - childRect.bottom,
            left: childRect.left - parentRect.left - (Number.parseFloat(parentStyle.paddingLeft) || 0),
          }
        }
        const code = document.querySelector('.code-sample')
        const codeBody = code?.querySelector(':scope > code')
        const codeLines = code ? [...code.querySelectorAll('.code-line')] : []
        const lastCodeLine = codeLines.at(-1)
        const codeStyle = codeBody ? getComputedStyle(codeBody) : null
        const endpoints = document.querySelector('[data-reference="endpoints"]')
        const endpointItems = endpoints ? [...endpoints.querySelectorAll('.endpoint')] : []
        const endpointCodes = endpointItems.map(item => item.querySelector('code')).filter(Boolean)
        const parameters = document.querySelector('[data-reference="parameters"]')
        const parameterRows = parameters ? [...parameters.querySelectorAll('tbody tr')] : []
        const parameterCells = parameterRows.flatMap(row => [...row.cells])
        const sample = document.querySelector('[data-reference="sample"]')
        const websocket = document.querySelector('[data-reference="websocket"]')
        const websocketText = websocket?.querySelector('p')
        const history = document.querySelector('[data-reference="history"]')
        const historyText = history?.querySelector('p')
        const note = document.querySelector('.behavior-note')
        const noteText = note?.querySelector('span')
        const guideArticles = [...document.querySelectorAll('.guide-grid article')]
        return {
          gridRows: getComputedStyle(document.getElementById('tab-docs')).gridTemplateRows,
          bodyRows: getComputedStyle(document.querySelector('.reference-body')).gridTemplateRows,
          bodyGap: getComputedStyle(document.querySelector('.reference-body')).gap,
          guide: measure('.guide'),
          referenceBody: measure('.reference-body'),
          endpoints: measure('[data-reference="endpoints"]'),
          sample: measure('[data-reference="sample"]'),
          code: measure('.code-sample'),
          codeClientHeight: code?.clientHeight || 0,
          codeScrollHeight: code?.scrollHeight || 0,
          codeFontSize: codeStyle?.fontSize || '',
          codeLineHeight: codeStyle?.lineHeight || '',
          codeLineCount: codeLines.length,
          lastCodeLineBottom: lastCodeLine?.getBoundingClientRect().bottom || 0,
          codeContentBottom: code ? code.getBoundingClientRect().bottom - parseFloat(getComputedStyle(code).paddingBottom) : 0,
          websocket: measure('[data-reference="websocket"]'),
          note: measure('.behavior-note'),
          contentFits: {
            guideSteps: guideArticles.length === 3 && guideArticles.every(article => {
              const copy = article.querySelector(':scope > div')
              return fitsInside(copy, article)
                && copy.scrollWidth <= copy.clientWidth + 1
                && copy.scrollHeight <= copy.clientHeight + 1
            }),
            endpoints: endpointItems.length === 7
              && fitsInside(endpointItems.at(-1), endpoints)
              && endpointCodes.every(item => item.scrollWidth <= item.clientWidth + 1),
            parameters: parameterRows.length === 7
              && fitsInside(parameterRows.at(-1), parameters)
              && parameterCells.every(cell => cell.scrollWidth <= cell.clientWidth + 1
                && cell.scrollHeight <= cell.clientHeight + 1),
            sample: codeLines.length === 9
              && fitsInside(code, sample)
              && code.scrollWidth <= code.clientWidth + 1
              && code.scrollHeight <= code.clientHeight + 1,
            websocket: fitsInside(websocketText, websocket),
            history: fitsInside(historyText, history),
            note: fitsInside(noteText, note)
              && noteText.scrollWidth <= noteText.clientWidth + 1
              && noteText.scrollHeight <= noteText.clientHeight + 1,
          },
          contentMargins: {
            endpoints: containmentMargins(endpointItems.at(-1), endpoints),
            parameters: containmentMargins(parameterRows.at(-1), parameters),
            sample: containmentMargins(code, sample),
            websocket: containmentMargins(websocketText, websocket),
            history: containmentMargins(historyText, history),
            note: containmentMargins(noteText, note),
          },
          endpointTexts: endpointCodes.map(item => item.textContent),
        }
      })(),
      historyStatus: document.getElementById('history-status').textContent,
      historyText: document.getElementById('history-list').textContent,
      historyItemCount: document.querySelectorAll('#history-list .history-item').length,
      historyCardsKeepNaturalHeight: [...document.querySelectorAll('#history-list .history-item')]
        .every(item => item.scrollHeight <= item.clientHeight + 1),
      historyPaginationVisible: document.getElementById('history-pagination').offsetParent !== null,
      historyPageSummary: document.getElementById('history-page-summary').textContent,
      historyPageSize: document.getElementById('history-page-size').value,
      historyCurrentPage: document.querySelector('#history-pages [aria-current="page"]')?.textContent || '',
      historyPageNumbers: [...document.querySelectorAll('#history-pages .pagination-page')].map(button => button.textContent),
      historyPreviousDisabled: document.getElementById('history-page-previous').disabled,
      historyNextDisabled: document.getElementById('history-page-next').disabled,
      historyAudioCount: document.querySelectorAll('#history-list audio').length,
      historyAudioReady: [...document.querySelectorAll('#history-list audio')].every(audio => audio.readyState >= 1),
      historyRequestDetails: [...document.querySelectorAll('#history-list .history-data summary')].filter(item => item.textContent === '完整请求').length,
      historyResponseDetails: [...document.querySelectorAll('#history-list .history-data summary')].filter(item => item.textContent === '完整响应').length,
      historySearchValue: document.getElementById('history-search').value,
      eventCount: events.length,
      eventText: events.map(item => item.textContent).join(' '),
      eventOrder,
      eventGroupCards,
      eventGroupsDoNotOverlap: eventGroupElements.every((group, index) => {
        const next = eventGroupElements[index + 1]
        return !next || group.getBoundingClientRect().bottom <= next.getBoundingClientRect().top + 1
      }),
      eventGroupsContainChildren: eventGroupElements.every(group => {
        if (!group.open) return true
        const events = [...group.querySelectorAll(':scope > .event-group-events > .event')]
        const last = events.at(-1)
        return !last || last.getBoundingClientRect().bottom <= group.getBoundingClientRect().bottom + 1
      }),
      eventsNewestFirst: eventOrder.every((entry, index) => {
        if (index === 0) return true
        const previous = eventOrder[index - 1]
        return previous.timestamp > entry.timestamp
          || (previous.timestamp === entry.timestamp && previous.sequence > entry.sequence)
      }),
      eventPayloadsAreCollapsed: [...document.querySelectorAll('.event-detail')].length > 0
        && [...document.querySelectorAll('.event-detail')].every(detail => !detail.open),
      visibleScrollableRegions,
      visibleScrollbarRegions,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      unnamedButtons: [...document.querySelectorAll('button')]
        .filter(button => !(button.innerText || button.getAttribute('aria-label') || button.title || '').trim())
        .length,
      unlabeledFields: [...document.querySelectorAll('input,textarea,select')]
        .filter(field => !field.labels.length && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby'))
        .length,
    }
  })()`)
}

async function longTextLayoutProbe(page) {
  return page.webContents.executeJavaScript(`(() => {
    const longTitle = '超长发送方与事件标题需要完整显示'.repeat(12)
    const longRequestId = 'tester-' + 'abcdef0123456789'.repeat(8)
    const fits = element => element
      && element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    const wraps = element => {
      if (!element) return false
      const style = getComputedStyle(element)
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.35
      return style.whiteSpace !== 'nowrap'
        && style.textOverflow !== 'ellipsis'
        && element.getBoundingClientRect().height >= lineHeight * 1.8
    }
    const mountClone = (source, width) => {
      if (!source) return null
      const clone = source.cloneNode(true)
      clone.style.cssText = 'position:fixed;left:-5000px;top:0;visibility:hidden;width:' + width + 'px;height:auto;max-height:none;'
      document.body.append(clone)
      return clone
    }

    const eventClone = mountClone(document.querySelector('.event'), 360)
    const eventTitle = eventClone?.querySelector('.event-main strong')
    if (eventTitle) eventTitle.textContent = longTitle

    const groupClone = mountClone(document.querySelector('.event-group-card'), 380)
    if (groupClone) groupClone.open = false
    const groupName = groupClone?.querySelector('.event-group-name')
    if (groupName) groupName.textContent = longTitle

    const historyClone = mountClone(document.querySelector('.history-item'), 800)
    const historyTitle = historyClone?.querySelector(':scope > header strong')
    if (historyTitle) historyTitle.textContent = longTitle
    const historyMeta = historyClone?.querySelector('.history-meta span')
    if (historyMeta) historyMeta.textContent = longRequestId

    const result = {
      eventTitleWraps: wraps(eventTitle),
      eventTitleFits: fits(eventTitle) && fits(eventClone),
      groupNameWraps: wraps(groupName),
      groupHeaderFits: fits(groupName) && fits(groupClone?.querySelector('.event-group-header')),
      historyTitleWraps: wraps(historyTitle),
      historyTitleFits: fits(historyTitle) && fits(historyClone?.querySelector(':scope > header')),
      longRequestIdFits: fits(historyMeta) && fits(historyClone),
    }

    eventClone?.remove()
    groupClone?.remove()
    historyClone?.remove()
    return result
  })()`)
}

async function externalHistoryMessageSnapshot(page) {
  return page.webContents.executeJavaScript(`(() => {
    const toggles = [...document.querySelectorAll('#history-list .history-message-toggle')]
    const toggle = toggles.find(item => !item.hidden)
    const row = toggle?.closest('.history-message')
    const content = row?.querySelector('.history-message-content p')
    const article = row?.closest('.history-item')
    const style = content ? getComputedStyle(content) : null
    const rect = content?.getBoundingClientRect()
    return {
      externalMessageCount: toggles.length,
      visibleToggleCount: toggles.filter(item => !item.hidden).length,
      hiddenToggleCount: toggles.filter(item => item.hidden).length,
      toggleText: toggle?.textContent || '',
      toggleExpanded: toggle?.getAttribute('aria-expanded') || '',
      rowExpanded: row?.dataset.expanded || '',
      contentText: content?.textContent || '',
      contentTitle: content?.title || '',
      contentTop: rect?.top || 0,
      contentBottom: rect?.bottom || 0,
      contentHeight: rect?.height || 0,
      contentClientWidth: content?.clientWidth || 0,
      contentScrollWidth: content?.scrollWidth || 0,
      articleHeight: article?.getBoundingClientRect().height || 0,
      lineHeight: Number.parseFloat(style?.lineHeight) || 0,
      whiteSpace: style?.whiteSpace || '',
      overflowX: style?.overflowX || '',
    }
  })()`)
}

async function run() {
  await app.whenReady()
  fs.mkdirSync(outputDirectory, { recursive: true })
  const port = 36000 + Math.floor(Math.random() * 2000)
  const handled = []
  const history = []
  const audioMessageIds = new Set()
  const audioPath = path.join(outputDirectory, 'history-audio.wav')
  const longHistoryContent = '这是一条用于验证外部消息单行折叠、完整悬停提示以及向下展开行为的长消息。'.repeat(12)
  fs.writeFileSync(audioPath, silentWav())
  for (let index = 1; index <= 20; index += 1) {
    const type = index <= 12 ? 'direct' : 'relay'
    const sequence = String(index).padStart(2, '0')
    const messageId = `history-seed-${sequence}`
    const requestId = `history-seed-request-${sequence}`
    const receivedAt = new Date(Date.now() - (21 - index) * 60000).toISOString()
    const content = index === 12
      ? longHistoryContent
      : `${type === 'relay' ? 'AI问答' : '直连消息'}分页样例 ${sequence}`
    const result = {
      text: type === 'relay' ? `桌宠回答：${content}` : content,
      emotion: type === 'relay' ? 'happy' : '',
      aiGenerated: type === 'relay',
      speech: { requested: false, status: 'disabled' },
    }
    const request = {
      messageId,
      requestId,
      source: 'external',
      sourceLabel: '外部',
      sender: '分页验收数据',
      type,
      content,
      speak: false,
      useCurrentCharacterProfile: true,
      useExternalContext: true,
      receivedAt,
    }
    history.push({
      ...request,
      status: 'completed',
      request,
      response: {
        ok: true,
        requestId,
        messageId,
        source: 'external',
        sourceLabel: '外部',
        sender: request.sender,
        type,
        result,
        receivedAt,
        completedAt: receivedAt,
      },
      result,
      conversation: [
        { role: 'external', label: '外部消息', content, at: receivedAt },
        ...(type === 'relay'
          ? [{ role: 'assistant', label: 'AI 回复', content: result.text, at: receivedAt }]
          : []),
      ],
      completedAt: receivedAt,
    })
  }
  let service
  service = createExternalMessageServer({
    port,
    testerPath: path.join(projectRoot, 'renderer', 'external-message-tester.html'),
    handleMessage: async message => {
      handled.push(message)
      service.broadcast({ phase: 'received', message })
      await wait(20)
      const completedAt = new Date().toISOString()
      const speech = {
        requested: message.speak,
        status: message.speak ? 'ready' : 'disabled',
        ...(message.speak
          ? { mimeType: 'audio/wav', cached: false, audioUrl: `/api/v1/history/audio/${encodeURIComponent(message.id)}` }
          : {}),
      }
      const result = {
        text: message.type === 'relay' ? `桌宠回答：${message.content}` : message.content,
        emotion: message.type === 'relay' ? 'happy' : '',
        aiGenerated: message.type === 'relay',
        speech,
      }
      const request = {
        messageId: message.id,
        requestId: message.requestId,
        source: 'external',
        sourceLabel: '外部',
        sender: message.sender,
        type: message.type,
        content: message.content,
        speak: message.speak,
        useCurrentCharacterProfile: message.useCurrentCharacterProfile,
        useExternalContext: message.useExternalContext,
        receivedAt: message.receivedAt,
      }
      const response = {
        ok: true,
        requestId: message.requestId,
        messageId: message.id,
        source: 'external',
        sourceLabel: '外部',
        sender: message.sender,
        type: message.type,
        result,
        receivedAt: message.receivedAt,
        completedAt,
      }
      history.push({
        ...request,
        status: 'completed',
        request,
        response,
        result,
        conversation: [
          { role: 'external', label: '外部消息', content: message.content, at: message.receivedAt },
          ...(message.type === 'relay'
            ? [{ role: 'assistant', label: 'AI 回复', content: result.text, at: completedAt }]
            : []),
        ],
        completedAt,
      })
      if (message.speak) audioMessageIds.add(message.id)
      service.broadcast({ phase: 'completed', message, result })
      return response
    },
    getHistory: ({ limit }) => history.slice(-limit).reverse(),
    getHistoryAudio: messageId => audioMessageIds.has(messageId)
      ? { filePath: audioPath, mimeType: 'audio/wav' }
      : null,
    clearHistory: () => {
      history.length = 0
      return []
    },
    logger: { warn() {} },
  })

  const consoleProblems = []
  let page
  try {
    const started = await service.setEnabled(true)
    assert.equal(started.running, true)
    page = new BrowserWindow({
      width: 860,
      height: 760,
      show: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(projectRoot, 'external-message-tester-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    page.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) consoleProblems.push({ level, message, line, sourceId })
    })
    await page.loadURL(started.testerUrl)
    assert.equal(await waitFor(page, `document.getElementById('service-pill').dataset.state === 'online'`), true)
    assert.equal(await waitFor(page, `document.getElementById('websocket-status').textContent.includes('已连接')`), true)
    const speechDefaultDisabled = await page.webContents.executeJavaScript(`document.getElementById('message-speak').checked === false`)

    const servicePillStability = await page.webContents.executeJavaScript(`(async () => {
      const pill = document.getElementById('service-pill')
      const status = document.getElementById('service-status')
      const button = document.getElementById('check-service')
      const measure = () => pill.getBoundingClientRect().width
      const onlineWidth = measure()
      const onlineTextFits = status.scrollWidth <= status.clientWidth
      button.click()
      const checkingWidth = measure()
      const returnedOnline = await new Promise(resolve => {
        const startedAt = performance.now()
        const inspect = () => {
          if (pill.dataset.state === 'online') return resolve(true)
          if (performance.now() - startedAt >= 4000) return resolve(false)
          setTimeout(inspect, 20)
        }
        inspect()
      })
      const refreshedWidth = measure()
      const onlineText = status.textContent
      const onlineTitle = status.title
      const largeQueueText = '服务运行中 · 队列 999999999999999999999999'
      status.textContent = largeQueueText
      status.title = largeQueueText
      const largeQueueWidth = measure()
      const largeQueueClipped = status.scrollWidth > status.clientWidth
      status.textContent = onlineText
      status.title = onlineTitle
      return {
        returnedOnline,
        widths: [onlineWidth, checkingWidth, refreshedWidth, largeQueueWidth],
        onlineTextFits,
        largeQueueClipped,
      }
    })()`)

    const iconAudit = await page.webContents.executeJavaScript(`(() => {
      const requiredSymbols = [
        'plane', 'clock', 'book', 'chat-dots', 'paw', 'link', 'link-off', 'trash',
        'cube', 'message-box', 'user', 'hash', 'mic', 'sparkles', 'wifi', 'refresh',
        'check-circle', 'search', 'copy', 'tools', 'shield', 'play', 'broadcast',
        'document', 'info', 'chevron-down', 'chevron-right', 'plus', 'minus', 'cat',
      ]
      const icons = [...document.querySelectorAll('svg:not(.svg-defs)')]
      const uses = [...document.querySelectorAll('svg:not(.svg-defs) use')]
      const unresolvedUses = uses
        .map(use => use.getAttribute('href') || use.getAttribute('xlink:href') || '')
        .filter(href => !href.startsWith('#') || !document.querySelector(href))
      const geometrySelector = 'use, path, circle, ellipse, line, polyline, polygon, rect'
      const emptyIcons = icons.filter(icon => !icon.querySelector(geometrySelector))
      const headerArt = document.querySelector('.header-art img')
      return {
        symbolCount: document.querySelectorAll('.svg-defs symbol').length,
        requiredSymbolCount: requiredSymbols.length,
        missingSymbols: requiredSymbols.filter(name => !document.getElementById('icon-' + name)),
        iconCount: icons.length,
        useCount: uses.length,
        unresolvedUses,
        emptyIconCount: emptyIcons.length,
        headerArtLoaded: Boolean(headerArt && headerArt.complete && headerArt.naturalWidth > 0 && headerArt.naturalHeight > 0),
        headerArtSize: headerArt ? [headerArt.naturalWidth, headerArt.naturalHeight] : [0, 0],
      }
    })()`)

    const iconSource = [
      fs.readFileSync(path.join(projectRoot, 'renderer', 'external-message-tester.html'), 'utf8'),
      fs.readFileSync(path.join(projectRoot, 'renderer', 'external-message-tester-redesign.css'), 'utf8'),
    ].join('\n')
    const forbiddenPlaceholderGlyphs = ['↗', '◇', '▤', '●', '➤', '✦', '♩', '▣', '•••']
    const sourceIconAudit = {
      forbiddenPlaceholderGlyphs: forbiddenPlaceholderGlyphs.filter(glyph => iconSource.includes(glyph)),
    }

    page.webContents.invalidate()
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await wait(420)
    const shellEdgeLayout = await page.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.shell').getBoundingClientRect()
      const request = document.querySelector('.request-panel').getBoundingClientRect()
      const log = document.querySelector('.log-panel').getBoundingClientRect()
      const appBar = document.querySelector('.app-bar').getBoundingClientRect()
      const tabBar = document.querySelector('.tab-bar').getBoundingClientRect()
      return {
        viewport: { width: innerWidth, height: innerHeight },
        points: {
          topLeftCorner: [2, 2],
          topRightCorner: [innerWidth - 3, 2],
          bottomLeftCorner: [2, innerHeight - 3],
          bottomRightCorner: [innerWidth - 3, innerHeight - 3],
          topGutter: [shell.left + shell.width / 2, 2],
          leftGutter: [5, request.top + request.height / 2],
          rightGutter: [innerWidth - 6, log.top + log.height / 2],
          bottomGutter: [request.left + 24, (request.bottom + innerHeight) / 2],
          headerSurface: [appBar.left + 24, appBar.top + appBar.height / 2],
          panelSurface: [log.left + log.width / 2, log.top + log.height * .72],
          headerTabGap: [appBar.left + appBar.width / 2, (appBar.bottom + tabBar.top) / 2],
          tabWorkspaceGap: [tabBar.left + tabBar.width / 2, (tabBar.bottom + request.top) / 2],
          panelGap: [(request.right + log.left) / 2, request.top + request.height / 2],
        },
      }
    })()`)
    const initialScreenshot = path.join(outputDirectory, 'external-message-tester-reference-state.png')
    const initialScreenshotBuffer = (await page.capturePage()).toPNG()
    const shellEdgeAlpha = await alphaAtCssPoints(
      initialScreenshotBuffer,
      shellEdgeLayout.viewport,
      shellEdgeLayout.points
    )
    fs.writeFileSync(initialScreenshot, initialScreenshotBuffer)
    await page.webContents.executeJavaScript(`document.querySelector('[data-tab="docs"]').click()`)
    assert.equal(await waitFor(page, `
      document.querySelector('[data-tab-panel="docs"]').hidden === false
      && document.querySelector('[data-tab-panel="debug"]').hidden === true
      && document.querySelector('[data-tab="docs"]').getAttribute('aria-selected') === 'true'
    `), true)
    page.webContents.invalidate()
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await wait(220)
    const docsReferenceStateSnapshot = await pageSnapshot(page)
    const docsReferenceScreenshot = path.join(outputDirectory, 'external-message-tester-docs-reference-state.png')
    const docsReferenceScreenshotBuffer = (await page.capturePage()).toPNG()
    assert.equal(initialScreenshotBuffer.equals(docsReferenceScreenshotBuffer), false)
    fs.writeFileSync(docsReferenceScreenshot, docsReferenceScreenshotBuffer)
    await page.webContents.executeJavaScript(`document.querySelector('[data-tab="debug"]').click()`)
    assert.equal(await waitFor(page, `
      document.querySelector('[data-tab-panel="debug"]').hidden === false
      && document.querySelector('[data-tab-panel="docs"]').hidden === true
      && document.querySelector('[data-tab="debug"]').getAttribute('aria-selected') === 'true'
    `), true)

    const aiOptionsByMode = await page.webContents.executeJavaScript(`(() => {
      const options = document.getElementById('ai-message-options')
      const direct = document.querySelector('#message-type [data-value="direct"]')
      const relay = document.querySelector('#message-type [data-value="relay"]')
      const initialDirectHidden = options.offsetParent === null
      relay.click()
      const relayVisible = options.offsetParent !== null
      direct.click()
      const directHiddenAgain = options.offsetParent === null
      return { initialDirectHidden, relayVisible, directHiddenAgain }
    })()`)

    await page.webContents.executeJavaScript(`(() => {
      document.getElementById('message-content').value = 'HTTP 直接消息联调'
      document.getElementById('message-sender').value = 'QA 日程系统'
      document.getElementById('request-id').value = 'tester-http-direct-1'
      document.getElementById('message-speak').checked = true
      document.getElementById('use-character-profile').checked = false
      document.getElementById('use-external-context').checked = false
      document.getElementById('send-http').click()
    })()`)
    assert.equal(await waitFor(page, `document.getElementById('request-state').textContent === '已完成'`), true)
    assert.equal(await waitFor(page, `document.getElementById('event-log').textContent.includes('HTTP 直接消息联调')`), true)

    await page.webContents.executeJavaScript(`(() => {
      document.querySelector('#message-type [data-value="relay"]').click()
      document.getElementById('message-content').value = 'WebSocket AI问答消息联调'
      document.getElementById('request-id').value = 'tester-ws-relay-1'
      document.getElementById('message-speak').checked = false
      document.getElementById('use-character-profile').checked = true
      document.getElementById('use-external-context').checked = true
      document.getElementById('send-websocket').click()
    })()`)
    assert.equal(await waitFor(page, `document.getElementById('event-log').textContent.includes('桌宠回答：WebSocket AI问答消息联调')`), true)

    await page.webContents.executeJavaScript(`(() => {
      document.querySelector('#message-type [data-value="direct"]').click()
      document.getElementById('message-content').value = 'HTTP 快捷键联调'
      document.getElementById('request-id').value = 'tester-http-shortcut-1'
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })()`)
    assert.equal(await waitFor(page, `document.getElementById('event-log').textContent.includes('HTTP 快捷键联调')`), true)
    assert.equal(await waitFor(page, `document.getElementById('request-state').textContent === '已完成'`), true)

    await page.webContents.executeJavaScript(`(() => {
      document.querySelector('#message-type [data-value="relay"]').click()
      document.getElementById('message-content').value = 'WebSocket 快捷键联调'
      document.getElementById('request-id').value = 'tester-ws-shortcut-1'
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })()`)
    assert.equal(await waitFor(page, `document.getElementById('event-log').textContent.includes('桌宠回答：WebSocket 快捷键联调')`), true)

    const fixedEventTime = Date.now() + 60000
    await page.webContents.executeJavaScript(`(() => {
      window.__externalTesterOriginalDateNow = Date.now
      Date.now = () => ${fixedEventTime}
    })()`)
    service.broadcast({ phase: 'received', message: { requestId: 'tester-same-time-order-1', type: 'direct', content: '同时间排序 A', sender: '排序测试' } })
    service.broadcast({ phase: 'received', message: { requestId: 'tester-same-time-order-1', type: 'direct', content: '同时间排序 B', sender: '排序测试' } })
    assert.equal(await waitFor(page, `document.getElementById('event-log').textContent.includes('同时间排序 B')`), true)
    await page.webContents.executeJavaScript(`(() => {
      Date.now = window.__externalTesterOriginalDateNow
      delete window.__externalTesterOriginalDateNow
    })()`)

    page.webContents.invalidate()
    await wait(180)
    const desktop = await pageSnapshot(page)
    const desktopScreenshot = path.join(outputDirectory, 'external-message-tester-desktop.png')
    fs.writeFileSync(desktopScreenshot, (await page.capturePage()).toPNG())

    const collapsedProtocolStyles = await page.webContents.executeJavaScript(`(() => {
      const groups = [...document.querySelectorAll('.event-group-card')]
      const openStates = groups.map(group => group.open)
      groups.forEach(group => { group.open = false })
      const styles = groups.map(group => {
        const header = group.querySelector('.event-group-header')
        const name = group.querySelector('.event-group-name')
        return {
          transport: group.dataset.transport || '',
          protocolText: group.querySelector('.event-group-protocol')?.textContent || '',
          backgroundColor: getComputedStyle(header).backgroundColor,
          nameColor: getComputedStyle(name).color,
        }
      })
      groups.forEach((group, index) => { group.open = openStates[index] })
      return styles
    })()`)

    await page.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      group.open = false
    })()`)
    service.broadcast({
      phase: 'received',
      message: {
        requestId: 'tester-ws-relay-1',
        type: 'relay',
        content: '折叠状态下收到的新事件',
        sender: '折叠测试',
      },
    })
    assert.equal(await waitFor(page, `(() => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      return !group.open && group.querySelectorAll('.event').length === 5
    })()`), true)
    page.webContents.invalidate()
    await wait(180)
    const collapsedGroup = await page.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      const event = group.querySelector('.event')
      return {
        open: group.open,
        name: group.querySelector('.event-group-name').textContent,
        count: group.querySelector('.event-group-count').textContent,
        toggle: group.querySelector('.event-group-toggle').textContent,
        eventVisible: event.offsetParent !== null,
        borderColor: getComputedStyle(group).borderLeftColor,
        borderWidth: getComputedStyle(group).borderLeftWidth,
        boxShadow: getComputedStyle(group).boxShadow,
      }
    })()`)
    const collapsedGroupScreenshot = path.join(outputDirectory, 'external-message-tester-group-collapsed.png')
    fs.writeFileSync(collapsedGroupScreenshot, (await page.capturePage()).toPNG())
    await page.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      group.open = true
    })()`)

    const eventDataExpanded = await page.webContents.executeJavaScript(`(() => new Promise(resolve => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      const detail = [...group.querySelectorAll('.event-detail')]
        .find(item => item.querySelector('pre')?.textContent.includes('useExternalContext'))
      detail.open = true
      setTimeout(() => {
        const payload = detail.querySelector('pre')
        const logRect = document.getElementById('event-log').getBoundingClientRect()
        const detailRect = detail.getBoundingClientRect()
        const style = getComputedStyle(payload)
        const scrollbarStyle = getComputedStyle(payload, '::-webkit-scrollbar')
        const text = payload.textContent.trim()
        const hasVerticalOverflow = payload.scrollHeight > payload.clientHeight + 1
        payload.scrollTop = payload.scrollHeight
        const payloadScrollPositionChanges = !hasVerticalOverflow || payload.scrollTop > 0
        payload.scrollTop = 0
        resolve({
          payloadComplete: text.startsWith('{') && text.endsWith('}')
            && text.includes('useExternalContext') && text.includes('tester-ws-relay-1'),
          payloadScrollableWhenNeeded: payload.scrollHeight <= payload.clientHeight + 1
            || (['auto', 'scroll'].includes(style.overflowY) && payloadScrollPositionChanges),
          payloadScrollbarHidden: style.scrollbarWidth === 'none'
            && scrollbarStyle.display === 'none'
            && scrollbarStyle.width === '0px',
          payloadHasNoHorizontalClipping: payload.scrollWidth <= payload.clientWidth + 1,
          detailInsideLogViewport: detailRect.bottom <= logRect.bottom + 2 && detailRect.top >= logRect.top - 2,
          detailTop: detailRect.top,
          detailBottom: detailRect.bottom,
          logTop: logRect.top,
          logBottom: logRect.bottom,
          payloadClientHeight: payload.clientHeight,
          payloadScrollHeight: payload.scrollHeight,
          groupBorderColor: getComputedStyle(group).borderLeftColor,
          groupBorderWidth: getComputedStyle(group).borderLeftWidth,
          groupBoxShadow: getComputedStyle(group).boxShadow,
        })
      }, 160)
    }))()`)
    page.webContents.invalidate()
    await wait(120)
    const expandedDataScreenshot = path.join(outputDirectory, 'external-message-tester-event-data-expanded.png')
    fs.writeFileSync(expandedDataScreenshot, (await page.capturePage()).toPNG())
    await page.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.event-group-card')]
        .find(item => item.dataset.requestId === 'tester-ws-relay-1')
      const detail = [...group.querySelectorAll('.event-detail')]
        .find(item => item.open)
      if (detail) detail.open = false
      document.getElementById('event-log').scrollTop = 0
    })()`)

    await page.webContents.executeJavaScript(`document.querySelector('[data-tab="history"]').click()`)
    assert.equal(await waitFor(page, `document.querySelector('[data-tab-panel="history"]').hidden === false`), true)
    assert.equal(await waitFor(page, `document.querySelector('#history-list audio')?.readyState >= 1`), true)
    assert.equal(await waitFor(page, `[...document.querySelectorAll('#history-list .history-message-toggle')].some(button => !button.hidden)`), true)
    page.webContents.invalidate()
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await wait(300)
    const collapsedExternalHistoryMessage = await externalHistoryMessageSnapshot(page)
    await page.webContents.executeJavaScript(`[...document.querySelectorAll('#history-list .history-message-toggle')].find(button => !button.hidden).click()`)
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    const expandedExternalHistoryMessage = await externalHistoryMessageSnapshot(page)
    const expandedHistoryMessageScreenshot = path.join(outputDirectory, 'external-message-tester-history-message-expanded.png')
    fs.writeFileSync(expandedHistoryMessageScreenshot, (await page.capturePage()).toPNG())
    await page.webContents.executeJavaScript(`[...document.querySelectorAll('#history-list .history-message-toggle')].find(button => !button.hidden).click()`)
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    const recollapsedExternalHistoryMessage = await externalHistoryMessageSnapshot(page)
    const historyTab = await pageSnapshot(page)
    const historyScreenshot = path.join(outputDirectory, 'external-message-tester-history.png')
    fs.writeFileSync(historyScreenshot, (await page.capturePage()).toPNG())
    const longTextLayout = await longTextLayoutProbe(page)

    await page.webContents.executeJavaScript(`document.getElementById('history-page-next').click()`)
    const historySecondPage = await pageSnapshot(page)
    const historySecondPageScreenshot = path.join(outputDirectory, 'external-message-tester-history-page-2.png')
    fs.writeFileSync(historySecondPageScreenshot, (await page.capturePage()).toPNG())

    page.setSize(390, 844)
    page.webContents.invalidate()
    await wait(160)
    const mobileHistory = await pageSnapshot(page)
    const mobileHistoryScreenshot = path.join(outputDirectory, 'external-message-tester-history-mobile.png')
    fs.writeFileSync(mobileHistoryScreenshot, (await page.capturePage()).toPNG())
    page.setSize(860, 760)
    page.webContents.invalidate()
    await wait(160)

    await page.webContents.executeJavaScript(`(() => {
      const select = document.getElementById('history-page-size')
      select.value = '10'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    const historyTenPerPage = await pageSnapshot(page)
    await page.webContents.executeJavaScript(`(() => {
      const select = document.getElementById('history-page-size')
      select.value = '5'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)

    await page.webContents.executeJavaScript(`document.querySelector('[data-history-type="relay"]').click()`)
    assert.equal(await waitFor(page, `document.getElementById('history-list').textContent.includes('WebSocket AI问答消息联调')`), true)
    const aiHistoryTab = await pageSnapshot(page)
    const aiHistoryScreenshot = path.join(outputDirectory, 'external-message-tester-history-ai.png')
    fs.writeFileSync(aiHistoryScreenshot, (await page.capturePage()).toPNG())

    await page.webContents.executeJavaScript(`(() => {
      const search = document.getElementById('history-search')
      search.value = '快捷键'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    const searchedHistory = await pageSnapshot(page)
    await page.webContents.executeJavaScript(`document.getElementById('clear-history-search').click()`)

    await page.webContents.executeJavaScript(`document.querySelector('[data-tab="docs"]').click()`)
    assert.equal(await waitFor(page, `document.querySelector('[data-tab-panel="docs"]').hidden === false`), true)
    page.webContents.invalidate()
    await page.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await wait(300)
    const docsTab = await pageSnapshot(page)
    const docsScreenshot = path.join(outputDirectory, 'external-message-tester-docs.png')
    fs.writeFileSync(docsScreenshot, (await page.capturePage()).toPNG())

    await page.webContents.executeJavaScript(`document.querySelector('[data-tab="debug"]').click()`)
    page.setSize(390, 844)
    page.webContents.invalidate()
    await wait(160)
    const mobile = await pageSnapshot(page)
    const mobileScreenshot = path.join(outputDirectory, 'external-message-tester-mobile.png')
    fs.writeFileSync(mobileScreenshot, (await page.capturePage()).toPNG())

    const assertions = {
      semanticDocument: desktop.title.includes('外部消息测试台') && desktop.language === 'zh-CN',
      customElectronHeader: desktop.windowMode === 'electron'
        && desktop.windowActionsVisible
        && desktop.customHeaderDragRegion === 'no-drag'
        && desktop.manualWindowDragAvailable,
      serviceDetected: desktop.serviceState === 'online' && desktop.serviceStatus.includes('服务运行中'),
      servicePillWidthIsStable: servicePillStability.returnedOnline
        && Math.max(...servicePillStability.widths) - Math.min(...servicePillStability.widths) <= 0.5
        && servicePillStability.onlineTextFits
        && servicePillStability.largeQueueClipped,
      websocketConnected: desktop.websocketStatus.includes('已连接'),
      directHttpCompleted: handled[0]?.requestId === 'tester-http-direct-1'
        && desktop.eventText.includes('HTTP 直接消息联调'),
      relayWebSocketCompleted: desktop.eventText.includes('桌宠回答：WebSocket AI问答消息联调'),
      shortcutLabelsVisible: desktop.sendHttpText.includes('HTTP 发送')
        && !desktop.sendHttpText.includes('POST 发送')
        && desktop.sendWebSocketText.includes('WebSocket 发送')
        && desktop.shortcutText.includes('Ctrl + Enter 快速执行 HTTP 请求')
        && desktop.shortcutText.includes('Alt + Enter 快速执行 WebSocket 请求'),
      topTabsShareOneHeight: desktop.tabHeights.length === 3
        && Math.max(...desktop.tabHeights) - Math.min(...desktop.tabHeights) <= 0.5,
      httpShortcutCompleted: handled.some(item => item.requestId === 'tester-http-shortcut-1')
        && desktop.eventText.includes('HTTP 快捷键联调'),
      websocketShortcutCompleted: handled.some(item => item.requestId === 'tester-ws-shortcut-1')
        && desktop.eventText.includes('桌宠回答：WebSocket 快捷键联调'),
      eventsSortedNewestFirst: desktop.eventsNewestFirst
        && desktop.eventOrder[0].summary === '同时间排序 B'
        && desktop.eventOrder[1].summary === '同时间排序 A'
        && desktop.eventOrder[0].timestamp === desktop.eventOrder[1].timestamp
        && desktop.eventOrder[0].sequence > desktop.eventOrder[1].sequence,
      eventsGroupedByRequestId: (() => {
        const httpEvents = desktop.eventOrder.filter(item => item.groupId === 'tester-http-direct-1')
        const websocketEvents = desktop.eventOrder.filter(item => item.groupId === 'tester-ws-relay-1')
        const httpGroup = desktop.eventGroupCards.find(item => item.requestId === 'tester-http-direct-1')
        const websocketGroup = desktop.eventGroupCards.find(item => item.requestId === 'tester-ws-relay-1')
        return httpEvents.length >= 3
          && websocketEvents.length >= 4
          && new Set(httpEvents.map(item => item.groupLabel)).size === 1
          && new Set(websocketEvents.map(item => item.groupLabel)).size === 1
          && httpEvents[0].groupLabel !== websocketEvents[0].groupLabel
          && httpEvents.every(item => item.groupName === httpEvents[0].groupLabel)
          && websocketEvents.every(item => item.groupName === websocketEvents[0].groupLabel)
          && httpEvents.every(item => item.groupTitle.includes('tester-http-direct-1'))
          && websocketEvents.every(item => item.groupTitle.includes('tester-ws-relay-1'))
          && [...httpEvents, ...websocketEvents].every(item => item.groupInset === 'none')
          && httpGroup?.count === httpEvents.length
          && websocketGroup?.count === websocketEvents.length
          && httpGroup?.countText === `${httpEvents.length} 条`
          && websocketGroup?.countText === `${websocketEvents.length} 条`
          && httpGroup?.open
          && websocketGroup?.open
      })(),
      eventGroupsAreCollapsible: collapsedGroup.open === false
        && collapsedGroup.name === '消息组 02'
        && collapsedGroup.count === '5 条'
        && collapsedGroup.toggle === '展开'
        && collapsedGroup.eventVisible === false
        && Number.parseFloat(collapsedGroup.borderWidth) > 0
        && Number.parseFloat(collapsedGroup.borderWidth) <= 1.5
        && collapsedGroup.borderColor !== 'rgba(0, 0, 0, 0)'
        && collapsedGroup.boxShadow === 'none',
      aiOptionsOnlyVisibleForQuestions: aiOptionsByMode.initialDirectHidden
        && aiOptionsByMode.relayVisible
        && aiOptionsByMode.directHiddenAgain
        && desktop.aiOptionsVisible,
      expandedGroupsKeepThinOuterBorder: desktop.eventGroupCards
        .filter(group => group.open)
        .every(group => Number.parseFloat(group.groupBorderWidth) > 0
          && Number.parseFloat(group.groupBorderWidth) <= 1.5
          && group.groupBorder !== 'rgba(0, 0, 0, 0)'
          && group.groupInset === 'none')
        && Number.parseFloat(eventDataExpanded.groupBorderWidth) > 0
        && Number.parseFloat(eventDataExpanded.groupBorderWidth) <= 1.5
        && eventDataExpanded.groupBorderColor !== 'rgba(0, 0, 0, 0)'
        && eventDataExpanded.groupBoxShadow === 'none',
      collapsedProtocolsAreDistinct: (() => {
        const representatives = ['system', 'http', 'websocket'].map(transport =>
          collapsedProtocolStyles.find(group => group.transport === transport))
        return representatives.every(Boolean)
          && representatives.map(group => group.protocolText).join('|') === '系统|HTTP|WebSocket'
          && new Set(representatives.map(group => group.backgroundColor)).size === 3
          && new Set(representatives.map(group => group.nameColor)).size === 3
      })(),
      eventGroupsScrollWithoutOverlap: desktop.eventGroupsDoNotOverlap
        && desktop.eventGroupsContainChildren
        && desktop.visibleScrollableRegions.includes('event-log')
        && desktop.visibleScrollbarRegions.includes('event-log'),
      eventGroupHeadersDoNotFloat: desktop.eventGroupCards.length > 0
        && desktop.eventGroupCards.every(group => group.headerPosition !== 'sticky'
          && group.headerPosition !== 'fixed'),
      eventGroupToggleHasComfortablePadding: desktop.eventGroupCards.length > 0
        && desktop.eventGroupCards.every(group => group.toggleWidth >= 59
          && group.togglePaddingLeft >= 9
          && group.togglePaddingRight >= 9),
      expandedEventDataIsComplete: eventDataExpanded.payloadComplete
        && eventDataExpanded.payloadScrollableWhenNeeded
        && eventDataExpanded.payloadScrollbarHidden
        && eventDataExpanded.payloadHasNoHorizontalClipping
        && eventDataExpanded.detailInsideLogViewport,
      newFlagsSubmitted: handled[0].useCurrentCharacterProfile === false
        && handled[0].useExternalContext === false
        && handled[1].useCurrentCharacterProfile === true
        && handled[1].useExternalContext === true,
      speechBroadcastDefaultsOff: speechDefaultDisabled,
      tabsOrganizeContent: desktop.tabLabels.join('|') === '消息调试|消息历史|API 文档'
        && desktop.activeTab === 'debug'
        && desktop.visibleTabPanels.join('|') === 'debug'
        && historyTab.activeTab === 'history'
        && docsTab.activeTab === 'docs',
      apiReferenceVisible: docsTab.apiReference.includes('useCurrentCharacterProfile')
        && docsTab.apiReference.includes('/api/v1/history'),
      docsCodeSampleIsCompleteAtReferenceSize: docsReferenceStateSnapshot.docsLayout.codeLineCount === 9
        && docsReferenceStateSnapshot.docsLayout.codeScrollHeight <= docsReferenceStateSnapshot.docsLayout.codeClientHeight + 1
        && docsReferenceStateSnapshot.docsLayout.lastCodeLineBottom <= docsReferenceStateSnapshot.docsLayout.codeContentBottom + 1,
      docsContentFitsAtReferenceSize: Object.values(docsReferenceStateSnapshot.docsLayout.contentFits).every(Boolean)
        && docsReferenceStateSnapshot.docsLayout.endpointTexts.includes('/api/v1/history/audio/{messageId}')
        && docsReferenceStateSnapshot.apiReference.includes('received / progress / completed / failed')
        && docsReferenceStateSnapshot.apiReference.includes('progress 仅为不入历史的临时状态')
        && docsReferenceStateSnapshot.apiReference.includes('不会取消正在进行的 App 对话')
        && docsReferenceStateSnapshot.docsLayout.codeContentBottom
          - docsReferenceStateSnapshot.docsLayout.lastCodeLineBottom >= 3
        && docsReferenceStateSnapshot.docsLayout.contentMargins.websocket.bottom >= 3,
      longUserContentStaysReadable: Object.values(longTextLayout).every(Boolean),
      historyCategoriesVisible: historyTab.historyTabLabels.join('|') === '直连消息|AI问答'
        && historyTab.activeHistoryType === 'direct'
        && historyTab.historyText.includes('HTTP 直接消息联调')
        && !historyTab.historyText.includes('WebSocket AI问答消息联调')
        && aiHistoryTab.activeHistoryType === 'relay'
        && aiHistoryTab.historyText.includes('WebSocket AI问答消息联调')
        && aiHistoryTab.historyText.includes('AI 回复'),
      historyPaginationWorks: historyTab.historyPaginationVisible
        && historyTab.historyItemCount === 5
        && historyTab.historyCardsKeepNaturalHeight
        && historyTab.historyPageSummary === '第 1–5 条，共 14 条'
        && historyTab.historyPageSize === '5'
        && historyTab.historyCurrentPage === '1'
        && historyTab.historyPreviousDisabled
        && !historyTab.historyNextDisabled
        && historySecondPage.historyItemCount === 5
        && historySecondPage.historyCardsKeepNaturalHeight
        && historySecondPage.historyPageSummary === '第 6–10 条，共 14 条'
        && historySecondPage.historyCurrentPage === '2'
        && !historySecondPage.historyPreviousDisabled
        && !historySecondPage.historyNextDisabled
        && historySecondPage.historyText !== historyTab.historyText
        && mobileHistory.historyPaginationVisible
        && mobileHistory.horizontalOverflow <= 1
        && historyTenPerPage.historyPageSize === '10'
        && historyTenPerPage.historyItemCount === 10
        && historyTenPerPage.historyPageSummary === '第 1–10 条，共 14 条'
        && historyTenPerPage.historyCurrentPage === '1'
        && aiHistoryTab.historyCurrentPage === '1'
        && searchedHistory.historyItemCount === 1
        && !searchedHistory.historyPaginationVisible
        && searchedHistory.historyCurrentPage === '1',
      completeHistoryDataVisible: historyTab.historyRequestDetails > 0
        && historyTab.historyRequestDetails === historyTab.historyResponseDetails
        && aiHistoryTab.historyRequestDetails > 0
        && aiHistoryTab.historyRequestDetails === aiHistoryTab.historyResponseDetails,
      historyAudioPlayable: historyTab.historyAudioCount > 0
        && historyTab.historyAudioReady
        && historyTab.historyText.includes('语音缓存：新生成'),
      externalHistoryMessagesCollapseAndExpand: collapsedExternalHistoryMessage.externalMessageCount > 1
        && collapsedExternalHistoryMessage.visibleToggleCount >= 1
        && collapsedExternalHistoryMessage.hiddenToggleCount >= 1
        && collapsedExternalHistoryMessage.toggleText === '展开'
        && collapsedExternalHistoryMessage.toggleExpanded === 'false'
        && collapsedExternalHistoryMessage.rowExpanded !== 'true'
        && collapsedExternalHistoryMessage.contentText === longHistoryContent
        && collapsedExternalHistoryMessage.contentTitle === longHistoryContent
        && collapsedExternalHistoryMessage.whiteSpace === 'nowrap'
        && collapsedExternalHistoryMessage.overflowX === 'hidden'
        && collapsedExternalHistoryMessage.contentScrollWidth > collapsedExternalHistoryMessage.contentClientWidth + 1
        && collapsedExternalHistoryMessage.contentHeight <= collapsedExternalHistoryMessage.lineHeight + 1
        && expandedExternalHistoryMessage.toggleText === '收起'
        && expandedExternalHistoryMessage.toggleExpanded === 'true'
        && expandedExternalHistoryMessage.rowExpanded === 'true'
        && expandedExternalHistoryMessage.contentTitle === longHistoryContent
        && expandedExternalHistoryMessage.whiteSpace === 'pre-wrap'
        && expandedExternalHistoryMessage.contentHeight > collapsedExternalHistoryMessage.contentHeight + collapsedExternalHistoryMessage.lineHeight
        && Math.abs(expandedExternalHistoryMessage.contentTop - collapsedExternalHistoryMessage.contentTop) <= 1
        && expandedExternalHistoryMessage.contentBottom > collapsedExternalHistoryMessage.contentBottom
        && expandedExternalHistoryMessage.articleHeight > collapsedExternalHistoryMessage.articleHeight
        && recollapsedExternalHistoryMessage.toggleText === '展开'
        && recollapsedExternalHistoryMessage.toggleExpanded === 'false'
        && recollapsedExternalHistoryMessage.rowExpanded === 'false'
        && recollapsedExternalHistoryMessage.whiteSpace === 'nowrap'
        && recollapsedExternalHistoryMessage.contentHeight <= recollapsedExternalHistoryMessage.lineHeight + 1,
      historySearchWorks: searchedHistory.historySearchValue === '快捷键'
        && searchedHistory.historyText.includes('WebSocket 快捷键联调')
        && !searchedHistory.historyText.includes('WebSocket AI问答消息联调'),
      scrollbarTracksAreScoped: desktop.visibleScrollbarRegions.every(region => region === 'event-log')
        && desktop.visibleScrollbarRegions.includes('event-log')
        && historyTab.visibleScrollbarRegions.length === 0
        && docsTab.visibleScrollbarRegions.length === 0
        && mobile.visibleScrollbarRegions.every(region => region === 'event-log'),
      payloadsAreCollapsible: desktop.eventPayloadsAreCollapsed,
      desktopHasNoHorizontalOverflow: desktop.horizontalOverflow <= 1,
      shellTouchesViewportEdges: Object.values(desktop.shellViewportInset).every(value => Math.abs(value) <= 0.5),
      shellPaddingStaysOpaqueWithoutOuterCornerHalos: [
        shellEdgeAlpha.topLeftCorner,
        shellEdgeAlpha.topRightCorner,
        shellEdgeAlpha.bottomLeftCorner,
        shellEdgeAlpha.bottomRightCorner,
      ].every(alpha => alpha <= 4)
        && [
          shellEdgeAlpha.topGutter,
        shellEdgeAlpha.leftGutter,
        shellEdgeAlpha.rightGutter,
        shellEdgeAlpha.bottomGutter,
        ].every(alpha => alpha === 255)
        && shellEdgeAlpha.headerSurface === 255
        && shellEdgeAlpha.panelSurface === 255
        && shellEdgeAlpha.headerTabGap === 255
        && shellEdgeAlpha.tabWorkspaceGap === 255
        && shellEdgeAlpha.panelGap === 255,
      messageEditorHasComfortableHeight: desktop.messageContentHeight >= 96
        && desktop.messageContentHeight <= 108.5
        && mobile.messageContentHeight >= 96,
      mobileHasNoHorizontalOverflow: mobile.horizontalOverflow <= 1,
      controlsAreNamed: desktop.unnamedButtons === 0 && desktop.unlabeledFields === 0,
      iconSystemComplete: iconAudit.symbolCount >= iconAudit.requiredSymbolCount
        && iconAudit.missingSymbols.length === 0
        && iconAudit.iconCount > 30
        && iconAudit.useCount > 30
        && iconAudit.unresolvedUses.length === 0
        && iconAudit.emptyIconCount === 0
        && iconAudit.headerArtLoaded
        && sourceIconAudit.forbiddenPlaceholderGlyphs.length === 0,
      noConsoleProblems: consoleProblems.length === 0,
    }
    const report = {
      generatedAt: new Date().toISOString(),
      service: started,
      desktop,
      historyTab,
      historySecondPage,
      mobileHistory,
      historyTenPerPage,
      aiHistoryTab,
      searchedHistory,
      collapsedExternalHistoryMessage,
      expandedExternalHistoryMessage,
      recollapsedExternalHistoryMessage,
      docsTab,
      mobile,
      collapsedGroup,
      collapsedProtocolStyles,
      aiOptionsByMode,
      eventDataExpanded,
      iconAudit,
      sourceIconAudit,
      docsReferenceStateSnapshot,
      longTextLayout,
      shellEdgeLayout,
      shellEdgeAlpha,
      consoleProblems,
      screenshots: {
        referenceState: initialScreenshot,
        docsReferenceState: docsReferenceScreenshot,
        desktop: desktopScreenshot,
        groupCollapsed: collapsedGroupScreenshot,
        eventDataExpanded: expandedDataScreenshot,
        history: historyScreenshot,
        expandedHistoryMessage: expandedHistoryMessageScreenshot,
        historySecondPage: historySecondPageScreenshot,
        mobileHistory: mobileHistoryScreenshot,
        aiHistory: aiHistoryScreenshot,
        docs: docsScreenshot,
        mobile: mobileScreenshot,
      },
      assertions,
      passed: Object.values(assertions).every(Boolean),
    }
    const reportPath = path.join(outputDirectory, 'results.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    process.stdout.write(JSON.stringify({ reportPath, ...report }, null, 2))
    assert.equal(report.passed, true)
  } finally {
    if (page && !page.isDestroyed()) page.destroy()
    await service.dispose()
    app.quit()
  }
}

run().catch(error => {
  console.error(error)
  app.exit(1)
})
