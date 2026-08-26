package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.BargeInDetector.Effect
import com.swarmforge.floatcompanion.BargeInDetector.Frame
import com.swarmforge.floatcompanion.BargeInDetector.State
import com.swarmforge.floatcompanion.BargeInDetector.VoiceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-777 slice A: the barge-in detector's decision logic — onset threshold,
 * self-output rejection, mode gating and listening-session bookkeeping.
 *
 * No `android.*` type appears in [BargeInDetector]'s own signatures, so this
 * runs under the JVM unit suite with no device and no emulator (constitution:
 * Testability Boundary — Bubble). The audio device binding — opening the mic
 * during playback and feeding it real frames — stays on the device-surface
 * side with the ticket's recorded manual procedure; what is tested here is the
 * state-machine correctness a manual procedure is worst at demonstrating.
 *
 * Every clock value is a pinned fixture instant. No test sleeps, and the
 * 300 ms stop-latency budget is measured against those instants, never a real
 * one (engineering rules: no real timers in the unit suite).
 */
class BargeInDetectorTest {

    private val t0 = 1_000_000L
    private val speaking = 0.30
    private val quiet = 0.01
    private val bubbleOnly = BargeInDetector.SELF_OUTPUT_REFERENCE_LEVEL

    private fun frame(atMs: Long, captured: Double, reference: Double = 0.0) =
        Frame(atMs = atMs, capturedLevel = captured, referenceLevel = reference)

    private fun speakingState(mode: VoiceMode = VoiceMode.HANDS_FREE): State =
        BargeInDetector.playbackStarted(State(), mode).state

    // ── playbackStarted: capture opens for detection, hands-free only ──────

