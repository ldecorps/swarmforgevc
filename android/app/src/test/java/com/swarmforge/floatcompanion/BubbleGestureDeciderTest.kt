package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.BubbleGestureDecider.Config
import com.swarmforge.floatcompanion.BubbleGestureDecider.Effect
import com.swarmforge.floatcompanion.BubbleGestureDecider.PointerEvent
import com.swarmforge.floatcompanion.BubbleGestureDecider.PointerKind
import com.swarmforge.floatcompanion.BubbleGestureDecider.State
import com.swarmforge.floatcompanion.BubbleGestureDecider.TalkPhase
import com.swarmforge.floatcompanion.BubbleGestureDecider.TimerAction
import com.swarmforge.floatcompanion.BubbleGestureDecider.TimerKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-828: JVM unit coverage for collapsed-bubble gesture arbitration.
 * Timestamps are advanced explicitly — never sleep for the double-tap window.
 */
class BubbleGestureDeciderTest {

    private val config = Config(
        touchSlopPx = 16,
        longPressTimeoutMs = 500L,
        doubleTapTimeoutMs = 300L
    )

    private fun down(t: Long, x: Int = 100, y: Int = 200, bx: Int = 40, by: Int = 80) =
        PointerEvent(PointerKind.DOWN, x, y, t, bx, by)

    private fun move(t: Long, x: Int, y: Int, bx: Int = 40, by: Int = 80) =
        PointerEvent(PointerKind.MOVE, x, y, t, bx, by)

    private fun up(t: Long, x: Int = 100, y: Int = 200, bx: Int = 40, by: Int = 80) =
        PointerEvent(PointerKind.UP, x, y, t, bx, by)

    private fun tapUp(
        state: State,
        phase: TalkPhase,
        tDown: Long,
        tUp: Long = tDown + 50
    ): BubbleGestureDecider.Result {
        val afterDown = BubbleGestureDecider.onPointer(state, config, phase, down(tDown), false)
        return BubbleGestureDecider.onPointer(afterDown.state, config, phase, up(tUp), false)
    }

    // BL-828 decision: holding an idle tap until the double-tap window has expired
    @Test
    fun `holding an idle tap until the double-tap window has expired`() {
        val tUp = 50L
        val afterTap = tapUp(State(), TalkPhase.IDLE, tDown = 0L, tUp = tUp)
        val deadline = tUp + config.doubleTapTimeoutMs
        assertTrue(afterTap.effects.none { it is Effect.StartMic || it is Effect.Expand })
        assertEquals(deadline, afterTap.state.pendingIdleTapDeadlineMs)
        assertTrue(
            afterTap.timers.any {
                it is TimerAction.Arm && it.kind == TimerKind.DOUBLE_TAP_WINDOW && it.fireAtMs == deadline
            }
        )
        // Still inside the window — mic must not fire yet.
        val mid = BubbleGestureDecider.onTimer(
            afterTap.state,
            TimerKind.DOUBLE_TAP_WINDOW,
            nowMs = deadline - 1L
        )
        assertTrue(mid.effects.none { it is Effect.StartMic })
        assertEquals(deadline, mid.state.pendingIdleTapDeadlineMs)
    }

    // BL-828 decision: starting the mic when the double-tap window expires with no second tap
    @Test
    fun `starting the mic when the double-tap window expires with no second tap`() {
        val tUp = 50L
        val afterTap = tapUp(State(), TalkPhase.IDLE, tDown = 0L, tUp = tUp)
        val deadline = tUp + config.doubleTapTimeoutMs
        val fired = BubbleGestureDecider.onTimer(
            afterTap.state,
            TimerKind.DOUBLE_TAP_WINDOW,
            nowMs = deadline
        )
        assertTrue(fired.effects.any { it is Effect.StartMic })
        assertTrue(fired.effects.none { it is Effect.Expand })
        assertNull(fired.state.pendingIdleTapDeadlineMs)
    }

    // BL-828 decision: expanding the panel when a second tap arrives inside the window
    @Test
    fun `expanding the panel when a second tap arrives inside the window`() {
        val afterFirst = tapUp(State(), TalkPhase.IDLE, tDown = 0L)
        val afterSecond = tapUp(afterFirst.state, TalkPhase.IDLE, tDown = 100L, tUp = 140L)
        assertTrue(afterSecond.effects.any { it is Effect.Expand })
        assertTrue(afterSecond.effects.none { it is Effect.StartMic })
    }

    // BL-828 decision: cancelling the held mic start when the expand fires
    @Test
    fun `cancelling the held mic start when the expand fires`() {
        val afterFirst = tapUp(State(), TalkPhase.IDLE, tDown = 0L, tUp = 50L)
        val deadline = 50L + config.doubleTapTimeoutMs
        assertEquals(deadline, afterFirst.state.pendingIdleTapDeadlineMs)
        val afterSecond = tapUp(afterFirst.state, TalkPhase.IDLE, tDown = 100L, tUp = 140L)
        assertNull(afterSecond.state.pendingIdleTapDeadlineMs)
        assertTrue(
            afterSecond.timers.any {
                it is TimerAction.Cancel && it.kind == TimerKind.DOUBLE_TAP_WINDOW
            }
        )
        val lateTimer = BubbleGestureDecider.onTimer(
            afterSecond.state,
            TimerKind.DOUBLE_TAP_WINDOW,
            nowMs = deadline
        )
        assertTrue(
            "held mic must stay cancelled after expand",
            lateTimer.effects.none { it is Effect.StartMic }
        )
    }

