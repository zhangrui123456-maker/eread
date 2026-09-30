// Eread shared UI helpers — fillSwatches / bindRange / applyPageTheme were each
// duplicated across reader/app.js, settings-page.js, shelf/shelf.js and
// user/user.js. Consolidated here (结构收敛), no behaviour change.
//
// Upstream: docs/dev/AI执行指导.md T2.x (UI 内外关联, PRD FR-R2).

import { loadSettings, applyThemeVars, shadeColor, isDarkColor } from './settings.js'
import { getWallpaper } from './db.js'

/** 填充色块容器；点击色块触发 onPick(color)。 */
export function fillSwatches(el, colors, current, onPick) {
    el.innerHTML = ''
    for (const c of colors) {
        const d = document.createElement('div')
        d.className = 'swatch' + (c === current ? ' active' : '')
        d.style.background = c
        d.dataset.color = c
        d.setAttribute('role', 'button')
        d.setAttribute('aria-label', '颜色 ' + c)
        d.setAttribute('tabindex', '0')
        d.addEventListener('click', () => {
            onPick(c)
            el.querySelectorAll('.swatch').forEach(x =>
                x.classList.toggle('active', x.dataset.color === c))
        })
        el.appendChild(d)
    }
}

/** 绑定滑杆 + 数值输出；fmt(v) 格式化，onChange(v) 持久化。 */
export function bindRange(inputId, outId, value, fmt, onChange) {
    const input = document.getElementById(inputId)
    const out = document.getElementById(outId)
    input.value = value
    out.textContent = fmt(value)
    input.addEventListener('input', () => {
        const v = +input.value
        out.textContent = fmt(v)
        onChange(v)
    })
}

/** 书架 / 用户页背景主题 + 顶栏底栏颜色跟随（需求5）。 */
export async function applyPageTheme() {
    applyThemeVars()
    const s = loadSettings()
    const bg = s.shelfBg || '#f5f5f5'
    const appEl = document.querySelector('.app')
    let wallpaperUrl = null
    if (s.shelfWallpaper) {
        try {
            const blob = await getWallpaper('shelfWallpaper')
            if (blob) wallpaperUrl = URL.createObjectURL(blob)
        } catch { /* ignore */ }
    }
    const setBg = (el) => {
        if (!el) return
        if (wallpaperUrl) {
            el.style.backgroundImage = `url(${wallpaperUrl})`
            el.style.backgroundSize = 'cover'
            el.style.backgroundPosition = 'center'
            el.style.background = ''
        } else {
            el.style.backgroundImage = ''
            el.style.background = bg
        }
    }
    setBg(appEl)
    setBg(document.body)
    const barBg = shadeColor(bg, isDarkColor(bg) ? 0.08 : -0.06)
    document.querySelectorAll('.topbar, .bottombar').forEach(el => { el.style.background = barBg })
}
