package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-717 (BL-654 coder-authored property test) over
 * [ReplyPlaybackDecision], encoding the ticket's three declared invariants:
 *
 * 1. No terminal branch is silent (every non-muted input resolves to a
 *    speak/play action; nothing quietly finishes with no attempt made).
 * 2. The fallback line is spoken only when no real speakable reply is
 *    available — it never masks a reply that could have played.
 * 3. The window is bounded — at most one recovery/fallback speech attempt
 *    ever chains after an initial failure, never an unbounded retry loop.
 */
class ReplyPlaybackDecisionPropertyTest {

    private fun randomBlankOrText(rng: Random, label: String): String? =
        when (rng.nextInt(3)) {
            0 -> null
            1 -> if (rng.nextBoolean()) "" else "   \n\t  "
            else -> "$label-${rng.nextInt(100_000)}"
        }

    @Test
    fun `every non-muted input resolves to a speaking action, never silence`() {
        val rng = Random(20260809)
        repeat(2_000) {
            val muted = rng.nextInt(10) == 0
            val audioBase64 = randomBlankOrText(rng, "audio")
            val replySpeechText = randomBlankOrText(rng, "speech")
            val replyText = randomBlankOrText(rng, "reply")
            val decision = ReplyPlaybackDecision.decideInitial(
                ReplyPlaybackDecision.InitialInput(
                    muted = muted,
                    audioBase64 = audioBase64,
                    replySpeechText = replySpeechText,
                    replyText = replyText,
                    fallbackText = "nothing to say"
                )
            )
            if (muted) {
                assertEquals(ReplyPlaybackDecision.InitialAction.Muted, decision)
            } else {
                val speaks = when (decision) {
                    is ReplyPlaybackDecision.InitialAction.PlayAudio -> true
                    is ReplyPlaybackDecision.InitialAction.Speak -> true
                    is ReplyPlaybackDecision.InitialAction.SpeakFallback -> true
                    ReplyPlaybackDecision.InitialAction.Muted -> false
                }
                assertTrue(
                    "non-muted input ($audioBase64 / $replySpeechText / $replyText) must resolve to a speaking action, got $decision",
                    speaks
                )
            }
        }
    }

    @Test
    fun `the fallback line is chosen only when nothing real is speakable`() {
        val rng = Random(20260809717L)
        repeat(2_000) {
            val audioBase64 = randomBlankOrText(rng, "audio")
            val replySpeechText = randomBlankOrText(rng, "speech")
            val replyText = randomBlankOrText(rng, "reply")
            val hasRealAudio = !audioBase64.isNullOrBlank()
            val hasRealSpeech = !replySpeechText.isNullOrBlank() || !replyText.isNullOrBlank()

            val decision = ReplyPlaybackDecision.decideInitial(
                ReplyPlaybackDecision.InitialInput(
                    muted = false,
                    audioBase64 = audioBase64,
                    replySpeechText = replySpeechText,
                    replyText = replyText,
                    fallbackText = "nothing to say"
                )
            )

            when (decision) {
                is ReplyPlaybackDecision.InitialAction.SpeakFallback ->
                    assertTrue("fallback chosen despite real content available", !hasRealAudio && !hasRealSpeech)
                is ReplyPlaybackDecision.InitialAction.PlayAudio ->
                    assertTrue("PlayAudio chosen without real audio", hasRealAudio)
                is ReplyPlaybackDecision.InitialAction.Speak ->
                    assertTrue(
                        "Speak chosen without real speech text — fallback should have masked nothing",
                        !hasRealAudio && hasRealSpeech
                    )
                ReplyPlaybackDecision.InitialAction.Muted -> throw AssertionError("unreachable: muted=false")
            }
        }
    }

    @Test
    fun `recovery never chains past one extra speech attempt`() {
        val rng = Random(20260809718L)
        repeat(1_000) {
            var recoveryAttempted = false
            var attempts = 0
            var reachedComplete = false
            var steps = 0
            // Simulate a run of terminal failures the way ReplyAudioPlayer would:
            // each failure asks decideAfterFailure, then flips its own
            // recoveryAttempted flag exactly as the real caller must.
            while (steps < 10 && !reachedComplete) {
                steps++
                val action = ReplyPlaybackDecision.decideAfterFailure(recoveryAttempted, "sorry-${rng.nextInt()}")
                when (action) {
                    ReplyPlaybackDecision.RecoveryAction.Complete -> reachedComplete = true
                    is ReplyPlaybackDecision.RecoveryAction.SpeakFailureLine -> {
                        attempts++
                        recoveryAttempted = true // the caller marks its one recovery budget spent
                    }
                }
            }
            assertTrue("must eventually reach Complete, never loop unboundedly", reachedComplete)
            assertTrue(
                "at most one recovery speech attempt may ever fire before Complete (got $attempts)",
                attempts <= 1
            )
        }
    }

    @Test
    fun `non-vacuity — a decision fn that ignores wasRecoveryAttempt would fail the bounded-recovery property`() {
        fun brokenDecideAfterFailure(failureLine: String): ReplyPlaybackDecision.RecoveryAction =
            ReplyPlaybackDecision.RecoveryAction.SpeakFailureLine(failureLine) // always retries — no budget

        var attempts = 0
        var steps = 0
        var reachedComplete = false
        while (steps < 10 && !reachedComplete) {
            steps++
            when (brokenDecideAfterFailure("sorry")) {
                ReplyPlaybackDecision.RecoveryAction.Complete -> reachedComplete = true
                is ReplyPlaybackDecision.RecoveryAction.SpeakFailureLine -> attempts++
            }
        }
        assertTrue(
            "the broken decision fn never completes within the step bound — " +
                "this is the unbounded-retry failure the real bounded-recovery property prevents",
            !reachedComplete
        )
        assertTrue(attempts == 10)
    }
}
