// Eread 共享查词详情页（全屏覆盖层，ed-* 风格）。
// reader 页（点词查词）与 practice 页（测评结果里的「查询」按钮）共用，
// 复用离线词典 dict.js + 联网 AI 释义（BYOK）。
// 提炼自 annotate/apply.js 的 openDetail/populateDetail；段落赏析改为 opts.grammar 传入。

import { loadDict, loadRich, lookup, lookupEntry } from './dict.js'
import { bridgeCall } from '../bridge/messages.js'
import { loadSettings, searchUrl } from '../settings.js'

const WORD_DETAIL_KEY = 'eread-word-detail'

/** HTML 转义（防注入）。 */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ---- 词 AI 详情缓存（按词缓存，避免重复调模型）----
function getCachedWord(word) {
    try { return JSON.parse(localStorage.getItem(WORD_DETAIL_KEY) || '{}')[word] || null } catch { return null }
}
function cacheWord(word, data) {
    try {
        const map = JSON.parse(localStorage.getItem(WORD_DETAIL_KEY) || '{}')
        map[word] = data
        localStorage.setItem(WORD_DETAIL_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
}
function clearCachedWord(word) {
    try {
        const map = JSON.parse(localStorage.getItem(WORD_DETAIL_KEY) || '{}')
        delete map[word]
        localStorage.setItem(WORD_DETAIL_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
}

/** 联网查词：调模型（BYOK），失败返回 null。结果按词缓存，避免重复消耗 token。 */
async function onlineLookup(text) {
    const cached = getCachedWord(text)
    if (cached) return cached
    try {
        const s = loadSettings()
        const res = await bridgeCall('translate', { text, kind: 'word', apiBaseUrl: s.apiBaseUrl ?? '', apiModel: s.apiModel ?? '' })
        if (!res.ok) return null
        const data = JSON.parse(res.content)
        data.source = 'ai'
        cacheWord(text, data)
        return data
    } catch { return null }
}

/** 本地查词：查离线词典，未命中返回 null。 */
function localLookup(text) {
    const e = lookup(text)
    return e ? { translation: e.gloss, source: 'local' } : null
}

/** 按「查词方式」设置决定优先顺序：local-first 先本地后联网，online-first 反之。 */
export async function resolveWord(text) {
    await loadDict()
    const mode = loadSettings().lookupMode ?? 'online-first'
    if (mode === 'local-first') return localLookup(text) ?? await onlineLookup(text)
    return await onlineLookup(text) ?? localLookup(text)
}

// ---- 全屏详情页 ----
let activeDetail = null
function closeDetail() { activeDetail?.remove(); activeDetail = null }

/** 打开应用内详情页：本地富词典完整条目（音标/多义项/例句）为主，
 *  顶部附 AI 释义（联网结果，若有）。opts.grammar 为可选的段落赏析文本（仅 reader 传）。 */
export function openWordDetail(word, quickData, opts = {}) {
    closeDetail()

    const div = window.document.createElement('div')
    div.className = 'eread-detail'
    div.innerHTML =
        `<div class="ed-header">` +
            `<strong>词典详情</strong>` +
            `<div class="ed-actions">` +
                `<button class="ed-refresh" type="button">刷新</button>` +
                `<button class="ed-web" type="button">网页搜索</button>` +
                `<button class="ed-close" title="关闭" aria-label="关闭"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` +
            `</div>` +
        `</div>` +
        `<div class="ed-body"><div class="ed-loading">加载中…</div></div>`
    window.document.body.appendChild(div)
    activeDetail = div

    div.querySelector('.ed-close').addEventListener('click', closeDetail)
    div.addEventListener('click', e => { if (e.target === div) closeDetail() }) // 点空白遮罩关闭
    div.querySelector('.ed-web').addEventListener('click', () => {
        bridgeCall('openExternal', { url: searchUrl(word) }) // 跳系统浏览器（次要出口）
    })
    div.querySelector('.ed-refresh').addEventListener('click', async () => {
        clearCachedWord(word) // 清缓存强制重查（默认走缓存省 token，刷新时手动重查）
        const fresh = await onlineLookup(word)
        populateDetail(div, word, fresh ?? quickData, opts)
    })

    populateDetail(div, word, quickData, opts)
    return div
}

/** 填充详情页：富词典条目为主，AI 释义置顶，均无则提示。 */
async function populateDetail(div, word, quickData, opts = {}) {
    let entry = null
    try { await loadRich(); entry = lookupEntry(word) } catch { /* 富词典加载失败走兜底 */ }

    const grammar = opts.grammar ?? null

    const rows = []
    const phonetic = entry?.uk
        ? `UK /${escapeHtml(entry.uk)}/${entry.us ? '  US /' + escapeHtml(entry.us) + '/' : ''}`
        : (quickData?.phonetic ? `/${escapeHtml(quickData.phonetic)}/` : '')
    rows.push(`<div class="ed-word">${escapeHtml(word)}</div>`)
    if (phonetic) rows.push(`<div class="ed-phonetic">${phonetic}</div>`)

    if (quickData?.source === 'ai' && quickData.translation) {
        rows.push(`<div class="ed-ai">AI 释义：${escapeHtml(quickData.translation)}</div>`)
    }

    // 常用词组搭配（AI 返回，随词缓存）
    const phrases = quickData?.phrases
    if (Array.isArray(phrases) && phrases.length) {
        rows.push(`<div class="ed-section">常用词组搭配</div>`)
        for (const ph of phrases) {
            rows.push(`<div class="ed-sense"><span class="ed-pos">${escapeHtml(ph.phrase ?? '')}</span> ${escapeHtml(ph.translation ?? '')}</div>`)
        }
    }

    // 段落赏析（仅 reader 传入时显示）
    if (grammar) {
        rows.push(`<div class="ed-section">段落赏析</div>`)
        rows.push(`<div class="ed-grammar">${escapeHtml(grammar)}</div>`)
    }

    const translations = entry?.translations ?? null
    if (translations && translations.length) {
        rows.push(`<div class="ed-section">释义</div>`)
        for (const t of translations) {
            const pos = t.type ? `<span class="ed-pos">${escapeHtml(t.type)}.</span> ` : ''
            rows.push(`<div class="ed-sense">${pos}${escapeHtml(t.translation ?? '')}</div>`)
        }
    } else if (quickData?.translation) {
        rows.push(`<div class="ed-section">释义</div>`)
        rows.push(`<div class="ed-sense">${escapeHtml(quickData.translation)}</div>`)
    }

    const sentences = entry?.sentences ?? null
    if (sentences && sentences.length) {
        rows.push(`<div class="ed-section">例句</div>`)
        for (const s of sentences) {
            rows.push(`<div class="ed-ex"><p class="ed-ex-en">${escapeHtml(s.sentence ?? '')}</p><p class="ed-ex-cn">${escapeHtml(s.translation ?? '')}</p></div>`)
        }
    }

    if (rows.length <= 1) rows.push(`<div class="ed-empty">未找到释义</div>`)

    div.querySelector('.ed-body').innerHTML = rows.join('')
}

/** 把测评结果渲染成 HTML（评分/纠错/词汇讲解/标准翻译），练习页与收藏页共用。
 *  返回 HTML 字符串；调用方负责写入 DOM，并调用 bindQueryButtons 绑定「查询」。 */
export function renderEvalResultHtml(data) {
    const rows = []
    rows.push(`<div class="ed-section">评分</div>`)
    rows.push(`<div class="pr-score">${escapeHtml(String(data?.score ?? '—'))}</div>`)
    if (data?.overall) rows.push(`<div class="ed-ai">${escapeHtml(data.overall)}</div>`)

    if (Array.isArray(data?.corrections) && data.corrections.length) {
        rows.push(`<div class="ed-section">纠错</div>`)
        for (const c of data.corrections) {
            const fix = c.fix ? ` → ${c.fix}` : ''
            rows.push(`<div class="pr-correction">${escapeHtml(c.issue ?? '')}${escapeHtml(fix)}</div>`)
        }
    }

    if (Array.isArray(data?.vocab) && data.vocab.length) {
        rows.push(`<div class="ed-section">词汇讲解</div>`)
        for (const v of data.vocab) {
            const word = v.word ?? ''
            rows.push(
                `<div class="pr-vocab">` +
                    `<span class="pr-vocab-word">${escapeHtml(word)}</span>` +
                    (v.gloss ? `<span class="pr-vocab-gloss">${escapeHtml(v.gloss)}</span>` : '') +
                    (word ? `<button class="pr-query" type="button" data-word="${escapeHtml(word)}" data-gloss="${escapeHtml(v.gloss ?? '')}">查询</button>` : '') +
                `</div>`
            )
            if (v.explain) rows.push(`<div class="pr-vocab-explain">${escapeHtml(v.explain)}</div>`)
        }
    }

    if (data?.standard) {
        rows.push(`<div class="ed-section">标准翻译</div>`)
        rows.push(`<div class="ed-sense">${escapeHtml(data.standard)}</div>`)
    }

    return rows.join('')
}

/** 给容器内的 .pr-query「查询」按钮绑定点词查词（跳共享详情页）。 */
export function bindQueryButtons(container) {
    container.querySelectorAll('.pr-query').forEach(btn => {
        btn.addEventListener('click', () => {
            openWordDetail(btn.dataset.word, { translation: btn.dataset.gloss ?? '', source: 'ai' })
        })
    })
}

// ---- 查词弹窗（点词即时释义，同阅读页 ep-* 弹窗；点「详情」进详情页）----
let activePopup = null
function dismissPopup() { activePopup?.remove(); activePopup = null }

/** 弹出查词弹窗（单词/词性/音标/释义 + 详情入口），5s 自动消失。 */
export function showWordPopup(word, data) {
    dismissPopup()
    const div = window.document.createElement('div')
    div.className = 'eread-popup'
    div.innerHTML =
        `<div class="ep-word">${escapeHtml(word)}</div>` +
        (data?.pos ? `<div class="ep-pos">${escapeHtml(data.pos)}${data.phonetic ? ' · ' + escapeHtml(data.phonetic) : ''}</div>` : '') +
        `<div class="ep-trans">${escapeHtml(data?.translation ?? '')}</div>` +
        `<div class="ep-detail"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>详情</div>`
    window.document.body.appendChild(div)
    activePopup = div

    div.querySelector('.ep-detail').addEventListener('click', () => {
        dismissPopup()
        openWordDetail(word, data)
    })

    setTimeout(() => { if (activePopup === div) { activePopup = null; div.remove() } }, 5000)
    return div
}
