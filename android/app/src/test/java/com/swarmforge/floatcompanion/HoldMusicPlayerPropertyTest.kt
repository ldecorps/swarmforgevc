package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-765 invariant 1 (BL-654 coder-authored property test): "Bubble stays
 * usable when remote config or catalog is missing, unreachable, or
 * malformed: it falls back to bundled defaults and never renders an empty
 * or broken surface." Encoded against [HoldMusicPlayer.chooseEffectiveSongs]
 * — the pure decision behind [HoldMusicPlayer.SONGS] — for an arbitrary
 * remote result (null, empty, or a real song list of any size): the
 * effective catalog is never empty, and is exactly the bundled defaults
 * whenever the remote result was missing or empty.
 */
class HoldMusicPlayerPropertyTest {

    private fun randomSong(rng: Random): HoldMusicPlayer.Song =
        HoldMusicPlayer.Song(
            name = "song-${rng.nextInt(100_000)}",
            bpm = rng.nextInt(40, 220),
            steps = Array(rng.nextInt(1, 6)) {
                intArrayOf(rng.nextInt(0, 90), rng.nextInt(0, 90), rng.nextInt(0, 90), rng.nextInt(0, 3))
            }
        )

    @Test
    fun `a missing or empty remote catalog falls back to exactly the bundled defaults`() {
        val bundled = HoldMusicPlayer.chooseEffectiveSongs(null)
        assertTrue("bundled defaults must never be empty", bundled.isNotEmpty())
        assertEquals(bundled, HoldMusicPlayer.chooseEffectiveSongs(null))
        assertEquals(bundled, HoldMusicPlayer.chooseEffectiveSongs(emptyList()))
    }

    @Test
    fun `the effective catalog is never empty, for any remote result`() {
        val rng = Random(20260814766L)
        repeat(1_000) {
            val remote = when (rng.nextInt(3)) {
                0 -> null
                1 -> emptyList()
                else -> List(rng.nextInt(1, 10)) { randomSong(rng) }
            }

            val effective = HoldMusicPlayer.chooseEffectiveSongs(remote)

            assertTrue("effective catalog must never be empty for remote=$remote", effective.isNotEmpty())
        }
    }

    @Test
    fun `a non-empty remote catalog is used verbatim, never mixed with bundled defaults`() {
        val rng = Random(20260814002L)
        repeat(500) {
            val remote = List(rng.nextInt(1, 10)) { randomSong(rng) }

            val effective = HoldMusicPlayer.chooseEffectiveSongs(remote)

            assertEquals(remote, effective)
        }
    }

    @Test
    fun `a naive reducer that treats null and empty differently would fail this property`() {
        // Non-vacuity companion: a plausible-but-wrong reducer might fall
        // back to defaults on a null remote result but return the (empty)
        // list verbatim on an explicitly-empty one, leaving an empty
        // playlist reachable. Demonstrate that failure, then confirm the
        // real reducer treats both the same way.
        fun naiveChoose(remote: List<HoldMusicPlayer.Song>?): List<HoldMusicPlayer.Song> =
            remote ?: listOf(randomSong(Random(1)))

        val naiveResult = naiveChoose(emptyList())
        assertTrue("the naive reducer wrongly returns an empty catalog for an empty remote result", naiveResult.isEmpty())

        val realResult = HoldMusicPlayer.chooseEffectiveSongs(emptyList())
        assertFalse("the real reducer must never return an empty catalog", realResult.isEmpty())
    }
}
