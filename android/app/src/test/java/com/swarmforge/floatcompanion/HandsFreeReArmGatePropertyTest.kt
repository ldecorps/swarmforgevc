package com.swarmforge.floatcompanion

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-826 invariant 2 (BL-654 coder-authored property test): "The gate
 * always resolves: for every input it either arms the mic or records why
 * it will not, within a bounded ceiling, so hands-free can never latch
 * silently off."
 *
 * Dual ceiling (voix lente fix): while playback is still reported active,
 * only [HandsFreeReArmGate.DEFAULT_ACTIVE_PLAYBACK_CEILING_MS] may force an
 * arm — the shorter quiet-tail ceiling must never open the mic onto live TTS.
 */
class HandsFreeReArmGatePropertyTest {

    @Test
    fun `every input resolves to Arm within the active-playback ceiling, never an unbounded wait`() {
        val rng = Random(20260807)
        repeat(500) {
            val waitStartedAt = rng.nextLong(0L, 10_000_000L)
            val quietTailMs = rng.nextLong(1L, 2_000L)
            val ceilingMs = rng.nextLong(quietTailMs, 8_000L)
            val activePlaybackCeilingMs = rng.nextLong(ceilingMs, 60_000L)
            val pollIntervalMs = rng.nextLong(20L, 500L)

            var now = waitStartedAt
            var lastAudioActivityAt = waitStartedAt
            var steps = 0
            var armed = false
            while (steps < 5_000 && !armed) {
                steps++
                val playbackActive = rng.nextBoolean()
                if (playbackActive) lastAudioActivityAt = now
                val decision = HandsFreeReArmGate.decide(
                    HandsFreeReArmGate.Input(
                        nowMs = now,
                        waitStartedAt = waitStartedAt,
                        hasPlaybackToAwait = true,
                        playbackActive = playbackActive,
                        lastAudioActivityAt = lastAudioActivityAt,
                        quietTailMs = quietTailMs,
                        ceilingMs = ceilingMs,
                        activePlaybackCeilingMs = activePlaybackCeilingMs,
                        pollIntervalMs = pollIntervalMs
                    )
                )
                when (decision) {
                    is HandsFreeReArmGate.Decision.Arm -> {
                        val hardCeiling = waitStartedAt + activePlaybackCeilingMs
                        assertTrue(
                            "armed at $now, past the active-playback ceiling $hardCeiling by more than one poll step",
                            now <= hardCeiling + pollIntervalMs
                        )
                        armed = true
                    }
                    is HandsFreeReArmGate.Decision.NotYet -> {
                        assertTrue(
                            "NotYet must recommend a recheck strictly after now " +
                                "(got recheckAtMs=${decision.recheckAtMs}, now=$now)",
                            decision.recheckAtMs > now
                        )
                        val maxRecheck = waitStartedAt + activePlaybackCeilingMs
                        assertTrue(
                            "NotYet must never recommend a recheck past the active-playback ceiling " +
                                "(recheckAtMs=${decision.recheckAtMs}, ceiling=$maxRecheck)",
                            decision.recheckAtMs <= maxRecheck
                        )
                        assertTrue("NotYet must always carry a reason", decision.reason.isNotBlank())
                        now = decision.recheckAtMs
                    }
                }
            }
            assertTrue(
                "gate never resolved to Arm within $steps polls " +
                    "(waitStartedAt=$waitStartedAt, ceilingMs=$ceilingMs, active=$activePlaybackCeilingMs)",
                armed
            )
        }
    }

    @Test
    fun `a gate without a ceiling clamp would fail the resolves-within-ceiling property`() {
        fun decideWithoutCeiling(input: HandsFreeReArmGate.Input): HandsFreeReArmGate.Decision {
            if (!input.hasPlaybackToAwait) return HandsFreeReArmGate.Decision.Arm("no playback to await")
            if (input.playbackActive) {
                return HandsFreeReArmGate.Decision.NotYet(
                    "playback still reported active",
                    recheckAtMs = input.nowMs + input.pollIntervalMs
                )
            }
            return HandsFreeReArmGate.Decision.Arm("quiet")
        }

        var now = 0L
        var steps = 0
        var armed = false
        while (steps < 5_000 && !armed) {
            steps++
            val decision = decideWithoutCeiling(
                HandsFreeReArmGate.Input(
                    nowMs = now,
                    waitStartedAt = 0L,
                    hasPlaybackToAwait = true,
                    playbackActive = true,
                    lastAudioActivityAt = now,
                    ceilingMs = 4_000L
                )
            )
            when (decision) {
                is HandsFreeReArmGate.Decision.Arm -> armed = true
                is HandsFreeReArmGate.Decision.NotYet -> now = decision.recheckAtMs
            }
        }

        assertTrue(
            "a gate with no ceiling clamp never arms while playback stays reported active — " +
                "this is the failure the real gate's ceiling prevents",
            !armed
        )
    }

