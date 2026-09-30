// Eread practice page — 翻译练习（英译中 / 中译英）。
// 复用共享设置（难度/句长/题材）、AI 桥接（generateSentence/evaluateTranslation）、
// 共享查词详情页（dict/detail.js）。

import { bridgeCall, _installShellCallbacks } from './bridge/messages.js'
import { loadSettings } from './settings.js'
import { applyPageTheme } from './ui.js'
import { escapeHtml, resolveWord, renderEvalResultHtml, bindQueryButtons, showWordPopup } from './dict/detail.js'

if (typeof window.ereadBridge !== 'undefined') {
    _installShellCallbacks(window.ereadBridge)
}

applyPageTheme()

const FAV_KEY = 'eread-practice-favorites'
const STATE_KEY = 'eread-practice-state'

let direction = 'en2zh'
let currentSentence = ''
let lastResult = null // 最后一次测评结果

const sentenceEl = document.getElementById('sentence')
const inputEl = document.getElementById('input')
const resultEl = document.getElementById('result')
const dirLabel = document.getElementById('dir-label')
const newBtn = document.getElementById('new-btn')
const favBtn = document.getElementById('fav-btn')
const evalBtn = document.getElementById('eval-btn')

function hasBridge() {
    const b = window.ereadBridge
    return b && typeof b._invoke === 'function'
}

// ---- 收藏（localStorage）----
function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
}
function saveFavorites(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}
function favorite() {
    if (!currentSentence) { alert('请先生成题目'); return }
    const list = getFavorites()
    if (list.some(x => x.sentence === currentSentence && x.direction === direction)) {
        alert('已在收藏中')
        return
    }
    const attempts = []
    // 若收藏前已测评过，把最后一次结果一并带入（否则第一次评分会丢失）
    if (lastResult) {
        attempts.push({
            user: inputEl.value.trim(),
            score: lastResult.score ?? null,
            result: lastResult,
            standard: lastResult.standard ?? '',
            at: Date.now(),
        })
    }
    list.unshift({
        id: Date.now(), direction, sentence: currentSentence,
        attempts, savedAt: Date.now(),
    })
    saveFavorites(list)
    favBtn.textContent = '✓ 已收藏'
    setTimeout(() => { favBtn.textContent = '收藏' }, 1200)
}
/** 测评后，若当前句子已收藏，追加一次「回答+测评结果」到 attempts（支持多次）。 */
function updateFavoriteResult(data) {
    if (!currentSentence) return
    const list = getFavorites()
    const item = list.find(x => x.sentence === currentSentence && x.direction === direction)
    if (item) {
        if (!Array.isArray(item.attempts)) item.attempts = []
        item.attempts.push({
            user: inputEl.value.trim(),
            score: data?.score ?? null,
            result: data,
            standard: data?.standard ?? '',
            at: Date.now(),
        })
        saveFavorites(list)
    }
}

// ---- 会话状态（跳出再回来不丢题目/回答/结果）----
function saveState() {
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify({
            direction, sentence: currentSentence, answer: inputEl.value, result: lastResult,
        }))
    } catch { /* ignore */ }
}
function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') } catch { return null }
}

// ---- 方向切换 ----
function updatePlaceholder() {
    inputEl.placeholder = direction === 'zh2en'
        ? '输入英文翻译，不认识的可用中文占位…'
        : '输入中文翻译，不认识的可用原英文单词占位…'
}
function setDirection(d) {
    direction = d
    dirLabel.textContent = d === 'zh2en' ? '中译英' : '英译中'
    updatePlaceholder()
    currentSentence = ''
    sentenceEl.textContent = '点击「换一题」生成练习句子'
    resultEl.hidden = true
    resultEl.innerHTML = ''
    inputEl.value = ''
}
document.getElementById('dir-buttons').addEventListener('click', e => {
    const b = e.target.closest('button[data-dir]')
    if (!b) return
    document.querySelectorAll('#dir-buttons button').forEach(x => x.classList.toggle('active', x === b))
    setDirection(b.dataset.dir)
})

