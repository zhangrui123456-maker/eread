// Eread M2 — on-demand annotation + tap-to-lookup.
//
// setupAnnotations: insert a "译" trigger before each paragraph; clicking it
//   annotates that paragraph (bridgeCall('segment') → engine → <ruby> glosses).
// setupWordLookup: tap a word to select it and show a popup with translation /
//   pos / phonetic (FR-D1/D2), via bridgeCall('translate').
//
// Upstream: docs/dev/AI执行指导.md T2.3/T2.4, docs/prd FR-A1/A2/A3/FR-D1/D2.

import { toAnnotatedRuns, renderRuns } from './engine.js'
import { bridgeCall } from '../bridge/messages.js'
import { loadSettings, searchUrl } from '../settings.js'

function hasBridge() {
    const b = window.ereadBridge
    return b && typeof b._invoke === 'function'
}

/** BYOK model config from shared settings (FR-M1/M2). apiKey 不传 —— 由
 *  native 从 Android Keystore 解密读取（NFR-SEC1），Web 层不接触 key。 */
function apiParams() {
    const s = loadSettings()
    return {
        apiBaseUrl: s.apiBaseUrl ?? '',
        apiModel: s.apiModel ?? '',
    }
}

// ---- paragraph annotation ----------------------------------------------

/** scrolled 模式下，foliate-js 会把图片 max-height 限制为屏幕高（setImageSize），
 *  导致整页插图被压扁、无法正常纵向连贯。延迟到 setImageSize 之后重置为 none，
 *  让图片保持自然高度随正文滚动。 */
function fixScrolledImages(doc) {
    const reset = () => {
        doc.querySelectorAll('img, svg, video').forEach(el => {
            el.style.setProperty('max-height', 'none', 'important')
            el.style.setProperty('max-width', '100%', 'important')
            el.style.setProperty('object-fit', 'contain', 'important')
        })
    }
    // 双 rAF + timeout，确保在 foliate-js 的 setImageSize 之后执行
    requestAnimationFrame(() => requestAnimationFrame(reset))
    setTimeout(reset, 120)
}

/** 翻译缓存：段前「译」标注的 segment 结果，按书 id + 段落文本缓存，
 *  重新打开/翻页时恢复标注，不重复 AI 翻译（需求1）。 */
const TRANSLATION_KEY = 'eread-translation'
function getCachedSegments(bookId, paraText) {
    try {
        return JSON.parse(localStorage.getItem(TRANSLATION_KEY) || '{}')[bookId]?.[paraText] || null
    } catch { return null }
}
function cacheSegments(bookId, paraText, segments) {
    try {
        const map = JSON.parse(localStorage.getItem(TRANSLATION_KEY) || '{}')
        map[bookId] = map[bookId] || {}
        map[bookId][paraText] = segments
        localStorage.setItem(TRANSLATION_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
}

/** Insert a click-to-annotate trigger before each paragraph in `doc`. */
export function setupAnnotations(doc, opts = {}) {
    const onStatus = opts.onStatus ?? (() => {})
    const bookId = opts.bookId ?? ''
    if (!hasBridge()) { onStatus('no bridge — annotation skipped (browser mode)'); return }

    if (loadSettings().flow === 'scrolled') {
        fixScrolledImages(doc)
    }

    const paragraphs = [...doc.querySelectorAll('p')]
        .filter(p => (p.textContent || '').trim().length >= 15)

    for (const p of paragraphs) {
        const btn = doc.createElement('span')
        btn.className = 'eread-trigger'
        btn.textContent = '译'
        btn.setAttribute('role', 'button')
        btn.addEventListener('click', () => annotateParagraph(doc, p, btn, onStatus, bookId))
        p.insertAdjacentElement('beforebegin', btn)
    }
    onStatus('added ' + paragraphs.length + ' trigger(s)')
}

async function annotateParagraph(doc, p, btn, onStatus, bookId) {
    if (btn.classList.contains('done')) {
        // 撤销标注：恢复原文
        if (btn._originalHtml) p.innerHTML = btn._originalHtml
        btn.classList.remove('done')
        btn.textContent = '译'
        onStatus('已取消标注')
        return
    }
    btn._originalHtml = p.innerHTML // 保存原文用于撤销
    const text = p.textContent
    btn.textContent = '…'

    // ① 先查翻译缓存，命中则直接用（不调 AI）
    let segments = getCachedSegments(bookId, text)
    if (!segments) {
        // ② 未命中：调 AI 划线 + 缓存
        let res
        try { res = await bridgeCall('segment', { text, ...apiParams() }) }
        catch (e) { btn.textContent = '译'; onStatus('segment bridge error: ' + e.message); return }
        if (!res.ok) { btn.textContent = '译'; onStatus('segment failed: ' + (res.error ?? '?')); return }
        try { segments = (JSON.parse(res.content).segments ?? []).filter(s => s.text) }
        catch { btn.textContent = '译'; onStatus('bad segment JSON'); return }
        if (segments.length) cacheSegments(bookId, text, segments)
    }
    if (!segments.length) { btn.textContent = '译'; onStatus('no segments'); return }

    const { runs } = toAnnotatedRuns(text, segments)
    renderRuns(doc, p, runs)
    btn.classList.add('done')
    btn.textContent = '✓'
    onStatus('annotated paragraph')
}

// ---- tap-to-lookup -----------------------------------------------------

// 模块级单例弹窗：全局只存在一个，跨 section 也只一个。
let activePopup = null
function dismissPopup() { activePopup?.remove(); activePopup = null }

/** Tap a word → select it → popup with translation/pos/phonetic. */
export function setupWordLookup(doc, opts = {}) {
    const onStatus = opts.onStatus ?? (() => {})
    if (!hasBridge()) return

    doc.addEventListener('click', async e => {
        if (activePopup && activePopup.contains(e.target)) return // 点弹窗内不处理
        if (e.target.closest?.('.eread-trigger')) { dismissPopup(); return }
        dismissPopup() // 点空白/新词都先关旧弹窗

        const hit = wordAtPoint(doc, e.clientX, e.clientY)
        if (!hit) { window.toggleBars?.(true); return } // 空白：显示顶栏/底栏
        selectRange(hit.range)

        let res
        try { res = await bridgeCall('translate', { text: hit.text, kind: 'word', ...apiParams() }) }
        catch (err) { onStatus('lookup bridge error: ' + err.message); return }
        if (!res.ok) { onStatus('lookup failed: ' + (res.error ?? '?')); return }

        let data
        try { data = JSON.parse(res.content) } catch { onStatus('bad translate JSON'); return }

        activePopup = showPopup(doc, hit.range, hit.text, data)
    })
}

function wordAtPoint(doc, x, y) {
    let range = null
    if (doc.caretRangeFromPoint) {
        range = doc.caretRangeFromPoint(x, y)
    } else if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(x, y)
        if (pos) { range = doc.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true) }
    }
    if (!range) return null
    const expanded = expandToWord(range)
    const text = expanded.toString().trim()
    if (!text || !/[A-Za-z]/.test(text)) return null
    return { text, range: expanded }
}

