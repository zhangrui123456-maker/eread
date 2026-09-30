// Eread reader page — foliate-js rendering + bottom toolbar + feature menu.
// Settings are the SHARED settings (settings.js/localStorage) so the reader ☰
// menu and the user page stay in sync (阅读内外关联, PRD FR-R2).
//
// Upstream: docs/software/技术方案.md §4, docs/dev/AI执行指导.md T2.3/T2.4.

import '../node_modules/foliate-js/view.js'
import { _installShellCallbacks } from '../bridge/messages.js'
import { setupAnnotations, setupWordLookup } from '../annotate/apply.js'
import { loadSettings, updateSettings, shadeColor, isDarkColor, applyThemeVars } from '../settings.js'
import { fillSwatches, bindRange } from '../ui.js'
import { getBook, getMerged, putMerged, getWallpaper } from '../db.js'
import { preprocessEpub } from '../preprocess.js'

const view = document.getElementById('view')
const prevBtn = document.getElementById('prev')
const nextBtn = document.getElementById('next')
const locationEl = document.getElementById('location')

// Book comes from the shelf via ?book=...&title=...&source=... ; default to
// spice-wolf. source=imported → read the Blob from IndexedDB (T2.1).
const params = new URLSearchParams(location.hash.replace(/^#/, ''))
const BOOK_URL = params.get('book') || './test-epub/spice-wolf.epub'
const BOOK_TITLE = params.get('title') || '阅读'
const BOOK_SOURCE = params.get('source') || 'url'
document.getElementById('book-title').textContent = BOOK_TITLE

/** 用合并后的单一 HTML 构造一个 foliate-js 自定义 book（图片内嵌正文 → 连续滚动）。 */
function makeMergedBook(html, title) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    return {
        sections: [{
            load: () => url,
            unload: () => {},
            createDocument: () => new DOMParser().parseFromString(html, 'text/html'),
            size: html.length,
            linear: 'yes',
        }],
        metadata: { title, language: 'en' },
        dir: 'ltr',
        toc: [],
    }
}

const loading = document.getElementById('loading')
const loadingText = document.getElementById('loading-text')

/** 用 XHR 读文件 → File（带 name，foliate-js 的 makeBook 依赖 name 判断类型）。
 *  fetch 不支持 file:// 协议，离线 assets 必须用 XHR。 */
function fetchBlob(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.responseType = 'blob'
        xhr.onload = () => {
            if (xhr.status !== 200 && xhr.status !== 0) { reject(new Error('HTTP ' + xhr.status)); return }
            const name = url.split('/').pop() || 'book.epub'
            resolve(new File([xhr.response], name))
        }
        xhr.onerror = () => reject(new Error('xhr error: ' + url))
        xhr.send()
    })
}

/** XHR 读文本（同样为了 file:// 兼容）。 */
function fetchText(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.onload = () => (xhr.status === 200 || xhr.status === 0)
            ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status))
        xhr.onerror = () => reject(new Error('xhr error: ' + url))
        xhr.send()
    })
}

async function getBlob() {
    if (BOOK_SOURCE === 'imported') {
        const blob = await getBook(BOOK_URL)
        if (!blob) throw new Error('导入的书不存在')
        return new File([blob], 'imported.epub')
    }
    return await fetchBlob(BOOK_URL)
}

/** 按浏览模式选书：
 *  - 横向翻页 paginated → 原 EPUB（foliate-js 原生分页，无预处理动画）
 *  - 纵向连贯 scrolled → 预处理合并 HTML（有缓存用缓存，无则预处理） */
async function openForFlow(flow) {
    loading.hidden = false
    try {
        if (flow === 'scrolled') {
            const cached = await getMerged(BOOK_URL)
            if (cached) {
                loadingText.textContent = '正在加载…'
                if (cached.title) document.getElementById('book-title').textContent = cached.title
                return makeMergedBook(cached.html, cached.title)
            }
            loadingText.textContent = '正在预处理电子书…'
            const merged = await preprocessEpub(await getBlob())
            await putMerged(BOOK_URL, merged)
            if (merged.title) document.getElementById('book-title').textContent = merged.title
            return makeMergedBook(merged.html, merged.title)
        }
        // 横向翻页：原 EPUB 直接打开（无预处理），用 XHR 读（fetch 不支持 file://）
        loadingText.textContent = '正在加载…'
        return await getBlob()
    } finally {
        loading.hidden = true
    }
}

