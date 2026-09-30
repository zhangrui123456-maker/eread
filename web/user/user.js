// Eread user page — a list of entries (设置 → settings page).
// Upstream: docs/prd FR-R2.

import { applyPageTheme } from '../ui.js'

// 页面背景主题 + 顶栏/底栏颜色跟随（需求5）
applyPageTheme()

// 底部 tab 导航（书架 | 练习 | 用户）
document.querySelectorAll('.bottombar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.dataset.page === 'shelf') location.href = 'index.html'
        else if (tab.dataset.page === 'practice') location.href = 'practice.html'
    })
})

// 「设置」栏项 → 统一设置页
document.getElementById('settings-item').addEventListener('click', () => {
    location.href = 'settings.html'
})

// 「关于」栏项 → 关于页
document.getElementById('about-item').addEventListener('click', () => {
    location.href = 'about.html'
})
