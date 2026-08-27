package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-763 invariant 2 (BL-654 coder-authored property test): "When Bubble
 * sees a new bridge instanceId and bounce-auto-session-reset is enabled, it
 * opens a fresh Let's Talk session once — not on every poll against the
 * same instance." Encoded as: fold [BridgeBounceSession.decide] over an
 * arbitrary sequence of (instanceId, autoResetEnabled) polls, threading
 * `nextKnownInstanceId` forward exactly the way [TalkEngine] would after
 * each real sync — and check that a reset fires on step N if and only if
 * step N's instanceId differs from the LAST NON-BLANK instanceId actually
 * seen so far and auto-reset was enabled at that step; consecutive polls
 * that repeat the same instanceId never both reset.
 */
class BridgeBounceSessionPropertyTest {

    private data class Poll(val instanceId: String, val autoResetEnabled: Boolean)

    private fun randomPoll(rng: Random): Poll {
        // A small alphabet of instance ids (including "" for a failed fetch)
        // so the generator actually revisits the same id repeatedly, the
        // exact case the invariant's "not on every poll" half exercises.
        val ids = listOf("", "instance-A", "instance-B", "instance-C")
        return Poll(instanceId = ids[rng.nextInt(ids.size)], autoResetEnabled = rng.nextBoolean())
    }

    @Test
    fun `a reset fires exactly on a change from the last non-blank seen instanceId, with auto-reset enabled`() {
        val rng = Random(20260813763L)
        repeat(2_000) {
            val polls = List(rng.nextInt(1, 20)) { randomPoll(rng) }

            var known = ""
            var lastNonBlankSeen = ""
            for ((i, poll) in polls.withIndex()) {
                val decision = BridgeBounceSession.decide(known, poll.instanceId, poll.autoResetEnabled)

                val expectedReset = poll.instanceId.isNotBlank() &&
                    lastNonBlankSeen.isNotBlank() &&
                    poll.instanceId != lastNonBlankSeen &&
                    poll.autoResetEnabled
                assertEquals(
                    "poll $i (polls=$polls, known=$known, lastNonBlankSeen=$lastNonBlankSeen)",
                    expectedReset,
                    decision.shouldResetSession
                )

                known = decision.nextKnownInstanceId
                if (poll.instanceId.isNotBlank()) lastNonBlankSeen = poll.instanceId
            }
        }
    }

    @Test
    fun `two consecutive polls reporting the identical instanceId never both reset`() {
        val rng = Random(20260813001L)
        repeat(500) {
            val id = listOf("instance-A", "instance-B", "instance-C")[rng.nextInt(3)]
            val first = BridgeBounceSession.decide("", id, autoResetEnabled = true)
            val second = BridgeBounceSession.decide(first.nextKnownInstanceId, id, autoResetEnabled = true)
            assertTrue("a same-instance repeat must never reset ($id)", !second.shouldResetSession)
        }
    }

    @Test
    fun `a naive always-reset-on-any-fetch reducer would fail this property`() {
        // Non-vacuity companion: the failure mode this invariant exists to
        // prevent is a client that resets on every poll regardless of
        // whether the instance actually changed - demonstrate it fails,
        // then confirm the real decision function above does not share
        // this behavior.
        fun alwaysResetOnFetch(freshInstanceId: String): Boolean = freshInstanceId.isNotBlank()

        val naiveResetsOnRepeat = alwaysResetOnFetch("instance-A")
        assertTrue(
            "the naive reducer wrongly resets even when the instanceId repeats",
            naiveResetsOnRepeat
        )

        val real = BridgeBounceSession.decide("instance-A", "instance-A", autoResetEnabled = true)
        assertEquals(
            "the real reducer must not reset on a repeated instanceId",
            false,
            real.shouldResetSession
        )
    }
}
