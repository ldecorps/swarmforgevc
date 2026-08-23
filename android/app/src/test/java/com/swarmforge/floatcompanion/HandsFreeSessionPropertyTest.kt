package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.HandsFreeSession.Effect
import com.swarmforge.floatcompanion.HandsFreeSession.Event
import com.swarmforge.floatcompanion.HandsFreeSession.Session
import com.swarmforge.floatcompanion.HandsFreeSession.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-844 property tests (BL-654 coder-authored, THREE declared invariants).
 *
 *   Invariant 1: nothing reaches the model unwoken - while the session is
 *   passive, no utterance is ever submitted as a turn, whatever it contains.
 *   Invariant 2: a session always has a way out - from any state, either a
 *   hard end phrase or the silence window returns it to passive; no input
 *   sequence leaves the mic open indefinitely.
 *   Invariant 3: push-to-talk is untouched by this policy - with hands-free
 *   off, no elapsed silence ever changes the session state.
 *
 * WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every
 * conversation the human could have". HandsFreeSessionTest pins the shapes a
 * reviewer thinks of; the failure that matters is the tenth - a sequence that
 * reaches passive by an unusual route and then submits the utterance that took
 * it there, or one that keeps restarting the window until it never closes.
 *
 * REACH, asserted rather than hoped for (BL-654's generator-reach clause).
 * Three states a naive generator would essentially never produce:
 *
 *   (a) A PASSIVE SESSION HOLDING A REAL QUESTION. Invariant 1 is only
 *       interesting when the utterance WOULD have been submitted had the
 *       session been open. Drawing utterances uniformly from a wide alphabet
 *       makes almost all of them unclassifiable noise, so passive-plus-real-
 *       question is constructed and floored - and the same utterance is
 *       replayed against an OPEN session to prove it really would have been
 *       submitted, which is what makes the passive case a fact about waking
 *       and not about the phrase.
 *
 *   (b) THE WINDOW BOUNDARY. Drawing elapsed times uniformly puts almost
 *       every case far inside or far outside the window, so an off-by-one on
 *       the comparison (`>` for `>=`) would survive any number of runs.
 *       Exactly-at and exactly-one-below are constructed, each with a floor.
 *
 *   (c) THE SOFT-CLOSER COLLISION. This is the collision shape BL-654 warns
 *       about: a closer and a question are conflated exactly when a closer is
 *       allowed to RESTART the window, which drawn independently would take a
 *       long sequence to expose. So a closer is injected DIRECTLY into an
 *       already-running window at a drawn offset, and the property asserts the
 *       session still closes on the ORIGINAL window - never a fresh one. Its
 *       near-miss twin is a question containing a closer word ("thanks for
 *       nothing, what is the backlog"), which MUST restart the conversation,
 *       because a machine that treated every closer-looking phrase as a
 *       non-task would pass a restart-free property while ignoring real work.
 */
class HandsFreeSessionPropertyTest {

    private val runs = 400
    private val window = HandsFreeSession.DEFAULT_SILENCE_WINDOW_MS

    private val questions = listOf(
        "what is the pipeline doing",
        "and what about the backlog",
        "stop the deployment before it reaches production",
        "thanks for nothing, what is the backlog",
        "read me the last briefing"
    )
    private val hardEnders = listOf("stop", "I'm done", "goodbye", "Stop.", "bye")
    private val softClosers = listOf("thank you", "thanks", "Thanks!", "  THANK YOU  ")

    private fun anyUtterance(rng: Random): String = when (rng.nextInt(3)) {
        0 -> questions.random(rng)
        1 -> hardEnders.random(rng)
        else -> softClosers.random(rng)
    }

    // ── Invariant 1 ───────────────────────────────────────────────────────

    @Test
    fun `no utterance is ever submitted while the session is passive`() {
        val rng = Random(20260823)
        var realQuestionsWhilePassive = 0

        repeat(runs) {
            // Reach (a): a passive session and an utterance that WOULD have
            // been submitted had it been open.
            val utterance = anyUtterance(rng)
            val atMs = rng.nextLong(0L, 10_000_000L)
            val handsFree = rng.nextBoolean()

            val step = HandsFreeSession.on(Session(), Event.Utterance(utterance, atMs), handsFree)
            assertTrue(
                "\"$utterance\" reached the model from a passive session",
                step.effects.none { it is Effect.SubmitTurn }
            )
            assertEquals(State.PassiveWake, step.session.state)

            if (questions.contains(utterance)) {
                // Proven, not assumed: the same utterance IS a turn once the
                // session is open, so the passive case is a fact about waking.
                val open = HandsFreeSession.on(
                    Session(state = State.ActiveListen),
                    Event.Utterance(utterance, atMs),
                    handsFree
                )
                if (open.effects.any { it is Effect.SubmitTurn }) realQuestionsWhilePassive++
            }
        }

        assertTrue(
            "passive sessions never saw a would-be turn: $realQuestionsWhilePassive",
            realQuestionsWhilePassive >= 60
        )
    }

    @Test
    fun `no event sequence reaches a state where a passive session submits a turn`() {
        val rng = Random(20260824)
        var passiveVisits = 0

        repeat(runs) {
            var session = Session()
            var at = rng.nextLong(0L, 10_000_000L)
            val handsFree = rng.nextBoolean()

            repeat(40) {
                at += rng.nextLong(0L, window * 2)
                val event: Event = when (rng.nextInt(8)) {
                    0 -> Event.WakeSignal(at)
                    1 -> Event.PushToTalkTap(at)
                    2 -> Event.PlaybackStarted(at)
                    3 -> Event.PlaybackFinished(at)
                    4 -> Event.BargeIn(at)
                    5 -> Event.TurnFailed(at)
                    6 -> Event.Tick(at)
                    else -> Event.Utterance(anyUtterance(rng), at)
                }
                val wasPassive = session.state == State.PassiveWake
                if (wasPassive) passiveVisits++
                val step = HandsFreeSession.on(session, event, handsFree)
                if (wasPassive && event is Event.Utterance) {
                    assertTrue(
                        "an utterance reached the model from passive via $event",
                        step.effects.none { it is Effect.SubmitTurn }
                    )
                }
                // A window may never be armed while passive: that is what
                // would let a tick "close" a session that was never open.
                if (step.session.state == State.PassiveWake) {
                    assertNull("a passive session must hold no window", step.session.silenceWindowStartedAt)
                }
                session = step.session
            }
        }

        assertTrue("passive states too rare to test invariant 1: $passiveVisits", passiveVisits >= 1_000)
    }

    // ── Invariant 2 ───────────────────────────────────────────────────────

    @Test
    fun `from any reachable session a hard end phrase returns it to passive`() {
        val rng = Random(20260825)
        var nonPassiveReached = 0

        repeat(runs) {
            var session = Session()
            var at = rng.nextLong(0L, 10_000_000L)
            val handsFree = rng.nextBoolean()

            repeat(20) {
                at += rng.nextLong(0L, window)
                val event: Event = when (rng.nextInt(6)) {
                    0 -> Event.WakeSignal(at)
                    1 -> Event.PushToTalkTap(at)
                    2 -> Event.PlaybackStarted(at)
                    3 -> Event.PlaybackFinished(at)
                    4 -> Event.BargeIn(at)
                    else -> Event.Utterance(questions.random(rng), at)
                }
                session = HandsFreeSession.on(session, event, handsFree).session
            }

            if (session.state != State.PassiveWake) nonPassiveReached++
            val out = HandsFreeSession.on(session, Event.Utterance(hardEnders.random(rng), at + 1), handsFree)
            assertEquals(
                "a session in ${session.state} had no way out",
                State.PassiveWake,
                out.session.state
            )
            assertNull("the way out must not leave a window running", out.session.silenceWindowStartedAt)
        }

        assertTrue("non-passive sessions too rare: $nonPassiveReached", nonPassiveReached >= 200)
    }

    @Test
    fun `an armed window always closes, and closes exactly at its boundary`() {
        val rng = Random(20260826)
        var atLimit = 0
        var justBelow = 0
        var wellPast = 0

        repeat(runs) {
            val armedAt = rng.nextLong(0L, 10_000_000L)
            val session = HandsFreeSession.on(
                Session(state = State.Speaking),
                Event.PlaybackFinished(armedAt),
                handsFree = true
            ).session
            assertEquals(armedAt, session.silenceWindowStartedAt)

            // Reach (b): the boundary itself, constructed.
            val arm = rng.nextInt(3)
            val elapsed = when (arm) {
                0 -> window
                1 -> window - 1
                else -> window + rng.nextLong(1L, window * 4)
            }
            val step = HandsFreeSession.on(session, Event.Tick(armedAt + elapsed), handsFree = true)
            if (elapsed >= window) {
                assertEquals(
                    "a window of $window closed late at $elapsed",
                    State.PassiveWake,
                    step.session.state
                )
                assertNull(step.session.silenceWindowStartedAt)
                if (arm == 0) atLimit++ else wellPast++
            } else {
                assertEquals(
                    "a window of $window closed early at $elapsed",
                    State.ActiveListen,
                    step.session.state
                )
                justBelow++
            }
        }

        assertTrue("exactly-at-the-limit cases too rare: $atLimit", atLimit >= 80)
        assertTrue("one-below-the-limit cases too rare: $justBelow", justBelow >= 80)
        assertTrue("well-past cases too rare: $wellPast", wellPast >= 80)
    }

    @Test
    fun `a soft closer cannot hold a session open, however many are said`() {
        val rng = Random(20260827)
        var closersInjected = 0
        var nearMisses = 0

        repeat(runs) {
            val armedAt = rng.nextLong(0L, 10_000_000L)
            var session = HandsFreeSession.on(
                Session(state = State.Speaking),
                Event.PlaybackFinished(armedAt),
                handsFree = true
            ).session

            // COLLISION BY CONSTRUCTION: closers are injected DIRECTLY into a
            // running window at drawn offsets. A machine that let a closer
            // restart the window would keep this session open past the
            // original deadline - which is exactly the conflation being tested.
            val howMany = 1 + rng.nextInt(4)
            var last = armedAt
            repeat(howMany) closerInjection@{
                last += rng.nextLong(1L, window - 1)
                if (last - armedAt >= window) return@closerInjection
                val step = HandsFreeSession.on(
                    session,
                    Event.Utterance(softClosers.random(rng), last),
                    handsFree = true
                )
                closersInjected++
                assertTrue(
                    "a polite closer must never be a turn",
                    step.effects.none { it is Effect.SubmitTurn }
                )
                assertEquals(
                    "a closer restarted the window",
                    armedAt,
                    step.session.silenceWindowStartedAt
                )
                session = step.session
            }

            val closed = HandsFreeSession.on(session, Event.Tick(armedAt + window), handsFree = true)
            assertEquals(
                "the session outlived the window the ANSWER armed",
                State.PassiveWake,
                closed.session.state
            )

            // The near miss: a question that merely CONTAINS a closer word must
            // restart the conversation, or the machine would ignore real work.
            val nearMiss = HandsFreeSession.on(
                HandsFreeSession.on(Session(state = State.Speaking), Event.PlaybackFinished(armedAt), true).session,
                Event.Utterance("thanks for nothing, what is the backlog", armedAt + 1),
                handsFree = true
            )
            assertEquals(State.Thinking, nearMiss.session.state)
            assertTrue(nearMiss.effects.any { it is Effect.SubmitTurn })
            nearMisses++
        }

        assertTrue("closers injected too rarely: $closersInjected", closersInjected >= 400)
        assertTrue("near misses too rare: $nearMisses", nearMisses >= 300)
    }

    // ── Invariant 3 ───────────────────────────────────────────────────────

    @Test
    fun `with hands-free off no elapsed silence ever changes the session state`() {
        val rng = Random(20260828)
        var armedSessionsTicked = 0

        repeat(runs) {
            // Reach (c) for this invariant: a session that IS in a state a
            // window could close, with a window armed, so "nothing changed" is
            // a fact about the mode gate and not about an empty session.
            val armedAt = rng.nextLong(0L, 10_000_000L)
            val state = listOf(State.ActiveListen, State.Thinking, State.Speaking).random(rng)
            val before = Session(state = state, silenceWindowStartedAt = armedAt)

            repeat(10) {
                val elapsed = rng.nextLong(0L, window * 10)
                val step = HandsFreeSession.on(before, Event.Tick(armedAt + elapsed), handsFree = false)
                assertEquals("push-to-talk state changed after ${elapsed}ms", before, step.session)
                assertTrue(step.effects.isEmpty())
                armedSessionsTicked++
            }
        }

        assertTrue("armed push-to-talk sessions too rare: $armedSessionsTicked", armedSessionsTicked >= 1_000)
    }

    @Test
    fun `with hands-free off an answer arms no window for a later tick to act on`() {
        val rng = Random(20260829)
        repeat(runs) {
            val at = rng.nextLong(0L, 10_000_000L)
            val session = HandsFreeSession.on(
                Session(state = State.Speaking),
                Event.PlaybackFinished(at),
                handsFree = false
            ).session
            assertNull("push-to-talk must arm no silence window", session.silenceWindowStartedAt)
            val ticked = HandsFreeSession.on(session, Event.Tick(at + window * 5), handsFree = false)
            assertEquals(State.ActiveListen, ticked.session.state)
        }
    }
}
