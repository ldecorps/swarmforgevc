package com.swarmforge.floatcompanion

import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/**
 * BL-707: discrete turns against the Let's Talk bridge path.
 * Auth: Authorization Bearer + X-Control-Token (same as Mini App).
 */
object BridgeClient {
    data class TurnResult(
        val ok: Boolean,
        val replyText: String,
        val transcript: String = "",
        val replyAudioBase64: String? = null,
        val replySpeechText: String? = null,
        val clientTts: Boolean = false,
        val speechLocale: String? = null,
        val recoverable: Boolean = false,
        val reason: String? = null,
        /** BL-716: host unresolved/unreachable or the tunnel edge itself is dead. */
        val connectionFailure: Boolean = false
    )

    /** Cloudflare quick-tunnel edge codes for "origin (this bridge) is gone". */
    private val TUNNEL_DEAD_HTTP_CODES = setOf(521, 522, 523, 524, 530)

    /** BL-716: a clear, non-raw message for DNS/connect failures — never the exception dump. */
    private fun friendlyConnectionMessage(e: Exception): String = when (e) {
        is UnknownHostException -> "Can't find the bridge host — pairing URL may be stale."
        is SocketTimeoutException -> "Bridge connection timed out — the tunnel may be down."
        is ConnectException -> "Can't connect to the bridge — the tunnel may be down."
        is IOException -> "Bridge connection error — the tunnel may be down."
        else -> "Connection error: ${e.message ?: e.javaClass.simpleName}"
    }

    /** BL-716: a clear message for a dead tunnel edge — never the raw Cloudflare error body. */
    private fun friendlyTunnelMessage(code: Int): String =
        "Bridge tunnel unreachable (HTTP $code) — pairing URL may be stale."

    fun submitTextTurn(baseUrl: String, token: String, text: String): TurnResult =
        postTurn(baseUrl, token, JSONObject().put("text", text))

    fun submitAudioTurn(
        baseUrl: String,
        token: String,
        audioBase64: String,
        mimeType: String
    ): TurnResult =
        postTurn(
            baseUrl,
            token,
            JSONObject()
                .put("audioBase64", audioBase64)
                .put("mimeType", mimeType)
        )

    fun newSession(baseUrl: String, token: String): Pair<Boolean, String?> {
        val url = URL("${baseUrl.trimEnd('/')}/lets-talk/new-session")
        val conn = openAuth(url, token)
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Length", "0")
            conn.outputStream.close()
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                val reason = if (code in TUNNEL_DEAD_HTTP_CODES) {
                    friendlyTunnelMessage(code)
                } else {
                    "HTTP $code: ${raw.take(200)}"
                }
                return false to reason
            }
            val json = JSONObject(raw)
            if (!json.optBoolean("success", false)) {
                return false to json.optString("reason", "new session failed")
            }
            true to null
        } catch (e: Exception) {
            false to friendlyConnectionMessage(e)
        } finally {
            conn.disconnect()
        }
    }

    private fun postTurn(baseUrl: String, token: String, body: JSONObject): TurnResult {
        val url = URL("${baseUrl.trimEnd('/')}/lets-talk/turn")
        val conn = openAuth(url, token)
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                return if (code in TUNNEL_DEAD_HTTP_CODES) {
                    TurnResult(false, "", reason = friendlyTunnelMessage(code), connectionFailure = true)
                } else {
                    TurnResult(false, "", reason = "HTTP $code: ${raw.take(200)}")
                }
            }
            val json = JSONObject(raw)
            if (!json.optBoolean("success", false)) {
                return TurnResult(
                    ok = false,
                    replyText = "",
                    recoverable = json.optBoolean("recoverable", false),
                    reason = json.optString("reason", "turn failed")
                )
            }
            val reply = json.optString("replyText", json.optString("transcript", ""))
            val audio = json.optString("replyAudioBase64", "").ifBlank { null }
            val speech = json.optString("replySpeechText", "").ifBlank { null }
            TurnResult(
                ok = true,
                replyText = reply.ifBlank { "(empty reply)" },
                transcript = json.optString("transcript", ""),
                replyAudioBase64 = audio,
                replySpeechText = speech,
                clientTts = json.optBoolean("clientTts", false),
                speechLocale = json.optString("speechLocale", "").ifBlank { null }
            )
        } catch (e: Exception) {
            TurnResult(false, "", reason = friendlyConnectionMessage(e), connectionFailure = true)
        } finally {
            conn.disconnect()
        }
    }

    private fun openAuth(url: URL, token: String): HttpURLConnection =
        (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 120_000
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-Control-Token", token)
            setRequestProperty("Accept", "application/json")
        }
}
