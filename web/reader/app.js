// Eread reader page — foliate-js rendering + bottom toolbar + feature menu.
// Settings are the SHARED settings (settings.js/localStorage) so the reader ☰
// menu and the user page stay in sync (阅读内外关联, PRD FR-R2).
//
// Upstream: docs/software/技术方案.md §4, docs/dev/AI执行指导.md T2.3/T2.4.

import '../node_modules/foliate-js/view.js'
import { _installShellCallbacks } from '../bridge/messages.js'
import { setupAnnotations, setupWordLookup } from '../annotate/apply.js'
import { loadSettings, updateSettings, shadeColor, isDarkColor, applyThemeVars } from '../settings.js'
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
function saveProgress() {
    const cfi = view.lastLocation?.cfi
    if (!cfi) return
    try {
        const map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')
        map[BOOK_URL] = cfi
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
}
function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')[BOOK_URL]
    } catch { return null }
}

// ---- pagination ---------------------------------------------------------
view.addEventListener('relocate', e => {
    saveProgress() // 每页/滚动都保存阅读位置
    // 页码：横向翻页 = 当前列/总列；纵向连贯 = 滚动位置对应的页
    const page = view.renderer?.page
    const pages = view.renderer?.pages
    if (page != null && pages != null && pages > 0) {
        locationEl.textContent = `${Math.min(page + 1, pages)} / ${pages} 页`
    } else {
        const { fraction } = e.detail ?? {}
        locationEl.textContent = `${Math.round((fraction ?? 0) * 100)}%`
    }
})

view.addEventListener('load', e => {
    const doc = e.detail?.doc
    if (doc) {
        setupAnnotations(doc, { onStatus: s => console.log('[eread]', s), bookId: BOOK_URL })
        setupWordLookup(doc, { onStatus: s => console.log('[eread]', s) })
    }
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

function fillSwatches(el, colors, current, onPick) {
    el.innerHTML = ''
    for (const c of colors) {
        const d = document.createElement('div')
        d.className = 'swatch' + (c === current ? ' active' : '')
        d.style.background = c
        d.dataset.color = c
        d.addEventListener('click', () => {
            onPick(c)
            el.querySelectorAll('.swatch').forEach(x =>
                x.classList.toggle('active', x.dataset.color === c))
        })
        el.appendChild(d)
    }
}
fillSwatches(document.getElementById('bg-swatches'),
    ['#ffffff', '#f5f0e6', '#2b2b2b', '#1a1a1a'], theme.bg, c => saveTheme({ bg: c }))
fillSwatches(document.getElementById('fg-swatches'),
    ['#222222', '#333333', '#e0e0e0', '#d0d0d0'], theme.fg, c => saveTheme({ fg: c }))
fillSwatches(document.getElementById('rt-swatches'),
    ['#6b7280', '#2563eb', '#9ca3af', '#dc2626'], theme.rtColor, c => saveTheme({ rtColor: c }))

function bindRange(inputId, outId, key, fmt) {
    const input = document.getElementById(inputId)
    const out = document.getElementById(outId)
    input.value = theme[key]
    out.textContent = fmt(theme[key])
    input.addEventListener('input', () => {
        const v = +input.value
        out.textContent = fmt(v)
        saveTheme({ [key]: v })
    })
}
bindRange('font-size', 'font-size-val', 'fontSize', v => v + 'px')
bindRange('rt-scale', 'rt-scale-val', 'rtScale', v => v.toFixed(2) + '×')

// 浏览模式：横向翻页 paginated；纵向连贯 scrolled（正文占满宽）。
async function setFlow(flow) {
    // 保存进度（fraction；原 EPUB 与合并 HTML 的 CFI 不通用，用进度估算恢复）
    const prevFraction = view.lastLocation?.fraction
    try {
        await openBook(flow) // 重新 open（横翻=原 EPUB，纵连=合并 HTML）
    } catch (e) { console.warn('[eread] flow switch failed', e); return }
    if (prevFraction != null) {
        setTimeout(() => view.goToFraction?.(prevFraction).catch?.(() => {}), 80)
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
})

document.getElementById('jump-go').addEventListener('click', () => {
    const idx = parseInt(document.getElementById('jump-index').value, 10)
    if (!Number.isNaN(idx)) view.goTo?.(idx).catch?.(e => console.warn('[eread] jump', e))
})

// ---- open ---------------------------------------------------------------
async function openBook(flow, restoreProgress = true) {
    const book = await openForFlow(flow)
    view.close?.() // 关闭旧 renderer（foliate-js 的 open 不自动清理，重新 open 前必须 close）
    await view.open(book)
    console.log('[eread] book opened:', BOOK_URL, 'flow=', flow)
    if (!annotationsCss) {
        try { annotationsCss = await fetchText('./annotate/annotations.css') }
        catch (e) { console.warn('[eread] fetch annotations.css failed', e) }
    }
    const r = view.renderer
    r.setAttribute('margin', '48px')
    r.setAttribute('gap', '10%')
    r.setAttribute('flow', flow)
    r.setAttribute('max-inline-size', flow === 'scrolled' ? '2000px' : '672px')
    applyTheme()
    r.next()
    // 恢复阅读进度（首次打开时；切换 flow 走 setFlow 的 fraction 恢复）
    if (restoreProgress) {
        const cfi = loadProgress()
        if (cfi) {
            setTimeout(() => view.goTo(cfi).catch(() => {}), 150)
        }
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