    @Test
    fun `hands-free playback opens exactly one listening session to watch for a barge-in`() {
        val step = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE)
        assertTrue(step.state.playbackRunning)
        assertEquals(1, step.state.listeningSessions)
        assertEquals(1, step.effects.filterIsInstance<Effect.OpenListening>().size)
    }

    @Test
    fun `push-to-talk playback opens no listening session at all`() {
        val step = BargeInDetector.playbackStarted(State(), VoiceMode.PUSH_TO_TALK)
        assertTrue(step.state.playbackRunning)
        assertEquals(0, step.state.listeningSessions)
        assertTrue(step.effects.isEmpty())
    }

    @Test
    fun `a second playbackStarted does not open a second session`() {
        val once = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE)
        val twice = BargeInDetector.playbackStarted(once.state, VoiceMode.HANDS_FREE)
        assertEquals(1, twice.state.listeningSessions)
        assertTrue(twice.effects.filterIsInstance<Effect.OpenListening>().isEmpty())
    }

    // ── barge-in-01: speech over playback stops it, within budget ─────────

    @Test
    fun `sustained speech over hands-free playback aborts it and leaves the mic open`() {
        var state = speakingState()
        var abort: Effect.AbortPlayback? = null
        var at = t0
        while (abort == null && at < t0 + 1_000) {
            val step = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.HANDS_FREE)
            state = step.state
            abort = step.effects.filterIsInstance<Effect.AbortPlayback>().firstOrNull()
            at += 20
        }
        assertTrue("speech over playback must abort it", abort != null)
        assertFalse("every barge-in path ends with playback stopped", state.playbackRunning)
        assertEquals("exactly one listening session survives the abort", 1, state.listeningSessions)
    }

    @Test
    fun `the abort lands inside the stop-latency budget measured from speech onset`() {
        var state = speakingState()
        var at = t0
        var abort: Effect.AbortPlayback? = null
        while (abort == null && at < t0 + 1_000) {
            val step = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.HANDS_FREE)
            state = step.state
            abort = step.effects.filterIsInstance<Effect.AbortPlayback>().firstOrNull()
            if (abort == null) at += BargeInDetector.MAX_FRAME_INTERVAL_MS
        }
        val decided = abort!!
        assertEquals(t0, decided.onsetAtMs)
        assertTrue(
            "abort at ${decided.detectedAtMs} must not already be past its own deadline ${decided.deadlineAtMs}",
            decided.detectedAtMs <= decided.deadlineAtMs
        )
        assertEquals(t0 + BargeInDetector.DEFAULT_STOP_LATENCY_BUDGET_MS, decided.deadlineAtMs)
    }

    @Test
    fun `the sustain window plus one frame interval fits inside the budget by construction`() {
        assertTrue(
            "a detector that cannot decide within its own budget can never honour it",
            BargeInDetector.DEFAULT_ONSET_SUSTAIN_MS + BargeInDetector.MAX_FRAME_INTERVAL_MS <=
                BargeInDetector.DEFAULT_STOP_LATENCY_BUDGET_MS
        )
    }

    @Test
    fun `a single loud frame is not yet a barge-in`() {
        val step = BargeInDetector.frame(speakingState(), frame(t0, speaking), VoiceMode.HANDS_FREE)
        assertTrue(step.effects.isEmpty())
        assertTrue(step.state.playbackRunning)
        assertEquals(t0, step.state.onsetStartedAt)
    }

    @Test
    fun `speech that stops before the sustain window elapses restarts the onset clock`() {
        var state = speakingState()
        state = BargeInDetector.frame(state, frame(t0, speaking), VoiceMode.HANDS_FREE).state
        state = BargeInDetector.frame(state, frame(t0 + 20, quiet), VoiceMode.HANDS_FREE).state
        assertNull("a gap must clear the onset, not extend it", state.onsetStartedAt)
        val resumed = BargeInDetector.frame(state, frame(t0 + 40, speaking), VoiceMode.HANDS_FREE)
        assertEquals(t0 + 40, resumed.state.onsetStartedAt)
        assertTrue(resumed.effects.isEmpty())
    }

    // ── barge-in-02: only speech interrupts ───────────────────────────────

    @Test
    fun `ambient noise below the onset threshold never aborts, however long it lasts`() {
        var state = speakingState()
        var at = t0
        repeat(200) {
            val step = BargeInDetector.frame(state, frame(at, quiet), VoiceMode.HANDS_FREE)
            state = step.state
            assertTrue("ambient noise must not abort playback", step.effects.isEmpty())
            at += 20
        }
        assertTrue(state.playbackRunning)
    }

    @Test
    fun `Bubble's own output alone never aborts, however long it lasts`() {
        var state = speakingState()
        var at = t0
        repeat(200) {
            // Captured level IS the reference: the mic hears only the speaker.
            val step = BargeInDetector.frame(state, frame(at, bubbleOnly, bubbleOnly), VoiceMode.HANDS_FREE)
            state = step.state
            assertTrue("a detector that hears itself makes the feature unusable", step.effects.isEmpty())
            at += 20
        }
        assertTrue(state.playbackRunning)
    }

    @Test
    fun `speech has to clear Bubble's own output by the self-output margin, not merely the threshold`() {
        val justOverThreshold = BargeInDetector.DEFAULT_ONSET_THRESHOLD * 1.1
        var state = speakingState()
        var at = t0
        repeat(50) {
            val step = BargeInDetector.frame(
                state,
                frame(at, justOverThreshold, justOverThreshold),
                VoiceMode.HANDS_FREE
            )
            state = step.state
            assertTrue(step.effects.isEmpty())
            at += 20
        }
        assertTrue(state.playbackRunning)
    }

    @Test
    fun `speech well above Bubble's own output does abort, so the margin is not a blanket veto`() {
        var state = speakingState()
        var at = t0
        var aborted = false
        repeat(50) {
            val step = BargeInDetector.frame(
                state,
                frame(at, bubbleOnly * BargeInDetector.DEFAULT_SELF_OUTPUT_MARGIN * 1.5, bubbleOnly),
                VoiceMode.HANDS_FREE
            )
            state = step.state
            if (step.effects.filterIsInstance<Effect.AbortPlayback>().isNotEmpty()) aborted = true
            at += 20
        }
        assertTrue("a human speaking over Bubble must still get through", aborted)
    }

    // ── barge-in-03: push-to-talk stays manual ────────────────────────────

    @Test
    fun `no audio input aborts playback in push-to-talk`() {
        var state = speakingState(VoiceMode.PUSH_TO_TALK)
        var at = t0
        repeat(200) {
            val step = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.PUSH_TO_TALK)
            state = step.state
            assertTrue("push-to-talk must never abort on audio", step.effects.isEmpty())
            at += 20
        }
        assertTrue(state.playbackRunning)
        assertEquals("push-to-talk must not open the mic on its own", 0, state.listeningSessions)
    }

    @Test
    fun `push-to-talk does not even accumulate an onset, so a mode switch cannot fire a stale one`() {
        val step = BargeInDetector.frame(speakingState(VoiceMode.PUSH_TO_TALK), frame(t0, speaking), VoiceMode.PUSH_TO_TALK)
        assertNull(step.state.onsetStartedAt)
    }

    // ── barge-in-04: exactly one listening session ────────────────────────

    @Test
    fun `a second barge-in during the same playback changes nothing`() {
        var state = speakingState()
        var at = t0
        repeat(20) {
            state = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.HANDS_FREE).state
            at += 20
        }
        assertFalse(state.playbackRunning)
        assertEquals(1, state.listeningSessions)

        val again = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.HANDS_FREE)
        assertTrue("no playback is running, so there is nothing to abort", again.effects.isEmpty())
        assertEquals(1, again.state.listeningSessions)
        assertFalse(again.state.playbackRunning)
    }

    // ── the mic is never left open with nothing consuming it ──────────────

    @Test
    fun `playback finishing on its own closes the watch session it opened`() {
        val state = speakingState()
        val step = BargeInDetector.playbackFinished(state, VoiceMode.HANDS_FREE)
        assertFalse(step.state.playbackRunning)
        assertEquals(0, step.state.listeningSessions)
        assertEquals(1, step.effects.filterIsInstance<Effect.CloseListening>().size)
    }

    @Test
    fun `playback finishing after a barge-in leaves the human's session open`() {
        var state = speakingState()
        var at = t0
        repeat(20) {
            state = BargeInDetector.frame(state, frame(at, speaking), VoiceMode.HANDS_FREE).state
            at += 20
        }
        val step = BargeInDetector.playbackFinished(state, VoiceMode.HANDS_FREE)
        assertEquals("the instruction that prompted the barge-in still needs the mic", 1, step.state.listeningSessions)
        assertTrue(step.effects.filterIsInstance<Effect.CloseListening>().isEmpty())
    }

    @Test
    fun `closing the listening session externally is recorded, so the count cannot drift`() {
        var state = speakingState()
        state = BargeInDetector.listeningClosed(state)
        assertEquals(0, state.listeningSessions)
        assertEquals("a second close is idempotent", 0, BargeInDetector.listeningClosed(state).listeningSessions)
    }

    @Test
    fun `push-to-talk playback finishing closes nothing, because it opened nothing`() {
        val state = BargeInDetector.playbackStarted(State(), VoiceMode.PUSH_TO_TALK).state
        val step = BargeInDetector.playbackFinished(state, VoiceMode.PUSH_TO_TALK)
        assertTrue(step.effects.isEmpty())
        assertEquals(0, step.state.listeningSessions)
    }

    @Test
    fun `a frame arriving with no playback running is ignored, in either mode`() {
        for (mode in VoiceMode.values()) {
            val step = BargeInDetector.frame(State(), frame(t0, speaking), mode)
            assertTrue(step.effects.isEmpty())
            assertNull(step.state.onsetStartedAt)
        }
    }
}
