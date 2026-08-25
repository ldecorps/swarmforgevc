package com.swarmforge.floatcompanion

/**
 * BL-777 slice A: pure decision logic for barging in on Bubble's own speech.
 *
 * No `android.*` type appears in this file's own signatures, so it runs under
 * the JVM unit suite with no device or emulator (constitution: Testability
 * Boundary — Bubble). The caller ([TalkEngine]) owns every framework concern —
 * opening the mic, reading frame levels, stopping the player — and reduces
 * each poll to a plain [Frame]. That split is deliberate: the invariants this
 * slice declares are state-machine correctness under repeated and concurrent
 * barge-ins, and a manual device procedure is worst precisely at those.
 *
 * Detection is PURE VAD OVERLAP — energy over a threshold, sustained — with no
 * wake phrase and no keyword. Requiring a prefix to interrupt would reintroduce
 * the turn-taking this feature exists to escape.
 *
 * Three invariants shape the state machine:
 *
 *  1. Playback and capture are never both live except during the detection
 *     overlap, and that overlap always terminates: [frame] is the only path
 *     that can abort, and every abort it emits clears [State.playbackRunning]
 *     in the same step. There is no way to record an abort and leave playback
 *     marked running.
 *
 *  2. At most one listening session exists at any instant. [State.listeningSessions]
 *     is the single counter, every transition either leaves it alone or moves
 *     it between 0 and 1, and both `Open` and `Close` effects are emitted only
 *     when they would actually change it - so a repeated barge-in, a second
 *     `playbackStarted`, or a duplicate close cannot stack sessions or close
 *     one twice.
 *
 *  3. Barge-in detection is hands-free only. [VoiceMode.PUSH_TO_TALK] returns
 *     from [frame] before any level is examined, so no audio input can abort
 *     playback there - and it does not even accumulate an onset, so a mode
 *     switch cannot fire a stale one.
 *
 * The self-output rule is not optional garnish: a detector that hears Bubble
 * makes the feature unusable rather than merely imperfect. Captured audio must
 * clear the reference level by [DEFAULT_SELF_OUTPUT_MARGIN], not merely clear
 * the absolute threshold - on top of the AcousticEchoCanceler
 * [AudioTurnRecorder] already attaches on capable devices.
 */
object BargeInDetector {

    /** How long after speech onset playback must have stopped. */
    const val DEFAULT_STOP_LATENCY_BUDGET_MS = 300L

    /**
     * Normalized RMS a frame must reach to count as speech at all. Matches
     * [AudioTurnRecorder]'s own speech floor: the same microphone, the same
     * normalization, so one number does not quietly mean two things.
     */
    const val DEFAULT_ONSET_THRESHOLD = 0.02

    /** How long that level must hold before it is an interruption and not a cough. */
    const val DEFAULT_ONSET_SUSTAIN_MS = 120L

    /**
     * The longest gap between frames this detector is specified against.
     * [DEFAULT_ONSET_SUSTAIN_MS] + this must fit inside
     * [DEFAULT_STOP_LATENCY_BUDGET_MS], or the detector could not honour its
     * own budget even with a perfect audio pipeline.
     */
    const val MAX_FRAME_INTERVAL_MS = 60L

    /** How far captured audio must exceed Bubble's own output to count as a human. */
    const val DEFAULT_SELF_OUTPUT_MARGIN = 2.5

    /**
     * The reference level the caller reports while Bubble is speaking - output
     * gating, in the ticket's terms. Bubble's true output RMS is not available
     * to the capture path, so playback contributes this fixed floor: while
     * Bubble speaks, a human has to be [DEFAULT_SELF_OUTPUT_MARGIN] times
     * louder than it to get through.
     */
    const val SELF_OUTPUT_REFERENCE_LEVEL = 0.04

    enum class VoiceMode { HANDS_FREE, PUSH_TO_TALK }

    data class Tuning(
        val onsetThreshold: Double = DEFAULT_ONSET_THRESHOLD,
        val onsetSustainMs: Long = DEFAULT_ONSET_SUSTAIN_MS,
        val selfOutputMargin: Double = DEFAULT_SELF_OUTPUT_MARGIN,
        val stopLatencyBudgetMs: Long = DEFAULT_STOP_LATENCY_BUDGET_MS
    )

