// Eread favorite detail page — 收藏条目的完整信息（原文 / 你的翻译 / 评分 / 完整测评）。

import { applyPageTheme } from './ui.js'
import { escapeHtml, renderEvalResultHtml, bindQueryButtons } from './dict/detail.js'

applyPageTheme()

const FAV_KEY = 'eread-practice-favorites'

function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
}
function dirLabel(d) { return d === 'zh2en' ? '中译英' : '英译中' }

const params = new URLSearchParams(location.hash.replace(/^#/, ''))
const id = parseInt(params.get('id'), 10)
const item = getFavorites().find(x => x.id === id)

const detailEl = document.getElementById('detail')

if (!item) {
    detailEl.innerHTML = '<div class="ed-empty">未找到该收藏</div>'
} else {
    const rows = []
    rows.push(`<div class="fav-dir">${escapeHtml(dirLabel(item.direction))}</div>`)
    rows.push(`<div class="ed-section">原文</div>`)
    rows.push(`<div class="fav-sentence">${escapeHtml(item.sentence)}</div>`)

    // 兼容旧结构（无 attempts）：从 user/score/result 构造单次
    const attempts = (Array.isArray(item.attempts) && item.attempts.length)
        ? item.attempts
        : ((item.user || item.score != null || item.result)
            ? [{ user: item.user ?? '', score: item.score ?? null, result: item.result ?? null, standard: item.standard ?? '' }]
            : [])

    attempts.forEach((a, i) => {
        const label = attempts.length > 1 ? `我的回答 ${i + 1}` : '我的回答'
        rows.push(`<div class="ed-section">${label}</div>`)
        rows.push(`<div class="fav-user">${escapeHtml(a.user ?? '')}</div>`)
        if (a.result && typeof a.result === 'object') {
            rows.push(renderEvalResultHtml(a.result))
        } else if (a.standard) {
            rows.push(`<div class="ed-section">标准翻译</div>`)
            rows.push(`<div class="ed-sense">${escapeHtml(a.standard)}</div>`)
        }
    })

    detailEl.innerHTML = rows.join('')
    bindQueryButtons(detailEl)
}

document.getElementById('back-btn').addEventListener('click', () => {
    if (history.length > 1) history.back()
    else location.href = 'favorites.html'
})
