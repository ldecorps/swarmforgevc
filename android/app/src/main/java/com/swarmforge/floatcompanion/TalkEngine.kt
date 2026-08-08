package com.swarmforge.floatcompanion

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.net.HttpURLConnection

/**
 * Voice session that outlives [TalkPanelActivity].
 * Owned by [OverlayService] so hands-free / mid-turn keep the mic while collapsed.
 */
class TalkEngine(private val appContext: Context) {
    enum class Phase { READY, RECORDING, THINKING, SPEAKING, ERROR }

    data class Snapshot(
        val phase: Phase = Phase.READY,
        val replyText: String = "",
        val replyIsErrorStyle: Boolean = false,
        val holdMusicTitle: String? = null,
        val handsFree: Boolean = false,
        val holdMusicOn: Boolean = true,
        val muted: Boolean = false,
        val pausedAll: Boolean = false,
        val volumePercent: Int = 55,
        val preferredSong: String = ""
    )

    fun interface Listener {
        fun onSnapshot(snapshot: Snapshot)
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val alive = AtomicBoolean(true)
    /** Bumps when a newer turn supersedes an in-flight HTTP call (PTT / text). */
    private val turnGeneration = AtomicInteger(0)
    @Volatile private var inFlightConn: HttpURLConnection? = null

    private var phase = Phase.READY
    private var handsFree = CompanionPrefs.isHandsFree(appContext)
    private var holdMusicOn = CompanionPrefs.isHoldMusic(appContext)
    private var muted = CompanionPrefs.isMuted(appContext)
    private var volumePercent = CompanionPrefs.getVolumePercent(appContext)
    private var preferredSong = CompanionPrefs.getPreferredSong(appContext)
    private var pausedAll = false
    private var handsFreeBeforePause = false
    private var mutedBeforePause = false
    private var replyText = ""
    private var replyIsErrorStyle = false
    private var holdMusicTitle: String? = null

    private var recorder: AudioTurnRecorder? = null
    private val holdMusic = HoldMusicPlayer()
    private var replyPlayer: ReplyAudioPlayer? = null
    private var autoListenRunnable: Runnable? = null
    private var recordStartedAt = 0L
    private var listener: Listener? = null

    init {
        replyPlayer = ReplyAudioPlayer(appContext) {
            mainHandler.post { onPlaybackDone() }
        }
        // Reply voice stays at full app gain so phone system volume owns loudness
        // (BL-765 volume split). Slider only scales hold music.
        replyPlayer?.setVolume(1f)
        holdMusic.setVolume(volumePercent / 100f)
        holdMusic.setPreferredSong(preferredSong.ifBlank { null })
        recorder = AudioTurnRecorder(appContext.cacheDir) {
            mainHandler.post { onRecorderAutoStop() }
        }
    }

    fun snapshot(): Snapshot = Snapshot(
        phase = phase,
        replyText = replyText,
        replyIsErrorStyle = replyIsErrorStyle,
        holdMusicTitle = holdMusicTitle,
        handsFree = handsFree,
        holdMusicOn = holdMusicOn,
        muted = muted,
        pausedAll = pausedAll,
        volumePercent = volumePercent,
        preferredSong = preferredSong
    )

    fun songNames(): List<String> = HoldMusicPlayer.SONGS.map { it.name }

    fun setListener(l: Listener?) {
        listener = l
        l?.onSnapshot(snapshot())
    }

    /** Keep running while collapsed if hands-free or mid-turn. */
    fun shouldSurviveCollapse(): Boolean =
        !pausedAll && (handsFree || phase == Phase.RECORDING || phase == Phase.THINKING || phase == Phase.SPEAKING)

    fun shutdown() {
        if (!alive.getAndSet(false)) return
        clearAutoListen()
        abortInFlightTurn()
        recorder?.cancel()
        holdMusic.stop()
        replyPlayer?.shutdown()
        listener = null
        io.shutdownNow()
    }

    fun setHandsFree(on: Boolean) {
        if (pausedAll && on) return
        handsFree = on
        CompanionPrefs.setHandsFree(appContext, on)
        if (on && (phase == Phase.READY || phase == Phase.ERROR)) {
            if (phase == Phase.ERROR) setPhase(Phase.READY)
            scheduleHandsFreeListen(AudioTurnRecorder.HANDS_FREE_POST_SPEECH_MS)
        } else if (!on) {
            clearAutoListen()
            if (phase == Phase.RECORDING) stopRecording(manual = false)
        }
        publish()
    }

    fun setHoldMusic(on: Boolean) {
        holdMusicOn = on
        CompanionPrefs.setHoldMusic(appContext, on)
        if (!on) {
            holdMusic.stop()
            holdMusicTitle = null
        } else if (phase == Phase.THINKING && !pausedAll) {
            startHoldMusic()
        }
        publish()
    }

    fun setMuted(on: Boolean) {
        if (pausedAll && !on) return
        muted = on
        CompanionPrefs.setMuted(appContext, on)
        if (on) replyPlayer?.stopNow()
        publish()
    }

    fun setVolumePercent(percent: Int) {
        volumePercent = percent.coerceIn(0, 100)
        CompanionPrefs.setVolumePercent(appContext, volumePercent)
        // Hold music only — reply voice follows the phone volume (USAGE_ASSISTANT / TTS).
        holdMusic.setVolume(volumePercent / 100f)
        publish()
    }

    /** Empty name = shuffle. If hold music is playing, switch now. */
    fun setPreferredSong(name: String) {
        preferredSong = name.trim()
        CompanionPrefs.setPreferredSong(appContext, preferredSong)
        holdMusic.setPreferredSong(preferredSong.ifBlank { null })
        if (holdMusicOn && !pausedAll && phase == Phase.THINKING) {
            startHoldMusic()
        }
        publish()
    }

    /** Play a hold tune now for listening — works even when not thinking. */
    fun previewSong(name: String) {
        if (pausedAll) return
        val trimmed = name.trim()
        if (trimmed.isNotEmpty()) {
            preferredSong = trimmed
            CompanionPrefs.setPreferredSong(appContext, preferredSong)
            holdMusic.setPreferredSong(preferredSong)
        } else {
            holdMusic.setPreferredSong(null)
        }
        if (!holdMusicOn) {
            holdMusicOn = true
            CompanionPrefs.setHoldMusic(appContext, true)
        }
        startHoldMusic()
    }

    fun stopHoldMusicPreview() {
        // Keep thinking-phase music if a turn is in flight; only stop idle previews.
        if (phase == Phase.THINKING) return
        holdMusic.stop()
        holdMusicTitle = null
        publish()
    }

    fun togglePauseAll() {
        if (!pausedAll) {
            handsFreeBeforePause = handsFree
            mutedBeforePause = muted
            pausedAll = true
            // In-memory only — do not clobber prefs; pause is ephemeral.
            muted = true
            handsFree = false
            clearAutoListen()
            abortInFlightTurn()
            if (recorder?.isRecording == true) recorder?.cancel()
            replyPlayer?.stopNow()
            holdMusic.stop()
            holdMusicTitle = null
            if (phase != Phase.READY) {
                phase = Phase.READY
            }
            publish()
        } else {
            pausedAll = false
            muted = mutedBeforePause
            handsFree = handsFreeBeforePause
            CompanionPrefs.setMuted(appContext, muted)
            CompanionPrefs.setHandsFree(appContext, handsFree)
            publish()
            if (holdMusicOn && phase == Phase.THINKING) {
                startHoldMusic()
            }
            if (handsFree) {
                ensureListeningIfHandsFree()
            }
        }
    }

    fun onRecordClicked() {
        if (pausedAll) return
        when (phase) {
            Phase.READY, Phase.ERROR -> startRecording(auto = false)
            Phase.SPEAKING -> {
                replyPlayer?.stopNow()
                setPhase(Phase.READY)
                startRecording(auto = false)
            }
            Phase.RECORDING -> stopRecording(manual = true)
            Phase.THINKING -> {
                // Allow barge-out of a stuck bridge wait so PTT is not wedged
                // behind a 120s timeout from a prior turn.
                abortInFlightTurn()
                holdMusic.stop()
                holdMusicTitle = null
                setPhase(Phase.READY)
                startRecording(auto = false)
            }
        }
    }

    fun ensureListeningIfHandsFree() {
        if (!alive.get() || pausedAll || !handsFree) return
        if (phase == Phase.READY || phase == Phase.ERROR) {
            if (phase == Phase.ERROR) setPhase(Phase.READY)
            scheduleHandsFreeListen(AudioTurnRecorder.HANDS_FREE_POST_SPEECH_MS)
        }
    }

    /**
     * Cold-start: if the user last left hands-free on, greet briefly then open the mic.
     * Safe to call once when [OverlayService] creates the engine.
     */
    fun greetAndResumeHandsFreeIfNeeded() {
        if (!alive.get() || pausedAll || !handsFree) return
        if (phase != Phase.READY && phase != Phase.ERROR) return
        if (phase == Phase.ERROR) setPhase(Phase.READY)
        val greeting = appContext.getString(R.string.hands_free_hello)
        replyText = greeting
        replyIsErrorStyle = true
        publish()
        if (muted) {
            ensureListeningIfHandsFree()
            return
        }
        setPhase(Phase.SPEAKING)
        replyPlayer?.speakPlain(greeting)
    }

    fun startRecording(auto: Boolean) {
        if (!alive.get() || pausedAll || phase == Phase.THINKING || phase == Phase.SPEAKING) return
        if (recorder?.isRecording == true) return
        clearAutoListen()
        val ok = recorder?.start(handsFree) == true
        if (!ok) {
            replyText = appContext.getString(R.string.no_audio)
            replyIsErrorStyle = true
            setPhase(Phase.READY)
            if (auto) scheduleHandsFreeListen(AudioTurnRecorder.HANDS_FREE_AFTER_ERROR_MS)
            publish()
            return
        }
        recordStartedAt = System.currentTimeMillis()
        setPhase(Phase.RECORDING)
    }

    fun sendTextTurn(text: String) {
        if (!alive.get() || pausedAll || phase == Phase.THINKING || phase == Phase.SPEAKING) return
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        clearAutoListen()
        if (recorder?.isRecording == true) recorder?.cancel()
        replyText = appContext.getString(R.string.phase_thinking) + "…"
        replyIsErrorStyle = true
        setPhase(Phase.THINKING)
        val base = CompanionPrefs.getBaseUrl(appContext)
        val token = CompanionPrefs.getToken(appContext)
        val gen = beginTurn()
        io.execute {
            val result = BridgeClient.submitTextTurn(base, token, trimmed, ::attachInFlight)
            mainHandler.post {
                if (!alive.get() || gen != turnGeneration.get()) return@post
                clearInFlight()
                if (result.ok) {
                    onTurnOk(result)
                } else {
                    applyTurnFailure(result)
                }
            }
        }
    }

    fun resetSession() {
        if (phase == Phase.THINKING || phase == Phase.SPEAKING) return
        val base = CompanionPrefs.getBaseUrl(appContext)
        val token = CompanionPrefs.getToken(appContext)
        io.execute {
            val (ok, reason) = BridgeClient.newSession(base, token)
            mainHandler.post {
                if (!alive.get()) return@post
                if (ok) {
                    replyText = "New session started."
                    replyIsErrorStyle = true
                    setPhase(Phase.READY)
                } else {
                    Toast.makeText(appContext, reason ?: "new session failed", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun onRecorderAutoStop() {
        if (pausedAll) return
        if (phase != Phase.RECORDING) return
        stopRecording(manual = false)
    }

    private fun stopRecording(manual: Boolean) {
        if (pausedAll) {
            recorder?.cancel()
            return
        }
        if (phase != Phase.RECORDING && recorder?.isRecording != true) return
        if (manual && System.currentTimeMillis() - recordStartedAt < AudioTurnRecorder.MIN_RECORD_MS) {
            Toast.makeText(appContext, R.string.keep_recording, Toast.LENGTH_SHORT).show()
            return
        }
        val capture = recorder?.stop()
        when {
            capture == null || capture.audioBase64.isBlank() -> {
                replyText = when (capture?.reason) {
                    "no-speech" -> appContext.getString(R.string.no_speech)
                    else -> appContext.getString(R.string.no_audio)
                }
                replyIsErrorStyle = true
                setPhase(Phase.READY)
                scheduleHandsFreeListen(AudioTurnRecorder.HANDS_FREE_AFTER_ERROR_MS)
            }
            else -> {
                if (capture.reason == "max-listen") {
                    Toast.makeText(appContext, R.string.record_max_reached, Toast.LENGTH_SHORT).show()
                }
                submitAudio(capture.audioBase64, capture.mimeType, sttAttempt = 0)
            }
        }
    }

    private fun submitAudio(audioBase64: String, mimeType: String, sttAttempt: Int) {
        replyText = appContext.getString(R.string.phase_thinking) + "…"
        replyIsErrorStyle = true
        setPhase(Phase.THINKING)
        val base = CompanionPrefs.getBaseUrl(appContext)
        val token = CompanionPrefs.getToken(appContext)
        val gen = if (sttAttempt == 0) beginTurn() else turnGeneration.get()
        io.execute {
            val result = BridgeClient.submitAudioTurn(base, token, audioBase64, mimeType, ::attachInFlight)
            mainHandler.post {
                if (!alive.get() || gen != turnGeneration.get()) return@post
                clearInFlight()
                if (result.ok) {
                    onTurnOk(result)
                } else if (
                    result.recoverable &&
                    sttAttempt + 1 < AudioTurnRecorder.STT_RETRY_BUDGET
                ) {
                    submitAudio(audioBase64, mimeType, sttAttempt + 1)
                } else {
                    applyTurnFailure(result)
                }
            }
        }
    }

    private fun beginTurn(): Int {
        try {
            inFlightConn?.disconnect()
        } catch (_: Exception) {
        }
        inFlightConn = null
        return turnGeneration.incrementAndGet()
    }

    private fun abortInFlightTurn() {
        turnGeneration.incrementAndGet()
        try {
            inFlightConn?.disconnect()
        } catch (_: Exception) {
        }
        inFlightConn = null
    }

    private fun attachInFlight(conn: HttpURLConnection) {
        inFlightConn = conn
    }

    private fun clearInFlight() {
        inFlightConn = null
    }

    private fun onTurnOk(result: BridgeClient.TurnResult) {
        replyText = result.replyText
        replyIsErrorStyle = false
        setPhase(Phase.SPEAKING)
        replyPlayer?.play(result, muted)
    }

    /**
     * BL-716: a DNS/connect failure (or dead tunnel edge) must not read as a healthy
     * READY/RECORDING cycle — land on the distinct ERROR phase so the bubble color and
     * panel text make the failure visible, instead of the invisible pass-through READY
     * previously used for every failure class alike.
     */
    private fun applyTurnFailure(result: BridgeClient.TurnResult) {
        val reason = result.reason ?: "turn failed"
        replyText = if (result.connectionFailure) {
            "$reason ${appContext.getString(R.string.connection_error_hint)}"
        } else {
            reason
        }
        replyIsErrorStyle = true
        setPhase(if (result.connectionFailure) Phase.ERROR else Phase.READY)
        scheduleHandsFreeListen(AudioTurnRecorder.HANDS_FREE_AFTER_ERROR_MS)
    }

    private fun onPlaybackDone() {
        if (!alive.get()) return
        if (phase == Phase.SPEAKING || phase == Phase.THINKING) {
            // BL-826: onPlaybackDone can fire from THINKING (a stale signal
            // from a player callback queued before a new turn started) —
            // that path never actually played audio, so it must not wait
            // out a quiet tail that has nothing to be quiet after.
            val realPlaybackOccurred = phase == Phase.SPEAKING
            setPhase(Phase.READY)
            scheduleHandsFreeListen(
                AudioTurnRecorder.HANDS_FREE_POST_SPEECH_MS,
                followsPlayback = realPlaybackOccurred
            )
        }
    }

    private fun setPhase(next: Phase) {
        val prev = phase
        phase = next
        if (next == Phase.THINKING && prev != Phase.THINKING) {
            startHoldMusic()
        } else if (next != Phase.THINKING && prev == Phase.THINKING) {
            holdMusic.stop()
            holdMusicTitle = null
        }
        publish()
    }

    private fun startHoldMusic() {
        if (!holdMusicOn || pausedAll) return
        holdMusic.start { name ->
            mainHandler.post {
                holdMusicTitle = name
                publish()
            }
        }
    }

    /**
     * BL-826: the single funnel every hands-free re-arm route passes
     * through — post-speech, error, THINKING, and recovery alike — so no
     * route to the mic can bypass [HandsFreeReArmGate]. [followsPlayback]
     * is true only when real playback just occurred (onPlaybackDone from
     * SPEAKING); every other caller has no tail to wait out and the gate
     * arms as soon as the existing [delayMs] cooldown elapses, preserving
     * today's timing for those paths.
     */
    private fun scheduleHandsFreeListen(delayMs: Long, followsPlayback: Boolean = false) {
        clearAutoListen()
        if (!alive.get() || pausedAll || !handsFree) return
        // The tail clock starts now (the playback-done moment), not after
        // delayMs. When there is no tail to await, the first (and often
        // only) tick still fires at delayMs, preserving today's cooldown
        // timing for those paths. When a tail IS being awaited
        // (followsPlayback), the first sample must land at the same cadence
        // as every later one (BL-826 bounce) — sampling at the wider delayMs
        // instead leaves a blind window in which continuous audio ending
        // shortly before that first sample goes completely unobserved.
        val waitStartedAt = System.currentTimeMillis()
        val poll = HandsFreeListenPoll(waitStartedAt, followsPlayback)
        val r = Runnable { poll.run() }
        autoListenRunnable = r
        mainHandler.postDelayed(r, HandsFreeReArmGate.firstPollDelayMs(delayMs, followsPlayback))
    }

    /** Mutable poll state for one hands-free re-arm wait; see
     *  [scheduleHandsFreeListen]. Lives only for the duration of that wait —
     *  a new call to [scheduleHandsFreeListen] (via [clearAutoListen])
     *  discards it. */
    private inner class HandsFreeListenPoll(
        private val waitStartedAt: Long,
        private val followsPlayback: Boolean
    ) {
        private var lastAudioActivityAt = waitStartedAt

        fun run() {
            // BL-716: ERROR included — a connection failure lands there (not
            // READY), and hands-free must still resume the listen loop once
            // it clears.
            if (!alive.get() || pausedAll || !handsFree) return
            if (phase != Phase.READY && phase != Phase.ERROR) return
            val now = System.currentTimeMillis()
            val playbackActive = followsPlayback && replyPlayer?.isAudioActive() == true
            if (playbackActive) lastAudioActivityAt = now
            val decision = HandsFreeReArmGate.decide(
                HandsFreeReArmGate.Input(
                    nowMs = now,
                    waitStartedAt = waitStartedAt,
                    hasPlaybackToAwait = followsPlayback,
                    playbackActive = playbackActive,
                    lastAudioActivityAt = lastAudioActivityAt
                )
            )
            when (decision) {
                is HandsFreeReArmGate.Decision.Arm -> {
                    // Stuck-playback ceiling: force-stop residual TTS before arming
                    // so a slow OEM voice cannot seed the next turn.
                    if (followsPlayback && replyPlayer?.isAudioActive() == true) {
                        replyPlayer?.stopNow()
                    }
                    startRecording(auto = true)
                }
                is HandsFreeReArmGate.Decision.NotYet -> {
                    val r = Runnable { run() }
                    autoListenRunnable = r
                    mainHandler.postDelayed(r, (decision.recheckAtMs - now).coerceAtLeast(1L))
                }
            }
        }
    }

    private fun clearAutoListen() {
        autoListenRunnable?.let { mainHandler.removeCallbacks(it) }
        autoListenRunnable = null
    }

    private fun publish() {
        val snap = snapshot()
        try {
            listener?.onSnapshot(snap)
        } catch (e: Exception) {
            Log.w(TAG, "listener failed", e)
        }
        OverlayService.onTalkSnapshot(appContext, snap)
    }

    companion object {
        private const val TAG = "SfFloatTalk"
    }
}
