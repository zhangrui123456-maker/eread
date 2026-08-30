// Eread annotation engine — turn model segmentation into <ruby> annotation runs.
// Upstream: docs/prd/产品需求文档PRD.md FR-A1/A2/A3, docs/software/技术方案.md §4
// (标注引擎: 段落 → 模型划线 → DOM 叠加 <ruby> + CSS 虚线, 颜色按激活分类渲染),
// docs/dev/AI执行指导.md §3.2 (标注逻辑要能离线单测：给定段落 + 模型返回 →
// 确定标注结果，不做成只能连真机验证的黑盒).
//
// Two layers, cleanly split so the core is DOM-free and unit-testable:
//   • toAnnotatedRuns(text, segments, opts)  — PURE. Maps SEGMENT_SCHEMA items
//     onto paragraph text (gap-fill + overlap resolution), returns ordered runs.
//   • categoryAttributes(seg, clickedSet)    — PURE. Maps a segment to the
//     FR-A3 four-category data-* attributes consumed by annotations.css.
//   • renderRuns(doc, parent, runs)          — thin DOM layer (wraps runs into
//     <ruby class="ann"><rt>gloss</rt></ruby>). Exercised live in T1.2's demo.

/** Map a model segment to the FR-A3 four-category data-* attributes.
 *  `clicked` is LOCAL user state (not from the model): pass a Set of surface
 *  strings the user has already looked up (FR-D3 "标记已查"). */
export function categoryAttributes(seg, clickedSet = new Set()) {
    return {
        pos: seg.pos ?? '',
        clicked: clickedSet.has(seg.text) ? 'yes' : 'no',
        level: seg.difficulty ?? 'none',
        freq: seg.freq ?? 'none',
    }
}

/** Resolve a segment's [start, end) range in `text`. If the model supplied
 *  textRange it's used as-is (authoritative); otherwise the segment's `text`
 *  is located via indexOf from `cursor`. (T1.3/R1 finding: models return
 *  surface text reliably but CANNOT count char offsets — 0% range accuracy
 *  vs 100% when the client locates the text. So we never ask the model for
 *  offsets; we locate client-side.) Returns [start, end] or null if not found. */
function rangeOf(seg, text, cursor) {
    if (Array.isArray(seg.textRange) && seg.textRange.length === 2) return seg.textRange
    if (seg.text) {
        const idx = text.indexOf(seg.text, cursor)
        if (idx >= 0) return [idx, idx + seg.text.length]
    }
    return null
}

function toRubyRun(seg, text, clickedSet) {
    return {
        kind: 'ruby',
        text,                              // authoritative slice (rendered)
        gloss: seg.gloss ?? '',
        // clicked-matching uses the model's stated seg.text (logical word
        // identity), so a slice with stray edge spaces still matches the clean
        // word the user looked up (FR-D3).
        attrs: categoryAttributes(seg, clickedSet),
    }
}

/** PURE: lay model segments onto paragraph text, producing ordered runs.
 *  - Segments processed in given (model reading) order; range resolved via
 *    rangeOf (textRange if present, else indexOf-locate on seg.text).
 *  - First-wins on overlap: a segment whose start precedes the cursor is
 *    skipped (→ `skipped`, surfaced via onSkip).
 *  - Gaps become plain-text runs; a segment's RENDERED text is the paragraph
 *    slice (not blindly trusting seg.text).
 *  Returns { runs: Run[], skipped: Segment[] }. */
export function toAnnotatedRuns(text, segments, opts = {}) {
    const clickedSet = opts.clicked instanceof Set
        ? opts.clicked : new Set(opts.clicked ?? [])
    const onSkip = opts.onSkip ?? (() => {})

    const runs = []
    const skipped = []
    let cursor = 0

    for (const seg of segments) {
        const r = rangeOf(seg, text, cursor)
        if (!r) { skipped.push(seg); onSkip(seg); continue }
        let [s, e] = r
        if (s < 0) s = 0
        if (e > text.length) e = text.length
        if (s >= e || s < cursor) {            // empty, or overlaps placed text
            skipped.push(seg); onSkip(seg); continue
        }
        if (s > cursor) runs.push({ kind: 'text', text: text.slice(cursor, s) })
        runs.push(toRubyRun(seg, text.slice(s, e), clickedSet))
        cursor = e
    }
    if (cursor < text.length) runs.push({ kind: 'text', text: text.slice(cursor) })
    return { runs, skipped }
}

/** DOM layer: render runs into <ruby>/<rt> under `parent` (in `doc`), replacing
 *  its children. Returns parent. Used by the live reader; not unit-tested
 *  (the pure logic above is).
 *
 *  Preserves the paragraph's font: replaceChildren() drops the original
 *  <span class="calibre3"> (which carries font-family: Calibri in calibre
 *  EPUBs), so we snapshot the computed font from the first span and re-apply
 *  it to the plain-text/ruby runs — otherwise the annotated text loses the
 *  book's typeface. */
export function renderRuns(doc, parent, runs) {
    const win = doc.defaultView
    let fontFamily = ''
    if (win) {
        const probe = parent.querySelector('span') || parent
        fontFamily = win.getComputedStyle(probe).fontFamily
    }

    const frag = doc.createDocumentFragment()
    for (const r of runs) {
        if (r.kind === 'text') {
            if (fontFamily) {
                const span = doc.createElement('span')
                span.style.fontFamily = fontFamily
                span.textContent = r.text
                frag.appendChild(span)
            } else {
                frag.appendChild(doc.createTextNode(r.text))
            }
            continue
        }
        // 回退到最初 <ruby> 结构（虚线=ruby 宽=单词宽，文字正常流）。译文交叉问题暂
        // 接受（用户要求「起码能用」的版本）。
        const ruby = doc.createElement('ruby')
        ruby.className = 'ann'
        if (fontFamily) ruby.style.fontFamily = fontFamily
        for (const [k, v] of Object.entries(r.attrs)) {
            if (v) ruby.setAttribute(`data-${k}`, v)
        }
        ruby.textContent = r.text.trim()
        const rt = doc.createElement('rt')
        rt.textContent = r.gloss
        ruby.appendChild(rt)
        frag.appendChild(ruby)
    }
    parent.replaceChildren(frag)
    return parent
}
