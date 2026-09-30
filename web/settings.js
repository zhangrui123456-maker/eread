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
    rtColor: '#787774',   // 注释文字颜色
    flow: 'paginated',    // 浏览模式: paginated | scrolled
    scrollMode: 'native', // 纵向连贯滑动方式: native(原生) | variable(差速)
    scrollFactor: 1,      // 差速滑动系数（划距 × 系数 = 滚动距离，0.5~1）
    scrollDirection: 'reverse', // 差速滑动方向: reverse(手下滑→看下文) | natural(手下滑→看上文)
    // 翻译练习偏好
    practiceDifficulty: 'gaokao', // 练习难度: zhongkao|gaokao|cet4|cet6|ielts|toefl
    practiceEnLen: 20,            // 英译中：英文词数目标
    practiceCnLen: 25,            // 中译英：中文字数目标
    practiceTopic: '',            // 题材偏好描述（空=无限定）
    practiceTapLookup: true,      // 练习题目点词翻译开关
    practiceTemperature: 1.2,     // 生成句子随机参数（temperature，越高越随机）
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
    lookupMode: 'online-first',   // 查词方式: online-first(联网优先) | local-first(本地优先)
    shelfBg: '#f5f5f5',           // 页面（书架/用户页）背景主题，与阅读背景区分
    shelfWallpaper: '',           // 页面（书架/用户页）壁纸 dataURL（空 = 无）
}

/** 预设主题（一键设置全量颜色：背景/文字/栏/卡片/按钮）。 */
export const THEMES = {
    light: {
        label: '浅色', bg: '#ffffff', fg: '#1c1917',
        pageBg: '#f7f6f3', barBg: '#ffffff', cardBg: '#ffffff',
        btnBg: '#ffffff', btnFg: '#1c1917', btnBorder: '#e7e5e4', accent: '#1c1917',
    },
    dark: {
        label: '深色', bg: '#1c1b1a', fg: '#edebe7',
        pageBg: '#161514', barBg: '#1c1b1a', cardBg: '#201e1d',
        btnBg: '#262423', btnFg: '#edebe7', btnBorder: '#343230', accent: '#edebe7',
    },
    sepia: {
        label: '护眼', bg: '#f5efe3', fg: '#4a3f35',
        pageBg: '#ece4d4', barBg: '#f5efe3', cardBg: '#f5efe3',
        btnBg: '#f5efe3', btnFg: '#4a3f35', btnBorder: '#d8cbb5', accent: '#4a3f35',
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
