package com.swarmforge.floatcompanion

/**
 * BL-826: pure decision logic for whether hands-free may re-arm the
 * microphone. No android.* type appears in this file's own signatures, so
 * it runs under the JVM unit suite with no device or emulator
 * (constitution: Testability Boundary — Bubble).
 *
 * Playback is not finished when the player says so; it is finished when
 * the player says so AND a measured quiet tail has followed with no
 * further audio. [decide] is that gate. The caller (TalkEngine) owns all
 * android.* state (Handler, MediaPlayer/TTS) and reduces it to plain
 * values on every poll tick.
 */
object HandsFreeReArmGate {

    const val DEFAULT_QUIET_TAIL_MS = 400L

    /**
     * Upper bound on how long the gate keeps refusing to arm once a wait has
     * started. Past this, it arms anyway rather than risk hands-free
     * latching silently off — see BL-826 "the one regression this fix must
     * not cause".
     */
    const val DEFAULT_CEILING_MS = 4_000L

    /** Recheck cadence while playback is still reported active. */
    const val DEFAULT_POLL_INTERVAL_MS = 150L

    /** Audio captured this soon after the mic arms is discarded — guards a
     *  late OS buffer flush from seeding a human turn as the mic opens. */
    const val POST_ARM_SETTLE_MS = 150L

    sealed class Decision {
        data class Arm(val reason: String) : Decision()
        data class NotYet(val reason: String, val recheckAtMs: Long) : Decision()
    }

    data class Input(
        val nowMs: Long,
        val waitStartedAt: Long,
        /** False for every re-arm path where no playback occurred this cycle
         *  (hands-free just toggled on, a failed turn, a stale THINKING-phase
         *  callback) — the tail is moot and the gate arms immediately. */
        val hasPlaybackToAwait: Boolean,
        val playbackActive: Boolean,
        val lastAudioActivityAt: Long,
        val quietTailMs: Long = DEFAULT_QUIET_TAIL_MS,
        val ceilingMs: Long = DEFAULT_CEILING_MS,
        val pollIntervalMs: Long = DEFAULT_POLL_INTERVAL_MS
    )

    fun decide(input: Input): Decision {
        with(input) {
            if (!hasPlaybackToAwait) {
                return Decision.Arm("no playback to await")
            }
            val ceilingAt = waitStartedAt + ceilingMs
            if (nowMs >= ceilingAt) {
                return Decision.Arm("quiet-tail ceiling (${ceilingMs}ms) reached — arming defensively")
            }
            if (playbackActive) {
                return Decision.NotYet(
                    "playback still reported active",
                    recheckAtMs = (nowMs + pollIntervalMs).coerceAtMost(ceilingAt)
                )
            }
            val quietFor = nowMs - lastAudioActivityAt
            if (quietFor < quietTailMs) {
                return Decision.NotYet(
                    "quiet tail not yet elapsed (${quietFor}ms of ${quietTailMs}ms)",
                    recheckAtMs = (lastAudioActivityAt + quietTailMs).coerceAtMost(ceilingAt)
                )
            }
            return Decision.Arm("quiet tail elapsed uninterrupted")
        }
    }

    fun isWithinSettleWindow(armedAtMs: Long, nowMs: Long, settleMs: Long = POST_ARM_SETTLE_MS): Boolean =
        nowMs - armedAtMs < settleMs

    /**
     * BL-826 bounce (2026-08-07): delay before [TalkEngine.scheduleHandsFreeListen]'s
     * FIRST poll tick. When a quiet tail is being awaited ([followsPlayback]),
     * this must equal [pollIntervalMs] — the same cadence every later tick
     * uses — not the caller's [cooldownMs]. [lastAudioActivityAt] only ever
     * advances on a tick that observes playback active; sampling the first
     * tick at the wider [cooldownMs] instead leaves a blind window of that
     * width in which continuous audio ending shortly before the sample is
     * never observed, so [decide] can later credit a full [quietTailMs] of
     * silence that never actually elapsed. Using [pollIntervalMs] shrinks
     * that unavoidable (any discrete sampler has one) blind window from
     * [cooldownMs] down to the size of a single poll step. When there is no
     * tail to await, the caller's own cooldown governs, unchanged.
     */
    fun firstPollDelayMs(
        cooldownMs: Long,
        followsPlayback: Boolean,
        pollIntervalMs: Long = DEFAULT_POLL_INTERVAL_MS
    ): Long = if (followsPlayback) pollIntervalMs else cooldownMs
}
