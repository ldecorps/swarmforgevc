package com.swarmforge.floatcompanion

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/**
 * Records a discrete mic turn to WAV (PCM 16-bit mono) with optional
 * hands-free silence auto-stop. Matches Let's Talk thresholds.
 */
class AudioTurnRecorder(
    private val cacheDir: File,
    private val onAutoStop: () -> Unit
) {
    data class Capture(
        val audioBase64: String,
        val mimeType: String,
        val reason: String? = null
    )

    private var recordThread: Thread? = null
    private var audioRecord: AudioRecord? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private val recording = AtomicBoolean(false)
    /** Latches once so silence/no-speech only fires onAutoStop once; stop() still owns teardown. */
    private val autoStopFired = AtomicBoolean(false)
    private val pcm = ByteArrayOutputStream()
    private var startedAt = 0L
    private var speechDetected = false
    private var lastSoundAt = 0L
    private var autoStopReason: String? = null

    val isRecording: Boolean get() = recording.get()

    fun start(handsFree: Boolean): Boolean {
        if (recording.get()) return false
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
        if (minBuf <= 0) return false
        val bufSize = minBuf * 2
        val ar = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                CHANNEL,
                ENCODING,
                bufSize
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "RECORD_AUDIO denied", e)
            return false
        }
        if (ar.state != AudioRecord.STATE_INITIALIZED) {
            ar.release()
            return false
        }
        pcm.reset()
        speechDetected = false
        autoStopReason = null
        autoStopFired.set(false)
        startedAt = System.currentTimeMillis()
        lastSoundAt = startedAt
        audioRecord = ar
        recording.set(true)
        attachEchoHardening(ar.audioSessionId)
        ar.startRecording()
        val armedAt = startedAt
        recordThread = Thread({
            val buf = ShortArray(bufSize / 2)
            while (recording.get()) {
                val n = ar.read(buf, 0, buf.size)
                if (n <= 0) continue
                // BL-826: a hands-free arm can catch the tail of a late OS
                // buffer flush right as the mic opens — discard audio inside
                // the settle window rather than let it seed a human turn.
                if (handsFree && HandsFreeReArmGate.isWithinSettleWindow(armedAt, System.currentTimeMillis())) {
                    continue
                }
                val bytes = ByteBuffer.allocate(n * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (i in 0 until n) bytes.putShort(buf[i])
                synchronized(pcm) { pcm.write(bytes.array()) }
                if (handsFree) {
                    checkSilence(buf, n)
                }
            }
        }, "sf-mic").also { it.start() }
        return true
    }

    /** BL-826: harden capture against Bubble's own reply tail leaking back
     *  through the mic, on devices where VOICE_COMMUNICATION alone doesn't
     *  deliver it. Absence must degrade silently — an OEM without the
     *  effect still gets the timing guards in [HandsFreeReArmGate]. */
    private fun attachEchoHardening(sessionId: Int) {
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(sessionId)?.also { it.setEnabled(true) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "AcousticEchoCanceler unavailable", e)
        }
        try {
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId)?.also { it.setEnabled(true) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "NoiseSuppressor unavailable", e)
        }
    }

    private fun releaseEchoHardening() {
        try {
            echoCanceler?.release()
        } catch (_: Exception) {
        }
        try {
            noiseSuppressor?.release()
        } catch (_: Exception) {
        }
        echoCanceler = null
        noiseSuppressor = null
    }

    fun stop(): Capture? {
        // Must clear recording before joining so the mic thread can exit.
        // Do not early-return when auto-stop already latched — that path leaves
        // recording true until here; a prior false recording means cancel/double-stop.
        if (!recording.getAndSet(false)) return null
        try {
            audioRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            recordThread?.join(1500)
        } catch (_: Exception) {
        }
        recordThread = null
        try {
            audioRecord?.release()
        } catch (_: Exception) {
        }
        audioRecord = null
        releaseEchoHardening()

        val pcmBytes = synchronized(pcm) { pcm.toByteArray() }
        pcm.reset()
        if (pcmBytes.isEmpty()) {
            return Capture("", "audio/wav", autoStopReason ?: "no-audio")
        }
        if (autoStopReason == "no-speech") {
            return Capture("", "audio/wav", "no-speech")
        }
        val wav = wrapWav(pcmBytes)
        val b64 = Base64.encodeToString(wav, Base64.NO_WRAP)
        return Capture(b64, "audio/wav", autoStopReason)
    }

    fun cancel() {
        autoStopFired.set(true)
        recording.set(false)
        try {
            audioRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            recordThread?.join(500)
        } catch (_: Exception) {
        }
        recordThread = null
        try {
            audioRecord?.release()
        } catch (_: Exception) {
        }
        audioRecord = null
        releaseEchoHardening()
        pcm.reset()
    }

    private fun checkSilence(buf: ShortArray, n: Int) {
        if (autoStopFired.get()) return
        var sum = 0.0
        for (i in 0 until n) {
            val s = buf[i] / 32768.0
            sum += s * s
        }
        val rms = sqrt(sum / n.coerceAtLeast(1))
        val now = System.currentTimeMillis()
        val recordingMs = now - startedAt
        if (rms >= SPEECH_LEVEL_THRESHOLD) {
            speechDetected = true
            lastSoundAt = now
        }
        if (!speechDetected && recordingMs >= HANDS_FREE_MAX_LISTEN_MS) {
            // Leave recording=true so stop() can collect (or return no-speech).
            if (autoStopFired.compareAndSet(false, true)) {
                autoStopReason = "no-speech"
                onAutoStop()
            }
            return
        }
        if (
            speechDetected &&
            recordingMs >= MIN_RECORD_MS &&
            now - lastSoundAt >= HANDS_FREE_SILENCE_MS
        ) {
            if (autoStopFired.compareAndSet(false, true)) {
                autoStopReason = "silence"
                onAutoStop()
            }
        }
    }

    private fun wrapWav(pcmBytes: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(44 + pcmBytes.size)
        val dataSize = pcmBytes.size
        val byteRate = SAMPLE_RATE * 2
        fun writeStr(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun writeInt(v: Int) {
            out.write(byteArrayOf(
                (v and 0xff).toByte(),
                ((v shr 8) and 0xff).toByte(),
                ((v shr 16) and 0xff).toByte(),
                ((v shr 24) and 0xff).toByte()
            ))
        }
        fun writeShort(v: Int) {
            out.write(byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte()))
        }
        writeStr("RIFF")
        writeInt(36 + dataSize)
        writeStr("WAVE")
        writeStr("fmt ")
        writeInt(16)
        writeShort(1) // PCM
        writeShort(1) // mono
        writeInt(SAMPLE_RATE)
        writeInt(byteRate)
        writeShort(2) // block align
        writeShort(16) // bits
        writeStr("data")
        writeInt(dataSize)
        out.write(pcmBytes)
        return out.toByteArray()
    }

    companion object {
        private const val TAG = "SfFloatMic"
        const val SAMPLE_RATE = 16000
        private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        const val MIN_RECORD_MS = 400L
        const val HANDS_FREE_SILENCE_MS = 2500L
        const val HANDS_FREE_POST_SPEECH_MS = 400L
        const val HANDS_FREE_AFTER_ERROR_MS = 2500L
        const val HANDS_FREE_MAX_LISTEN_MS = 30_000L
        const val SPEECH_LEVEL_THRESHOLD = 0.02
        const val STT_RETRY_BUDGET = 3
    }
}
