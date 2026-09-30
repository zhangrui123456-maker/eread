// Eread 本地词典模块 —— 离线查词兜底 + 词频/等级分类（FR-A4 / FR-A3 ④）。
// 数据：dict.json（{word: {level, gloss}}），由 build-dict.mjs 从 KyleBing 词库生成。
// 加载用 XHR（fetch 不支持 file:// 协议，离线 assets 必须用 XHR）。
//
// 等级 → 词频（「词频颜色虚线」用，见 annotations.css [data-active="freq"]）：
//   junior/senior/cet4 → high（高频常用）
//   cet6 → mid
//   kaoyan/toefl/sat → low（低频进阶）

let _dict = null      // Map<word, {level, gloss}>
let _loading = null   // Promise<Map>，并发去重

/** 等级 → 词频（FR-A3 ④ 词频分类）。 */
export const LEVEL_TO_FREQ = {
    junior: 'high', senior: 'high', cet4: 'high',
    cet6: 'mid',
    kaoyan: 'low', toefl: 'low', sat: 'low',
}

/** 等级 → 高考四六级分类（FR-A3 ③，data-level）。 */
export const LEVEL_TO_DIFFICULTY = {
    junior: 'gk', senior: 'gk',
    cet4: 'cet4', cet6: 'cet6',
    kaoyan: 'none', toefl: 'none', sat: 'none',
}

/** XHR 读文本（file:// 兼容，与 reader/app.js 同款）。 */
function fetchText(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.onload = () => (xhr.status === 200 || xhr.status === 0)
            ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status))
        xhr.onerror = () => reject(new Error('xhr error: ' + url))
        xhr.send()
    })
}

/** 加载 dict.json 到内存 Map（惰性 + 缓存；首次 await 后 lookup/classify 同步可查）。 */
export function loadDict(url = './dict/dict.json') {
    if (_dict) return Promise.resolve(_dict)
    if (!_loading) {
        _loading = fetchText(url)
            .then(txt => { _dict = new Map(Object.entries(JSON.parse(txt))); return _dict })
            .catch(err => { _loading = null; throw err })
    }
    return _loading
}

/** 归一化：小写 + 去标点（查词/分类都以它匹配词典键）。 */
function normalize(word) {
    return String(word).toLowerCase().replace(/[^a-z'-]/g, '')
}

/** 同步查词（需先 await loadDict()）。命中返回 {level, gloss}，未命中 null。 */
export function lookup(word) {
    if (!_dict) return null
    return _dict.get(normalize(word)) ?? null
}

/** 同步分类（需先 await loadDict()）。返回 {level, freq, difficulty}。 */
export function classify(word) {
    const e = lookup(word)
    if (!e) return { level: 'none', freq: 'none', difficulty: 'none' }
    return {
        level: e.level,
        freq: LEVEL_TO_FREQ[e.level] ?? 'none',
        difficulty: LEVEL_TO_DIFFICULTY[e.level] ?? 'none',
    }
}

// ---- 富词典（带音标，供详情页） ----

let _rich = null        // Map<word, {us, uk, translations, sentences}>
let _richLoading = null

/** 加载 dict-rich.json（音标 + 多义项 + 例句），惰性 + 缓存。 */
export function loadRich(url = './dict/dict-rich.json') {
    if (_rich) return Promise.resolve(_rich)
    if (!_richLoading) {
        _richLoading = fetchText(url)
            .then(txt => { _rich = new Map(Object.entries(JSON.parse(txt))); return _rich })
            .catch(err => { _richLoading = null; throw err })
    }
    return _richLoading
}

/** 同步查富词典（需先 await loadRich()）。命中返回 {us, uk, translations, sentences}，未命中 null。 */
export function lookupEntry(word) {
    if (!_rich) return null
    return _rich.get(normalize(word)) ?? null
}
