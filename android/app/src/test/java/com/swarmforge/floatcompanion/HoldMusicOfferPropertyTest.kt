package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import kotlin.random.Random

/**
 * BL-765 remote-config-03 (BL-654 coder-authored property test): "Disabling
 * a capability remotely removes it without a new APK" — encoded against
 * [HoldMusicOffer.shouldOffer]: for ANY combination of the user's own
 * on/off toggle and the paused state, a remotely-disabled holdMusic
 * capability always wins — hold music is never offered.
 */
class HoldMusicOfferPropertyTest {

    @Test
    fun `a remotely-disabled capability is never offered, regardless of the user toggle or pause state`() {
        val rng = Random(20260814003L)
        repeat(1_000) {
            val holdMusicOn = rng.nextBoolean()
            val pausedAll = rng.nextBoolean()

            val offered = HoldMusicOffer.shouldOffer(holdMusicOn, pausedAll, capabilityEnabled = false)

            assertFalse(
                "holdMusicOn=$holdMusicOn pausedAll=$pausedAll must never offer hold music when the capability is disabled",
                offered
            )
        }
    }

    @Test
    fun `hold music is offered exactly when the toggle is on, not paused, and the capability is enabled`() {
        val rng = Random(20260814004L)
        repeat(1_000) {
            val holdMusicOn = rng.nextBoolean()
            val pausedAll = rng.nextBoolean()
            val capabilityEnabled = rng.nextBoolean()

            val offered = HoldMusicOffer.shouldOffer(holdMusicOn, pausedAll, capabilityEnabled)

            assertEquals(
                "holdMusicOn=$holdMusicOn pausedAll=$pausedAll capabilityEnabled=$capabilityEnabled",
                holdMusicOn && !pausedAll && capabilityEnabled,
                offered
            )
        }
    }

    @Test
    fun `a naive reducer that ignores the remote capability would fail this property`() {
        // Non-vacuity companion: a plausible-but-wrong reducer might only
        // check the user's own toggle and the pause state, missing the
        // remote-disable channel entirely.
        fun naiveOffer(holdMusicOn: Boolean, pausedAll: Boolean): Boolean = holdMusicOn && !pausedAll

        val naiveResult = naiveOffer(holdMusicOn = true, pausedAll = false)
        assertEquals("the naive reducer wrongly offers hold music with no remote check", true, naiveResult)

        val realResult = HoldMusicOffer.shouldOffer(holdMusicOn = true, pausedAll = false, capabilityEnabled = false)
        assertFalse("the real reducer must respect a remote disable", realResult)
    }
}
