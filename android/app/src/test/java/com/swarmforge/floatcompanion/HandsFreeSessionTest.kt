package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.HandsFreeSession.Effect
import com.swarmforge.floatcompanion.HandsFreeSession.Event
import com.swarmforge.floatcompanion.HandsFreeSession.Session
import com.swarmforge.floatcompanion.HandsFreeSession.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-844: the hands-free session state machine —
 * PassiveWake -> ActiveListen -> Thinking -> Speaking and back.
 *
 * A pure function of (session, event): no `android.*` type in its own
 * signature, so it runs under the JVM unit suite with no device or emulator
 * (constitution: Testability Boundary — Bubble). The silence window is read
 * from an injected clock value carried on the event, never a sleep and never a
 * wall-clock poll — no test here waits for anything.
 */
class HandsFreeSessionTest {

    private val t0 = 5_000_000L
    private val window = HandsFreeSession.DEFAULT_SILENCE_WINDOW_MS

    private fun passive() = Session()

    private fun afterAnswer(atMs: Long = t0): Session =
        HandsFreeSession.on(
            Session(state = State.Speaking),
            Event.PlaybackFinished(atMs),
            handsFree = true
        ).session

    // ── the window default is the researched one ──────────────────────────

    @Test
    fun `the silence window is ten seconds, the number the intake settled on`() {
        assertEquals(10_000L, HandsFreeSession.DEFAULT_SILENCE_WINDOW_MS)
    }

    // ── 01: nothing reaches the model unwoken ─────────────────────────────

    @Test
    fun `speech while passive submits no turn and does not open a session`() {
        val step = HandsFreeSession.on(passive(), Event.Utterance("what is the pipeline doing", t0), handsFree = true)
        assertTrue(step.effects.isEmpty())
        assertEquals(State.PassiveWake, step.session.state)
    }

    @Test
    fun `not even a hard end phrase submits a turn while passive`() {
        for (utterance in listOf("stop", "goodbye", "thank you", "deploy to production")) {
            val step = HandsFreeSession.on(passive(), Event.Utterance(utterance, t0), handsFree = true)
            assertTrue("\"$utterance\" must reach no model while passive", step.effects.isEmpty())
            assertEquals(State.PassiveWake, step.session.state)
        }
    }

    // ── 02: only a wake signal or an explicit gesture opens a session ─────

    @Test
    fun `a wake signal opens a session`() {
        assertEquals(State.ActiveListen, HandsFreeSession.on(passive(), Event.WakeSignal(t0), handsFree = true).session.state)
    }

    @Test
    fun `a push-to-talk tap opens a session, in either mode`() {
        assertEquals(State.ActiveListen, HandsFreeSession.on(passive(), Event.PushToTalkTap(t0), handsFree = true).session.state)
        assertEquals(State.ActiveListen, HandsFreeSession.on(passive(), Event.PushToTalkTap(t0), handsFree = false).session.state)
    }

    @Test
    fun `playback finishing while passive opens nothing`() {
        val step = HandsFreeSession.on(passive(), Event.PlaybackFinished(t0), handsFree = true)
        assertEquals(State.PassiveWake, step.session.state)
        assertNull("no window may be armed while passive", step.session.silenceWindowStartedAt)
    }

    // ── 03: a follow-up inside an open session needs no wake signal ───────

    @Test
    fun `speech in an open session submits a turn and moves to Thinking`() {
        val open = Session(state = State.ActiveListen)
        val step = HandsFreeSession.on(open, Event.Utterance("and what about the backlog", t0), handsFree = true)
        assertEquals(listOf<Effect>(Effect.SubmitTurn("and what about the backlog")), step.effects)
        assertEquals(State.Thinking, step.session.state)
        assertNull("thinking is not waiting out a silence window", step.session.silenceWindowStartedAt)
    }

    // ── 04: silence ends the session, speech extends it ──────────────────

    @Test
    fun `an answer arms the silence window and returns to listening`() {
        val session = afterAnswer()
        assertEquals(State.ActiveListen, session.state)
        assertEquals(t0, session.silenceWindowStartedAt)
    }

    @Test
    fun `silence through the window returns the session to passive`() {
        var session = afterAnswer()
        session = HandsFreeSession.on(session, Event.Tick(t0 + 6_000), handsFree = true).session
        assertEquals("six seconds is inside the window", State.ActiveListen, session.state)
        session = HandsFreeSession.on(session, Event.Tick(t0 + 12_000), handsFree = true).session
        assertEquals(State.PassiveWake, session.state)
        assertNull(session.silenceWindowStartedAt)
    }

    @Test
    fun `the window closes exactly at its boundary, not one tick late`() {
        val session = afterAnswer()
        assertEquals(
            State.ActiveListen,
            HandsFreeSession.on(session, Event.Tick(t0 + window - 1), handsFree = true).session.state
        )
        assertEquals(
            State.PassiveWake,
            HandsFreeSession.on(session, Event.Tick(t0 + window), handsFree = true).session.state
        )
    }