// Shared settings — reader ☰ menu and user page read/write the same object.
let theme = loadSettings()
let annotationsCss = ''

function themeCss() {
    // 背景偏好：壁纸用主文档 #wallpaper-bg 层（书内容透明），纯色用 body background。
    // !important 覆盖 EPUB 自带 CSS 的 body background（scrolled 模式改背景色）。
    const bgDecl = theme.wallpaper ? `background: transparent !important;` : `background: ${theme.bg} !important;`
    return `
:root { --rt-scale: ${theme.rtScale}; --rt-color: ${theme.rtColor}; }
body { ${bgDecl} color: ${theme.fg} !important;
       font-size: ${theme.fontSize}px !important; }
`
}
function applyTheme() {
    applyThemeVars() // 全局主题变量（阅读页按钮/文字跟随主题）
    view.renderer?.setStyles?.(themeCss() + '\n' + annotationsCss)
    document.body.style.background = theme.wallpaper ? '' : theme.bg
    applyWallpaper()
    // 顶栏/底栏颜色跟随背景，带深浅差异（需求3）
    const dark = isDarkColor(theme.bg)
    const barBg = shadeColor(theme.bg, dark ? 0.08 : -0.06)
    document.querySelectorAll('.topbar, .bottombar').forEach(el => { el.style.background = barBg })
}

/** 阅读壁纸：从 IndexedDB 读壁纸 blob → blob URL → 主文档 #wallpaper-bg 层。 */
async function applyWallpaper() {
    const bg = document.getElementById('wallpaper-bg')
    if (!bg) return
    if (theme.wallpaper) {
        try {
            const blob = await getWallpaper('wallpaper')
            if (blob) {
                bg.style.display = 'block'
                bg.style.backgroundImage = `url(${URL.createObjectURL(blob)})`
                bg.style.backgroundSize = 'cover'
                bg.style.backgroundPosition = 'center'
                bg.style.opacity = String(1 - (theme.wallpaperOpacity ?? 0.35))
                return
            }
        } catch { /* ignore */ }
    }
    bg.style.display = 'none'
}
function saveTheme(patch) {
    theme = updateSettings(patch)
    applyTheme()
}

// ---- 阅读进度保留（FR-R3）------------------------------------------------
const PROGRESS_KEY = 'eread-progress'
/** 当前浏览位置的小数进度（0-1）：
 *  scrolled = 滚动位置 / 总高度；paginated = (当前页-1) / (总页-2)。
 *  foliate-js 的 view.lastLocation 不含 fraction（#onRelocate 丢弃了），
 *  故直接从 renderer 的公开 getter 计算。 */
function currentFraction() {
    const r = view.renderer
    if (!r) return null
    if (r.scrolled) return r.viewSize ? Math.min(1, Math.max(0, r.start / r.viewSize)) : null
    return r.pages > 2 ? (r.page - 1) / (r.pages - 2) : null
}
/** fraction (0-1) → " 45%" 带前导空格；非数字 → 空串（供状态浮层拼接，不含 cfi）。 */
const pct = (f) => (typeof f === 'number' ? ' ' + Math.round(f * 100) + '%' : '')
function saveProgress() {
    const cfi = view.lastLocation?.cfi
    const fraction = currentFraction()
    if (!cfi && fraction == null) return
    try {
        const map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')
        // cfi 用于横向翻页精确定位；fraction 用于纵向连贯（合并 HTML 的 CFI 不可靠）
        map[BOOK_URL] = { cfi, fraction }
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
        console.log('[eread] saveProgress', { key: BOOK_URL, fraction, hasCfi: !!cfi })
        showStatus('保存进度' + pct(fraction))
    } catch { /* ignore */ }
}
function loadProgress() {
    try {
        const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')[BOOK_URL]
        if (!raw) return null
        // 兼容旧格式（纯字符串 = 仅 CFI）
        return typeof raw === 'string' ? { cfi: raw, fraction: null } : raw
    } catch { return null }
}

