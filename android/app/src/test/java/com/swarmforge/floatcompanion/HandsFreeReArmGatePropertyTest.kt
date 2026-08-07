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
 * No Kotlin property-test framework is pinned in this project (constitution:
 * Startup Tools — the `*.property.test.js`/`npm run test:properties` seam is
 * TS-only, via extension/vitest.properties.config.mjs). This runs as a plain
 * JUnit test under the same JVM unit suite as HandsFreeReArmGateTest — the
 * documented degraded posture for a `.kt`-only parcel — but it IS a property
 * test in substance: it sweeps randomized inputs rather than fixed examples,
 * and non-vacuity is proven inline (a deliberately-broken gate that never
 * forces Arm past the ceiling fails it — see the second test below).
 *
 * The simulation mirrors the real poll loop TalkEngine.scheduleHandsFreeListen
 * runs: starting from a random waitStartedAt, repeatedly call decide(), and
 * whenever it is NotYet, advance now to its own recheckAtMs and ask again -
 * exactly what production does. A gate that could recommend a recheck past
 * its own ceiling, or that could NotYet forever, fails this property.
 */
class HandsFreeReArmGatePropertyTest {

    @Test
    fun `every input resolves to Arm within the ceiling, never an unbounded wait`() {
        val rng = Random(20260807)
        repeat(500) {
            val waitStartedAt = rng.nextLong(0L, 10_000_000L)
            val quietTailMs = rng.nextLong(1L, 2_000L)
            val ceilingMs = rng.nextLong(quietTailMs, 8_000L)
            val pollIntervalMs = rng.nextLong(20L, 500L)

            var now = waitStartedAt
            var lastAudioActivityAt = waitStartedAt
            var steps = 0
            var armed = false
            while (steps < 5_000 && !armed) {
                steps++
                // Random, possibly-flapping playback activity: each poll may
                // or may not still see playback active. lastAudioActivityAt
                // only ever advances when it does — the same rule the real
                // poll loop applies (TalkEngine.HandsFreeListenPoll.run()).
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
                        pollIntervalMs = pollIntervalMs
                    )
                )
                when (decision) {
                    is HandsFreeReArmGate.Decision.Arm -> {
                        assertTrue(
                            "armed at $now, past the ceiling ${waitStartedAt + ceilingMs} by more than one poll step",
                            now <= waitStartedAt + ceilingMs + pollIntervalMs
                        )
                        armed = true
                    }
                    is HandsFreeReArmGate.Decision.NotYet -> {
                        assertTrue(
                            "NotYet must recommend a recheck strictly after now " +
                                "(got recheckAtMs=${decision.recheckAtMs}, now=$now)",
                            decision.recheckAtMs > now
                        )
                        assertTrue(
                            "NotYet must never recommend a recheck past the ceiling " +
                                "(recheckAtMs=${decision.recheckAtMs}, ceiling=${waitStartedAt + ceilingMs})",
                            decision.recheckAtMs <= waitStartedAt + ceilingMs
                        )
                        assertTrue("NotYet must always carry a reason", decision.reason.isNotBlank())
                        now = decision.recheckAtMs
                    }
                }
            }
            assertTrue(
                "gate never resolved to Arm within $steps polls " +
                    "(waitStartedAt=$waitStartedAt, ceilingMs=$ceilingMs, quietTailMs=$quietTailMs)",
                armed
            )
        }
    }

    // Non-vacuity: a gate that dropped the ceiling clamp (NotYet forever
    // while playback is reported active) fails the property above. Proves
    // the property test is actually exercising the ceiling, not passing by
    // construction.
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
                    playbackActive = true, // always active — never quiets down
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

    /**
     * BL-826 bounce (2026-08-07) regression property: the original sweep
     * above starts its simulated `now` at `waitStartedAt` itself, modeling a
     * UNIFORM poll cadence. Production's real scheduler
     * (TalkEngine.scheduleHandsFreeListen) is two-tier: the first tick fires
     * at [HandsFreeReArmGate.firstPollDelayMs], every later one at decide()'s
     * own recheckAtMs. This sweep mirrors that real schedule and checks the
     * property the bounce found broken: the true silence duration at the
     * moment the gate arms (armTime - audioEndsAt, where audioEndsAt is when
     * real playback actually, permanently stopped) must never fall short of
     * the declared quiet tail by more than one poll step. A discrete sampler
     * can't do better than that — but it must not do worse.
     */
    @Test
    fun `first poll tick samples at the steady cadence, closing the two-tier blind window`() {
        val rng = Random(20260807826L)
        repeat(500) {
            val waitStartedAt = rng.nextLong(0L, 10_000_000L)
            val quietTailMs = rng.nextLong(1L, 2_000L)
            val ceilingMs = rng.nextLong(quietTailMs, 8_000L)
            val pollIntervalMs = rng.nextLong(20L, 500L)
            // A cooldown wider than the poll interval, like the real
            // HANDS_FREE_POST_SPEECH_MS (400ms) vs DEFAULT_POLL_INTERVAL_MS
            // (150ms) -- the exact shape that created the bounce's blind spot.
            val cooldownMs = rng.nextLong(pollIntervalMs, 2_000L)
            // When real, continuous playback actually stops -- anywhere from
            // immediately to past the ceiling.
            val audioEndsAt = waitStartedAt + rng.nextLong(0L, ceilingMs + pollIntervalMs)

            val armAt = simulateTwoTierPoll(
                waitStartedAt, audioEndsAt, quietTailMs, ceilingMs, pollIntervalMs,
                firstPollDelayMs = HandsFreeReArmGate.firstPollDelayMs(cooldownMs, followsPlayback = true, pollIntervalMs)
            )

            val ceilingAt = waitStartedAt + ceilingMs
            if (armAt < ceilingAt) {
                // Not a defensive ceiling arm -- the gate believes it saw a
                // genuine quiet tail. Fails pre-fix: see the non-vacuity
                // test below.
                assertTrue(
                    "armed at $armAt believing a ${quietTailMs}ms quiet tail elapsed, but real audio " +
                        "didn't stop until $audioEndsAt (only ${armAt - audioEndsAt}ms of true silence) -- " +
                        "waitStartedAt=$waitStartedAt pollIntervalMs=$pollIntervalMs cooldownMs=$cooldownMs",
                    armAt - audioEndsAt >= quietTailMs - pollIntervalMs
                )
            }
        }
    }

    // Non-vacuity: sampling the first tick at the caller's wider cooldown
    // (production's behavior before the BL-826 bounce fix) fails the
    // property above, using the exact scenario from the bounce evidence --
    // proves the property exercises the fix, not passing by construction.
    @Test
    fun `sampling the first tick at the caller cooldown instead of the poll interval fails the property`() {
        val waitStartedAt = 0L
        val quietTailMs = 400L
        val ceilingMs = 4_000L
        val pollIntervalMs = 150L
        val cooldownMs = 400L
        // Real reply audio plays continuously almost all the way to the
        // pre-fix first sample at cooldownMs (400ms), then stops.
        val audioEndsAt = 390L

        val armAt = simulateTwoTierPoll(
            waitStartedAt, audioEndsAt, quietTailMs, ceilingMs, pollIntervalMs,
            firstPollDelayMs = cooldownMs // the pre-fix behavior
        )

        assertTrue(
            "expected the pre-fix schedule to arm having witnessed far less than the declared " +
                "quiet tail (armed at $armAt, audio actually stopped at $audioEndsAt)",
            armAt - audioEndsAt < quietTailMs - pollIntervalMs
        )
    }

    /** Mirrors TalkEngine.HandsFreeListenPoll.run(): first tick at
     *  [firstPollDelayMs], every later tick at decide()'s own recheckAtMs;
     *  playback is modeled as continuously active until [audioEndsAt], then
     *  permanently silent. Returns the `now` at which the gate arms. */
    private fun simulateTwoTierPoll(
        waitStartedAt: Long,
        audioEndsAt: Long,
        quietTailMs: Long,
        ceilingMs: Long,
        pollIntervalMs: Long,
        firstPollDelayMs: Long
    ): Long {
        var now = waitStartedAt + firstPollDelayMs
        var lastAudioActivityAt = waitStartedAt
        var steps = 0
        while (steps < 5_000) {
            steps++
            val playbackActive = now < audioEndsAt
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
                    pollIntervalMs = pollIntervalMs
                )
            )
            when (decision) {
                is HandsFreeReArmGate.Decision.Arm -> return now
                is HandsFreeReArmGate.Decision.NotYet -> now = decision.recheckAtMs
            }
        }
        throw IllegalStateException("gate never resolved within $steps polls")
    }

    @Test
    fun `a turn with no playback to await always arms immediately regardless of other inputs`() {
        val rng = Random(1)
        repeat(500) {
            val decision = HandsFreeReArmGate.decide(
                HandsFreeReArmGate.Input(
                    nowMs = rng.nextLong(0, 1_000_000),
                    waitStartedAt = rng.nextLong(0, 1_000_000),
                    hasPlaybackToAwait = false,
                    playbackActive = rng.nextBoolean(),
                    lastAudioActivityAt = rng.nextLong(0, 1_000_000),
                    quietTailMs = rng.nextLong(1, 2_000),
                    ceilingMs = rng.nextLong(1, 20_000)
                )
            )
            assertTrue(decision is HandsFreeReArmGate.Decision.Arm)
        }
    }
}
