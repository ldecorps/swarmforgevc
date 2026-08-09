package com.swarmforge.floatcompanion

/**
 * BL-717: pure decision logic behind "no terminal branch of a hold-music
 * turn is silent" (constitution invariant, coder-authored per BL-654). No
 * android.* type appears in this file's own signatures, so it runs under
 * the JVM unit suite with no device or emulator (Testability Boundary —
 * Bubble). [ReplyAudioPlayer] owns all android.* state (MediaPlayer, TTS,
 * Handler) and reduces it to plain values before calling in.
 */
object ReplyPlaybackDecision {

    /** What [ReplyAudioPlayer.play] must do first for a fresh turn result. */
    sealed class InitialAction {
        /** The human explicitly muted playback — the one deliberate silent branch. */
        object Muted : InitialAction()
        data class PlayAudio(val base64: String) : InitialAction()
        data class Speak(val text: String) : InitialAction()

        /** No audio and no speakable text came with the turn — speak the
         *  fallback line rather than silently finishing. */
        data class SpeakFallback(val text: String) : InitialAction()
    }

    data class InitialInput(
        val muted: Boolean,
        val audioBase64: String?,
        val replySpeechText: String?,
        val replyText: String?,
        val fallbackText: String
    )

    fun decideInitial(input: InitialInput): InitialAction {
        with(input) {
            if (muted) return InitialAction.Muted
            if (!audioBase64.isNullOrBlank()) return InitialAction.PlayAudio(audioBase64)
            val speech = replySpeechText?.takeIf { it.isNotBlank() }
                ?: replyText?.takeIf { it.isNotBlank() }
            return if (speech != null) InitialAction.Speak(speech) else InitialAction.SpeakFallback(fallbackText)
        }
    }

    /** What to do when a terminal event (playback error, synthesis error, or
     *  watchdog expiry) ends a speech attempt without ever reaching a normal
     *  completion callback. */
    sealed class RecoveryAction {
        object Complete : RecoveryAction()
        data class SpeakFailureLine(val text: String) : RecoveryAction()
    }

    /**
     * [wasRecoveryAttempt] is true when the attempt that just failed/expired
     * was ITSELF already a fallback/failure-line attempt — never chain a
     * second recovery. This bounds every terminal branch to at most one
     * extra speech attempt beyond the original, so the silent window stays
     * bounded (invariant 3) instead of open-ended retries.
     */
    fun decideAfterFailure(wasRecoveryAttempt: Boolean, failureLine: String): RecoveryAction =
        if (wasRecoveryAttempt) RecoveryAction.Complete else RecoveryAction.SpeakFailureLine(failureLine)
}