// 阅读状态提示：保存/恢复进度时的轻量浮层，短暂停留后淡出。
// 颜色/层级与返回键一致（ui.css 用 --app-* 主题变量），此处只管文案与显隐。
function showStatus(text) {
    let el = document.getElementById('eread-toast')
    if (!el) {
        el = document.createElement('div')
        el.id = 'eread-toast'
        el.className = 'reader-toast'
        document.body.appendChild(el)
    }
    el.textContent = text
    el.classList.add('show')
    clearTimeout(el._hideTimer)
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 1500)
}

// foliate-js 的 #justAnchored 标志会吞掉「打开/恢复后的首次滚动」，导致 relocate 不触发；
// 且 Android 退出（后台/杀进程）不一定触发 pagehide/beforeunload。
// 因此这里：
//  1) 直接监听 renderer 的 scroll 事件（paginator 每次滚动都会在自身重派发 scroll，见 paginator.js L551），
//     节流 250ms 立即保存 + 滚动停止后 400ms 兜底保存一次；
//  2) 页面隐藏/后台/卸载时立即保存。
let scrollSaveTimer
let lastScrollSave = 0
function scheduleScrollSave() {
    const now = Date.now()
    if (now - lastScrollSave >= 250) {
        lastScrollSave = now
        saveProgress()
    }
    clearTimeout(scrollSaveTimer)
    scrollSaveTimer = setTimeout(saveProgress, 400)
}
function saveNow() { saveProgress() }
window.addEventListener('pagehide', saveNow)
window.addEventListener('beforeunload', saveNow)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow()
})

// ---- pagination ---------------------------------------------------------
let firstRelocate = true
view.addEventListener('relocate', e => {
    saveProgress() // 每页/滚动都保存阅读位置
    // 翻页/滑动时隐藏顶栏底栏（需求4）；首次打开不隐藏
    if (!firstRelocate) toggleBars(false)
    firstRelocate = false
    // 页码显示：横向翻页的 renderer.pages 含封面/封底各 1 页（正文页 = pages - 2，
    // 且 page 是 1 起的正文页号，page=0 是封面）；纵向连贯 pages 即屏数（无封面/封底），
    // page 是 0 起的屏序号，故用 page+1。
    const r = view.renderer
    const page = r?.page, pages = r?.pages
    const scrolled = !!r?.scrolled
    if (page != null && pages != null && pages > 0 && (scrolled || pages > 2)) {
        const total = scrolled ? pages : pages - 2
        const current = scrolled ? Math.min(page + 1, pages) : Math.min(Math.max(page, 1), total)
        locationEl.textContent = `${current} / ${total} 页`
    } else {
        const { fraction } = e.detail ?? {}
        locationEl.textContent = `${Math.round((fraction ?? 0) * 100)}%`
    }
})

view.addEventListener('load', e => {
    const doc = e.detail?.doc
    if (doc) {
        setupAnnotations(doc, { onStatus: s => console.log('[eread]', s), bookId: BOOK_URL })
        setupWordLookup(doc, { onStatus: s => console.log('[eread]', s), bookId: BOOK_URL })
    }
    // book 内容在 foliate-js 的 iframe 里，touch 事件不冒泡到父文档；记录当前
    // document，「差速滑动」的 touch 接管需直接挂到 doc 上（而非 renderer host）。
    activeDoc = doc ?? null
    applyScrollMode()
})

// ---- toolbar ------------------------------------------------------------
// 顶栏/底栏自动隐藏（需求4）：翻页时上下隐藏，点空白处再出现
function toggleBars(show) {
    const topbar = document.querySelector('.topbar')
    const bottombar = document.querySelector('.bottombar')
    if (topbar) topbar.style.transform = show ? 'translateY(0)' : 'translateY(-110%)'
    if (bottombar) bottombar.style.transform = show ? 'translateY(0)' : 'translateY(110%)'
}
window.toggleBars = toggleBars // 供 apply.js 点空白时调用

