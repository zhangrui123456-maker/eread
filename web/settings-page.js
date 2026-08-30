// Eread settings page (统一设置页) — reads/writes the SAME settings as the
// reader ☰ menu via localStorage (内外关联). Upstream: docs/prd FR-R2, FR-D3.

import { loadSettings, updateSettings, THEMES, applyThemeVars } from './settings.js'
import { bridgeCall, _installShellCallbacks } from './bridge/messages.js'
import { putWallpaper } from './db.js'

applyThemeVars() // 设置页也跟随全局主题

/** dataURL → Blob（壁纸存 IndexedDB，避开 localStorage 5MB 限制）。 */
function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',')
    const mime = (head.match(/data:(.*?);/) || [, 'image/jpeg'])[1]
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
}

if (typeof window.ereadBridge !== 'undefined') {
    _installShellCallbacks(window.ereadBridge)
}

let s = loadSettings()

// ---- 主题预设 ----
const themeButtons = document.getElementById('theme-buttons')
themeButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === s.theme))
themeButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-theme]')
    if (!b) return
    const t = THEMES[b.dataset.theme]
    s = updateSettings({ theme: b.dataset.theme, bg: t.bg, fg: t.fg, shelfBg: t.pageBg })
    themeButtons.querySelectorAll('button').forEach(x =>
        x.classList.toggle('active', x === b))
    // 同步色块高亮
    document.querySelectorAll('#bg-swatches .swatch').forEach(x =>
        x.classList.toggle('active', x.dataset.color === t.bg))
    document.querySelectorAll('#fg-swatches .swatch').forEach(x =>
        x.classList.toggle('active', x.dataset.color === t.fg))
})

// 返回（浮动键）
document.getElementById('back-btn').addEventListener('click', () => {
    if (history.length > 1) history.back()
    else location.href = 'user.html'
})

// ---- swatches ----
function fillSwatches(el, colors, current, key) {
    el.innerHTML = ''
    for (const c of colors) {
        const d = document.createElement('div')
        d.className = 'swatch' + (c === current ? ' active' : '')
        d.style.background = c
        d.dataset.color = c
        d.addEventListener('click', () => {
            const patch = { [key]: c }
            if (key === 'bg') patch.wallpaper = '' // 选纯色背景则清除壁纸（同层次二选一）
            s = updateSettings(patch)
            el.querySelectorAll('.swatch').forEach(x =>
                x.classList.toggle('active', x.dataset.color === c))
        })
        el.appendChild(d)
    }
}
fillSwatches(document.getElementById('bg-swatches'),
    ['#ffffff', '#f5f0e6', '#2b2b2b', '#1a1a1a'], s.bg, 'bg')
fillSwatches(document.getElementById('fg-swatches'),
    ['#222222', '#333333', '#e0e0e0', '#d0d0d0'], s.fg, 'fg')
fillSwatches(document.getElementById('rt-swatches'),
    ['#6b7280', '#2563eb', '#9ca3af', '#dc2626'], s.rtColor, 'rtColor')

// ---- ranges ----
function bindRange(inputId, outId, key, fmt) {
    const input = document.getElementById(inputId)
    const out = document.getElementById(outId)
    input.value = s[key]
    out.textContent = fmt(s[key])
    input.addEventListener('input', () => {
        const v = +input.value
        s = updateSettings({ [key]: v })
        out.textContent = fmt(v)
    })
}
bindRange('font-size', 'font-size-val', 'fontSize', v => v + 'px')
bindRange('rt-scale', 'rt-scale-val', 'rtScale', v => v.toFixed(2) + '×')

// ---- flow ----
const flowButtons = document.getElementById('flow-buttons')
flowButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.flow === s.flow))
flowButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-flow]')
    if (!b) return
    s = updateSettings({ flow: b.dataset.flow })
    flowButtons.querySelectorAll('button').forEach(x =>
        x.classList.toggle('active', x === b))
})

// ---- search site (FR-D3) ----
const siteSel = document.getElementById('search-site')
siteSel.value = s.searchSite
siteSel.addEventListener('change', () => {
    s = updateSettings({ searchSite: siteSel.value })
})

// ---- 翻译 API 配置 (BYOK, FR-M1/M2) ----
function bindField(inputId, key) {
    const input = document.getElementById(inputId)
    input.value = s[key] ?? ''
    input.addEventListener('change', () => {
        s = updateSettings({ [key]: input.value.trim() })
    })
}
bindField('api-base-url', 'apiBaseUrl')
bindField('api-model', 'apiModel')

// apiKey 存 Kotlin Keystore（不落 localStorage 明文，NFR-SEC1）
const apiKeyInput = document.getElementById('api-key')
apiKeyInput.placeholder = '输入 API Key'

// 「保存配置」按钮：保存 base_url/model/key（key 加密）后生效
document.getElementById('api-save').addEventListener('click', () => {
    const key = apiKeyInput.value.trim()
    bridgeCall('saveApiConfig', { apiBaseUrl: s.apiBaseUrl, apiModel: s.apiModel, apiKey: key })
    if (key) apiKeyInput.value = ''
    const btn = document.getElementById('api-save')
    const orig = btn.textContent
    btn.textContent = '✓ 已保存'
    setTimeout(() => { btn.textContent = orig }, 1500)
})

// ---- 阅读壁纸 ----
document.getElementById('wallpaper-btn').addEventListener('click', async () => {
    if (typeof window.ereadBridge === 'undefined') { alert('需在 App 内使用'); return }
    const res = await bridgeCall('openImagePicker', {})
    if (!res.ok) return
    await putWallpaper('wallpaper', dataUrlToBlob(res.dataUrl)) // 存 IndexedDB
    s = updateSettings({ wallpaper: 'set' }) // 只存标记
})

document.getElementById('wallpaper-clear').addEventListener('click', () => {
    s = updateSettings({ wallpaper: '' })
})

// ---- 页面背景（书架/用户页，需求3/5）----
fillSwatches(document.getElementById('shelf-bg-swatches'),
    ['#f5f5f5', '#ffffff', '#1a1a1a', '#2b2b2b'], s.shelfBg, 'shelfBg')
document.getElementById('shelf-wallpaper-btn').addEventListener('click', async () => {
    if (typeof window.ereadBridge === 'undefined') { alert('需在 App 内使用'); return }
    const res = await bridgeCall('openImagePicker', {})
    if (!res.ok) return
    await putWallpaper('shelfWallpaper', dataUrlToBlob(res.dataUrl))
    s = updateSettings({ shelfWallpaper: 'set' })
})
document.getElementById('shelf-wallpaper-clear').addEventListener('click', () => {
    s = updateSettings({ shelfWallpaper: '' })
})

bindRange('wallpaper-blur', 'wallpaper-blur-val', 'wallpaperBlur', v => v + 'px')
bindRange('wallpaper-opacity', 'wallpaper-opacity-val', 'wallpaperOpacity', v => Math.round(v * 100) + '%')

// ---- 查词弹窗位置 ----
const popupPosButtons = document.getElementById('popup-position-buttons')
popupPosButtons.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.pos === s.popupPosition))
popupPosButtons.addEventListener('click', e => {
    const b = e.target.closest('button[data-pos]')
    if (!b) return
    s = updateSettings({ popupPosition: b.dataset.pos })
    popupPosButtons.querySelectorAll('button').forEach(x =>
        x.classList.toggle('active', x === b))
})