    // BL-828 decision: sending immediately when a tap lands while recording
    @Test
    fun `sending immediately when a tap lands while recording`() {
        val tUp = 50L
        val afterTap = tapUp(State(), TalkPhase.RECORDING, tDown = 0L, tUp = tUp)
        assertTrue(afterTap.effects.any { it is Effect.Send })
        assertTrue(afterTap.effects.none { it is Effect.StartMic })
        assertTrue(afterTap.effects.none { it is Effect.Expand })
        assertNull(afterTap.state.pendingIdleTapDeadlineMs)
        assertEquals(tUp + config.doubleTapTimeoutMs, afterTap.state.expandWindowDeadlineMs)
    }

    // BL-828 decision: expanding when a second tap follows a send inside the window
    @Test
    fun `expanding when a second tap follows a send inside the window`() {
        val afterSend = tapUp(State(), TalkPhase.RECORDING, tDown = 0L)
        assertTrue(afterSend.effects.any { it is Effect.Send })
        // Phase may still look RECORDING to the next pointer if the engine
        // has not yet published; expand must still fire and must not Send again
        // from the second tap when expandCandidate is set.
        val afterSecond = tapUp(afterSend.state, TalkPhase.IDLE, tDown = 80L, tUp = 120L)
        assertTrue(afterSecond.effects.any { it is Effect.Expand })
        assertTrue(afterSecond.effects.none { it is Effect.Send })
        assertTrue(afterSecond.effects.none { it is Effect.StartMic })
    }

    // BL-828 decision: resolving a pointer that exceeds touch slop as a drag and never as a tap
    @Test
    fun `resolving a pointer that exceeds touch slop as a drag and never as a tap`() {
        var state = State()
        val d = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE, down(0L, x = 100, y = 200), false
        )
        state = d.state
        val m = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            move(10L, x = 100 + config.touchSlopPx + 1, y = 200),
            false
        )
        assertTrue(m.state.moved)
        assertTrue(m.effects.any { it is Effect.ShowRemoveZone })
        assertTrue(m.effects.any { it is Effect.MoveBubble })
        val u = BubbleGestureDecider.onPointer(
            m.state, config, TalkPhase.IDLE,
            up(20L, x = 100 + config.touchSlopPx + 1, y = 200),
            overRemoveZone = false
        )
        assertTrue(u.effects.any { it is Effect.MagnetEdge })
        assertTrue(
            u.effects.none {
                it is Effect.StartMic || it is Effect.Send || it is Effect.Expand
            }
        )
        assertNull(u.state.pendingIdleTapDeadlineMs)
    }

    // BL-828 decision: leaving long-press pause and drag-to-teardown outcomes unchanged
    @Test
    fun `leaving long-press pause and drag-to-teardown outcomes unchanged`() {
        // Long-press
        val afterDown = BubbleGestureDecider.onPointer(
            State(), config, TalkPhase.IDLE, down(0L), false
        )
        val longPress = BubbleGestureDecider.onTimer(
            afterDown.state, TimerKind.LONG_PRESS, nowMs = 500L
        )
        assertTrue(longPress.effects.any { it is Effect.TogglePause })
        assertTrue(longPress.effects.any { it is Effect.LongPressHaptic })
        assertTrue(
            longPress.effects.none {
                it is Effect.StartMic || it is Effect.Send || it is Effect.Expand
            }
        )
        val afterLongUp = BubbleGestureDecider.onPointer(
            longPress.state, config, TalkPhase.IDLE, up(600L), false
        )
        assertTrue(
            afterLongUp.effects.none {
                it is Effect.StartMic || it is Effect.Send || it is Effect.Expand ||
                    it is Effect.Teardown || it is Effect.MagnetEdge
            }
        )

        // Drag-to-teardown
        var state = State()
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE, down(0L, x = 100, y = 200), false
        ).state
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            move(10L, x = 100 + config.touchSlopPx + 5, y = 200),
            overRemoveZone = true
        ).state
        val teardown = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            up(20L, x = 100 + config.touchSlopPx + 5, y = 200),
            overRemoveZone = true
        )
        assertTrue(teardown.effects.any { it is Effect.Teardown })
        assertTrue(
            teardown.effects.none {
                it is Effect.StartMic || it is Effect.Send || it is Effect.Expand ||
                    it is Effect.MagnetEdge
            }
        )
    }

    @Test
    fun `a drag after the first idle tap cancels the held mic and does not expand`() {
        val afterFirst = tapUp(State(), TalkPhase.IDLE, tDown = 0L)
        var state = afterFirst.state
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE, down(50L), false
        ).state
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            move(60L, x = 100 + config.touchSlopPx + 1, y = 200),
            false
        ).state
        val u = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            up(70L, x = 100 + config.touchSlopPx + 1, y = 200),
            false
        )
        assertNull(u.state.pendingIdleTapDeadlineMs)
        assertFalse(u.state.expandCandidate)
        assertTrue(u.effects.none { it is Effect.Expand || it is Effect.StartMic })
    }
}