function goPrev() { view.prev?.(); toggleBars(false) }
function goNext() { view.next?.(); toggleBars(false) }
prevBtn.addEventListener('click', goPrev)
nextBtn.addEventListener('click', goNext)
document.getElementById('back-btn').addEventListener('click', () => { location.href = 'index.html' })
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') goPrev()
    else if (e.key === 'ArrowRight') goNext()
})

// ---- feature menu -------------------------------------------------------
const menu = document.getElementById('menu')
const menuMask = document.getElementById('menu-mask')
function openMenu() { menu.classList.add('open'); menuMask.classList.add('show') }
function closeMenu() { menu.classList.remove('open'); menuMask.classList.remove('show') }
document.getElementById('menu-btn').addEventListener('click', () => {
    menu.classList.contains('open') ? closeMenu() : openMenu()
})
document.getElementById('menu-close').addEventListener('click', closeMenu)
menuMask.addEventListener('click', closeMenu)

fillSwatches(document.getElementById('bg-swatches'),
    ['#ffffff', '#f5f0e6', '#2b2b2b', '#1a1a1a'], theme.bg, c => saveTheme({ bg: c }))
fillSwatches(document.getElementById('fg-swatches'),
    ['#222222', '#333333', '#e0e0e0', '#d0d0d0'], theme.fg, c => saveTheme({ fg: c }))
fillSwatches(document.getElementById('rt-swatches'),
    ['#787774', '#1f6c9f', '#346538', '#956400'], theme.rtColor, c => saveTheme({ rtColor: c }))

bindRange('font-size', 'font-size-val', theme.fontSize, v => v + 'px', v => saveTheme({ fontSize: v }))
bindRange('rt-scale', 'rt-scale-val', theme.rtScale, v => v.toFixed(2) + '×', v => saveTheme({ rtScale: v }))
bindRange('scroll-factor', 'scroll-factor-val', theme.scrollFactor, v => v.toFixed(2) + '×', v => {
    saveTheme({ scrollFactor: v })
    applyScrollMode()
})

// 浏览模式：横向翻页 paginated；纵向连贯 scrolled（正文占满宽）。
async function setFlow(flow) {
    // 记录切换前的小数进度（fraction；原 EPUB 与合并 HTML 的 CFI 不通用，用进度估算恢复）
    const prevFraction = currentFraction()
    try {
        await openBook(flow, false) // 重新 open（横翻=原 EPUB，纵连=合并 HTML）；不按 CFI 恢复，改走下方 fraction
    } catch (e) { console.warn('[eread] flow switch failed', e); return }
    if (prevFraction != null) {
        const r = view.renderer
        if (flow === 'scrolled') {
            // 合并 HTML 无 sectionProgress，goToFraction 不可用 → 直接滚动到 fraction
            setTimeout(() => r?.goTo?.({ index: 0, anchor: prevFraction }).catch?.(() => {}), 80)
        } else {
            setTimeout(() => view.goToFraction?.(prevFraction).catch?.(() => {}), 80)
        }
    }
    // 淡入过渡，避免切换生硬
    const content = document.querySelector('.content')
    content.classList.remove('fade-in')
    requestAnimationFrame(() => requestAnimationFrame(() => content.classList.add('fade-in')))
}
const flowButtons = document.getElementById('flow-buttons')
flowButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.flow === theme.flow))
flowButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-flow]')
    if (!b) return
    flowButtons.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    setFlow(b.dataset.flow)
    saveTheme({ flow: b.dataset.flow })
    updateScrollUI()
})

