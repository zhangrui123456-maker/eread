// Eread shell ↔ Web bridge — message contract.
// Upstream: docs/software/技术方案.md §4 (桥接层), docs/dev/AI执行指导.md §3.3
// (壳层↔Web 层消息接口先定义好（调用/返回/错误），再写实现), §3.1 (key 仅内存传递).
//
// The Kotlin shell injects a bridge object into the WebView
// (Android: JavascriptInterface named `ereadBridge`; iOS: WKScriptMessageHandler).
// The Web layer calls these methods; results come back via the bridge's
// resolve(id, payload) / reject(id, err) — NEVER thrown across the bridge,
// so a missing key / 401 / 429 / timeout is handled in JS, not a native crash.
//
// SECURITY (FR-M2 / NFR-SEC1): the API key is injected into the Web layer's
// memory ONLY by the shell (never written to DOM / localStorage / logs). The
// Web layer never sees the key as a string for display; it only triggers shell
// side calls that attach the key. This file defines the shape both sides agree
// on before either is implemented.

/** Envelope for every request → response. */
export const BRIDGE_VERSION = 1

/** Standard error codes (mapped from upstream model HTTP/status in the shell). */
export const BridgeError = Object.freeze({
    NO_KEY: 'no_key',           // FR-M1: user hasn't configured a key
    BAD_KEY: 'bad_key',         // 401
    RATE_LIMITED: 'rate_limited', // 429
    NETWORK: 'network',         // timeout / unreachable
    PARSE: 'parse',             // model returned non-conforming JSON (R1 risk)
    CONTENT_BLOCKED: 'content_blocked', // model content filter rejected
    UNKNOWN: 'unknown',
})

/** A model-returned segmentation segment (docs/software §3.4, PRD §9.1).
 *  The model returns `text` (the exact surface substring); char offsets are NOT
 *  requested — T1.3/R1 finding: models count chars unreliably (0% range
 *  accuracy vs 100% with client-side indexOf location). The client computes
 *  textRange by locating `text` in the paragraph (engine.js rangeOf). */
export const SEGMENT_SCHEMA = {
    text: 'string',              // exact surface substring from the paragraph (authoritative for locating)
    textRange: '[start, end]?',  // optional; if absent the client locates `text` via indexOf
    type: 'word | phrase',
    pos: 'noun | verb | adj | adv | phrase | ...', // 词性
    difficulty: 'cet4 | cet6 | gk | none',          // 高考四六级
    freq: 'high | mid | low | none',                // 词频
    gloss: 'string',           // 中文释义
    source: 'model | dict',    // 来源 (model or local-dict fallback, FR-A4)
}

/** Methods the Web layer may invoke on the shell. Each returns a Promise of
 *  { ok: true, ...payload } | { ok: false, error: BridgeError, message?: string }.
 *  Defined here as a contract; implementation lives in the Kotlin shell. */
export const BridgeMethods = {
    /** Segment a paragraph (FR-A1). opts.context carries 1-2 paragraphs of
     *  surrounding text for phrase-boundary accuracy (FR-P2-style). */
    segment: 'segment',          // {text, context?} -> {ok, segments: SEGMENT_SCHEMA[]}
    /** Translate a word/phrase or a whole paragraph (FR-D2 / FR-P1). */
    translate: 'translate',       // {text, context?, kind:'word'|'para'} -> {ok, translation, pos?, phonetic?}
    /** 翻译练习：AI 生成长难句（英译中给英文、中译英给中文）。 */
    generateSentence: 'generateSentence',   // {direction, difficulty, length, topic} -> {ok, content: JSON{sentence}}
    /** 翻译练习：AI 评分纠错 + 讲解 + 标准翻译。 */
    evaluateTranslation: 'evaluateTranslation', // {direction, difficulty, source, user} -> {ok, content: JSON{score,corrections,vocab,standard}}
    /** BYOK connection check (FR-M1/M3). */
    pingModel: 'pingModel',      // {providerId} -> {ok}
    /** Annotation cache read/write by book+locator (FR-A5, avoid re-call). */
    getAnnotation: 'getAnnotation', // {bookId, locator} -> {ok, segments?}
    putAnnotation: 'putAnnotation', // {bookId, locator, segments} -> {ok}
}

/** Web-side helper: invoke a bridge method by name, return a Promise.
 *  Relies on `window.ereadBridge._invoke(method, id, params)` (injected by shell)
 *  and a pending-map keyed by id that the shell resolves via
 *  `ereadBridge._resolve(id, payload)` / `ereadBridge._reject(id, code, message)`. */
const _pending = new Map()

export function bridgeCall(method, params = {}) {
    return new Promise((resolve) => {
        const id = `${method}-${_seq++}`
        _pending.set(id, resolve)
        try {
            // Kotlin @JavascriptInterface _invoke(method, id, paramsJson: String)
            // — send params as a JSON string so native can JSONObject() it.
            window.ereadBridge._invoke(method, id, JSON.stringify(params))
        } catch (e) {
            _pending.delete(id)
            resolve({ ok: false, error: BridgeError.UNKNOWN, message: String(e) })
        }
    })
}
let _seq = 0

/** Called BY the shell (from native) to fulfil a pending request. These must
 *  be exposed on window.ereadBridge so the shell can `evaluateJavascript`
 *  `ereadBridge._resolve(...)`. */
export function _installShellCallbacks(bridge = window.ereadBridge) {
    bridge._resolve = (id, payload) => {
        const resolve = _pending.get(id); _pending.delete(id)
        resolve?.(payload && typeof payload === 'object' ? payload : { ok: false, error: BridgeError.UNKNOWN })
    }
    bridge._reject = (id, code, message) => {
        const resolve = _pending.get(id); _pending.delete(id)
        resolve?.({ ok: false, error: code ?? BridgeError.UNKNOWN, message: message ?? '' })
    }
}
