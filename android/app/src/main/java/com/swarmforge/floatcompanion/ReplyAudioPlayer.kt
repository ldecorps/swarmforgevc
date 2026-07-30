package com.swarmforge.floatcompanion

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.util.Log
import java.io.File
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/** Plays Let's Talk reply audio (server base64) or falls back to device TTS. */
class ReplyAudioPlayer(
    private val context: Context,
    private val onDone: () -> Unit
) : TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = TextToSpeech(context, this)
    private var mediaPlayer: MediaPlayer? = null
    private val ttsReady = AtomicBoolean(false)
    private val finished = AtomicBoolean(true)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var watchdog: Runnable? = null
    private var speakPoll: Runnable? = null
    @Volatile private var volumeGain = 0.55f

    /** 0..1 linear gain for MediaPlayer + TTS. */
    fun setVolume(gain: Float) {
        volumeGain = gain.coerceIn(0f, 1f)
        try {
            mediaPlayer?.setVolume(volumeGain, volumeGain)
        } catch (_: Exception) {
        }
    }

    override fun onInit(status: Int) {
        ttsReady.set(status == TextToSpeech.SUCCESS)
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.getDefault()
        }
    }

    fun play(result: BridgeClient.TurnResult, muted: Boolean) {
        stopNow()
        finished.set(false)
        if (muted) {
            complete()
            return
        }
        val audioB64 = result.replyAudioBase64
        if (!audioB64.isNullOrBlank()) {
            playBase64(audioB64)
            return
        }
        val speech = result.replySpeechText?.ifBlank { null }
            ?: result.replyText.ifBlank { null }
        if (speech != null) {
            speak(speech, result.speechLocale)
        } else {
            complete()
        }
    }

    fun stopNow() {
        clearWatchdogs()
        finished.set(true)
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {
        }
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {
        }
        mediaPlayer = null
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
    }

    /**
     * Local TTS greeting (not a bridge reply). Waits briefly for TTS init.
     * Invokes [onDone] when finished or skipped.
     */
    fun speakPlain(text: String, attemptsLeft: Int = 8) {
        stopNow()
        finished.set(false)
        if (!ttsReady.get()) {
            if (attemptsLeft <= 0) {
                Log.w(TAG, "TTS not ready for plain speak — skipping")
                complete()
                return
            }
            mainHandler.postDelayed({ speakPlain(text, attemptsLeft - 1) }, 250)
            return
        }
        speak(text, null)
    }

    fun shutdown() {
        stopNow()
        tts?.shutdown()
        tts = null
    }

    private fun complete() {
        if (!finished.compareAndSet(false, true)) return
        clearWatchdogs()
        mainHandler.post { onDone() }
    }

    private fun clearWatchdogs() {
        watchdog?.let { mainHandler.removeCallbacks(it) }
        speakPoll?.let { mainHandler.removeCallbacks(it) }
        watchdog = null
        speakPoll = null
    }

    private fun armWatchdog(ms: Long) {
        val r = Runnable {
            Log.w(TAG, "playback watchdog fired after ${ms}ms")
            complete()
        }
        watchdog = r
        mainHandler.postDelayed(r, ms)
    }

    private fun playBase64(b64: String) {
        try {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val tmp = File(context.cacheDir, "sf-reply-${System.currentTimeMillis()}.ogg")
            tmp.writeBytes(bytes)
            val mp = MediaPlayer()
            mediaPlayer = mp
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            mp.setDataSource(tmp.absolutePath)
            mp.setOnCompletionListener {
                tmp.delete()
                mediaPlayer = null
                complete()
            }
            mp.setOnErrorListener { _, _, _ ->
                tmp.delete()
                mediaPlayer = null
                complete()
                true
            }
            mp.prepare()
            try {
                mp.setVolume(volumeGain, volumeGain)
            } catch (_: Exception) {
            }
            armWatchdog((mp.duration.takeIf { it > 0 } ?: 8_000).toLong() + 2_000)
            mp.start()
        } catch (e: Exception) {
            Log.w(TAG, "reply audio play failed", e)
            complete()
        }
    }

    private fun speak(text: String, localeTag: String?) {
        val engine = tts
        if (engine == null || !ttsReady.get()) {
            Log.w(TAG, "TTS not ready — skipping speech")
            complete()
            return
        }
        if (!localeTag.isNullOrBlank()) {
            try {
                engine.language = Locale.forLanguageTag(localeTag.replace('_', '-'))
            } catch (_: Exception) {
            }
        }
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                complete()
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                complete()
            }
            override fun onError(utteranceId: String?, errorCode: Int) {
                complete()
            }
        })
        val words = text.split(Regex("\\s+")).size.coerceAtLeast(1)
        // ~180 wpm + buffer; never leave the panel stuck on "speaking"
        armWatchdog((words * 400L + 3_000L).coerceIn(4_000L, 45_000L))

        val params = Bundle()
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeGain)
        val status = engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "sf-reply")
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TTS speak() returned $status")
            complete()
            return
        }
        // OEM engines sometimes skip onDone — poll isSpeaking.
        val poll = object : Runnable {
            private var sawSpeaking = false
            private var quietTicks = 0
            override fun run() {
                if (finished.get()) return
                val speaking = try {
                    engine.isSpeaking
                } catch (_: Exception) {
                    false
                }
                if (speaking) {
                    sawSpeaking = true
                    quietTicks = 0
                } else if (sawSpeaking) {
                    quietTicks++
                    if (quietTicks >= 2) {
                        complete()
                        return
                    }
                }
                speakPoll = this
                mainHandler.postDelayed(this, 250)
            }
        }
        speakPoll = poll
        mainHandler.postDelayed(poll, 400)
    }

    companion object {
        private const val TAG = "SfFloatReply"
    }
}
