// Eread shared reader settings — stored in localStorage so the shelf page,
// reader page (☰ menu), and settings page all read/write the SAME settings.
// This is the "阅读内外都可改变且关联" requirement (PRD FR-R2).
//
// Upstream: docs/prd FR-R2, docs/dev/AI执行指导.md.

const KEY = 'eread-settings'

export const DEFAULTS = {
    bg: '#ffffff',        // 背景颜色
    fg: '#222222',        // 文字颜色
    fontSize: 17,         // 正文字号 (px)
    rtScale: 0.62,        // 注释字号 = 正文 × rtScale (<1)
    rtColor: '#6b7280',   // 注释文字颜色
    flow: 'paginated',    // 浏览模式: paginated | scrolled
    searchSite: 'google', // 单词搜索跳转网站 (FR-D3)
    // 翻译 API 配置 (BYOK, FR-M1/M2) — base_url/model 存 localStorage；
    // apiKey 存 Android Keystore（不落 localStorage 明文，NFR-SEC1）
    apiBaseUrl: 'https://api.deepseek.com',
    apiModel: 'deepseek-chat',
    // 主题 / 壁纸（UI 美化）
    theme: 'light',          // 预设主题: light | dark | sepia
    wallpaper: '',           // 阅读壁纸 dataURL（空 = 无壁纸）
    wallpaperBlur: 0,        // 壁纸模糊度 0-20 (px)
    wallpaperOpacity: 0.35,  // 壁纸遮罩透明度 0-1
    popupPosition: 'bottom-left', // 查词弹窗位置: bottom-left | around-word
    shelfBg: '#f5f5f5',           // 页面（书架/用户页）背景主题，与阅读背景区分
    shelfWallpaper: '',           // 页面（书架/用户页）壁纸 dataURL（空 = 无）
}

/** 预设主题（一键设置全量颜色：背景/文字/栏/卡片/按钮）。 */
export const THEMES = {
    light: {
        label: '浅色', bg: '#ffffff', fg: '#222222',
        pageBg: '#f5f5f5', barBg: '#ffffff', cardBg: '#ffffff',
        btnBg: '#ffffff', btnFg: '#333333', btnBorder: '#dddddd', accent: '#2563eb',
    },
    dark: {
        label: '深色', bg: '#16161a', fg: '#e4e4e7',
        pageBg: '#1a1a1e', barBg: '#1f1f23', cardBg: '#1f1f23',
        btnBg: '#2a2a2f', btnFg: '#e4e4e7', btnBorder: '#3a3a40', accent: '#3b82f6',
    },
    sepia: {
        label: '护眼', bg: '#f5f0e6', fg: '#4a3f35',
        pageBg: '#ece4d4', barBg: '#f5f0e6', cardBg: '#f5f0e6',
        btnBg: '#f5f0e6', btnFg: '#4a3f35', btnBorder: '#d8cbb5', accent: '#2563eb',
    },
}

/** 把当前主题应用到 document 的 CSS 变量（全局主题，所有页面统一）。 */
export function applyThemeVars() {
    const s = loadSettings()
    const t = THEMES[s.theme] ?? THEMES.light
    const root = document.documentElement
    root.style.setProperty('--app-bg', t.pageBg)
    root.style.setProperty('--app-fg', t.fg)
    root.style.setProperty('--app-bar', t.barBg)
    root.style.setProperty('--app-card', t.cardBg)
    root.style.setProperty('--app-btn-bg', t.btnBg)
    root.style.setProperty('--app-btn-fg', t.btnFg)
    root.style.setProperty('--app-btn-border', t.btnBorder)
    root.style.setProperty('--app-accent', t.accent)
}

/** 单词搜索跳转网站的 URL 模板（{word} 占位）。后续可扩充。 */
export const SEARCH_SITES = {
    google: 'https://translate.google.com/?sl=en&tl=zh-CN&text={word}',
    youdao: 'https://dict.youdao.com/w/eng/{word}',
    eudic: 'https://dict.eudic.net/dicts/en/{word}',
}

export function loadSettings() {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    } catch { return { ...DEFAULTS } }
}

export function saveSettings(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

/** Merge a partial patch into current settings and persist. */
export function updateSettings(patch) {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    return next
}

/** Build the URL to search `word` using the currently configured site. */
export function searchUrl(word, settings = loadSettings()) {
    const tpl = SEARCH_SITES[settings.searchSite] ?? SEARCH_SITES.google
    return tpl.replace('{word}', encodeURIComponent(word))
}

/** 颜色浅/深变体：amt>0 变亮，amt<0 变暗。用于顶栏/底栏跟随背景（深浅差异）。 */
export function shadeColor(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex || '#fff'
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const t = amt < 0 ? 0 : 255
    const p = Math.abs(amt)
    return `rgb(${Math.round(r + (t - r) * p)}, ${Math.round(g + (t - g) * p)}, ${Math.round(b + (t - b) * p)})`
}

/** 判断颜色是否偏暗（用于决定顶栏/底栏是变浅还是变深）。 */
export function isDarkColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return false
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return (r * 299 + g * 587 + b * 114) / 1000 < 128
}
