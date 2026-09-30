// Eread 离线词典构建脚本 —— 从 KyleBing/english-vocabulary 拉取分级词表，
// 合并成一份紧凑的离线词典 dict.json（{word: {level, gloss}}）。
// 运行：node web/dict/build-dict.mjs
//
// 数据源：仓库顶层 `N 名称-乱序.txt`（格式 `单词\t释义`，无表头，UTF-8）。
// 合并优先级（越基础越优先，词取「首次出现」即最基础等级的等级）：
//   初中 > 高中 > 四级 > 六级 > 考研 > 托福 > SAT
//
// 等级 → 词频（供「词频颜色虚线」使用，见 dict.js 的 LEVEL_TO_FREQ）：
//   初中/高中/四级 → high（高频常用），六级 → mid，考研/托福/SAT → low（低频进阶）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = 'https://api.github.com/repos/KyleBing/english-vocabulary/contents/'

// 按 basic → advanced 顺序排列：先出现的等级在合并时优先保留。
const LEVELS = [
    { key: 'junior', file: '1 初中-乱序.txt' },
    { key: 'senior', file: '2 高中-乱序.txt' },
    { key: 'cet4',   file: '3 四级-乱序.txt' },
    { key: 'cet6',   file: '4 六级-乱序.txt' },
    { key: 'kaoyan', file: '5 考研-乱序.txt' },
    { key: 'toefl',  file: '6 托福-乱序.txt' },
    { key: 'sat',    file: '7 SAT-乱序.txt' },
]

async function fetchFile(file) {
    const url = API + encodeURIComponent(file)
    const res = await fetch(url, { headers: { 'User-Agent': 'eread-build' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`)
    const d = await res.json()
    return Buffer.from(d.content, 'base64').toString('utf-8')
}

async function main() {
    const dict = new Map()
    for (const { key, file } of LEVELS) {
        const text = await fetchFile(file)
        let added = 0
        for (const line of text.split('\n')) {
            const idx = line.indexOf('\t')
            if (idx <= 0) continue
            const word = line.slice(0, idx).trim().toLowerCase()
            const gloss = line.slice(idx + 1).trim()
            if (!word || !gloss) continue
            // basic 优先：更基础等级已收录则跳过（首次出现 = 最基础等级）
            if (!dict.has(word)) {
                dict.set(word, { level: key, gloss })
                added++
            }
        }
        console.log(`  ${key}: +${added}  (累计 ${dict.size})`)
    }
    const out = {}
    for (const [w, v] of dict) out[w] = v
    const json = JSON.stringify(out)
    fs.writeFileSync(path.join(__dirname, 'dict.json'), json, 'utf-8')
    console.log(`\n写入 dict.json: ${dict.size} 词, ${(json.length / 1024).toFixed(0)} KB`)
}

main().catch(e => { console.error(e); process.exit(1) })
