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
    /** BL-717: true once the one-shot fallback/failure-line speech attempt
     *  for the current turn has been used — bounds every terminal branch to
     *  at most one recovery attempt (see [ReplyPlaybackDecision]). */
    private val recoveryAttempted = AtomicBoolean(true)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var watchdog: Runnable? = null
    private var speakPoll: Runnable? = null
    // Full gain by default: phone media/assistant volume is the user control.
    @Volatile private var volumeGain = 1f

    /** 0..1 linear gain for MediaPlayer + TTS (kept at 1 for normal talk). */
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
        val locale = result.speechLocale
        when (
            val action = ReplyPlaybackDecision.decideInitial(
                ReplyPlaybackDecision.InitialInput(
                    muted = muted,
                    audioBase64 = result.replyAudioBase64,
                    replySpeechText = result.replySpeechText,
                    replyText = result.replyText,
                    fallbackText = context.getString(R.string.reply_nothing_to_say)
                )
            )
        ) {
            is ReplyPlaybackDecision.InitialAction.Muted -> complete()
            is ReplyPlaybackDecision.InitialAction.PlayAudio -> playBase64(action.base64, locale)
            is ReplyPlaybackDecision.InitialAction.Speak -> speak(action.text, locale)
            is ReplyPlaybackDecision.InitialAction.SpeakFallback -> {
                // The nothing-to-say line is itself the one-shot recovery
                // budget's attempt — if it also fails, complete() rather
                // than chase a second fallback.
                recoveryAttempted.set(true)
                speak(action.text, locale)
            }
        }
    }

    /**
     * BL-717: a playback/synthesis error, a failed TTS speak() call, or a
     * watchdog expiry all funnel here. Speaks a generic failure line ONCE
     * (never masking real content the human could still hear) and then
     * completes — never a silent finish, never an unbounded retry chain.
     */
    private fun onTerminalFailure(localeTag: String?) {
        clearWatchdogs()
        val wasRecovery = recoveryAttempted.getAndSet(true)
        when (val action = ReplyPlaybackDecision.decideAfterFailure(wasRecovery, context.getString(R.string.reply_playback_failure))) {
            ReplyPlaybackDecision.RecoveryAction.Complete -> complete()
            is ReplyPlaybackDecision.RecoveryAction.SpeakFailureLine -> speak(action.text, localeTag)
        }
    }

    /**
     * BL-826: true if the player still reports audio in flight. A defensive
     * re-check beyond [onDone] for the quiet-tail gate, since [onDone] can
     * fire slightly ahead of the last audible buffer (MediaPlayer's
     * onCompletion, or an OEM TTS engine's isSpeaking flag lagging the
     * actual speaker output).
     */
    fun isAudioActive(): Boolean {
        // When a turn is still in flight (!finished) and neither engine has
        // reported yet, assume active; once finished, assume inactive. Used
        // both as the query-can't-tell fallback and as the final default.
        val fallback = !finished.get()
        val mp = mediaPlayer
        if (mp != null) {
            return try {
                mp.isPlaying
            } catch (_: Exception) {
                fallback
            }
        }
        val engine = tts
        if (engine != null && ttsReady.get()) {
            return try {
                engine.isSpeaking
            } catch (_: Exception) {
                fallback
            }
        }
        return fallback
    }

    fun stopNow() {
        clearWatchdogs()
        finished.set(true)
        // Reset the one-shot recovery budget for whatever plays next.
        recoveryAttempted.set(false)
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

    private fun armWatchdog(ms: Long, localeTag: String?) {
        val r = Runnable {
            // Slow OEM voices (voix lente) routinely outlive a ~180wpm estimate.
            // Never complete() while TTS is still speaking — that opens the mic
            // onto Bubble's own reply and seeds the self-listen loop.
            val stillSpeaking = try {
                tts?.isSpeaking == true
            } catch (_: Exception) {
                false
            }
            val mpPlaying = try {
                mediaPlayer?.isPlaying == true
            } catch (_: Exception) {
                false
            }
            if (stillSpeaking || mpPlaying) {
                Log.w(TAG, "playback watchdog deferred — audio still active after ${ms}ms")
                armWatchdog(8_000L, localeTag)
                return@Runnable
            }
            Log.w(TAG, "playback watchdog fired after ${ms}ms")
            onTerminalFailure(localeTag)
        }
        watchdog = r
        mainHandler.postDelayed(r, ms)
    }

    private fun playBase64(b64: String, localeTag: String?) {
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
                onTerminalFailure(localeTag)
                true
            }
            mp.prepare()
            try {
                mp.setVolume(volumeGain, volumeGain)
            } catch (_: Exception) {
            }
            armWatchdog((mp.duration.takeIf { it > 0 } ?: 8_000).toLong() + 2_000, localeTag)
            mp.start()
        } catch (e: Exception) {
            Log.w(TAG, "reply audio play failed", e)
            onTerminalFailure(localeTag)
        }
    }

    private fun speak(text: String, localeTag: String?) {
        val engine = tts
        if (engine == null || !ttsReady.get()) {
            Log.w(TAG, "TTS not ready — skipping speech")
            onTerminalFailure(localeTag)
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
                onTerminalFailure(localeTag)
            }
            override fun onError(utteranceId: String?, errorCode: Int) {
                onTerminalFailure(localeTag)
            }
        })
        val words = text.split(Regex("\\s+")).size.coerceAtLeast(1)
        // Slow system voices (~80–100 wpm) need more headroom than ~180 wpm.
        armWatchdog((words * 750L + 5_000L).coerceIn(8_000L, 90_000L), localeTag)

        val params = Bundle()
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeGain)
        val status = engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "sf-reply")
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TTS speak() returned $status")
            onTerminalFailure(localeTag)
            return
        }
        // OEM engines sometimes skip onDone — poll isSpeaking.
        // Require a long quiet streak so mid-utterance pauses on a slow voice
        // do not false-complete and re-arm the mic onto live TTS.
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
                    if (quietTicks >= 8) { // 8 × 250ms ≈ 2s quiet
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