// ---- 滑动方式 / 滑动系数（纵向连贯）--------------------------------------
// 纵向连贯模式默认原生 overflow 滚动（1:1 跟手）。「差速滑动」时接管 touch：
// 手指划距 × 系数 → 手动设置 #container.scrollTop，实现「划满屏只滚系数×屏高」。
// 两个关键点：
//  1) book 内容在 foliate-js 的 iframe 里，touch 事件不冒泡到父文档，监听器
//     必须直接挂在 book document（doc）上，而不是 renderer host。
//  2) 必须先设 touch-action 禁原生滚动，否则浏览器在合成器线程抢先滚、
//     preventDefault 无效。touch-action 沿命中链跨 iframe 生效，需同时设在
//     #view、renderer 与 doc 根元素三处。用 none（而非 pan-x）：纵向连贯无横向
//     滚动需求，none 让浏览器完全不介入任何 pan，避免「合成器准备滚动 ↔ 被
//     preventDefault 取消」的往返造成的卡顿。
let activeDoc = null
let scrollDragState = null // { doc, renderer, onStart, onMove, onEnd }
function applyScrollMode() {
    // 清理旧接管
    if (scrollDragState) {
        const s = scrollDragState
        s.doc.removeEventListener('touchstart', s.onStart)
        s.doc.removeEventListener('touchmove', s.onMove)
        s.doc.removeEventListener('touchend', s.onEnd)
        s.doc.removeEventListener('touchcancel', s.onEnd)
        scrollDragState = null
    }
    // 复位 touch-action
    view.style.touchAction = ''
    if (view.renderer) view.renderer.style.touchAction = ''
    if (activeDoc) activeDoc.documentElement.style.touchAction = ''

    const renderer = view.renderer
    const doc = activeDoc
    const enabled = theme.flow === 'scrolled' && theme.scrollMode === 'variable' && renderer && doc
    if (!enabled) return

    const factor = theme.scrollFactor
    view.style.touchAction = 'none'
    renderer.style.touchAction = 'none'
    doc.documentElement.style.touchAction = 'none'

    let touch = null
    const onStart = e => {
        if (e.touches.length !== 1) { touch = null; return }
        const t = e.touches[0]
        touch = { sx: t.clientX, sy: t.clientY, pos: renderer.containerPosition, vertical: null, dy: 0, raf: 0 }
    }
    const onMove = e => {
        if (!touch || e.touches.length !== 1) { touch = null; return }
        const t = e.touches[0]
        const dx = t.clientX - touch.sx, dy = t.clientY - touch.sy
        if (touch.vertical == null) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return // 尚未判定方向
            touch.vertical = Math.abs(dy) >= Math.abs(dx)
        }
        if (!touch.vertical) return // 横向手势交还原生滚动
        e.preventDefault()
        // 记录最新位移，用 rAF 合并到下一渲染帧再写 scrollTop：touchmove 频率
        // 可高于 60Hz，直接写会高频触发主线程滚动 + scroll 事件（「卡」主因）。
        touch.dy = dy
        if (!touch.raf) {
            const cur = touch
            cur.raf = requestAnimationFrame(() => {
                cur.raf = 0
                if (cur.vertical && touch === cur) {
                    // 方向：reverse（默认，手下滑→看下文）scrollTop 增；natural（手下滑→看上文）减
                    const dir = theme.scrollDirection === 'natural' ? -1 : 1
                    renderer.containerPosition = cur.pos + cur.dy * factor * dir
                }
            })
        }
    }
    const onEnd = () => { touch = null }
    doc.addEventListener('touchstart', onStart, { passive: true })
    doc.addEventListener('touchmove', onMove, { passive: false })
    doc.addEventListener('touchend', onEnd)
    doc.addEventListener('touchcancel', onEnd)
    scrollDragState = { doc, renderer, onStart, onMove, onEnd }
}

// 滑动方式（原生滑动 / 差速滑动）
const scrollModeButtons = document.getElementById('scroll-mode-buttons')
scrollModeButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === theme.scrollMode))
scrollModeButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]')
    if (!b) return
    scrollModeButtons.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    saveTheme({ scrollMode: b.dataset.mode })
    applyScrollMode()
    updateScrollUI()
})

// 滑动方向（差速：手下滑时看上文/下文）
const scrollDirectionButtons = document.getElementById('scroll-direction-buttons')
scrollDirectionButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.dir === theme.scrollDirection))
scrollDirectionButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-dir]')
    if (!b) return
    scrollDirectionButtons.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    saveTheme({ scrollDirection: b.dataset.dir })
    applyScrollMode()
})

