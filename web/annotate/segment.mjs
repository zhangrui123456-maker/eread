// Eread T1.3 spike — DeepSeek structured segmentation + parse-rate (R1).
//
// Upstream: docs/dev/AI执行指导.md T1.3 (最小脚本调模型，要求结构化返回划线段，
//   统计可解析率), docs/software/技术方案.md §3.4/R1 (模型划线响应格式不稳定 →
//   PoC 验证 text_range 可解析率，kill criteria <80%).
//
// This is a STANDALONE PoC — it calls DeepSeek directly from Node with the key
// read from web/.env.local (gitignored). It is NOT the production path: in M2 the
// shell calls the model and injects the key into memory only (FR-M2 / NFR-SEC1),
// via the bridge contract in web/bridge/messages.js. Here we just measure whether
// the model can return parseable structured segmentation.
//
// Run:  node web/annotate/segment.mjs            # all paragraphs
//       node web/annotate/segment.mjs --limit=3  # quick smoke

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '..', '.env.local')

function loadEnv() {
    const env = {}
    try {
        for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
            if (m) env[m[1]] = m[2]
        }
    } catch { /* .env.local optional — prefer process.env so key stays off disk */ }
    return env
}

// Prefer process.env so the key need NOT be written to any file (FR-M2 / NFR-SEC1):
//   DEEPSEEK_API_KEY=sk-... node web/annotate/segment.mjs
const ENV = loadEnv()
const BASE_URL = process.env.DEEPSEEK_BASE_URL || ENV.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' // 待核实
const MODEL = process.env.DEEPSEEK_MODEL || ENV.DEEPSEEK_MODEL || 'deepseek-chat'                      // 待核实
const API_KEY = process.env.DEEPSEEK_API_KEY || ENV.DEEPSEEK_API_KEY
if (!API_KEY) { console.error(`set DEEPSEEK_API_KEY env var (or web/.env.local)`); process.exit(1) }

const SYSTEM = `You are a linguistic annotation engine for an English-reader app.
Given an English paragraph, identify the words and multi-word expressions that are
meaningful for a learner: content words (nouns, verbs, adjectives, adverbs), phrasal
verbs, fixed expressions, idioms, and proper nouns. Do NOT segment function words
(articles, conjunctions, simple prepositions, pronouns) on their own.

Return ONLY a JSON object of this exact shape (no prose, no code fence):
{"segments": [
  {
    "text": "...",
    "type": "word" | "phrase",
    "pos": "noun" | "verb" | "adj" | "adv" | "phrase" | "name",
    "difficulty": "cet4" | "cet6" | "gk" | "none",
    "freq": "high" | "mid" | "low" | "none",
    "gloss": "中文释义"
  }
]}

"text" MUST be the exact substring as it appears in the paragraph — copy it
verbatim, including any spaces within a phrase. Do NOT include character offsets;
the client locates each "text" in the paragraph itself. Return {"segments": []}
if nothing is worth segmenting.`

async function callDeepSeek(paragraph) {
    const body = {
        model: MODEL,
        messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: paragraph },
        ],
        temperature: 0,
        response_format: { type: 'json_object' }, // DeepSeek supports JSON mode
    }
    const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const t = await res.text().catch(() => '')
        return { httpErr: `HTTP ${res.status}: ${t.slice(0, 200)}` }
    }
    const data = await res.json()
    return { content: data?.choices?.[0]?.message?.content ?? '' }
}

/** Parse + locate. The model returns surface `text` (NO char offsets — the R1
 *  spike finding: models count chars unreliably). The CLIENT locates each `text`
 *  in the paragraph via indexOf (first-wins, no overlap). A paragraph is
 *  "parseable" iff the response was valid JSON whose every segment's text occurs
 *  in the paragraph (R1 metric, redefined client-side). */
function parseSegments(content, paragraph) {
    if (!content) return { ok: false, error: 'empty content' }
    let raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
    let parsed
    try { parsed = JSON.parse(raw) }
    catch (e) { return { ok: false, error: 'JSON parse: ' + e.message, raw: raw.slice(0, 160) } }
    const arr = Array.isArray(parsed) ? parsed : (parsed.segments ?? parsed.array ?? null)
    if (!Array.isArray(arr)) return { ok: false, error: 'no segments array', raw: raw.slice(0, 160) }
    const segs = []
    let cursor = 0, foundCount = 0
    for (const s of arr) {
        const text = s.text
        if (!text) continue
        const idx = paragraph.indexOf(text, cursor)
        const found = idx >= 0
        if (found) {
            foundCount++
            segs.push({ ...s, text, text_range: [idx, idx + text.length], found: true })
            cursor = idx + text.length
        } else {
            segs.push({ ...s, text, found: false })
        }
    }
    return { ok: segs.length > 0 && foundCount === segs.length, segs, foundCount, total: arr.length }
}

