// Eread 本地化存储结构（需求8：偏好/壁纸/图像/进度/翻译资源分类管理）。
//
// IndexedDB `eread-books` / `books`（大文件）：
//   - key `<id>`             → 导入的电子书 Blob（书本体）
//   - key `merged:vN:<id>`   → 预处理合并 HTML 缓存（{html, title}）
//
// localStorage（小数据，统一 `eread-` 前缀）：
//   - `eread-settings`     → 偏好（主题/字号/注释样式/API配置/壁纸 dataURL 等）
//   - `eread-progress`     → 阅读进度（{书id: CFI}）
//   - `eread-translation`  → 已翻译资源（{书id: {段落文本: segments}}）
//   - `eread-shelf`        → 书架（导入书元数据：id/name/size/cover）
//
// 图像文件：封面提取自 EPUB（书架元数据 cover = dataURL），壁纸存 settings.wallpaper。

const DB_NAME = 'eread-books'
const STORE = 'books'

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

export async function putBook(id, blob) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(blob, id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
    })
}

export async function getBook(id) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(id)
        req.onsuccess = () => { db.close(); resolve(req.result) }
        req.onerror = () => { db.close(); reject(req.error) }
    })
}

/** 预处理结果缓存（合并 HTML + title），避免每次打开都重新预处理。
 *  key 带版本号，preprocess 逻辑变化时 bump 版本强制重新预处理。 */
const MERGED_PREFIX = 'merged:v4:'

export async function putMerged(id, merged) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(merged, MERGED_PREFIX + id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
    })
}

export async function getMerged(id) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(MERGED_PREFIX + id)
        req.onsuccess = () => { db.close(); resolve(req.result) }
        req.onerror = () => { db.close(); reject(req.error) }
    })
}

/** 删除导入的书 + 其预处理缓存（需求2：书架删除）。 */
export async function deleteBook(id) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(id)
        tx.objectStore(STORE).delete(MERGED_PREFIX + id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
    })
}

/** 壁纸存 IndexedDB（blob，避开 localStorage 5MB 限制）。
 *  key: 'wallpaper'（阅读壁纸）/'shelfWallpaper'（页面壁纸）。 */
export async function putWallpaper(key, blob) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(blob, 'wallpaper:' + key)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
    })
}

export async function getWallpaper(key) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get('wallpaper:' + key)
        req.onsuccess = () => { db.close(); resolve(req.result) }
        req.onerror = () => { db.close(); reject(req.error) }
    })
}

/** Shelf metadata for imported books (id/name/size), persisted in localStorage. */
const SHELF_KEY = 'eread-shelf'

export function getImportedBooks() {
    try { return JSON.parse(localStorage.getItem(SHELF_KEY)) ?? [] }
    catch { return [] }
}

export function addImportedBook(meta) {
    const list = getImportedBooks()
    list.push(meta)
    localStorage.setItem(SHELF_KEY, JSON.stringify(list))
}
