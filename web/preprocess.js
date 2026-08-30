// Eread EPUB preprocessing — merge illustration-only sections into the
// surrounding text so images flow inline with the prose (连续滚动).
// Upstream: docs/prd FR-R1, "插图内嵌正文" (foliate-js renders per-section and
// can't merge cross-section, so we flatten the spine into ONE html section).
//
// Uses JSZip to unpack the EPUB, walks the <spine>, inlines images as blob URLs
// and CSS as a <style>, and returns a single merged HTML.

// JSZip is loaded globally via <script> in reader.html (UMD, not ESM-friendly).
const JSZip = window.JSZip

/** Resolve a relative href against a base dir (handles ../). */
function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
    })
}

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

/**
 * @param {Blob} blob  an EPUB file
 * @returns {Promise<{html: string, title: string}>}
 */
export async function preprocessEpub(blob) {
    const zip = await JSZip.loadAsync(blob)

    const containerXml = await zip.file('META-INF/container.xml').async('string')
    const opfPath = (containerXml.match(/full-path="([^"]+)"/) || [, 'content.opf'])[1]
    const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1)

    const opfXml = await zip.file(opfPath).async('string')
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')

    const spine = [...opfDoc.querySelectorAll('spine itemref')].map(r => r.getAttribute('idref'))
    const manifest = {}
    opfDoc.querySelectorAll('manifest item').forEach(item => {
        manifest[item.getAttribute('id')] = {
            href: item.getAttribute('href'),
            type: item.getAttribute('media-type') || '',
        }
    })

    // inline CSS (stylesheet.css etc.)
    let cssText = ''
    for (const it of Object.values(manifest)) {
        if (!it.type.includes('css')) continue
        const f = zip.file(resolvePath(opfDir, it.href))
        if (f) cssText += await f.async('string') + '\n'
    }

    // walk spine, inline images as blob URLs, collect body innerHTML
    const bodies = []
    for (const idref of spine) {
        const item = manifest[idref]
        if (!item) continue
        const href = item.href
        if (!href) continue
        if (/nav|toc/i.test(href)) continue // 只跳过导航/目录，保留 titlepage（封面图）
        const htmlPath = resolvePath(opfDir, href)
        const file = zip.file(htmlPath)
        if (!file) continue
        const html = await file.async('string')
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const baseDir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1)
        // 处理 <img> 和 <svg><image>（封面图常是 SVG image，如 calibre 的 titlepage）
        for (const el of doc.querySelectorAll('img, image')) {
            const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href')
            if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue
            const imgFile = zip.file(resolvePath(baseDir, src))
            if (!imgFile) continue
            const imgBlob = await imgFile.async('blob')
            const url = await blobToDataUrl(imgBlob) // data URL 可持久化（跨会话）
            if (el.tagName.toLowerCase() === 'image') {
                el.setAttribute('href', url)
                el.setAttribute('xlink:href', url)
            } else {
                el.setAttribute('src', url)
                // 图片居中 + 宽 90%（内联 style，优先级高于 foliate-js 的 setImageSize）
                el.setAttribute('style', 'max-width:90%; height:auto; display:block; margin:1em auto;')
            }
        }
        // 每章包一层 + break-before，横向翻页时每章从新页开始（不越界）
        bodies.push(`<section class="eread-chapter">${doc.body.innerHTML}</section>`)
    }

    const chapterCss = `.eread-chapter { break-before: column; } img, svg, image { max-width: 100%; height: auto; }`
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${cssText}\n${chapterCss}</style></head><body>${bodies.join('\n')}</body></html>`
    const title = opfDoc.querySelector('metadata title')?.textContent?.trim() || '阅读'
    return { html, title }
}
