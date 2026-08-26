package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-763: maps specs/features/BL-763-bubble-tunnel-hand-fixes-swarm-stamp.feature
 * scenario "session-01" onto [BridgeBounceSession], per the Testability
 * Boundary — Bubble (the decision belongs in a pure Kotlin function).
 */
class BridgeBounceSessionTest {

    // BL-763 session-01: Bubble opens one new session when the bridge
    // instance changes and bounce-auto-session-reset is enabled.
    @Test
    fun `a changed instanceId with auto-reset enabled resets the session`() {
        val decision = BridgeBounceSession.decide(
            lastKnownInstanceId = "instance-A",
            freshInstanceId = "instance-B",
            autoResetEnabled = true
        )
        assertTrue(decision.shouldResetSession)
        assertEquals("instance-B", decision.nextKnownInstanceId)
    }

    @Test
    fun `a changed instanceId with auto-reset disabled does not reset the session`() {
        val decision = BridgeBounceSession.decide(
            lastKnownInstanceId = "instance-A",
            freshInstanceId = "instance-B",
            autoResetEnabled = false
        )
        assertFalse(decision.shouldResetSession)
        // The stored id still advances so a later enable doesn't retroactively fire.
        assertEquals("instance-B", decision.nextKnownInstanceId)
    }

    // BL-763 session-01: "it does not call new-session again while the
    // instanceId stays the same".
    @Test
    fun `an unchanged instanceId never resets the session, even with auto-reset enabled`() {
        val decision = BridgeBounceSession.decide(
            lastKnownInstanceId = "instance-A",
            freshInstanceId = "instance-A",
            autoResetEnabled = true
        )
        assertFalse(decision.shouldResetSession)
        assertEquals("instance-A", decision.nextKnownInstanceId)
    }

    @Test
    fun `a first-ever sync (no prior stored instanceId) records a baseline without resetting`() {
        val decision = BridgeBounceSession.decide(
            lastKnownInstanceId = "",
            freshInstanceId = "instance-A",
            autoResetEnabled = true
        )
        assertFalse(decision.shouldResetSession)
        assertEquals("instance-A", decision.nextKnownInstanceId)
    }

    @Test
    fun `a failed meta fetch (blank fresh id) never resets and never overwrites the stored id`() {
        val decision = BridgeBounceSession.decide(
            lastKnownInstanceId = "instance-A",
            freshInstanceId = "",
            autoResetEnabled = true
        )
        assertFalse(decision.shouldResetSession)
        assertEquals("instance-A", decision.nextKnownInstanceId)
    }
}
