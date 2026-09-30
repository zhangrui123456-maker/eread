// Eread favorites page — 翻译练习收藏（筛选 + 单项/批量删除）。

import { applyPageTheme } from './ui.js'
import { escapeHtml } from './dict/detail.js'

applyPageTheme()

const FAV_KEY = 'eread-practice-favorites'

let filter = 'all'
let selected = new Set() // 选中的收藏 id

const listEl = document.getElementById('list')
const toolbarEl = document.getElementById('fav-toolbar')
const selectAllEl = document.getElementById('select-all')

function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
}
function saveFavorites(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

function dirLabel(d) { return d === 'zh2en' ? '中译英' : '英译中' }

/** 取收藏项的最后一次回答（兼容旧结构 user/score/standard）。 */
function lastAttempt(item) {
    if (Array.isArray(item.attempts) && item.attempts.length) return item.attempts[item.attempts.length - 1]
    if (item.user || item.score != null || item.result) {
        return { user: item.user ?? '', score: item.score ?? null, standard: item.standard ?? '', result: item.result ?? null }
    }
    return null
}

function filteredList() {
    const list = getFavorites()
    if (filter === 'all') return list
    if (filter === 'none') return []
    return list.filter(x => x.direction === filter)
}

function render() {
    const items = filteredList()
    listEl.innerHTML = ''

    if (!items.length) {
        listEl.innerHTML = '<div class="ed-empty">暂无收藏</div>'
        toolbarEl.hidden = true
        return
    }

    toolbarEl.hidden = false

    for (const item of items) {
        const card = document.createElement('div')
        card.className = 'fav-card'
        const last = lastAttempt(item)
        card.innerHTML =
            `<div class="fav-head">` +
                `<input type="checkbox" class="fav-check"/>` +
                `<span class="fav-dir">${escapeHtml(dirLabel(item.direction))}</span>` +
                `<button class="fav-del" type="button" title="删除">删除</button>` +
            `</div>` +
            `<div class="fav-sentence">${escapeHtml(item.sentence)}</div>` +
            (last?.user ? `<div class="fav-user">你的翻译：${escapeHtml(last.user)}</div>` : '') +
            (last?.score != null ? `<div class="fav-score">评分：${escapeHtml(String(last.score))}</div>` : '') +
            (last?.standard ? `<div class="fav-standard">标准：${escapeHtml(last.standard)}</div>` : '')

        listEl.appendChild(card)

        const check = card.querySelector('.fav-check')
        check.checked = selected.has(item.id)
        check.addEventListener('change', () => {
            if (check.checked) selected.add(item.id)
            else selected.delete(item.id)
            updateSelectAll()
        })

        card.querySelector('.fav-del').addEventListener('click', () => {
            if (confirm('删除这条收藏？')) removeItems([item.id])
        })

        // 点击条目 → 跳详情页（新页面）；复选框/删除按钮除外
        card.addEventListener('click', e => {
            if (e.target.closest('.fav-check') || e.target.closest('.fav-del')) return
            location.href = 'favorite-detail.html#id=' + item.id
        })
    }

    updateSelectAll()
}

function removeItems(ids) {
    const idSet = new Set(ids)
    const list = getFavorites().filter(x => !idSet.has(x.id))
    saveFavorites(list)
    ids.forEach(id => selected.delete(id))
    render()
}

function updateSelectAll() {
    const items = filteredList()
    selectAllEl.checked = items.length > 0 && items.every(x => selected.has(x.id))
}

// 全选 / 全不选
selectAllEl.addEventListener('change', () => {
    const items = filteredList()
    if (selectAllEl.checked) items.forEach(x => selected.add(x.id))
    else items.forEach(x => selected.delete(x.id))
    render()
})

// 批量删除
document.getElementById('delete-selected').addEventListener('click', () => {
    if (!selected.size) { alert('请先选择要删除的收藏'); return }
    if (confirm(`删除选中的 ${selected.size} 条收藏？`)) {
        removeItems([...selected])
    }
})

// 筛选
document.getElementById('filter-buttons').addEventListener('click', e => {
    const b = e.target.closest('button[data-filter]')
    if (!b) return
    filter = b.dataset.filter
    document.querySelectorAll('#filter-buttons button').forEach(x => x.classList.toggle('active', x === b))
    selected.clear()
    render()
})

// 返回
document.getElementById('back-btn').addEventListener('click', () => {
    if (history.length > 1) history.back()
    else location.href = 'practice.html'
})

// 底部 tab
document.querySelectorAll('.bottombar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const p = tab.dataset.page
        if (p === 'shelf') location.href = 'index.html'
        else if (p === 'practice') location.href = 'practice.html'
        else if (p === 'user') location.href = 'user.html'
    })
})

render()
