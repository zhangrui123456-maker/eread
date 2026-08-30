// Offline unit test for the annotation engine (AI指导 §3.2: 标注逻辑可离线单测).
// Uses Node's built-in test runner — no jsdom, no npm install. Run:
//   node --test web/annotate/engine.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAnnotatedRuns, categoryAttributes } from './engine.js'

// "The reader stumbles over unfamiliar words."
//  0123456789012345678901234567890123456789
//            11      18  21   25
const PARA = 'The reader stumbles over unfamiliar words.'

const SEGMENTS = [
    { text: 'stumbles over', textRange: [11, 24], type: 'phrase', pos: 'phrase', difficulty: 'cet6', freq: 'mid', gloss: '磕绊', source: 'model' },
    { text: 'unfamiliar', textRange: [25, 35], type: 'word', pos: 'adj', difficulty: 'cet6', freq: 'mid', gloss: '陌生的', source: 'model' },
]

test('toAnnotatedRuns lays segments onto text with gap-fill', () => {
    const { runs, skipped } = toAnnotatedRuns(PARA, SEGMENTS)
    assert.equal(skipped.length, 0)

    // leading plain text up to the first segment
    assert.equal(runs[0].kind, 'text')
    assert.equal(runs[0].text, 'The reader ')

    assert.equal(runs[1].kind, 'ruby')
    assert.equal(runs[1].text, 'stumbles over')
    assert.equal(runs[1].gloss, '磕绊')

    // gap between the two segments is a text run
    assert.equal(runs[2].kind, 'text')
    assert.equal(runs[2].text, ' ')

    assert.equal(runs[3].kind, 'ruby')
    assert.equal(runs[3].text, 'unfamiliar')
    assert.equal(runs[3].gloss, '陌生的')

    // trailing text
    assert.equal(runs[4].kind, 'text')
    assert.equal(runs[4].text, ' words.')
})

test('overlapping segments: first wins, later dropped', () => {
    const segs = [
        { text: 'stumbles over', textRange: [11, 24], pos: 'phrase', difficulty: 'cet6', freq: 'mid', gloss: '磕绊' },
        { text: 'stumbles', textRange: [11, 19], pos: 'verb', difficulty: 'cet4', freq: 'high', gloss: '绊倒' }, // overlaps
    ]
    const { runs, skipped } = toAnnotatedRuns(PARA, segs)
    assert.equal(skipped.length, 1)
    assert.equal(skipped[0].text, 'stumbles')
    const ruby = runs.find(r => r.kind === 'ruby')
    assert.equal(ruby.text, 'stumbles over')
})

test('segment text is sliced from the paragraph, not trusted blindly', () => {
    const segs = [{ text: 'WRONG-LABEL', textRange: [11, 24], pos: 'phrase', difficulty: 'cet6', freq: 'mid', gloss: '磕绊' }]
    const { runs } = toAnnotatedRuns(PARA, segs)
    assert.equal(runs[1].text, 'stumbles over') // the slice wins over seg.text
})

test('out-of-range segments are clamped, empty ones skipped', () => {
    const segs = [
        { text: 'words', textRange: [100, 200], pos: 'noun', difficulty: 'cet4', freq: 'high', gloss: '词' }, // beyond end
        { text: 'x', textRange: [5, 5], pos: 'noun', difficulty: 'cet4', freq: 'high', gloss: 'x' },          // empty range
    ]
    const { runs, skipped } = toAnnotatedRuns(PARA, segs)
    assert.equal(skipped.length, 2) // both: empty after clamp / zero-length
    // no ruby runs placed
    assert.equal(runs.filter(r => r.kind === 'ruby').length, 0)
    assert.equal(runs[0].text, PARA) // whole paragraph as plain text
})

test('categoryAttributes maps the four FR-A3 dimensions + clicked state', () => {
    const seg = { text: 'habit', pos: 'noun', difficulty: 'cet4', freq: 'high' }
    assert.deepEqual(categoryAttributes(seg), {
        pos: 'noun', clicked: 'no', level: 'cet4', freq: 'high',
    })
    const clicked = categoryAttributes(seg, new Set(['habit']))
    assert.equal(clicked.clicked, 'yes')
})

test('clicked state is surfaced as data-clicked on the run attrs', () => {
    // 'read habit now' → 'habit' occupies chars [5,10)
    const segs = [{ text: 'habit', textRange: [5, 10], pos: 'noun', difficulty: 'cet4', freq: 'high', gloss: '习惯' }]
    const { runs } = toAnnotatedRuns('read habit now', segs, { clicked: new Set(['habit']) })
    assert.equal(runs[1].attrs.clicked, 'yes')
})

test('text-only segments (no textRange) are located client-side by indexOf', () => {
    // The real model returns surface `text` with NO char offsets (T1.3/R1 finding).
    const segs = [
        { text: 'stumbles over', pos: 'phrase', difficulty: 'cet6', freq: 'mid', gloss: '磕绊' },
        { text: 'unfamiliar', pos: 'adj', difficulty: 'cet6', freq: 'mid', gloss: '陌生的' },
    ]
    const { runs, skipped } = toAnnotatedRuns(PARA, segs)
    assert.equal(skipped.length, 0)
    assert.equal(runs[0].kind, 'text')
    assert.equal(runs[0].text, 'The reader ')
    assert.equal(runs[1].text, 'stumbles over')
    assert.equal(runs[3].text, 'unfamiliar')
})

test('a text-only segment whose text is absent is skipped, not placed', () => {
    const segs = [{ text: 'nonexistent-word', pos: 'noun', difficulty: 'cet4', freq: 'high', gloss: '不存在的' }]
    const { runs, skipped } = toAnnotatedRuns(PARA, segs)
    assert.equal(skipped.length, 1)
    assert.equal(runs.filter(r => r.kind === 'ruby').length, 0)
})