/** 渲染题目句子：英译中且开启「点词翻译」时，英文词包成可点击 span。 */
function renderSentence(sentence) {
    const tap = loadSettings().practiceTapLookup !== false && direction === 'en2zh'
    if (!tap) {
        sentenceEl.textContent = sentence
        return
    }
    sentenceEl.innerHTML = sentence.split(/(\s+)/).map(token => {
        const trimmed = token.trim()
        const word = trimmed.replace(/[^A-Za-z'-]/g, '')
        if (word && /[A-Za-z]/.test(trimmed)) {
            return `<span class="tap-word" data-word="${escapeHtml(word)}">${escapeHtml(token)}</span>`
        }
        return escapeHtml(token)
    }).join('')
    sentenceEl.querySelectorAll('.tap-word').forEach(el => {
        el.addEventListener('click', async () => {
            let data = null
            try { data = await resolveWord(el.dataset.word) } catch { /* ignore */ }
            showWordPopup(el.dataset.word, data ?? { translation: '' })
        })
    })
}

// ---- 生成题目 ----
async function generate() {
    if (!hasBridge()) { sentenceEl.textContent = '翻译练习需在 App 内使用'; return }
    const s = loadSettings()
    const length = direction === 'zh2en' ? s.practiceCnLen : s.practiceEnLen
    newBtn.disabled = true
    newBtn.textContent = '…'
    try {
        const res = await bridgeCall('generateSentence', {
            direction,
            difficulty: s.practiceDifficulty,
            length,
            topic: s.practiceTopic ?? '',
            temperature: s.practiceTemperature ?? 1.2,
            apiBaseUrl: s.apiBaseUrl, apiModel: s.apiModel,
        })
        if (!res.ok) {
            sentenceEl.textContent = '生成失败：' + (res.message || res.error || '请确认已配置 API Key')
            return
        }
        const data = JSON.parse(res.content)
        currentSentence = data.sentence ?? ''
        renderSentence(currentSentence || '（未生成到句子）')
        resultEl.hidden = true
        resultEl.innerHTML = ''
        inputEl.value = ''
        lastResult = null
        saveState()
    } catch (e) {
        sentenceEl.textContent = '生成失败：' + (e.message ?? e)
    } finally {
        newBtn.disabled = false
        newBtn.textContent = '换一题'
    }
}

// ---- 测评 ----
async function evaluate() {
    if (!hasBridge()) { alert('翻译练习需在 App 内使用'); return }
    if (!currentSentence) { alert('请先生成题目'); return }
    const user = inputEl.value.trim()
    if (!user) { alert('请输入你的翻译'); return }
    const s = loadSettings()
    evalBtn.disabled = true
    evalBtn.textContent = '测评中…'
    try {
        const res = await bridgeCall('evaluateTranslation', {
            direction,
            difficulty: s.practiceDifficulty,
            source: currentSentence,
            user,
            apiBaseUrl: s.apiBaseUrl, apiModel: s.apiModel,
        })
        if (!res.ok) { alert('测评失败：' + (res.message || res.error || '请确认已配置 API Key')); return }
        const data = JSON.parse(res.content)
        lastResult = data
        renderResult(data)
        updateFavoriteResult(data)
        saveState()
    } catch (e) {
        alert('测评失败：' + (e.message ?? e))
    } finally {
        evalBtn.disabled = false
        evalBtn.textContent = '测评'
    }
}

// ---- 渲染结果（共享 renderEvalResultHtml；英文词旁「查询」按钮跳详情页）----
function renderResult(data) {
    resultEl.innerHTML = renderEvalResultHtml(data)
    resultEl.hidden = false
    bindQueryButtons(resultEl)
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ---- 绑定 ----
newBtn.addEventListener('click', generate)
favBtn.addEventListener('click', favorite)
evalBtn.addEventListener('click', evaluate)
inputEl.addEventListener('input', saveState)
document.getElementById('prefs-btn').addEventListener('click', () => { location.href = 'settings.html' })
document.getElementById('favs-btn').addEventListener('click', () => { location.href = 'favorites.html' })

// 底部 tab 导航
document.querySelectorAll('.bottombar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const p = tab.dataset.page
        if (p === 'shelf') location.href = 'index.html'
        else if (p === 'user') location.href = 'user.html'
    })
})

// 初始化：优先恢复上次会话（题目/回答/结果），否则生成新题
const saved = loadState()
if (saved && saved.sentence) {
    setDirection(saved.direction || 'en2zh')
    document.querySelectorAll('#dir-buttons button').forEach(x => x.classList.toggle('active', x.dataset.dir === direction))
    currentSentence = saved.sentence
    renderSentence(saved.sentence)
    inputEl.value = saved.answer ?? ''
    if (saved.result) {
        lastResult = saved.result
        renderResult(saved.result)
    }
} else {
    setDirection('en2zh')
    generate()
}