function expandToWord(range) {
    const r = range.cloneRange()
    const isWord = c => /[A-Za-z']/.test(c)
    // back
    while (r.startContainer.nodeType === 3) {
        const node = r.startContainer
        if (r.startOffset === 0 || !isWord(node.data[r.startOffset - 1])) break
        r.setStart(node, r.startOffset - 1)
    }
    // forward
    while (r.endContainer.nodeType === 3) {
        const node = r.endContainer
        if (r.endOffset >= node.data.length || !isWord(node.data[r.endOffset])) break
        r.setEnd(node, r.endOffset + 1)
    }
    return r
}

function selectRange(range) {
    const win = range.startContainer.ownerDocument.defaultView
    const sel = win.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function showPopup(doc, range, word, data) {
    // 弹窗放主文档，避开 iframe 分页多列坐标越界问题。
    const div = window.document.createElement('div')
    div.className = 'eread-popup'
    div.innerHTML =
        `<div class="ep-word">${escapeHtml(word)}</div>` +
        (data.pos ? `<div class="ep-pos">${escapeHtml(data.pos)}${data.phonetic ? ' · ' + escapeHtml(data.phonetic) : ''}</div>` : '') +
        `<div class="ep-trans">${escapeHtml(data.translation ?? '')}</div>` +
        `<div class="ep-search">🔍 在网页中搜索</div>`

    window.document.body.appendChild(div)

    // 位置偏好：单词周围（不越界）或左下角（CSS 默认）
    if (loadSettings().popupPosition === 'around-word') {
        positionAroundWord(div, range, doc)
    }

    // "search on web" (FR-D3)
    div.querySelector('.ep-search').addEventListener('click', () => {
        bridgeCall('openExternal', { url: searchUrl(word) })
    })

    // 5s 自动消失（若仍是最新弹窗）
    setTimeout(() => { if (activePopup === div) dismissPopup() }, 5000)

    return div
}

/** 单词周围定位：iframe 坐标 + iframe 屏幕偏移 → 屏幕坐标，夹紧不越界。 */
function positionAroundWord(div, range, doc) {
    const rect = range.getBoundingClientRect()
    const iframeEl = doc.defaultView?.frameElement
    const ir = iframeEl?.getBoundingClientRect()
    const offX = ir?.left ?? 0
    const offY = ir?.top ?? 0

    const pw = div.offsetWidth
    const ph = div.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8

    let left = rect.left + offX
    if (left + pw > vw - margin) left = vw - pw - margin
    left = Math.max(margin, left)

    let top = rect.bottom + offY + 6
    if (top + ph > vh - margin) top = rect.top + offY - ph - 6
    top = Math.max(margin, top)

    div.style.left = left + 'px'
    div.style.top = top + 'px'
    div.style.bottom = 'auto'
}
