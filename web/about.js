// Eread about page（关于本 app 使用说明）。
// Upstream: docs/用户使用说明书.md（简化版）。

import { applyThemeVars } from './settings.js'

applyThemeVars() // 跟随全局主题（浅色 / 深色 / 护眼）

// 返回（浮动键）
document.getElementById('back-btn').addEventListener('click', () => {
    if (history.length > 1) history.back()
    else location.href = 'user.html'
})
