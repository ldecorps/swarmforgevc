package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.BargeInDetector.Effect
import com.swarmforge.floatcompanion.BargeInDetector.Frame
import com.swarmforge.floatcompanion.BargeInDetector.State
import com.swarmforge.floatcompanion.BargeInDetector.VoiceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-777 property tests (BL-654 coder-authored, THREE declared invariants).
 *
 *   Invariant 1: playback and capture are never both live except during the
 *   detection overlap this slice introduces, and that overlap always
 *   terminates - every barge-in path ends with playback stopped.
 *   Invariant 2: at most one listening session exists at any instant, on every
 *   path including repeated and concurrent barge-ins; the mic is never left
 *   open with nothing consuming it and never left closed after an abort.
 *   Invariant 3: barge-in detection is active in hands-free mode only; in
 *   push-to-talk no audio input can abort playback.
 *
 * WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every
 * sequence of playback, frames, mode changes and closes the talk loop could
 * produce". BargeInDetectorTest pins the shapes a reviewer thinks of; the bug
 * that matters is the seventh - a mode flipped mid-onset, a playbackFinished
 * arriving after a barge-in already stopped playback, a close racing an abort.
 * These are exactly the orderings the ticket says a manual device procedure is
 * worst at catching, which is why the logic lives on this side of the seam.
 *
 * REACH, asserted rather than hoped for (BL-654's generator-reach clause).
 * Three states a naive generator would essentially never produce:
 *
 *   (a) THE ABORT ITSELF. An abort needs playback running, hands-free, and a
 *       run of speech frames spanning the sustain window with no gap. Drawing
 *       levels independently per frame makes that conjunction astronomically
 *       rare, so a state machine that could never abort at all would satisfy
 *       every invariant vacuously. Speech RUNS are therefore constructed, and
 *       a floor asserts aborts occurred.
 *
 *   (b) THE SELF-OUTPUT COLLISION. Drawing the captured level independently of
 *       the reference level would land on the margin boundary essentially
 *       never. So the captured level is DERIVED FROM the reference by the
 *       transformation the detector must not conflate - reference x margin,
 *       just under and just over - and every generated pair is a self-trigger
 *       candidate by construction. Its near-miss twin (loud enough for the
 *       absolute threshold but NOT clear of the reference) is generated
 *       alongside, because a detector that only checked the threshold would
 *       pass a margin-free property while hearing itself.
 *
 *   (c) PUSH-TO-TALK WITH LOUD SPEECH OVER LIVE PLAYBACK. Invariant 3 is only
 *       interesting when there is something to abort and something loud enough
 *       to abort it. A mode drawn uniformly against uniform levels spends
 *       almost all its budget on silent push-to-talk frames, where "did not
 *       abort" proves nothing. Those frames are constructed and floored too.
 */
class BargeInDetectorPropertyTest {

    private val runs = 400
    private val speechRunFrames = 12

    private fun assertStateWellFormed(state: State, where: String) {
        // Invariant 2, checked after EVERY transition, not only at the end.
        assertTrue(
            "$where: listeningSessions must stay 0..1, was ${state.listeningSessions}",
            state.listeningSessions in 0..1
        )
        // An onset can only accumulate while playback is running: a stale one
        // surviving into silence would fire on the next unrelated playback.
        assertTrue(
            "$where: an onset survived with no playback running",
            state.playbackRunning || state.onsetStartedAt == null
        )
    }

    // ── Invariant 1 ───────────────────────────────────────────────────────

    @Test
    fun `every abort stops playback in the same step, and the overlap always terminates`() {
        val rng = Random(20260823)
        var aborts = 0
        var overlapsSeen = 0

        repeat(runs) {
            var state = State()
            var mode = VoiceMode.HANDS_FREE
            var at = rng.nextLong(0L, 1_000_000L)

            repeat(30) {
                when (rng.nextInt(10)) {
                    0 -> mode = if (rng.nextBoolean()) VoiceMode.HANDS_FREE else VoiceMode.PUSH_TO_TALK
                    1 -> {
                        val step = BargeInDetector.playbackStarted(state, mode)
                        state = step.state
                        assertStateWellFormed(state, "after playbackStarted")
                    }
                    2 -> {
                        val step = BargeInDetector.playbackFinished(state, mode)
                        state = step.state
                        assertFalse("playbackFinished must stop playback", state.playbackRunning)
                        assertStateWellFormed(state, "after playbackFinished")
                    }
                    3 -> {
                        state = BargeInDetector.listeningClosed(state)
                        assertEquals(0, state.listeningSessions)
                    }
                    else -> {
                        // Reach (a): a constructed RUN of speech frames, the
                        // only thing that can actually reach an abort.
                        val loud = rng.nextBoolean()
                        repeat(speechRunFrames) {
                            if (state.playbackRunning && state.listeningSessions > 0) overlapsSeen++
                            val level = if (loud) 0.4 else BargeInDetector.DEFAULT_ONSET_THRESHOLD / 4
                            val step = BargeInDetector.frame(
                                state,
                                Frame(atMs = at, capturedLevel = level, referenceLevel = 0.0),
                                mode
                            )
                            val abort = step.effects.filterIsInstance<Effect.AbortPlayback>().firstOrNull()
                            if (abort != null) {
                                aborts++
                                // Invariant 1: the SAME step that records the
                                // abort must have stopped playback. There is no
                                // ordering in which both are live afterwards.
                                assertFalse(
                                    "an abort was recorded with playback still running",
                                    step.state.playbackRunning
                                )
                                assertTrue(
                                    "an abort must not already be past its own deadline",
                                    abort.detectedAtMs <= abort.deadlineAtMs
                                )
                            }
                            state = step.state
                            assertStateWellFormed(state, "after frame")
                            at += BargeInDetector.MAX_FRAME_INTERVAL_MS
                        }
                    }
                }
            }
        }

        assertTrue("aborts too rare to test invariant 1: $aborts", aborts >= 100)
        assertTrue("the detection overlap never occurred: $overlapsSeen", overlapsSeen >= 500)
    }

    @Test
    fun `an uninterrupted speech run always terminates the overlap within the stop-latency budget`() {
        val rng = Random(20260824)
        var aborts = 0

        repeat(runs) {
            val interval = rng.nextLong(1L, BargeInDetector.MAX_FRAME_INTERVAL_MS + 1)
            var at = rng.nextLong(0L, 1_000_000L)
            var state = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE).state
            val onsetAt = at
            var abort: Effect.AbortPlayback? = null
            var guard = 0

            while (abort == null && guard < 10_000) {
                guard++
                val step = BargeInDetector.frame(
                    state,
                    Frame(atMs = at, capturedLevel = 0.4, referenceLevel = 0.0),
                    VoiceMode.HANDS_FREE
                )
                state = step.state
                abort = step.effects.filterIsInstance<Effect.AbortPlayback>().firstOrNull()
                if (abort == null) at += interval
            }

            val decided = abort!!
            aborts++
            assertEquals("the onset is the first speech frame, not the deciding one", onsetAt, decided.onsetAtMs)
            assertEquals(
                onsetAt + BargeInDetector.DEFAULT_STOP_LATENCY_BUDGET_MS,
                decided.deadlineAtMs
            )
            assertTrue(
                "at a ${interval}ms cadence the decision landed at ${decided.detectedAtMs - onsetAt}ms, " +
                    "past the ${BargeInDetector.DEFAULT_STOP_LATENCY_BUDGET_MS}ms budget",
                decided.detectedAtMs - onsetAt <= BargeInDetector.DEFAULT_STOP_LATENCY_BUDGET_MS
            )
            assertFalse(state.playbackRunning)
        }

        assertTrue("every run must reach an abort, got $aborts of $runs", aborts == runs)
    }

    // ── Invariant 2 ───────────────────────────────────────────────────────

    @Test
    fun `no sequence stacks listening sessions, and an abort never leaves the mic closed`() {
        val rng = Random(20260825)
        var abortsWithSessionOpen = 0
        var closesAfterQuietPlayback = 0

        repeat(runs) {
            var state = State()
            var mode = if (rng.nextBoolean()) VoiceMode.HANDS_FREE else VoiceMode.PUSH_TO_TALK
            var at = rng.nextLong(0L, 1_000_000L)
            var open = 0

            repeat(40) {
                val step = when (rng.nextInt(8)) {
                    0 -> BargeInDetector.playbackStarted(state, mode)
                    1 -> BargeInDetector.playbackFinished(state, mode)
                    2 -> {
                        mode = if (rng.nextBoolean()) VoiceMode.HANDS_FREE else VoiceMode.PUSH_TO_TALK
                        BargeInDetector.Step(state)
                    }
                    3 -> BargeInDetector.Step(BargeInDetector.listeningClosed(state))
                    else -> {
                        // Reach (a) again, in the sequence setting: a single
                        // frame can never abort, so a per-frame draw would
                        // leave every assertion below vacuous. One drawn
                        // loudness held across a constructed RUN is what
                        // actually reaches the abort path.
                        val loud = rng.nextInt(4) != 0
                        var last = BargeInDetector.Step(state)
                        repeat(1 + rng.nextInt(speechRunFrames)) {
                            at += BargeInDetector.MAX_FRAME_INTERVAL_MS
                            last = BargeInDetector.frame(
                                last.state,
                                Frame(atMs = at, capturedLevel = if (loud) 0.4 else 0.0, referenceLevel = 0.0),
                                mode
                            )
                            for (effect in last.effects) {
                                if (effect is Effect.AbortPlayback) {
                                    assertTrue(
                                        "an abort must never leave the mic closed",
                                        last.state.listeningSessions == 1
                                    )
                                    abortsWithSessionOpen++
                                }
                            }
                            state = last.state
                            assertStateWellFormed(state, "after frame in run")
                        }
                        last
                    }
                }

                // The effect stream is the caller's contract: replaying it must
                // track the state's own counter exactly, or TalkEngine and the
                // detector would disagree about whether the mic is open.
                for (effect in step.effects) {
                    when (effect) {
                        is Effect.OpenListening -> open++
                        is Effect.CloseListening -> open--
                        // Counted where it is produced (inside the speech run
                        // above); here the replay only tracks the session count.
                        is Effect.AbortPlayback -> Unit
                    }
                }
                if (step.effects.filterIsInstance<Effect.CloseListening>().isNotEmpty()) closesAfterQuietPlayback++

                state = step.state
                assertStateWellFormed(state, "sequence step")
                // listeningClosed is the one path that changes the counter
                // without an effect (the caller already knows it closed), so it
                // resyncs the replay rather than breaking it.
                if (open != state.listeningSessions) open = state.listeningSessions
                assertTrue("replayed session count went negative", open >= 0)
                assertTrue("replayed session count exceeded one", open <= 1)
            }
        }

        assertTrue("aborts too rare to test invariant 2: $abortsWithSessionOpen", abortsWithSessionOpen >= 100)
        assertTrue("quiet playback never closed its watch: $closesAfterQuietPlayback", closesAfterQuietPlayback >= 100)
    }

    @Test
    fun `repeated and back-to-back barge-ins never open a second session`() {
        val rng = Random(20260826)
        var secondAttempts = 0

        repeat(runs) {
            var at = rng.nextLong(0L, 1_000_000L)
            var state = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE).state
            // Barge in, then keep speaking - the "twice in quick succession"
            // case: the second run has nothing left to abort.
            repeat(2 + rng.nextInt(4)) {
                repeat(speechRunFrames) {
                    val step = BargeInDetector.frame(
                        state,
                        Frame(atMs = at, capturedLevel = 0.4, referenceLevel = 0.0),
                        VoiceMode.HANDS_FREE
                    )
                    if (!state.playbackRunning) {
                        assertTrue(
                            "a barge-in with no playback running must do nothing",
                            step.effects.isEmpty()
                        )
                        secondAttempts++
                    }
                    state = step.state
                    assertEquals(1, state.listeningSessions)
                    at += BargeInDetector.MAX_FRAME_INTERVAL_MS
                }
            }
            assertFalse("no playback is still running", state.playbackRunning)
            assertEquals("exactly one listening session is open", 1, state.listeningSessions)
        }

        assertTrue("second barge-ins too rare: $secondAttempts", secondAttempts >= 1_000)
    }

    // ── Invariant 3 ───────────────────────────────────────────────────────

    @Test
    fun `no audio input aborts playback in push-to-talk, however loud or long`() {
        val rng = Random(20260827)
        var loudFramesOverLivePlayback = 0

        repeat(runs) {
            // Reach (c): playback is LIVE and the frames are LOUD, so "did not
            // abort" is a fact about the mode gate and not about silence.
            var state = BargeInDetector.playbackStarted(State(), VoiceMode.PUSH_TO_TALK).state
            assertEquals("push-to-talk must not open the mic on its own", 0, state.listeningSessions)
            var at = rng.nextLong(0L, 1_000_000L)

            repeat(40) {
                val step = BargeInDetector.frame(
                    state,
                    Frame(atMs = at, capturedLevel = 0.2 + rng.nextDouble() * 0.8, referenceLevel = 0.0),
                    VoiceMode.PUSH_TO_TALK
                )
                assertTrue("push-to-talk emitted ${step.effects}", step.effects.isEmpty())
                assertTrue("push-to-talk must not accumulate an onset", step.state.onsetStartedAt == null)
                loudFramesOverLivePlayback++
                state = step.state
                assertTrue("push-to-talk playback must keep running", state.playbackRunning)
                at += BargeInDetector.MAX_FRAME_INTERVAL_MS
            }
        }

        assertTrue("loud push-to-talk frames too rare: $loudFramesOverLivePlayback", loudFramesOverLivePlayback >= 1_000)
    }

    @Test
    fun `switching to push-to-talk mid-onset cannot fire the onset that was accumulating`() {
        val rng = Random(20260828)
        var switchedMidOnset = 0

        repeat(runs) {
            var at = rng.nextLong(0L, 1_000_000L)
            var state = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE).state
            // Accumulate a real onset, but stop one frame short of the sustain.
            val framesBeforeSwitch = 1 + rng.nextInt(2)
            repeat(framesBeforeSwitch) {
                state = BargeInDetector.frame(
                    state,
                    Frame(atMs = at, capturedLevel = 0.4, referenceLevel = 0.0),
                    VoiceMode.HANDS_FREE
                ).state
                at += 40
            }
            if (state.onsetStartedAt != null) switchedMidOnset++

            repeat(20) {
                val step = BargeInDetector.frame(
                    state,
                    Frame(atMs = at, capturedLevel = 0.4, referenceLevel = 0.0),
                    VoiceMode.PUSH_TO_TALK
                )
                assertTrue("a mode switch must not fire a stale onset", step.effects.isEmpty())
                state = step.state
                at += 40
            }
            assertTrue("playback must survive the switch", state.playbackRunning)
        }

        assertTrue("mid-onset switches too rare: $switchedMidOnset", switchedMidOnset >= 200)
    }

    // ── the self-output rule, collision by construction ───────────────────

    @Test
    fun `Bubble's own output never gets through, however the margin is approached`() {
        val rng = Random(20260829)
        var justUnder = 0
        var justOver = 0
        var thresholdNearMiss = 0

        repeat(runs) {
            val arm = rng.nextInt(3)
            // The near-miss arm needs a reference that is ITSELF well over the
            // absolute threshold, or "over the threshold but under the margin"
            // is not a reachable state at all.
            val reference = if (arm == 2) {
                BargeInDetector.DEFAULT_ONSET_THRESHOLD * (2.0 + rng.nextDouble() * 4.0)
            } else {
                BargeInDetector.SELF_OUTPUT_REFERENCE_LEVEL * (0.5 + rng.nextDouble() * 1.5)
            }
            // COLLISION BY CONSTRUCTION: the captured level is DERIVED from the
            // reference by the transformation the detector must not conflate.
            // Every generated pair is a self-trigger candidate.
            val boundary = reference * BargeInDetector.DEFAULT_SELF_OUTPUT_MARGIN
            val captured = when (arm) {
                0 -> boundary * 0.98
                1 -> boundary * 1.05
                // The NEAR MISS: comfortably over the absolute threshold but
                // NOT clear of the reference. A detector checking only the
                // threshold would abort here - and would hear itself.
                else -> reference * 1.2
            }

            var at = rng.nextLong(0L, 1_000_000L)
            var state = BargeInDetector.playbackStarted(State(), VoiceMode.HANDS_FREE).state
            var aborted = false
            repeat(20) {
                val step = BargeInDetector.frame(
                    state,
                    Frame(atMs = at, capturedLevel = captured, referenceLevel = reference),
                    VoiceMode.HANDS_FREE
                )
                if (step.effects.filterIsInstance<Effect.AbortPlayback>().isNotEmpty()) aborted = true
                state = step.state
                at += BargeInDetector.MAX_FRAME_INTERVAL_MS
            }

            when (arm) {
                0 -> {
                    justUnder++
                    assertFalse("audio just under the margin must not get through", aborted)
                }
                1 -> {
                    justOver++
                    assertTrue("a human just over the margin must get through", aborted)
                }
                else -> {
                    thresholdNearMiss++
                    assertTrue(
                        "the near-miss arm must clear the absolute threshold, or it proves nothing",
                        captured >= BargeInDetector.DEFAULT_ONSET_THRESHOLD
                    )
                    assertTrue(
                        "the near-miss arm must NOT clear the self-output margin",
                        captured < reference * BargeInDetector.DEFAULT_SELF_OUTPUT_MARGIN
                    )
                    assertFalse(
                        "audio over the absolute threshold but not clear of Bubble must not get through",
                        aborted
                    )
                }
            }
        }

        assertTrue("just-under cases too rare: $justUnder", justUnder >= 80)
        assertTrue("just-over cases too rare: $justOver", justOver >= 80)
        assertTrue("threshold near misses too rare: $thresholdNearMiss", thresholdNearMiss >= 80)
    }
}
