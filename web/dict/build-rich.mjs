// Eread 富词典构建脚本 —— 从 sentence JSONL（带音标）生成离线词典 dict-rich.json，
// 供「内置单词详情页」使用。
// 运行：node web/dict/build-rich.mjs
//
// 数据源：full_line_jsonl/sentence/正序/{初中,高中,四级,六级}.jsonl
//   每行一个 JSON：{"word","us","uk","translations":[{translation,type}],
//   "phrases":[...],"sentences":[{sentence,translation}]}
// 裁剪策略（控体积）：
//   - 丢弃 phrases（体积最大、非核心）
//   - sentences 上限 3 条（语境例句）
//   - 保留 us/uk 音标 + 全部义项（多义词）
// 合并：按 初中 > 高中 > 四级 > 六级 优先，词取最基础等级的条目。
//
// 为什么只覆盖 4 级：这 4 级正是「高考四六级」维度（FR-A3 ③），对应目标用户；
// 考研/托福/SAT 等生僻词回落到 dict.json 基础释义 + 联网 AI 兜底。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = 'https://api.github.com/repos/KyleBing/english-vocabulary/contents/'
const UA = { headers: { 'User-Agent': 'eread-build' } }

// 按 basic → advanced 顺序：先出现者优先保留。
const LEVELS = [
    { file: '初中' },
    { file: '高中' },
    { file: '四级' },
    { file: '六级' },
]
const SENTENCE_CAP = 3

async function fetchFile(rel) {
    // 逐段 encodeURIComponent：保留路径分隔符 `/`，只编码中文/空格等
    const url = API + rel.split('/').map(encodeURIComponent).join('/')
    const meta = await (await fetch(url, UA)).json()
    // 文件 ≤1MB：contents API 直接返回 base64 content；>1MB：content 为空，需走 git blobs 拿全量
    let content = meta.content
    if (!content) {
        const blob = await (await fetch(meta.git_url, UA)).json()
        content = blob.content
    }
    return Buffer.from(content, 'base64').toString('utf-8')
}

/** 裁剪单个词条：去 word/phrases，例句封顶。 */
function trim(raw) {
    const out = {}
    if (raw.us) out.us = raw.us
    if (raw.uk) out.uk = raw.uk
    if (Array.isArray(raw.translations) && raw.translations.length) {
        out.translations = raw.translations.map(t => ({ translation: t.translation, type: t.type }))
    }
    if (Array.isArray(raw.sentences) && raw.sentences.length) {
        out.sentences = raw.sentences.slice(0, SENTENCE_CAP)
            .map(s => ({ sentence: s.sentence, translation: s.translation }))
    }
    return out
}

async function main() {
    const dict = new Map()
    for (const { file } of LEVELS) {
        const rel = `full_line_jsonl/sentence/正序/${file}.jsonl`
        const text = await fetchFile(rel)
        let added = 0, skipped = 0
        for (const line of text.split('\n')) {
            if (!line.trim()) continue
            let raw
            try { raw = JSON.parse(line) } catch { skipped++; continue }
            const word = (raw.word ?? '').trim().toLowerCase()
            if (!word) { skipped++; continue }
            if (!dict.has(word)) {
                const entry = trim(raw)
                if (entry.translations || entry.sentences) { dict.set(word, entry); added++ }
                else skipped++
            }
        }
        console.log(`  ${file}: +${added}  (累计 ${dict.size}, 跳过 ${skipped})`)
    }
    const out = {}
    for (const [w, v] of dict) out[w] = v
    const json = JSON.stringify(out)
    fs.writeFileSync(path.join(__dirname, 'dict-rich.json'), json, 'utf-8')
    console.log(`\n写入 dict-rich.json: ${dict.size} 词, ${(json.length / 1024 / 1024).toFixed(2)} MB`)
}

main().catch(e => { console.error(e); process.exit(1) })
