(function () {
  const instances = new WeakMap()
  let activeInstance = null
  let instanceSequence = 0
  let globalsBound = false

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('zh-CN')
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
      .trim()
  }

  function fuzzyScore(term, candidate) {
    const query = normalizeSearch(term).replace(/\s+/g, '')
    const target = normalizeSearch(candidate).replace(/\s+/g, '')
    if (!query) return 0
    if (!target) return -1
    if (target === query) return 1000
    if (target.startsWith(query)) return 820 - Math.min(120, target.length - query.length)
    const substringIndex = target.indexOf(query)
    if (substringIndex >= 0) return 640 - substringIndex * 3

    let previousIndex = -1
    let firstIndex = -1
    let gaps = 0
    for (const character of query) {
      const nextIndex = target.indexOf(character, previousIndex + 1)
      if (nextIndex < 0) return -1
      if (firstIndex < 0) firstIndex = nextIndex
      if (previousIndex >= 0) gaps += nextIndex - previousIndex - 1
      previousIndex = nextIndex
    }
    return Math.max(1, 420 - firstIndex * 4 - gaps * 6 - (target.length - query.length))
  }

  function optionScore(option, query) {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
    if (!terms.length) return 0
    const aliases = normalizeSearch(option.search).split(/\s+/).filter(Boolean)
    const candidates = [option.primary, option.secondary, option.value, ...aliases]
    let score = 0
    for (const term of terms) {
      const best = Math.max(...candidates.map(candidate => fuzzyScore(term, candidate)))
      if (best < 0) return -1
      score += best
    }
    return score
  }

  function makeSvg(className, pathMarkup, viewBox = '0 0 18 18') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', className)
    svg.setAttribute('viewBox', viewBox)
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = pathMarkup
    return svg
  }

  function bindGlobals() {
    if (globalsBound) return
    globalsBound = true
    document.addEventListener('pointerdown', event => {
      if (!activeInstance) return
      if (activeInstance.root.contains(event.target) || activeInstance.popover.contains(event.target)) return
      activeInstance.close()
    })
    document.addEventListener('scroll', event => {
      if (!activeInstance || activeInstance.popover.contains(event.target)) return
      activeInstance.positionPopover()
    }, true)
    window.addEventListener('resize', () => activeInstance && activeInstance.positionPopover())
    window.addEventListener('blur', () => activeInstance && activeInstance.close())
  }

  class SearchSelect {
    constructor(select, options = {}) {
      if (!(select instanceof HTMLSelectElement)) throw new TypeError('SearchSelect requires a native select element')
      this.select = select
      this.options = {
        searchable: options.searchable !== false && select.dataset.searchable !== 'false',
        searchPlaceholder: options.searchPlaceholder || select.dataset.searchPlaceholder || '搜索选项',
        emptyTitle: options.emptyTitle || select.dataset.emptyTitle || '没有找到匹配项',
        emptyHint: options.emptyHint || select.dataset.emptyHint || '换个关键词试试',
        itemLabel: options.itemLabel || select.dataset.itemLabel || '个选项',
        density: options.density || select.dataset.density || 'regular',
        minMenuWidth: Number(options.minMenuWidth || select.dataset.menuMinWidth || 0),
        maxMenuHeight: Number(options.maxMenuHeight || select.dataset.menuMaxHeight || 216),
        showTriggerSecondary: options.showTriggerSecondary !== false && select.dataset.triggerSecondary !== 'false',
        showOptionSecondary: options.showOptionSecondary !== false && select.dataset.optionSecondary !== 'false',
        legacyVoice: options.legacyVoice || select.dataset.selectLegacy === 'ai-voice',
      }
      this.id = select.id || `search-select-${++instanceSequence}`
      if (!select.id) select.id = this.id
      this.originalTabIndex = select.getAttribute('tabindex')
      this.originalAriaHidden = select.getAttribute('aria-hidden')
      this.results = []
      this.activeIndex = -1
      this.build()
      this.bind()
      this.refresh()
      instances.set(select, this)
      bindGlobals()
    }

    build() {
      const legacy = this.options.legacyVoice
      this.select.classList.add('search-select-native')
      this.select.setAttribute('tabindex', '-1')
      this.select.setAttribute('aria-hidden', 'true')

      this.root = document.createElement('div')
      this.root.id = `${this.id}-picker`
      this.root.className = `search-select search-select--${this.options.density}${legacy ? ' ai-voice-picker' : ''}`

      this.trigger = document.createElement('button')
      this.trigger.id = `${this.id}-trigger`
      this.trigger.type = 'button'
      this.trigger.className = `search-select-trigger${legacy ? ' ai-voice-trigger' : ''}`
      this.trigger.setAttribute('aria-haspopup', 'listbox')
      this.trigger.setAttribute('aria-expanded', 'false')
      this.trigger.setAttribute('aria-controls', `${this.id}-popover`)
      this.trigger.setAttribute('aria-label', this.select.getAttribute('aria-label') || '选择选项')

      this.selection = document.createElement('span')
      this.selection.className = `search-select-selection${legacy ? ' ai-voice-selection' : ''}`
      this.selectedPrimary = document.createElement('strong')
      this.selectedPrimary.id = `${this.id}-selected-name`
      this.selectedPrimary.className = 'search-select-selected-primary'
      this.selectedSecondary = document.createElement('span')
      this.selectedSecondary.id = `${this.id}-selected-id`
      this.selectedSecondary.className = 'search-select-selected-secondary'
      this.selection.append(this.selectedPrimary, document.createTextNode(' '), this.selectedSecondary)
      this.chevron = makeSvg(
        `search-select-chevron${legacy ? ' ai-voice-chevron' : ''}`,
        '<path d="m5 7 4 4 4-4"/>'
      )
      this.trigger.append(this.selection, this.chevron)
      this.root.append(this.trigger)
      this.select.insertAdjacentElement('afterend', this.root)

      this.popover = document.createElement('div')
      this.popover.id = `${this.id}-popover`
      this.popover.className = `search-select-popover search-select-popover--${this.options.density}${legacy ? ' ai-voice-popover' : ''}`
      this.popover.hidden = true

      this.searchBox = document.createElement('div')
      this.searchBox.className = `search-select-search-box${legacy ? ' ai-voice-search-box' : ''}`
      this.searchBox.append(makeSvg('search-select-search-icon', '<circle cx="7.7" cy="7.7" r="4.2"/><path d="m11 11 3.4 3.4"/>'))
      this.search = document.createElement('input')
      this.search.id = `${this.id}-search`
      this.search.type = 'search'
      this.search.className = 'search-select-search'
      this.search.placeholder = this.options.searchPlaceholder
      this.search.autocomplete = 'off'
      this.search.spellcheck = false
      this.search.setAttribute('role', 'combobox')
      this.search.setAttribute('aria-autocomplete', 'list')
      this.search.setAttribute('aria-expanded', 'false')
      this.search.setAttribute('aria-controls', `${this.id}-options`)
      this.clear = document.createElement('button')
      this.clear.id = `${this.id}-search-clear`
      this.clear.type = 'button'
      this.clear.className = `search-select-search-clear${legacy ? ' ai-voice-search-clear' : ''}`
      this.clear.title = '清空搜索'
      this.clear.setAttribute('aria-label', '清空搜索')
      this.clear.hidden = true
      this.clear.append(makeSvg('', '<path d="m5.5 5.5 7 7m0-7-7 7"/>'))
      this.searchBox.append(this.search, this.clear)
      this.searchBox.hidden = !this.options.searchable

      this.resultsHead = document.createElement('div')
      this.resultsHead.className = `search-select-results-head${legacy ? ' ai-voice-results-head' : ''}`
      this.resultCount = document.createElement('span')
      this.resultCount.id = `${this.id}-result-count`
      this.keyboardHint = document.createElement('span')
      this.keyboardHint.textContent = this.options.searchable ? '↑↓ 选择 · Enter 确认' : '↑↓ 选择'
      this.resultsHead.append(this.resultCount, this.keyboardHint)

      this.list = document.createElement('div')
      this.list.id = `${this.id}-options`
      this.list.className = `search-select-options${legacy ? ' ai-voice-options' : ''}`
      this.list.setAttribute('role', 'listbox')
      this.list.setAttribute('aria-label', `${this.trigger.getAttribute('aria-label')}搜索结果`)

      this.empty = document.createElement('div')
      this.empty.id = `${this.id}-empty`
      this.empty.className = `search-select-empty${legacy ? ' ai-voice-empty' : ''}`
      this.empty.hidden = true
      this.empty.append(
        makeSvg('', '<path d="M5 12a7 7 0 1 1 13.2 3.2M4 20l4.2-4.2M17 17l3 3m0-3-3 3"/>', '0 0 24 24'),
        Object.assign(document.createElement('strong'), { textContent: this.options.emptyTitle }),
        Object.assign(document.createElement('span'), { textContent: this.options.emptyHint })
      )

      this.popover.append(this.searchBox, this.resultsHead, this.list, this.empty)
      document.body.append(this.popover)
    }

    bind() {
      this.trigger.addEventListener('click', () => this.isOpen() ? this.close() : this.open())
      this.trigger.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.isOpen()) {
          event.preventDefault()
          this.close(true)
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
        event.preventDefault()
        if (!this.isOpen()) {
          this.open()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          this.moveActive(event.key === 'ArrowDown' ? 1 : -1)
        } else if (!this.options.searchable) {
          const option = this.results[this.activeIndex]
          if (option && !option.disabled) this.choose(option.value)
        }
      })
      this.search.addEventListener('input', () => this.renderResults(true))
      this.search.addEventListener('keydown', event => this.onSearchKeydown(event))
      this.clear.addEventListener('click', () => {
        this.search.value = ''
        this.renderResults(true)
        this.search.focus()
      })
      this.list.addEventListener('click', event => {
        const option = event.target.closest('.search-select-option')
        if (option && !option.disabled) this.choose(option.dataset.value)
      })
      this.list.addEventListener('pointermove', event => {
        const option = event.target.closest('.search-select-option')
        if (!option || option.disabled) return
        this.setActiveIndex(Number(option.dataset.resultIndex))
      })
      this.select.addEventListener('change', () => {
        this.refreshSelection()
        if (this.isOpen()) this.renderResults()
      })
      this.select.addEventListener('input', () => this.refreshSelection())
    }

    nativeOptions() {
      return [...this.select.options].map((option, index) => ({
        index,
        value: option.value,
        primary: option.dataset.primary || option.label || option.textContent.trim(),
        secondary: option.dataset.secondary || '',
        search: option.dataset.search || '',
        disabled: option.disabled,
        unavailable: option.dataset.unavailable === 'true' || option.classList.contains('is-unavailable'),
      }))
    }

    refresh() {
      this.catalog = this.nativeOptions()
      this.trigger.disabled = this.select.disabled || !this.catalog.some(option => !option.disabled)
      this.root.classList.toggle('is-disabled', this.trigger.disabled)
      this.refreshSelection()
      if (this.isOpen()) this.renderResults()
      return this
    }

    refreshSelection() {
      const nativeOption = this.select.options[this.select.selectedIndex]
      const option = nativeOption && {
        primary: nativeOption.dataset.primary || nativeOption.label || nativeOption.textContent.trim(),
        secondary: nativeOption.dataset.secondary || '',
        unavailable: nativeOption.dataset.unavailable === 'true' || nativeOption.classList.contains('is-unavailable'),
      }
      const primary = option ? option.primary : (this.select.dataset.placeholder || '请选择')
      const secondary = option && this.options.showTriggerSecondary ? option.secondary : ''
      this.selectedPrimary.textContent = primary
      this.selectedSecondary.textContent = secondary
      this.selectedSecondary.hidden = !secondary
      this.root.classList.toggle('has-trigger-secondary', Boolean(secondary))
      this.root.classList.toggle('is-unavailable', Boolean(option && option.unavailable))
      this.trigger.title = secondary ? `${primary} · ${secondary}` : primary
    }

    renderResults(resetActive = false) {
      const query = this.search.value.trim()
      const previous = !resetActive && this.results[this.activeIndex]
      this.results = this.catalog
        .map((option, order) => ({ ...option, order, score: optionScore(option, query) }))
        .filter(option => option.score >= 0)
        .sort((left, right) => query ? right.score - left.score || left.order - right.order : left.order - right.order)

      this.resultCount.textContent = `${this.results.length} ${this.options.itemLabel}`
      this.clear.hidden = !query
      this.list.hidden = this.results.length === 0
      this.empty.hidden = this.results.length > 0
      const selectedValue = this.select.value
      const nodes = this.results.map((option, index) => {
        const secondaryText = this.options.showOptionSecondary ? option.secondary : ''
        const button = document.createElement('button')
        button.type = 'button'
        button.id = `${this.id}-option-${option.index}`
        button.className = `search-select-option${secondaryText ? ' has-secondary' : ''}${option.unavailable ? ' is-unavailable' : ''}${this.options.legacyVoice ? ' ai-voice-option' : ''}`
        button.dataset.value = option.value
        button.dataset.resultIndex = String(index)
        if (this.options.legacyVoice) button.dataset.voiceId = option.value
        button.setAttribute('role', 'option')
        button.setAttribute('aria-selected', String(option.value === selectedValue))
        button.disabled = option.disabled
        const primary = document.createElement('strong')
        primary.className = 'search-select-option-primary'
        primary.textContent = option.primary
        const secondary = document.createElement('span')
        secondary.className = 'search-select-option-secondary'
        secondary.textContent = secondaryText
        secondary.hidden = !secondaryText
        const check = makeSvg(`search-select-option-check${this.options.legacyVoice ? ' ai-voice-option-check' : ''}`, '<path d="m4.5 9.2 2.8 2.8 6.2-6.2"/>')
        button.append(primary, secondary, check)
        return button
      })
      this.list.replaceChildren(...nodes)

      let nextIndex = previous ? this.results.findIndex(option => option.index === previous.index) : -1
      if (nextIndex < 0) nextIndex = this.results.findIndex(option => option.value === selectedValue && !option.disabled)
      if (nextIndex < 0) nextIndex = this.results.findIndex(option => !option.disabled)
      this.setActiveIndex(nextIndex)
      if (this.isOpen()) this.positionPopover()
    }

    setActiveIndex(index, reveal = false) {
      const nodes = [...this.list.querySelectorAll('.search-select-option')]
      if (!nodes.length || index < 0) {
        this.activeIndex = -1
        this.search.removeAttribute('aria-activedescendant')
        return
      }
      this.activeIndex = Math.max(0, Math.min(index, nodes.length - 1))
      nodes.forEach((node, nodeIndex) => node.classList.toggle('is-active', nodeIndex === this.activeIndex))
      const active = nodes[this.activeIndex]
      this.search.setAttribute('aria-activedescendant', active.id)
      if (!reveal) return
      const top = active.offsetTop
      const bottom = top + active.offsetHeight
      if (top < this.list.scrollTop) this.list.scrollTop = top
      else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight
    }

    moveActive(direction) {
      if (!this.results.length) return
      let next = this.activeIndex
      for (let attempts = 0; attempts < this.results.length; attempts += 1) {
        next = (next + direction + this.results.length) % this.results.length
        if (!this.results[next].disabled) {
          this.setActiveIndex(next, true)
          return
        }
      }
    }

    onSearchKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.close(true)
      } else if (event.key === 'Tab') {
        this.close()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveActive(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const boundary = event.key === 'Home' ? 0 : this.results.length - 1
        this.setActiveIndex(boundary, true)
        if (this.results[this.activeIndex] && this.results[this.activeIndex].disabled) this.moveActive(event.key === 'Home' ? 1 : -1)
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        const option = this.results[this.activeIndex]
        if (option && !option.disabled) this.choose(option.value)
      }
    }

    choose(value) {
      const option = this.catalog.find(item => item.value === value)
      if (!option || option.disabled) return
      const changed = this.select.value !== value
      this.select.value = value
      this.refreshSelection()
      if (changed) {
        this.select.dispatchEvent(new Event('input', { bubbles: true }))
        this.select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      this.close(true)
    }

    isOpen() {
      return !this.popover.hidden
    }

    open() {
      this.refresh()
      if (this.trigger.disabled) return
      if (activeInstance && activeInstance !== this) activeInstance.close()
      activeInstance = this
      this.root.classList.add('is-open')
      this.popover.hidden = false
      this.trigger.setAttribute('aria-expanded', 'true')
      this.search.setAttribute('aria-expanded', 'true')
      this.search.value = ''
      this.renderResults(true)
      this.positionPopover()
      if (this.options.searchable) this.search.focus()
      else this.trigger.focus()
      this.setActiveIndex(this.activeIndex, true)
    }

    close(restoreFocus = false) {
      if (!this.isOpen()) return
      this.root.classList.remove('is-open')
      this.popover.hidden = true
      this.popover.classList.remove('opens-up', 'is-positioned')
      this.trigger.setAttribute('aria-expanded', 'false')
      this.search.setAttribute('aria-expanded', 'false')
      this.search.removeAttribute('aria-activedescendant')
      if (activeInstance === this) activeInstance = null
      if (restoreFocus && document.activeElement !== this.trigger) this.trigger.focus()
    }

    positionPopover() {
      if (!this.isOpen() || !this.trigger.isConnected) return
      const rect = this.trigger.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        this.close()
        return
      }
      const margin = 8
      const gap = 6
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      const width = Math.min(
        viewportWidth - margin * 2,
        Math.max(rect.width, this.options.minMenuWidth || rect.width)
      )
      const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))
      const spaceBelow = viewportHeight - rect.bottom - margin - gap
      const spaceAbove = rect.top - margin - gap
      const openUp = spaceBelow < 176 && spaceAbove > spaceBelow
      const available = Math.max(120, openUp ? spaceAbove : spaceBelow)
      const chromeHeight = this.options.searchable ? 82 : 38
      const listHeight = Math.max(60, Math.min(this.options.maxMenuHeight, available - chromeHeight))

      this.popover.classList.toggle('opens-up', openUp)
      this.popover.style.width = `${width}px`
      this.popover.style.left = `${left}px`
      this.list.style.maxHeight = `${listHeight}px`
      this.popover.style.top = '0'
      this.popover.classList.add('is-positioned')
      const popoverHeight = this.popover.getBoundingClientRect().height
      const top = openUp
        ? Math.max(margin, rect.top - gap - popoverHeight)
        : Math.min(viewportHeight - margin - popoverHeight, rect.bottom + gap)
      this.popover.style.top = `${Math.max(margin, top)}px`
    }

    destroy() {
      if (this.isOpen()) this.close()
      this.root.remove()
      this.popover.remove()
      this.select.classList.remove('search-select-native')
      if (this.originalTabIndex === null) this.select.removeAttribute('tabindex')
      else this.select.setAttribute('tabindex', this.originalTabIndex)
      if (this.originalAriaHidden === null) this.select.removeAttribute('aria-hidden')
      else this.select.setAttribute('aria-hidden', this.originalAriaHidden)
      instances.delete(this.select)
    }

    static enhance(select, options = {}) {
      if (instances.has(select)) return instances.get(select)
      return new SearchSelect(select, options)
    }

    static from(select) {
      return instances.get(select) || null
    }

    static enhanceAll(scope = document) {
      return [...scope.querySelectorAll('select[data-search-select]')].map(select => SearchSelect.enhance(select))
    }

    static destroyAll(scope = document) {
      scope.querySelectorAll('select.search-select-native').forEach(select => {
        const instance = instances.get(select)
        if (instance) instance.destroy()
      })
    }

    static closeActive() {
      if (activeInstance) activeInstance.close()
    }
  }

  window.SearchSelect = SearchSelect
})()
