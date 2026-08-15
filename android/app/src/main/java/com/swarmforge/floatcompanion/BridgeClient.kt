package com.swarmforge.floatcompanion

import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
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

    // BL-864: GET/POST /lets-talk/audio-engine — Bubble Settings' voice-engine
    // selector reads and writes the BL-863 preference through these.

    data class AudioEngineOptionResult(val serviceable: Boolean, val reason: String? = null)

    data class AudioEngineStatusResult(
        val ok: Boolean,
        val enabled: Boolean = false,
        val engine: String = "",
        val local: AudioEngineOptionResult = AudioEngineOptionResult(false),
        val openai: AudioEngineOptionResult = AudioEngineOptionResult(false),
        val reason: String? = null
    )

    data class AudioEngineWriteResult(
        val ok: Boolean,
        val engine: String = "",
        val reason: String? = null,
        val connectionFailure: Boolean = false
    )

    /**
     * BL-864 invariant 1 (BL-654 coder-authored property test in
     * BridgeClientPropertyTest): the phone sends an engine NAME only. This
     * is the one place the write request body is built — a plain JSONObject
     * with exactly one key, never string concatenation that could let an
     * extra field ride along. `internal` (BL-769 precedent) so the JVM unit
     * suite can exercise it directly.
     */
    internal fun audioEnginePreferenceBody(engine: String): JSONObject =
        JSONObject().put("engine", engine)

    private fun audioEngineOptionFromJson(obj: JSONObject?): AudioEngineOptionResult {
        if (obj == null) return AudioEngineOptionResult(false)
        return AudioEngineOptionResult(
            serviceable = obj.optBoolean("serviceable", false),
            reason = obj.optString("reason", "").ifBlank { null }
        )
    }

    fun fetchAudioEngineStatus(baseUrl: String, token: String): AudioEngineStatusResult {
        return try {
            val (code, raw) = getRaw(baseUrl, "/lets-talk/audio-engine", token)
            if (code !in 200..299) {
                return AudioEngineStatusResult(false, reason = "HTTP $code: ${raw.take(200)}")
            }
            val json = JSONObject(raw)
            if (!json.optBoolean("success", false)) {
                return AudioEngineStatusResult(false, reason = json.optString("reason", "status query failed"))
            }
            val engines = json.optJSONObject("engines")
            AudioEngineStatusResult(
                ok = true,
                enabled = json.optBoolean("enabled", false),
                engine = json.optString("engine", ""),
                local = audioEngineOptionFromJson(engines?.optJSONObject("local")),
                openai = audioEngineOptionFromJson(engines?.optJSONObject("openai"))
            )
        } catch (e: Exception) {
            AudioEngineStatusResult(false, reason = friendlyConnectionMessage(e))
        }
    }

    fun writeAudioEnginePreference(baseUrl: String, token: String, engine: String): AudioEngineWriteResult {
        val url = URL("${baseUrl.trimEnd('/')}/lets-talk/audio-engine")
        val conn = openAuth(url, token)
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            val payload = audioEnginePreferenceBody(engine).toString().toByteArray(Charsets.UTF_8)
            conn.setFixedLengthStreamingMode(payload.size)
            conn.outputStream.use { it.write(payload) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                return AudioEngineWriteResult(false, reason = "HTTP $code: ${raw.take(200)}")
            }
            val json = JSONObject(raw)
            if (!json.optBoolean("success", false)) {
                return AudioEngineWriteResult(false, reason = json.optString("reason", "engine choice refused"))
            }
            AudioEngineWriteResult(true, engine = json.optString("engine", engine))
        } catch (e: Exception) {
            AudioEngineWriteResult(false, reason = friendlyConnectionMessage(e), connectionFailure = true)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * BL-716: a clear, non-raw message for DNS/connect failures — never the exception dump.
     *
     * BL-769: internal (not private) so the JVM unit suite can exercise the
     * classification directly — this is the pure logic behind the BL-716 defect
     * where an unresolvable host had to stop reading as a healthy state.
     */
    internal fun friendlyConnectionMessage(e: Exception): String = when (e) {
        is UnknownHostException -> "Can't find the bridge host — pairing URL may be stale."
        is SocketTimeoutException -> "Bridge connection timed out — the tunnel may be down."
        is ConnectException -> "Can't connect to the bridge — the tunnel may be down."
        is IOException -> "Bridge connection error — the tunnel may be down."
        else -> "Connection error: ${e.message ?: e.javaClass.simpleName}"
    }

    /** BL-716: a clear message for a dead tunnel edge — never the raw Cloudflare error body. */
    private fun friendlyTunnelMessage(code: Int): String =
        "Bridge tunnel unreachable (HTTP $code) — pairing URL may be stale."

    fun submitTextTurn(
        baseUrl: String,
        token: String,
        text: String,
        connectionSink: ((HttpURLConnection) -> Unit)? = null
    ): TurnResult =
        postTurn(baseUrl, token, JSONObject().put("text", text), connectionSink)

    fun submitAudioTurn(
        baseUrl: String,
        token: String,
        audioBase64: String,
        mimeType: String,
        connectionSink: ((HttpURLConnection) -> Unit)? = null
    ): TurnResult =
        postTurn(
            baseUrl,
            token,
            JSONObject()
                .put("audioBase64", audioBase64)
                .put("mimeType", mimeType),
            connectionSink
        )

    // BL-763: GET /lets-talk/meta — the bridge process's own instanceId
    // (+ startedAt), so TalkEngine.syncBridgeInstanceAndSession can detect a
    // bounce (BridgeBounceSession, the pure decision behind it).

    data class BridgeMetaResult(
        val ok: Boolean,
        val instanceId: String = "",
        val startedAt: String = "",
        val reason: String? = null
    )

    fun fetchBridgeMeta(baseUrl: String, token: String): BridgeMetaResult {
        return try {
            val (code, raw) = getRaw(baseUrl, "/lets-talk/meta", token)
            if (code !in 200..299) {
                return BridgeMetaResult(false, reason = "HTTP $code: ${raw.take(200)}")
            }
            val json = JSONObject(raw)
            if (!json.optBoolean("success", false)) {
                return BridgeMetaResult(false, reason = json.optString("reason", "meta query failed"))
            }
            BridgeMetaResult(
                ok = true,
                instanceId = json.optString("instanceId", ""),
                startedAt = json.optString("startedAt", "")
            )
        } catch (e: Exception) {
            BridgeMetaResult(false, reason = friendlyConnectionMessage(e))
        }
    }

    // BL-763/BL-765: GET /lets-talk/bubble-config.json — Bubble's full
    // capability document (textTurns, handsFree, holdMusic, playlist,
    // newSession, pauseAll, bridgeBounceAutoSessionReset, voiceEngineSwitch).
    // BL-763's stub read only bridgeBounceAutoSessionReset; this ticket
    // applies the rest. Every flag defaults to true (the bundled-default
    // shape) so a failed/unreachable fetch — BubbleConfigResult(ok = false)
    // — degrades to "every capability enabled" rather than a broken surface
    // (BL-654 invariant 1).

    data class BubbleConfigResult(
        val ok: Boolean,
        val textTurns: Boolean = true,
        val handsFree: Boolean = true,
        val holdMusic: Boolean = true,
        val playlist: Boolean = true,
        val newSession: Boolean = true,
        val pauseAll: Boolean = true,
        val bridgeBounceAutoSessionReset: Boolean = true,
        val voiceEngineSwitch: Boolean = true,
        val reason: String? = null
    )

    fun fetchBubbleConfig(baseUrl: String, token: String): BubbleConfigResult {
        return try {
            val (code, raw) = getRaw(baseUrl, "/lets-talk/bubble-config.json", token)
            if (code !in 200..299) {
                return BubbleConfigResult(false, reason = "HTTP $code: ${raw.take(200)}")
            }
            val json = JSONObject(raw)
            val features = json.optJSONObject("features")
            BubbleConfigResult(
                ok = true,
                textTurns = features?.optBoolean("textTurns", true) ?: true,
                handsFree = features?.optBoolean("handsFree", true) ?: true,
                holdMusic = features?.optBoolean("holdMusic", true) ?: true,
                playlist = features?.optBoolean("playlist", true) ?: true,
                newSession = features?.optBoolean("newSession", true) ?: true,
                pauseAll = features?.optBoolean("pauseAll", true) ?: true,
                bridgeBounceAutoSessionReset = features?.optBoolean("bridgeBounceAutoSessionReset", true) ?: true,
                voiceEngineSwitch = features?.optBoolean("voiceEngineSwitch", true) ?: true
            )
        } catch (e: Exception) {
            BubbleConfigResult(false, reason = friendlyConnectionMessage(e))
        }
    }

    // BL-765: GET /lets-talk/chiptunes.json — the hold-music catalog as
    // data, so a song add reaches the phone on bridge redeploy with no APK
    // rebuild. Parsing rejects the WHOLE catalog on any malformed entry
    // (BL-654 invariant 2) rather than keeping the songs that happened to
    // parse — [parseChiptunesCatalog] is the pure decision, `internal` so
    // the JVM unit suite can exercise it directly (BL-769 precedent).

    data class ChiptunesSong(val name: String, val bpm: Int, val steps: List<List<Int>>)

    data class ChiptunesCatalogResult(
        val ok: Boolean,
        val songs: List<ChiptunesSong> = emptyList(),
        val reason: String? = null
    )

    internal fun parseChiptunesCatalog(raw: String): List<ChiptunesSong>? {
        return try {
            val json = JSONObject(raw)
            val songsJson = json.optJSONArray("songs") ?: return null
            val songs = ArrayList<ChiptunesSong>(songsJson.length())
            for (i in 0 until songsJson.length()) {
                songs.add(parseChiptuneSong(songsJson.optJSONObject(i) ?: return null) ?: return null)
            }
            if (songs.isEmpty()) null else songs
        } catch (_: Exception) {
            null
        }
    }

    private fun parseChiptuneSong(obj: JSONObject): ChiptunesSong? {
        val name = obj.optString("name", "")
        val bpm = obj.optInt("bpm", -1)
        val stepsJson = obj.optJSONArray("steps") ?: return null
        if (name.isBlank() || bpm <= 0 || stepsJson.length() == 0) return null
        val steps = ArrayList<List<Int>>(stepsJson.length())
        for (i in 0 until stepsJson.length()) {
            val row = stepsJson.optJSONArray(i) ?: return null
            if (row.length() != 4) return null
            steps.add((0 until 4).map { row.optInt(it, Int.MIN_VALUE) })
        }
        if (steps.any { row -> row.any { it == Int.MIN_VALUE } }) return null
        return ChiptunesSong(name, bpm, steps)
    }

    fun fetchChiptunesCatalog(baseUrl: String, token: String): ChiptunesCatalogResult {
        return try {
            val (code, raw) = getRaw(baseUrl, "/lets-talk/chiptunes.json", token)
            if (code !in 200..299) {
                return ChiptunesCatalogResult(false, reason = "HTTP $code: ${raw.take(200)}")
            }
            val songs = parseChiptunesCatalog(raw)
                ?: return ChiptunesCatalogResult(false, reason = "malformed chiptunes catalog")
            ChiptunesCatalogResult(true, songs = songs)
        } catch (e: Exception) {
            ChiptunesCatalogResult(false, reason = friendlyConnectionMessage(e))
        }
    }

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

    private fun postTurn(
        baseUrl: String,
        token: String,
        body: JSONObject,
        connectionSink: ((HttpURLConnection) -> Unit)? = null
    ): TurnResult {
        val url = URL("${baseUrl.trimEnd('/')}/lets-talk/turn")
        val conn = openAuth(url, token)
        connectionSink?.invoke(conn)
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            val payload = body.toString().toByteArray(Charsets.UTF_8)
            // Stream large PTT payloads so the write is not buffered entirely
            // in memory before the request starts (helps avoid silent stalls).
            conn.setFixedLengthStreamingMode(payload.size)
            conn.outputStream.use { it.write(payload) }
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

    /**
     * BL-765 cleanup: the shared GET-and-read-raw-body shape behind every
     * `fetch*` query (audio-engine status, bridge meta, bubble config,
     * chiptunes catalog) — each keeps its own JSON parsing and connection-
     * failure handling, only the HTTP mechanics were duplicated.
     */
    private fun getRaw(baseUrl: String, path: String, token: String): Pair<Int, String> {
        val url = URL("${baseUrl.trimEnd('/')}$path")
        val conn = openAuth(url, token)
        try {
            conn.requestMethod = "GET"
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            return code to raw
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