    @Test
    fun `a question inside the window is a normal turn and the window stops running`() {
        var session = afterAnswer()
        session = HandsFreeSession.on(session, Event.Utterance("what about the backlog", t0 + 6_000), handsFree = true).session
        assertEquals(State.Thinking, session.state)
        session = HandsFreeSession.on(session, Event.Tick(t0 + 12_000), handsFree = true).session
        assertEquals("a turn in flight is not silence", State.Thinking, session.state)
    }

    // ── 05: a soft closer does not hold the session open ─────────────────

    @Test
    fun `a soft closer submits no turn and does not restart the window`() {
        for (utterance in listOf("thank you", "thanks", "Thanks!", "  THANK YOU  ")) {
            var session = afterAnswer()
            val step = HandsFreeSession.on(session, Event.Utterance(utterance, t0 + 6_000), handsFree = true)
            assertEquals("\"$utterance\" is a non-task", listOf<Effect>(Effect.AcknowledgeCloser(utterance)), step.effects)
            assertEquals(State.ActiveListen, step.session.state)
            assertEquals(
                "silence wins: a closer must not restart the window",
                t0,
                step.session.silenceWindowStartedAt
            )
            session = HandsFreeSession.on(step.session, Event.Tick(t0 + window), handsFree = true).session
            assertEquals(State.PassiveWake, session.state)
        }
    }

    // ── 06: a hard end phrase goes quiet at once ─────────────────────────

    @Test
    fun `a hard end phrase drops to passive without waiting the window out`() {
        for (utterance in listOf("stop", "I'm done", "goodbye", "Stop.", "im done", "Goodbye!")) {
            val step = HandsFreeSession.on(afterAnswer(), Event.Utterance(utterance, t0 + 1_000), handsFree = true)
            assertEquals("\"$utterance\" must end the session", State.PassiveWake, step.session.state)
            assertNull("\"$utterance\" must not leave a window running", step.session.silenceWindowStartedAt)
            assertTrue("\"$utterance\" is not a task", step.effects.isEmpty())
        }
    }

    @Test
    fun `a hard end phrase ends the session from every non-passive state`() {
        for (state in listOf(State.ActiveListen, State.Thinking, State.Speaking)) {
            val step = HandsFreeSession.on(Session(state = state), Event.Utterance("stop", t0), handsFree = true)
            assertEquals("a session in $state must have a way out", State.PassiveWake, step.session.state)
        }
    }

    @Test
    fun `a phrase that merely contains an end word is still an ordinary turn`() {
        val step = HandsFreeSession.on(
            Session(state = State.ActiveListen),
            Event.Utterance("stop the deployment before it reaches production", t0),
            handsFree = true
        )
        assertEquals(State.Thinking, step.session.state)
        assertEquals(listOf<Effect>(Effect.SubmitTurn("stop the deployment before it reaches production")), step.effects)
    }

    // ── 07: a barge-in reopens the mic ──────────────────────────────────

    @Test
    fun `a barge-in while speaking returns to listening rather than ending the session`() {
        val step = HandsFreeSession.on(Session(state = State.Speaking), Event.BargeIn(t0), handsFree = true)
        assertEquals(State.ActiveListen, step.session.state)
        assertNull("the human is speaking; nothing is waiting out silence", step.session.silenceWindowStartedAt)
    }

    @Test
    fun `a barge-in signal while passive opens nothing`() {
        assertEquals(State.PassiveWake, HandsFreeSession.on(passive(), Event.BargeIn(t0), handsFree = true).session.state)
    }

    // ── 08: push-to-talk is untouched by the policy ─────────────────────

    @Test
    fun `with hands-free off no elapsed silence changes the session state`() {
        val armed = Session(state = State.ActiveListen, silenceWindowStartedAt = t0)
        val step = HandsFreeSession.on(armed, Event.Tick(t0 + 10 * window), handsFree = false)
        assertEquals(State.ActiveListen, step.session.state)
        assertEquals(t0, step.session.silenceWindowStartedAt)
    }

    @Test
    fun `with hands-free off an answer arms no window at all`() {
        val step = HandsFreeSession.on(Session(state = State.Speaking), Event.PlaybackFinished(t0), handsFree = false)
        assertNull(step.session.silenceWindowStartedAt)
    }

    // ── the rest of the cycle ───────────────────────────────────────────

    @Test
    fun `an answer arriving moves Thinking to Speaking`() {
        val step = HandsFreeSession.on(Session(state = State.Thinking), Event.PlaybackStarted(t0), handsFree = true)
        assertEquals(State.Speaking, step.session.state)
    }

    @Test
    fun `a turn that fails returns to listening with the window running, not to a dead session`() {
        val step = HandsFreeSession.on(Session(state = State.Thinking), Event.TurnFailed(t0), handsFree = true)
        assertEquals(State.ActiveListen, step.session.state)
        assertEquals(t0, step.session.silenceWindowStartedAt)
    }

    @Test
    fun `classification is the same whatever the surrounding punctuation and case`() {
        assertTrue(HandsFreeSession.isHardEndPhrase("  GOODBYE!!  "))
        assertTrue(HandsFreeSession.isSoftCloser("Thanks."))
        assertTrue(!HandsFreeSession.isSoftCloser("thanks for nothing, what is the backlog"))
        assertTrue(!HandsFreeSession.isHardEndPhrase(""))
    }
}
