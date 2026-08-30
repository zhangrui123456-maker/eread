// Eread user page — a list of entries (设置 → settings page).
// Upstream: docs/prd FR-R2.

import { loadSettings, shadeColor, isDarkColor, applyThemeVars } from '../settings.js'
import { getWallpaper } from '../db.js'

// 页面背景主题 + 顶栏/底栏颜色跟随（需求5）
async function applyPageTheme() {
    applyThemeVars() // 全局主题变量
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
    setBg(appEl)          // 主体背景
    setBg(document.body)  // body 露出的部分
    const barBg = shadeColor(bg, isDarkColor(bg) ? 0.08 : -0.06)
    document.querySelectorAll('.topbar, .bottombar').forEach(el => { el.style.background = barBg })
}
applyPageTheme()

// 底部 tab 导航（书架 | 用户）
document.querySelectorAll('.bottombar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.dataset.page === 'shelf') location.href = 'index.html'
    })
})

// 「设置」栏项 → 统一设置页
document.getElementById('settings-item').addEventListener('click', () => {
    location.href = 'settings.html'
})

// 根据主题切换底部 tab 图标（深色主题用浅色图标）
function applyTabIcons() {
    const suffix = loadSettings().theme === 'dark' ? 'light' : 'dark'
    document.querySelectorAll('.tab-icon').forEach(img => {
        const name = img.src.includes('home') ? 'home' : 'user'
        img.src = `ico/${name}-${suffix}.png`
    })
}
applyTabIcons()