// 15 original English paragraphs — varied vocab, phrasal verbs, idioms (controlled
// fixture; spec calls for 30 — scale up once the prompt is validated).
const PARAGRAPHS = [
    'The old lighthouse stood at the edge of the cliff, its lamp sweeping the sea every dozen seconds. The keeper had grown so used to the rhythm that he could tell the time of night by it.',
    'She decided to give up coffee after years of relying on it to get through the morning. The headaches lasted a week, then faded for good.',
    'The committee turned down the proposal without much discussion, which took everyone by surprise. A few members had clearly made up their minds in advance.',
    'He ran into an old friend at the market, someone he had not seen since college. They picked up their conversation as though no time had passed.',
    'The recipe calls for a pinch of salt and a generous handful of fresh herbs. The trick is to let the dough rest before you knead it.',
    'Storms had been gathering over the ridge all afternoon, and by dusk the first lightning struck the reservoir. The dogs refused to go outside for the rest of the evening.',
    'The startup managed to break even in its third year, well ahead of the founders\' own forecast. They attributed the turnaround to a single decision: cutting the features that nobody used.',
    'She had a habit of jotting down ideas on the back of receipts, then losing them in the wash. The best ones, she believed, always came back to her eventually.',
    'The treaty was signed in secret and remained unknown to the public for decades. Historians still argue over whether the negotiators acted in good faith.',
    'A thick fog rolled in off the harbor, swallowing the masts of the fishing boats one by one. The gulls went quiet, as if the grey had swallowed their voices too.',
    'The professor pointed out that the data did not bear out the hypothesis, and urged the students to revise their assumptions. Several of them pushed back at first, then conceded.',
    'He put off the decision for as long as he could, hoping the right answer would present itself. In the end, he simply went with his gut.',
    'The trail wound through a stand of birch trees before climbing steeply toward the ridge. By the time they reached the summit, the valley below was already in shadow.',
    'She made a point of reading a few pages every night before bed, even when she was exhausted. Over the years, the habit added up to a surprising number of books.',
    'The mechanic figured out the fault within minutes, though it had stumped two other garages. A loose wire, nothing more, but it had brought the whole engine to a halt.',
]

async function main() {
    const limitArg = process.argv.find(a => a.startsWith('--limit='))
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : PARAGRAPHS.length
    const items = PARAGRAPHS.slice(0, Math.min(limit, PARAGRAPHS.length))

    let okPara = 0, totalSeg = 0, foundSeg = 0
    for (let i = 0; i < items.length; i++) {
        const para = items[i]
        const r = await callDeepSeek(para)
        if (r.httpErr) { console.log(`[${i + 1}/${items.length}] HTTP-ERR ${r.httpErr}`); continue }
        const p = parseSegments(r.content, para)
        if (p.ok) okPara++
        if (p.segs) { totalSeg += p.segs.length; foundSeg += p.segs.filter(s => s.found).length }
        const sample = (p.segs ?? []).slice(0, 2).map(s => `${s.text}/${s.gloss}${s.found ? '' : '?!'}`).join(' ')
        console.log(`[${i + 1}/${items.length}] ok=${p.ok} segs=${p.segs?.length ?? 0} found=${p.foundCount ?? 0}/${p.segs?.length ?? 0} ${p.error ?? ''} ${sample}`)
    }
    const paraRate = (okPara / items.length * 100)
    const segRate = totalSeg ? (foundSeg / totalSeg * 100) : 0
    console.log(`\n=== paragraph parseable rate: ${okPara}/${items.length} = ${paraRate.toFixed(1)}%`)
    console.log(`=== segment located-in-text rate: ${foundSeg}/${totalSeg} = ${segRate.toFixed(1)}%`)
    console.log(`R1 threshold (paragraph ≥ 80%): ${paraRate >= 80 ? 'PASS ✓' : 'FAIL ✗ — consider fallback (技术方案 R1 kill criteria)'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