    data class State(
        val playbackRunning: Boolean = false,
        /** 0 or 1. Never more: invariant 2 is this counter's whole job. */
        val listeningSessions: Int = 0,
        /** When the current uninterrupted run of speech began, or null. */
        val onsetStartedAt: Long? = null
    )

    /** One poll of the capture path, reduced to plain values by the caller. */
    data class Frame(
        val atMs: Long,
        /** Normalized RMS of the captured frame, 0..1. */
        val capturedLevel: Double,
        /** Normalized level Bubble's own output contributes at that instant. */
        val referenceLevel: Double
    )

    sealed class Effect {
        data class AbortPlayback(
            val reason: String,
            val onsetAtMs: Long,
            val detectedAtMs: Long,
            val deadlineAtMs: Long
        ) : Effect()

        data class OpenListening(val reason: String) : Effect()
        data class CloseListening(val reason: String) : Effect()
    }

    data class Step(val state: State, val effects: List<Effect> = emptyList())

    /**
     * Bubble has started speaking. In hands-free the mic opens alongside it -
     * the detection overlap invariant 1 permits - so the instruction that
     * prompts an interruption is already being captured when it is spoken.
     */
    fun playbackStarted(state: State, mode: VoiceMode): Step {
        val speaking = state.copy(playbackRunning = true, onsetStartedAt = null)
        if (mode != VoiceMode.HANDS_FREE || speaking.listeningSessions > 0) {
            return Step(speaking)
        }
        return Step(
            speaking.copy(listeningSessions = 1),
            listOf(Effect.OpenListening("hands-free barge-in watch"))
        )
    }

    /**
     * One capture frame. The ONLY path that can abort playback, and the abort
     * clears [State.playbackRunning] in the same step - there is no ordering
     * in which a barge-in is recorded and playback is left running.
     */
    fun frame(state: State, frame: Frame, mode: VoiceMode, tuning: Tuning = Tuning()): Step {
        // Invariant 3: push-to-talk returns before any level is examined.
        if (mode != VoiceMode.HANDS_FREE) {
            return Step(state.copy(onsetStartedAt = null))
        }
        if (!state.playbackRunning) {
            return Step(state.copy(onsetStartedAt = null))
        }
        val loudEnough = frame.capturedLevel >= tuning.onsetThreshold
        val clearsBubble = frame.capturedLevel >= frame.referenceLevel * tuning.selfOutputMargin
        if (!loudEnough || !clearsBubble) {
            // A gap CLEARS the onset rather than extending it: an interruption
            // is continuous speech, not the sum of unrelated syllables.
            return Step(state.copy(onsetStartedAt = null))
        }
        val onsetAt = state.onsetStartedAt ?: frame.atMs
        if (frame.atMs - onsetAt < tuning.onsetSustainMs) {
            return Step(state.copy(onsetStartedAt = onsetAt))
        }
        val aborted = state.copy(
            playbackRunning = false,
            onsetStartedAt = null,
            listeningSessions = 1
        )
        val effects = mutableListOf<Effect>(
            Effect.AbortPlayback(
                reason = "human speech over playback",
                onsetAtMs = onsetAt,
                detectedAtMs = frame.atMs,
                deadlineAtMs = onsetAt + tuning.stopLatencyBudgetMs
            )
        )
        if (state.listeningSessions == 0) {
            effects += Effect.OpenListening("barge-in with no watch open")
        }
        return Step(aborted, effects)
    }

    /**
     * Playback ended. If it ended on its own, the watch session has nothing
     * left to consume it and is closed - the mic is never left open with
     * nothing consuming it. If it ended because of a barge-in, [frame] already
     * cleared [State.playbackRunning] and the session belongs to the human's
     * instruction, so it stays open.
     */
    fun playbackFinished(state: State, mode: VoiceMode): Step {
        val stopped = state.copy(playbackRunning = false, onsetStartedAt = null)
        val wasBargedIn = !state.playbackRunning
        if (mode != VoiceMode.HANDS_FREE || wasBargedIn || stopped.listeningSessions == 0) {
            return Step(stopped)
        }
        return Step(
            stopped.copy(listeningSessions = 0),
            listOf(Effect.CloseListening("playback finished with no barge-in"))
        )
    }

    /** The caller closed the mic (turn submitted, hands-free off, shutdown). */
    fun listeningClosed(state: State): State = state.copy(listeningSessions = 0, onsetStartedAt = null)
}
