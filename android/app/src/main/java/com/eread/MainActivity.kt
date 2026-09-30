package com.eread

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * M2 shell: WebView (foliate-js reader + annotation engine) + an async bridge
 * to native. Native owns the BYOK model call (segment/translate) so the API key
 * lives here (secure storage, FR-M2), never in the Web layer. Bridge contract is
 * defined in web/bridge/messages.js (_invoke / _resolve / _reject).
 *
 * Upstream: docs/software/技术方案.md §4, docs/dev/AI执行指导.md T2.3/T2.6.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val bridge = Bridge(::handleCall)

    /** Injected as window.ereadBridge. Async calls flow through _invoke(id). */
    class Bridge(private val onCall: (String, String, String) -> Unit) {
        @JavascriptInterface
        fun ping(): String = "pong"

        @JavascriptInterface
        fun version(): String = "eread-android 0.2.0 (M2)"

        /** Async entry point. `paramsJson` is a JSON string from the Web layer. */
        @JavascriptInterface
        fun _invoke(method: String, id: String, paramsJson: String) {
            onCall(method, id, paramsJson)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // targetSdk 35 forces edge-to-edge; let the system pad the content
        // below the status bar so the Web layer's toolbar isn't covered.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            @Suppress("DEPRECATION")
            window.setDecorFitsSystemWindows(true)
        }
        web = WebView(this)
        setContentView(web)

        // 离线模式：加载打包进 assets 的 Web 层（不依赖 dev 服务器）。
        // 开发模式（连 dev 服务器热更新）：把 DEV_MODE 改回 true。
        val devMode = false
        val url = if (devMode) "http://10.0.2.2:5173/" else "file:///android_asset/index.html"

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // 离线 file:// 模式：允许页面 fetch 同目录的 assets 资源（EPUB/CSS/JS）
        web.settings.allowFileAccess = true
        @Suppress("DEPRECATION")
        web.settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        web.settings.allowUniversalAccessFromFileURLs = true
        WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect (人工指导 §5.2)

        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                Log.i(TAG, "onPageStarted: $url")
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                Log.i(TAG, "onPageFinished: $url")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                Log.d(TAG, "console: ${consoleMessage.message()}")
                return true
            }
        }

        web.addJavascriptInterface(bridge, "ereadBridge")
        web.loadUrl(url)
    }

    // ---- bridge dispatch -------------------------------------------------

    private fun handleCall(method: String, id: String, paramsJson: String) {
        Log.d(TAG, "bridge call: $method id=$id")
        when (method) {
            "segment" -> runModel(method, id, paramsJson)
            "translate" -> runModel(method, id, paramsJson)
            "generateSentence" -> runModel(method, id, paramsJson)
            "evaluateTranslation" -> runModel(method, id, paramsJson)
            "openExternal" -> openExternal(id, paramsJson)
            "openFilePicker" -> openFilePicker(id)
            "openImagePicker" -> openImagePicker(id)
            "saveApiConfig" -> saveApiConfig(id, paramsJson)
            "getApiConfig" -> getApiConfig(id)
            else -> resolve(id, """{"ok":false,"error":"unknown","message":${JSONObject.quote("no such method: $method")}}""")
        }
    }

    /** Background model call (BYOK), then _resolve back into the Web layer. */
    private fun runModel(method: String, id: String, paramsJson: String) {
        Thread {
            try {
                val params = JSONObject(paramsJson)
                // BYOK 配置：base_url/model 从 Web 传（或 native 默认），key 从 Keystore 解密
                val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
                val baseUrl = params.optString("apiBaseUrl", "").ifEmpty { prefs.getString("base_url", "") ?: BASE_URL }
                val model = params.optString("apiModel", "").ifEmpty { prefs.getString("model", "") ?: MODEL }
                val apiKey = loadApiKey()
                if (apiKey.isEmpty()) {
                    resolve(id, """{"ok":false,"error":"no_key","message":"请先在设置中配置 API Key"}""")
                    return@Thread
                }
                val (system, user) = buildPrompt(method, params)
                if (user.isEmpty()) {
                    resolve(id, """{"ok":false,"error":"parse","message":"empty input"}""")
                    return@Thread
                }
                // 生成句子随机性由 Web 传 temperature（设置里可调，默认 0.9），其余任务确定性输出
                val temperature = if (method == "generateSentence") params.optDouble("temperature", 0.9) else 0.0
                val content = callDeepSeek(baseUrl, model, apiKey, system, user, temperature)
                resolve(id, """{"ok":true,"content":${JSONObject.quote(content)}}""")
            } catch (e: Exception) {
                Log.w(TAG, "model call $method failed", e)
                resolve(id, """{"ok":false,"error":"network","message":${JSONObject.quote(e.message ?: "error")}}""")
            }
        }.start()
    }

    /** method → (systemPrompt, userContent)。segment/translate 用 text 单字段；
     *  翻译练习的两个方法从 params 组装多字段输入。 */
    private fun buildPrompt(method: String, params: JSONObject): Pair<String, String> {
        return when (method) {
            "segment" -> SEGMENT_SYSTEM to params.optString("text", "")
            "translate" -> TRANSLATE_SYSTEM to params.optString("text", "")
            "generateSentence" -> GEN_SENTENCE_SYSTEM to genSentenceUser(params)
            "evaluateTranslation" -> EVAL_SYSTEM to evalUser(params)
            else -> "" to ""
        }
    }

    /** Open a URL in the system browser (word-lookup "search on web", FR-D3). */
    private fun openExternal(id: String, paramsJson: String) {
        try {
            val url = JSONObject(paramsJson).optString("url", "")
            if (url.isEmpty()) {
                resolve(id, """{"ok":false,"error":"parse","message":"empty url"}""")
                return
            }
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            resolve(id, """{"ok":true}""")
        } catch (e: Exception) {
            resolve(id, """{"ok":false,"error":"unknown","message":${JSONObject.quote(e.message ?: "err")}}""")
        }
    }

    /** Import a book (FR-R1/T2.1): open the SAF picker, read the file, return
     *  its name + base64 content to the Web layer. */
    private var pendingPickerId: String? = null

    private fun openFilePicker(id: String) {
        pendingPickerId = id
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/epub+zip", "text/plain"))
        }
        startActivityForResult(intent, REQ_PICK_BOOK)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK_IMAGE) {
            val id = pendingImagePickerId ?: return
            pendingImagePickerId = null
            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                resolve(id, """{"ok":false,"error":"cancelled"}""")
                return
            }
            val uri = data.data!!
            try {
                val mime = contentResolver.getType(uri) ?: "image/jpeg"
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                resolve(id, JSONObject().put("ok", true).put("dataUrl", "data:$mime;base64,$b64").toString())
            } catch (e: Exception) {
                resolve(id, """{"ok":false,"error":"read","message":${JSONObject.quote(e.message ?: "err")}}""")
            }
            return
        }
        if (requestCode != REQ_PICK_BOOK) return
        val id = pendingPickerId ?: return
        pendingPickerId = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            resolve(id, """{"ok":false,"error":"cancelled"}""")
            return
        }
        val uri = data.data!!
        try {
            val name = queryName(uri)
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
            val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            resolve(id, JSONObject()
                .put("ok", true)
                .put("name", name)
                .put("size", bytes.size)
                .put("base64", b64).toString())
        } catch (e: Exception) {
            resolve(id, """{"ok":false,"error":"read","message":${JSONObject.quote(e.message ?: "err")}}""")
        }
    }

    private fun queryName(uri: Uri): String {
        val cursor = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        return cursor?.use { if (it.moveToFirst()) it.getString(0) else "导入的书" } ?: "导入的书"
    }

    /** 手机物理返回键：优先返回 WebView 历史（阅读页→书架），否则退出。 */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    /** Import a wallpaper image (UI 美化): SAF picker → data URL → Web layer. */
    private var pendingImagePickerId: String? = null

    private fun openImagePicker(id: String) {
        pendingImagePickerId = id
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        startActivityForResult(intent, REQ_PICK_IMAGE)
    }

    // ---- API key 加密存储（NFR-SEC1）：Android Keystore AES-GCM ------------

    private fun getOrCreateAesKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateAesKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv + ct, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val data = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = data.copyOfRange(0, 12)
        val ct = data.copyOfRange(12, data.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateAesKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    /** 保存 base_url/model（明文，非敏感）+ api_key（Keystore 加密）。 */
    private fun saveApiConfig(id: String, paramsJson: String) {
        try {
            val params = JSONObject(paramsJson)
            val prefs = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            prefs.putString("base_url", params.optString("apiBaseUrl", ""))
            prefs.putString("model", params.optString("apiModel", ""))
            val key = params.optString("apiKey", "")
            if (key.isNotEmpty()) prefs.putString("api_key", encrypt(key))
            prefs.apply()
            resolve(id, """{"ok":true}""")
        } catch (e: Exception) {
            resolve(id, """{"ok":false,"error":"unknown","message":${JSONObject.quote(e.message ?: "err")}}""")
        }
    }

    /** 返回 base_url/model + 是否已配 key（不回传 key 明文）。 */
    private fun getApiConfig(id: String) {
        try {
            val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
            resolve(id, JSONObject()
                .put("ok", true)
                .put("baseUrl", prefs.getString("base_url", "") ?: "")
                .put("model", prefs.getString("model", "") ?: "")
                .put("hasKey", prefs.contains("api_key")).toString())
        } catch (e: Exception) {
            resolve(id, """{"ok":false,"error":"unknown","message":${JSONObject.quote(e.message ?: "err")}}""")
        }
    }

    private fun loadApiKey(): String {
        val enc = getSharedPreferences(PREFS, MODE_PRIVATE).getString("api_key", "") ?: ""
        return if (enc.isEmpty()) "" else try { decrypt(enc) } catch (e: Exception) { "" }
    }

    /** Deliver a result to the Web layer's pending bridge call (messages.js _resolve). */
    private fun resolve(id: String, resultJson: String) {
        web.post {
            web.evaluateJavascript(
                "ereadBridge._resolve(${JSONObject.quote(id)}, $resultJson)", null
            )
        }
    }

    // ---- DeepSeek (OpenAI-compatible /chat/completions) -----------------

    /** Call the BYOK model. base_url/model/key are DEV constants for now —
     *  FR-M2 will move them to encrypted storage (Keystore) + a settings UI. */
    private fun callDeepSeek(baseUrl: String, model: String, apiKey: String, system: String, user: String, temperature: Double = 0.0): String {
        val body = JSONObject()
            .put("model", model)
            .put("temperature", temperature)
            .put("response_format", JSONObject().put("type", "json_object"))
            .put("messages", org.json.JSONArray()
                .put(JSONObject().put("role", "system").put("content", system))
                .put(JSONObject().put("role", "user").put("content", user)))

        val conn = URL("$baseUrl/chat/completions").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $apiKey")
            conn.doOutput = true
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.outputStream.use { it.write(body.toString().toByteArray()) }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code: ${raw.take(160)}")
            }
            val choices = JSONObject(raw).optJSONArray("choices")
            val content = choices?.optJSONObject(0)?.optJSONObject("message")?.optString("content")
                ?: throw IllegalStateException("no choices in model response")
            content
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val TAG = "eread"
        private const val REQ_PICK_BOOK = 1001
        private const val REQ_PICK_IMAGE = 1002
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "eread_api_key"
        private const val PREFS = "eread_prefs"

        // 默认 base_url/model（api key 由用户在设置页配置，Keystore 加密存储，不硬编码）
        private const val BASE_URL = "https://api.deepseek.com"
        private const val MODEL = "deepseek-chat"

        // Reuse the T1.3-validated prompt: model returns surface `text` (NO char
        // offsets — R1 finding), the Web layer locates each text via indexOf.
        private val SEGMENT_SYSTEM = (
            "You are a linguistic annotation engine for an English-reader app.\n" +
            "Given an English paragraph, identify the words and multi-word expressions that are\n" +
            "meaningful for a learner: content words (nouns, verbs, adjectives, adverbs), phrasal\n" +
            "verbs, fixed expressions, idioms, and proper nouns. Do NOT segment function words\n" +
            "(articles, conjunctions, simple prepositions, pronouns) on their own.\n\n" +
            "Return ONLY a JSON object of this exact shape (no prose, no code fence):\n" +
            "{\"segments\": [{\"text\": \"...\", \"type\": \"word\"|\"phrase\",\n" +
            "  \"pos\": \"noun\"|\"verb\"|\"adj\"|\"adv\"|\"phrase\"|\"name\",\n" +
            "  \"difficulty\": \"cet4\"|\"cet6\"|\"gk\"|\"none\", \"freq\": \"high\"|\"mid\"|\"low\"|\"none\",\n" +
            "  \"gloss\": \"中文释义\"}],\n" +
            " \"grammar\": \"用中文写的本段语法/句式赏析（2-4 句，面向学习者，点出关键语法点、从句、时态、固定搭配）\"}\n" +
            "\"text\" MUST be the exact substring as it appears in the paragraph — copy it verbatim,\n" +
            "including any spaces within a phrase. Do NOT include character offsets; the client\n" +
            "locates each \"text\" in the paragraph itself. Return {\"segments\": [], \"grammar\": \"\"}\n" +
            "if nothing is worth segmenting."
        )

        private val TRANSLATE_SYSTEM = (
            "You are an English-Chinese dictionary for a learner. Return ONLY a JSON object\n" +
            "(no prose, no code fence): {\"translation\": \"中文释义\",\n" +
            "\"pos\": \"noun|verb|adj|adv|phrase|name\", \"phonetic\": \"音标(未知则空字符串)\",\n" +
            "\"phrases\": [{\"phrase\": \"常用词组/搭配\", \"translation\": \"中文释义\"}]}.\n" +
            "phrases: 3-5 个该词最常见的词组或固定搭配（动词短语、介词搭配、惯用语），没有则返回 []."
        )

        // 翻译练习：生成一句用于翻译练习的长难句（方向/难度/句长/题材由 user 消息给出）
        private val GEN_SENTENCE_SYSTEM = (
            "You are a translation-exercise generator for a language-learning app.\n" +
            "Generate ONE challenging long sentence for the user to translate, based on the\n" +
            "direction, difficulty, length and topic in the user message.\n" +
            "- direction en2zh: output an English sentence with layered clauses and vocabulary\n" +
            "  matching the difficulty level.\n" +
            "- direction zh2en: output a Chinese sentence with layered description/narration.\n" +
            "Match the requested difficulty (zhongkao/gaokao/cet4/cet6/ielts/toefl) in word choice,\n" +
            "and the requested length (word/character count) approximately.\n" +
            "Vary the sentence opening and clause order every time — do NOT keep starting with the\n" +
            "same connector (e.g. Although, However, When). Use diverse starters and structures.\n" +
            "Return ONLY a JSON object (no prose, no code fence): {\"sentence\": \"...\"}"
        )

        // 翻译练习：评分 + 逐条纠错 + 占位词/问题词讲解 + 标准翻译
        private val EVAL_SYSTEM = (
            "You are a translation grader for a language-learning app.\n" +
            "Grade the user's translation of the source sentence, then return corrections,\n" +
            "vocabulary explanations, and a standard translation.\n" +
            "Return ONLY a JSON object of this exact shape (no prose, no code fence):\n" +
            "{\"score\": 0-100 的整数,\n" +
            " \"overall\": \"一句话总评（中文）\",\n" +
            " \"corrections\": [{\"issue\": \"问题描述（中文）\", \"fix\": \"修改建议（中文）\", \"word\": \"相关英文词（无则空字符串）\"}],\n" +
            " \"vocab\": [{\"word\": \"英文词\", \"gloss\": \"中文释义\", \"explain\": \"讲解（中文）\"}],\n" +
            " \"standard\": \"标准翻译\"}\n" +
            "corrections 针对用户译文的错误或生硬处；vocab 针对用户占位（未译出的词）或错误用词，\n" +
            "给出英文词 + 中文释义 + 讲解；standard 是符合难度要求的通顺标准翻译。\n" +
            "若用户译文里保留了原文英文词占位（英译中）或中文占位（中译英），把这些占位对应的\n" +
            "词/表达写进 vocab 并讲解。"
        )

        /** 组装「生成句子」的 user 消息（中文指令，模型据此生成）。 */
        private fun genSentenceUser(params: JSONObject): String {
            val direction = params.optString("direction", "en2zh") // en2zh|zh2en
            val difficulty = params.optString("difficulty", "gaokao")
            val length = params.optInt("length", 20)
            val topic = params.optString("topic", "").trim()
            val dirDesc = if (direction == "zh2en") "中文长难句（描写/叙述为主，含一定层次）" else "英文长难句（含一定层次词汇）"
            val unit = if (direction == "zh2en") "字" else "词"
            val topicDesc = if (topic.isEmpty()) "不限题材" else "题材：$topic"
            return "方向：$dirDesc\n难度：$difficulty\n句长：约 $length $unit\n$topicDesc\n请生成一句用于翻译练习的句子。"
        }

        /** 组装「测评」的 user 消息（原文 + 用户译文）。 */
        private fun evalUser(params: JSONObject): String {
            val direction = params.optString("direction", "en2zh")
            val difficulty = params.optString("difficulty", "gaokao")
            val source = params.optString("source", "")
            val user = params.optString("user", "")
            val dirDesc = if (direction == "zh2en") "中译英" else "英译中"
            return "方向：$dirDesc\n难度：$difficulty\n\n原文：\n$source\n\n用户译文：\n$user"
        }
    }
}