// 条件显示：纵向连贯才显示「滑动方式」；差速滑动才显示「滑动系数」「滑动方向」
function updateScrollUI() {
    const scrolled = theme.flow === 'scrolled'
    const variable = theme.scrollMode === 'variable'
    document.getElementById('scroll-mode-section').hidden = !scrolled
    document.getElementById('scroll-factor-section').hidden = !(scrolled && variable)
    document.getElementById('scroll-direction-section').hidden = !(scrolled && variable)
}
updateScrollUI()

document.getElementById('jump-go').addEventListener('click', () => {
    const idx = parseInt(document.getElementById('jump-index').value, 10)
    if (!Number.isNaN(idx)) view.goTo?.(idx).catch?.(e => console.warn('[eread] jump', e))
})

// 分页参数（foliate-js renderer 属性）。当前固定；后续做页边距/宽度设置项时在此扩展。
const PAGINATION = {
    margin: '48px',
    gap: '10%',
    maxInlineSize: { paginated: '672px', scrolled: '2000px' },
}

// ---- open ---------------------------------------------------------------
async function openBook(flow, restoreProgress = true) {
    // 必须先读已保存进度：view.open / r.next() 都会触发 relocate，
    // relocate 里会 saveProgress()，若放到后面再读，保存值会被第一页覆盖。
    const saved = restoreProgress ? loadProgress() : null
    const book = await openForFlow(flow)
    view.close?.() // 关闭旧 renderer（foliate-js 的 open 不自动清理，重新 open 前必须 close）
    await view.open(book)
    // 每次 open 会新建 renderer，需重新挂 scroll 保存监听（纵向连贯兜底保存）
    view.renderer.addEventListener('scroll', scheduleScrollSave)
    console.log('[eread] book opened:', BOOK_URL, 'flow=', flow)
    if (!annotationsCss) {
        try { annotationsCss = await fetchText('./annotate/annotations.css') }
        catch (e) { console.warn('[eread] fetch annotations.css failed', e) }
    }
    const r = view.renderer
    r.setAttribute('margin', PAGINATION.margin)
    r.setAttribute('gap', PAGINATION.gap)
    r.setAttribute('flow', flow)
    r.setAttribute('max-inline-size', flow === 'scrolled' ? PAGINATION.maxInlineSize.scrolled : PAGINATION.maxInlineSize.paginated)
    applyTheme()
    // 有保存位置 → 定位到保存处；否则从第一页开始渲染。
    // 纵向连贯：合并 HTML 的 CFI 恢复不可靠，先渲染第一段，再直接设置滚动位置
    // （renderer 的 containerPosition 是公开 setter，等于 #container.scrollTop）。
    // 横向翻页：用 CFI 精确定位。
    console.log('[eread] openBook restore', { flow, saved })
    if (saved) {
        if (flow === 'scrolled' && typeof saved.fraction === 'number') {
            // 必须用 anchor 传 fraction：goTo 内部 #scrollToAnchor(fraction) 会设置 #anchor 并滚动。
            // 若直接改 containerPosition，#anchor 仍是 0，之后 render()/expand() 的
            // onExpand→#scrollToAnchor(#anchor) 会把位置重置回顶部。
            showStatus('恢复进度' + pct(saved.fraction))
            await view.renderer.goTo({ index: 0, anchor: saved.fraction }).catch(() => {})
        } else if (saved.cfi) {
            showStatus('恢复进度' + pct(saved.fraction))
            await view.goTo(saved.cfi).catch(() => {})
        } else {
            showStatus('打开第一页')
            r.next()
        }
    } else {
        showStatus('打开第一页')
        r.next()
    }
}

openBook(theme.flow).catch(err => {
    console.error('[eread] open failed', err)
    locationEl.textContent = '打开失败：' + (err?.message ?? err)
})

// ---- native bridge ------------------------------------------------------
if (typeof window.ereadBridge !== 'undefined') {
    _installShellCallbacks(window.ereadBridge)
    try {
        console.log('[eread] bridge ping:', window.ereadBridge.ping(),
            '|', window.ereadBridge.version())
    } catch (e) { console.error('[eread] bridge error', e) }
} else {
    console.log('[eread] no native bridge (browser mode)')
}