    @Test
    fun `short quiet-tail ceiling alone never arms onto continuously active playback`() {
        var now = 0L
        var steps = 0
        var armedEarly = false
        while (steps < 1_000 && !armedEarly) {
            steps++
            val decision = HandsFreeReArmGate.decide(
                HandsFreeReArmGate.Input(
                    nowMs = now,
                    waitStartedAt = 0L,
                    hasPlaybackToAwait = true,
                    playbackActive = true,
                    lastAudioActivityAt = now,
                    quietTailMs = 700L,
                    ceilingMs = 8_000L,
                    activePlaybackCeilingMs = 60_000L,
                    pollIntervalMs = 150L
                )
            )
            when (decision) {
                is HandsFreeReArmGate.Decision.Arm -> {
                    // Must not arm before the active-playback ceiling.
                    assertTrue(now >= 60_000L)
                    armedEarly = true
                }
                is HandsFreeReArmGate.Decision.NotYet -> {
                    if (now > 8_000L && now < 60_000L) {
                        assertTrue(
                            "must still be waiting on active playback after quiet-tail ceiling",
                            decision.reason.contains("playback still reported active")
                        )
                    }
                    now = decision.recheckAtMs
                }
            }
        }
        assertTrue("should eventually arm at the active-playback ceiling", armedEarly)
    }

    /**
     * BL-826 bounce (2026-08-07) regression property: the true silence
     * duration at arm-time must never fall short of the declared quiet tail
     * by more than one poll step when audio has actually stopped.
     */
    @Test
    fun `first poll tick samples at the steady cadence, closing the two-tier blind window`() {
        val rng = Random(20260807826L)
        repeat(500) {
            val waitStartedAt = rng.nextLong(0L, 10_000_000L)
            val quietTailMs = rng.nextLong(1L, 2_000L)
            // Quiet-tail ceiling must leave room for audio to finish AND a full
            // quiet tail, otherwise the defensive quiet ceiling arms early by
            // design and the silence invariant does not apply.
            val ceilingMs = rng.nextLong(quietTailMs * 3, quietTailMs * 3 + 8_000L)
            val pollIntervalMs = rng.nextLong(20L, 500L)
            val minEnd = pollIntervalMs + 1
            val maxEndExclusive = (ceilingMs - quietTailMs).coerceAtLeast(minEnd + 1)
            val audioEndsAt = waitStartedAt + rng.nextLong(minEnd, maxEndExclusive)

            var now = waitStartedAt
            var lastAudioActivityAt = waitStartedAt
            var firstTick = true
            var armed = false
            var armTime = 0L
            var steps = 0
            while (steps < 5_000 && !armed) {
                steps++
                if (firstTick) {
                    now = waitStartedAt + HandsFreeReArmGate.firstPollDelayMs(
                        cooldownMs = AudioTurnRecorder.HANDS_FREE_POST_SPEECH_MS,
                        followsPlayback = true,
                        pollIntervalMs = pollIntervalMs
                    )
                    firstTick = false
                }
                val playbackActive = now <= audioEndsAt
                if (playbackActive) lastAudioActivityAt = now
                val decision = HandsFreeReArmGate.decide(
                    HandsFreeReArmGate.Input(
                        nowMs = now,
                        waitStartedAt = waitStartedAt,
                        hasPlaybackToAwait = true,
                        playbackActive = playbackActive,
                        lastAudioActivityAt = lastAudioActivityAt,
                        quietTailMs = quietTailMs,
                        ceilingMs = ceilingMs,
                        activePlaybackCeilingMs = 60_000L,
                        pollIntervalMs = pollIntervalMs
                    )
                )
                when (decision) {
                    is HandsFreeReArmGate.Decision.Arm -> {
                        armed = true
                        armTime = now
                    }
                    is HandsFreeReArmGate.Decision.NotYet -> now = decision.recheckAtMs
                }
            }
            assertTrue("gate must arm", armed)
            val trueSilence = armTime - audioEndsAt
            assertTrue(
                "armed with only ${trueSilence}ms of true silence (need >= ${quietTailMs - pollIntervalMs})",
                trueSilence >= quietTailMs - pollIntervalMs
            )
        }
    }

    @Test
    fun `pre-fix two-tier schedule under-measures quiet when first poll is the wide cooldown`() {
        // Non-vacuity companion: if the first poll used the 400ms cooldown
        // instead of the 150ms poll step, continuous audio ending at 390ms
        // would be invisible and the gate could arm having seen less than a
        // full quiet tail.
        val waitStartedAt = 0L
        val quietTailMs = 400L
        val pollIntervalMs = 150L
        val audioEndsAt = 390L

        var now = waitStartedAt + 400L // broken first-poll delay
        var lastAudioActivityAt = waitStartedAt // never observed the 390ms audio
        val decision = HandsFreeReArmGate.decide(
            HandsFreeReArmGate.Input(
                nowMs = now,
                waitStartedAt = waitStartedAt,
                hasPlaybackToAwait = true,
                playbackActive = false,
                lastAudioActivityAt = lastAudioActivityAt,
                quietTailMs = quietTailMs,
                ceilingMs = 8_000L,
                pollIntervalMs = pollIntervalMs
            )
        )
        assertTrue(
            "broken first-poll delay would arm with insufficient true silence",
            decision is HandsFreeReArmGate.Decision.Arm
        )
        val trueSilence = now - audioEndsAt
        assertTrue(
            "and that arm would under-measure the quiet tail ($trueSilence < $quietTailMs)",
            trueSilence < quietTailMs
        )
    }
}
