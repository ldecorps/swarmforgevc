package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-826: HandsFreeReArmGate is the pure decision behind the quiet-tail
 * fix for Bubble's hands-free self-listen echo loop. No android.* type in
 * its own signature (constitution: Testability Boundary — Bubble), so this
 * runs under the JVM unit suite with no device or emulator.
 */
class HandsFreeReArmGateTest {

    private fun input(
        nowMs: Long,
        waitStartedAt: Long = 0L,
        hasPlaybackToAwait: Boolean = true,
        playbackActive: Boolean = false,
        lastAudioActivityAt: Long = waitStartedAt,
        quietTailMs: Long = 700L,
        ceilingMs: Long = 8_000L
    ) = HandsFreeReArmGate.Input(
        nowMs = nowMs,
        waitStartedAt = waitStartedAt,
        hasPlaybackToAwait = hasPlaybackToAwait,
        playbackActive = playbackActive,
        lastAudioActivityAt = lastAudioActivityAt,
        quietTailMs = quietTailMs,
        ceilingMs = ceilingMs
    )

    // BL-826 hands-free-self-listen-echo-loop-01, decision:
    // "refusing to arm the mic while playback is still reported active"
    @Test
    fun `refusing to arm the mic while playback is still reported active`() {
        val decision = HandsFreeReArmGate.decide(input(nowMs = 0L, playbackActive = true))

        assertTrue(decision is HandsFreeReArmGate.Decision.NotYet)
        assertEquals(
            "playback still reported active",
            (decision as HandsFreeReArmGate.Decision.NotYet).reason
        )
    }

    // decision: "refusing to arm until a quiet tail has followed the
    // playback-done signal"
    @Test
    fun `refusing to arm until a quiet tail has followed the playback-done signal`() {
        val decision = HandsFreeReArmGate.decide(input(nowMs = 100L, quietTailMs = 400L))

        assertTrue(decision is HandsFreeReArmGate.Decision.NotYet)
        assertEquals(
            "quiet tail not yet elapsed (100ms of 400ms)",
            (decision as HandsFreeReArmGate.Decision.NotYet).reason
        )
    }

    // decision: "restarting the quiet tail when audio resumes before it
    // completes"
    @Test
    fun `restarting the quiet tail when audio resumes before it completes`() {
        // Playback resumes at t=350 (before the 400ms tail from
        // waitStartedAt=0 would have elapsed) — a real poll loop moves
        // lastAudioActivityAt to 350 the instant it observes that.
        val resumed = HandsFreeReArmGate.decide(input(nowMs = 350L, playbackActive = true, quietTailMs = 400L))
        assertTrue(resumed is HandsFreeReArmGate.Decision.NotYet)

        // A gate that ignored the resume and measured quiet-since-
        // waitStartedAt would arm here (t=400). It must not.
        val stillWaiting = HandsFreeReArmGate.decide(
            input(nowMs = 400L, lastAudioActivityAt = 350L, quietTailMs = 400L)
        )
        assertTrue(
            "a gate that ignored the resume would have armed by t=400",
            stillWaiting is HandsFreeReArmGate.Decision.NotYet
        )

        // The tail restarted from the resume point (350) and elapses at 750.
        val armedAfterRestartedTail = HandsFreeReArmGate.decide(
            input(nowMs = 750L, lastAudioActivityAt = 350L, quietTailMs = 400L)
        )
        assertTrue(armedAfterRestartedTail is HandsFreeReArmGate.Decision.Arm)
    }

    // decision: "arming the mic once an uninterrupted quiet tail has
    // elapsed"
    @Test
    fun `arming the mic once an uninterrupted quiet tail has elapsed`() {
        val decision = HandsFreeReArmGate.decide(
            input(nowMs = 400L, quietTailMs = 400L, lastAudioActivityAt = 0L)
        )

        assertTrue(decision is HandsFreeReArmGate.Decision.Arm)
        assertEquals(
            "quiet tail elapsed uninterrupted",
            (decision as HandsFreeReArmGate.Decision.Arm).reason
        )
    }

    // decision: "discarding audio captured inside the post-arm settle
    // window"
    @Test
    fun `discarding audio captured inside the post-arm settle window`() {
        val armedAt = 1_000L

        assertTrue(HandsFreeReArmGate.isWithinSettleWindow(armedAt, armedAt + 50L, settleMs = 150L))
        assertTrue(!HandsFreeReArmGate.isWithinSettleWindow(armedAt, armedAt + 150L, settleMs = 150L))
        assertTrue(!HandsFreeReArmGate.isWithinSettleWindow(armedAt, armedAt + 500L, settleMs = 150L))
    }

    // decision: "arming after a failed turn that produced no playback at
    // all"
    @Test
    fun `arming after a failed turn that produced no playback at all`() {
        val decision = HandsFreeReArmGate.decide(
            input(nowMs = 0L, hasPlaybackToAwait = false, playbackActive = true)
        )

        assertTrue(decision is HandsFreeReArmGate.Decision.Arm)
        assertEquals(
            "no playback to await",
            (decision as HandsFreeReArmGate.Decision.Arm).reason
        )
    }

    // Coverage beyond the Scenario Outline: quiet-tail ceiling only applies
    // once playback has gone quiet — never while audio is still active.
    @Test
    fun `quiet-tail ceiling does not arm while playback is still reported active`() {
        val decision = HandsFreeReArmGate.decide(
            input(
                nowMs = 4_000L,
                waitStartedAt = 0L,
                ceilingMs = 4_000L,
                playbackActive = true
            )
        )

        assertTrue(decision is HandsFreeReArmGate.Decision.NotYet)
        assertEquals(
            "playback still reported active",
            (decision as HandsFreeReArmGate.Decision.NotYet).reason
        )
    }

    @Test
    fun `arms defensively once the active-playback ceiling is reached while audio stays active`() {
        val decision = HandsFreeReArmGate.decide(
            HandsFreeReArmGate.Input(
                nowMs = 60_000L,
                waitStartedAt = 0L,
                hasPlaybackToAwait = true,
                playbackActive = true,
                lastAudioActivityAt = 60_000L,
                ceilingMs = 8_000L,
                activePlaybackCeilingMs = 60_000L
            )
        )

        assertTrue(decision is HandsFreeReArmGate.Decision.Arm)
        assertTrue(
            (decision as HandsFreeReArmGate.Decision.Arm).reason.contains("active-playback ceiling")
        )
    }

    @Test
    fun `NotYet never recommends a recheck past the active-playback ceiling`() {
        val decision = HandsFreeReArmGate.decide(
            HandsFreeReArmGate.Input(
                nowMs = 59_900L,
                waitStartedAt = 0L,
                hasPlaybackToAwait = true,
                playbackActive = true,
                lastAudioActivityAt = 59_900L,
                ceilingMs = 8_000L,
                activePlaybackCeilingMs = 60_000L,
                pollIntervalMs = 150L
            )
        )

        assertTrue(decision is HandsFreeReArmGate.Decision.NotYet)
        assertTrue((decision as HandsFreeReArmGate.Decision.NotYet).recheckAtMs <= 60_000L)
    }
}
