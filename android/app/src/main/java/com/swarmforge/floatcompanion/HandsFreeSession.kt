package com.swarmforge.floatcompanion

/**
 * BL-844: the hands-free session state machine —
 * PassiveWake -> ActiveListen -> Thinking -> Speaking, and back.
 *
 * A pure function of (session, event, mode): no `android.*` type appears in
 * this file's own signatures, so it runs under the JVM unit suite with no
 * device or emulator (constitution: Testability Boundary — Bubble). The
 * silence window is read from a clock value the CALLER puts on the event —
 * never a sleep, never a wall-clock poll — so the whole policy is testable
 * without waiting ten seconds for anything.
 *
 * Three invariants shape it:
 *
 *  1. Nothing reaches the model unwoken. [State.PassiveWake] returns from
 *     [on] before an utterance is even classified, so there is no branch —
 *     not a hard end phrase, not a soft closer, not a question — that can
 *     submit a turn while the session is passive.
 *
 *  2. A session always has a way out. From every non-passive state a hard end
 *     phrase returns it to passive at once, and whenever the silence window is
 *     armed enough elapsed time does the same. No input sequence leaves the
 *     mic open indefinitely.
 *
 *  3. Push-to-talk is untouched. With hands-free off, [Event.Tick] is a no-op
 *     whatever has elapsed, and an answer arms no window in the first place.
 *     An explicit gesture still opens a session, exactly as it does today.
 *
 * The soft closer is the subtle one. "Thank you" is acknowledged as a
 * non-task and does NOT restart the window: silence wins, and the session
 * closes on the window the answer armed. A closer that restarted the window
 * would make every polite goodbye hold the mic open for another ten seconds.
 *
 * The window is 10 seconds, from the human's own research quoted in the
 * intake (Alexa ~8s, Google ~8-10s, Gemini Live ~15s — not 20-60s). A
 * constant on purpose; making it configurable is a later slice.
 */
object HandsFreeSession {

    const val DEFAULT_SILENCE_WINDOW_MS = 10_000L

    enum class State { PassiveWake, ActiveListen, Thinking, Speaking }

    data class Session(
        val state: State = State.PassiveWake,
        /** When the post-answer silence window started, or null if none runs. */
        val silenceWindowStartedAt: Long? = null
    )

    sealed class Event {
        /** The wake spotter fired (BL-845 owns producing this). */
        data class WakeSignal(val atMs: Long) : Event()

        /** The human opened a session by hand — the record button, the UI. */
        data class PushToTalkTap(val atMs: Long) : Event()

        /** One transcribed utterance. */
        data class Utterance(val text: String, val atMs: Long) : Event()

        /** A reply started playing. */
        data class PlaybackStarted(val atMs: Long) : Event()

        /** A reply finished playing — this is what arms the silence window. */
        data class PlaybackFinished(val atMs: Long) : Event()

        /** The human spoke over the reply (BL-777 owns detecting this). */
        data class BargeIn(val atMs: Long) : Event()

        /** The turn never produced an answer. */
        data class TurnFailed(val atMs: Long) : Event()

        /** A clock reading. The ONLY way elapsed time enters this machine. */
        data class Tick(val atMs: Long) : Event()
    }

    sealed class Effect {
        data class SubmitTurn(val text: String) : Effect()
        /** A non-task the human said out of politeness. */
        data class AcknowledgeCloser(val text: String) : Effect()
    }

    data class Step(val session: Session, val effects: List<Effect> = emptyList())

    /**
     * Ends the session at once, without waiting a window out. Also the shape
     * invariant 2 leans on: every non-passive state reaches it.
     */
    private fun passive(): Session = Session(state = State.PassiveWake, silenceWindowStartedAt = null)

    private fun normalize(text: String): String =
        text.lowercase().filter { it.isLetterOrDigit() || it.isWhitespace() }.trim().replace(Regex("\\s+"), " ")

    private val HARD_END_PHRASES = setOf("stop", "im done", "i am done", "goodbye", "good bye", "bye")
    private val SOFT_CLOSERS = setOf("thank you", "thanks", "thankyou")

    /** Whole-utterance match only: "stop the deployment" is a task, not an exit. */
    fun isHardEndPhrase(text: String): Boolean = normalize(text) in HARD_END_PHRASES

    /** Whole-utterance match only, for the same reason. */
    fun isSoftCloser(text: String): Boolean = normalize(text) in SOFT_CLOSERS

    fun on(
        session: Session,
        event: Event,
        handsFree: Boolean,
        silenceWindowMs: Long = DEFAULT_SILENCE_WINDOW_MS
    ): Step = when (event) {
        is Event.WakeSignal ->
            if (handsFree) Step(Session(state = State.ActiveListen)) else Step(session)

        // An explicit gesture opens a session in either mode - that is what
        // "explicit" means, and it is how push-to-talk works today.
        is Event.PushToTalkTap -> Step(Session(state = State.ActiveListen))

        is Event.Utterance -> onUtterance(session, event)

        is Event.PlaybackStarted ->
            if (session.state == State.Thinking) {
                Step(session.copy(state = State.Speaking, silenceWindowStartedAt = null))
            } else {
                Step(session)
            }

        is Event.PlaybackFinished -> onPlaybackFinished(session, event, handsFree)

        is Event.BargeIn ->
            if (session.state == State.Speaking) {
                // The human is talking: nothing is waiting out silence.
                Step(Session(state = State.ActiveListen))
            } else {
                Step(session)
            }

        is Event.TurnFailed ->
            if (session.state == State.PassiveWake) {
                Step(session)
            } else {
                Step(armedListen(event.atMs, handsFree))
            }

        // Invariant 3: with hands-free off, elapsed time changes nothing.
        is Event.Tick -> onTick(session, event, handsFree, silenceWindowMs)
    }

    private fun armedListen(atMs: Long, handsFree: Boolean): Session =
        Session(
            state = State.ActiveListen,
            silenceWindowStartedAt = if (handsFree) atMs else null
        )

    private fun onUtterance(session: Session, event: Event.Utterance): Step {
        // Invariant 1: returns BEFORE classification. There is no branch here
        // that can submit a turn from a passive session.
        if (session.state == State.PassiveWake) {
            return Step(session)
        }
        if (isHardEndPhrase(event.text)) {
            return Step(passive())
        }
        if (isSoftCloser(event.text)) {
            // Deliberately keeps the EXISTING window: silence wins. Restarting
            // it here would let every polite goodbye hold the mic for another
            // full window.
            return Step(session, listOf(Effect.AcknowledgeCloser(event.text)))
        }
        return Step(
            session.copy(state = State.Thinking, silenceWindowStartedAt = null),
            listOf(Effect.SubmitTurn(event.text))
        )
    }

    private fun onPlaybackFinished(session: Session, event: Event.PlaybackFinished, handsFree: Boolean): Step {
        if (session.state != State.Speaking) {
            // Notably from PassiveWake: a reply finishing must not open a
            // session the human never woke.
            return Step(session)
        }
        return Step(armedListen(event.atMs, handsFree))
    }

    private fun onTick(session: Session, event: Event.Tick, handsFree: Boolean, silenceWindowMs: Long): Step {
        if (!handsFree) {
            return Step(session)
        }
        val startedAt = session.silenceWindowStartedAt ?: return Step(session)
        if (event.atMs - startedAt < silenceWindowMs) {
            return Step(session)
        }
        return Step(passive())
    }
}
