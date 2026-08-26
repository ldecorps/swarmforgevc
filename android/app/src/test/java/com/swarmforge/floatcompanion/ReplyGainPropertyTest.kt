package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import kotlin.random.Random

/**
 * BL-765 volume-06 (BL-654 coder-authored property test): "Music volume no
 * longer governs the reply voice." Encoded against
 * [ReplyGain.independentOfMusicVolume]: for ANY music volume percent 0..100,
 * the reply gain is always full (1f) — the function's output never varies
 * with its input.
 */
class ReplyGainPropertyTest {

    @Test
    fun `reply gain is always full, for any music volume percent`() {
        val rng = Random(20260814005L)
        repeat(500) {
            val musicVolumePercent = rng.nextInt(0, 101)

            val gain = ReplyGain.independentOfMusicVolume(musicVolumePercent)

            assertEquals("musicVolumePercent=$musicVolumePercent", 1f, gain)
        }
    }

    @Test
    fun `a naive reducer that scales gain with music volume would fail this property`() {
        // Non-vacuity companion: a plausible-but-wrong reducer might mirror
        // the (pre-BL-765) coupling where one slider governed both.
        fun naiveGain(musicVolumePercent: Int): Float = musicVolumePercent / 100f

        val naiveResult = naiveGain(20)
        assertNotEquals("the naive reducer wrongly scales reply gain with music volume", 1f, naiveResult)

        val realResult = ReplyGain.independentOfMusicVolume(20)
        assertEquals("the real reducer must ignore music volume entirely", 1f, realResult)
    }
}
