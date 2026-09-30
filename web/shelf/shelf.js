// Eread shelf (首页) — 所有书（预置 + 导入）同质化存书架，统一管理/删除。
// Upstream: docs/prd FR-R1 (导入并阅读本地 EPUB/TXT), docs/dev T2.1.

import { putBook, getImportedBooks, addImportedBook, deleteBook } from '../db.js'
import { bridgeCall, _installShellCallbacks } from '../bridge/messages.js'
import { applyPageTheme } from '../ui.js'

if (typeof window.ereadBridge !== 'undefined') {
    _installShellCallbacks(window.ereadBridge)
}

// 预置书（首次启动迁移进书架，之后与导入书同级、可删除）
const BUILTIN_BOOKS = [
    { id: 'spice-wolf', name: '香料与狼1', file: 'test-epub/spice-wolf.epub', cover: 'covers/spice-wolf.jpg', source: 'builtin' },
    { id: 'spice-wolf-xi', name: 'Spice & Wolf XI', file: 'test-epub/spice-wolf-xi.epub', cover: 'covers/spice-wolf-xi.jpg', source: 'builtin' },
]

const shelf = document.getElementById('shelf')

/** 首次启动：把预置书迁移进书架（eread-shelf），与导入书同质化。
 *  用 initialized 标记只执行一次——删除内置书后不重新加回。 */
function initShelf() {
    if (localStorage.getItem('eread-shelf-initialized')) return
    const list = getImportedBooks()
    if (!list.some(x => x.source === 'builtin')) {
        localStorage.setItem('eread-shelf', JSON.stringify([...BUILTIN_BOOKS, ...list]))
    }
    localStorage.setItem('eread-shelf-initialized', '1')
}

/** 统一打开：预置书用本地 file，导入书用 IndexedDB id。 */
function openBook(b) {
    if (b.source === 'builtin') {
        location.href = 'reader.html#book=' + encodeURIComponent(b.file) + '&title=' + encodeURIComponent(b.name)
    } else {
        location.href = 'reader.html#book=' + encodeURIComponent(b.id) + '&source=imported&title=' + encodeURIComponent(b.name)
    }
}

function base64ToBlob(b64, mime) {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
}

const JSZip = window.JSZip

function resolvePath(baseDir, href) {
    const parts = (baseDir + href).split('/')
    const out = []
    for (const p of parts) {
        if (p === '.' || p === '') continue
        if (p === '..') out.pop()
        else out.push(p)
    }
    return out.join('/')
}

function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
    })
}

/** 从 EPUB 提取封面（cover meta 或第一张图片）→ data URL。 */
async function extractCover(blob) {
    try {
        const zip = await JSZip.loadAsync(blob)
        const containerXml = await zip.file('META-INF/container.xml').async('string')
        const opfPath = (containerXml.match(/full-path="([^"]+)"/) || [, 'content.opf'])[1]
        const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
        const opfXml = await zip.file(opfPath).async('string')
        const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')
        let coverHref = null
        const coverMeta = opfDoc.querySelector('meta[name="cover"]')
        if (coverMeta) {
            const coverId = coverMeta.getAttribute('content')
            coverHref = opfDoc.querySelector(`manifest item[id="${coverId}"]`)?.getAttribute('href')
        }
        if (!coverHref) {
            const imgItem = [...opfDoc.querySelectorAll('manifest item')].find(it => (it.getAttribute('media-type') || '').includes('image'))
            coverHref = imgItem?.getAttribute('href')
        }
        if (!coverHref) return null
        const file = zip.file(resolvePath(opfDir, coverHref))
        if (!file) return null
        return await blobToDataUrl(await file.async('blob'))
    } catch (e) {
        console.warn('[eread] extract cover failed', e)
        return null
    }
}

async function importBook() {
    if (typeof window.ereadBridge === 'undefined') {
        alert('图书导入需在 App 内使用')
        return
    }
    const res = await bridgeCall('openFilePicker', {})
    if (!res.ok) { console.log('[eread] import cancelled/failed:', res.error); return }

    const { name, base64, size } = res
    const mime = name.toLowerCase().endsWith('.txt') ? 'text/plain' : 'application/epub+zip'
    const blob = base64ToBlob(base64, mime)
    const id = 'imported-' + Date.now()
    await putBook(id, blob)
    const cover = await extractCover(blob)
    addImportedBook({ id, name, size, cover, source: 'imported' })
    render()
}

function makeCard(coverEl, title, onClick) {
    const card = document.createElement('div')
    card.className = 'book-card'
    const titleEl = document.createElement('div')
    titleEl.className = 'book-title'
    titleEl.textContent = title
    card.append(coverEl, titleEl)
    card.addEventListener('click', onClick)
    return card
}

/** 从书架移除（任意书，预置/导入都可用）。 */
function removeBook(id) {
    const list = getImportedBooks().filter(x => x.id !== id)
    localStorage.setItem('eread-shelf', JSON.stringify(list))
}

/** 长按删除（需求2）：预置书只移出书架，导入书同时删 IndexedDB。 */
function addLongPressDelete(card, b) {
    let timer = null
    card.addEventListener('touchstart', () => {
        timer = setTimeout(async () => {
            if (confirm(`删除《${b.name}》？`)) {
                if (b.source === 'imported') await deleteBook(b.id)
                removeBook(b.id)
                render()
            }
        }, 500)
    })
    card.addEventListener('touchend', () => clearTimeout(timer))
    card.addEventListener('touchmove', () => clearTimeout(timer))
}

function render() {
    shelf.innerHTML = ''

    for (const b of getImportedBooks()) {
        let cover
        if (b.cover) {
            cover = document.createElement('img')
            cover.className = 'book-cover'
            cover.src = b.cover
            cover.alt = b.name
        } else {
            cover = document.createElement('div')
            cover.className = 'book-cover'
            cover.textContent = (b.name.trim()[0] ?? '?')
        }
        const card = makeCard(cover, b.name, () => openBook(b))
        addLongPressDelete(card, b)
        shelf.appendChild(card)
    }

    // 「添加图书」卡片（空 + 加号）
    const add = document.createElement('div')
    add.className = 'book-card'
    const addCover = document.createElement('div')
    addCover.className = 'book-cover add-cover'
    addCover.textContent = '+'
    const addTitle = document.createElement('div')
    addTitle.className = 'book-title'
    addTitle.textContent = '添加图书'
    add.append(addCover, addTitle)
    add.addEventListener('click', importBook)
    shelf.appendChild(add)
}

// 底部 tab 导航（书架 | 练习 | 用户）
document.querySelectorAll('.bottombar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.dataset.page === 'practice') location.href = 'practice.html'
        else if (tab.dataset.page === 'user') location.href = 'user.html'
    })
})
document.getElementById('import-btn').addEventListener('click', importBook)

// 页面背景主题（书架/用户页，与阅读背景区分）+ 顶栏/底栏颜色跟随（需求5）
applyPageTheme()

initShelf()
render()
