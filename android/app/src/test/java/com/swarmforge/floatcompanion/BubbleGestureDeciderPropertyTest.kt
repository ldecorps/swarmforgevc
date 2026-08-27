package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.BubbleGestureDecider.Config
import com.swarmforge.floatcompanion.BubbleGestureDecider.Effect
import com.swarmforge.floatcompanion.BubbleGestureDecider.PointerEvent
import com.swarmforge.floatcompanion.BubbleGestureDecider.PointerKind
import com.swarmforge.floatcompanion.BubbleGestureDecider.State
import com.swarmforge.floatcompanion.BubbleGestureDecider.TalkPhase
import com.swarmforge.floatcompanion.BubbleGestureDecider.TimerKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-828 declared invariants (BL-654 coder-authored property tests).
 *
 * Generator reachability: sequences are built from concrete gesture shapes
 * (idle-tap hold, double-tap expand, recording send+expand, drag, teardown,
 * long-press) rather than independent random events, so every run hits the
 * arbitration states the invariants quantify over.
 */
class BubbleGestureDeciderPropertyTest {

    private val config = Config(
        touchSlopPx = 16,
        longPressTimeoutMs = 400L,
        doubleTapTimeoutMs = 300L
    )

    private val exclusiveOutcomes = setOf(
        Effect.StartMic::class,
        Effect.Send::class,
        Effect.Expand::class,
        Effect.TogglePause::class,
        Effect.Teardown::class,
        Effect.MagnetEdge::class
    )

    /**
     * Invariant 1: Every completed gesture resolves to exactly one outcome,
     * exactly once: a held tap either fires its action or is cancelled by a
     * superseding gesture, never both and never neither.
     */
    @Test
    fun `held idle tap either fires StartMic or is cancelled by expand, never both or neither`() {
        val rng = Random(82801)
        repeat(300) {
            val holdMs = rng.nextLong(0L, config.doubleTapTimeoutMs + 80L)
            val secondTap = rng.nextBoolean()
            var state = State()
            var t = rng.nextLong(0L, 50_000L)
            val first = downUp(state, TalkPhase.IDLE, t)
            state = first.state
            val pending = state.pendingIdleTapDeadlineMs
            assertTrue("idle tap must arm a held mic", pending != null)
            t += 40L

            val outcomes = mutableListOf<Effect>()
            val secondDownAt = t + holdMs
            if (secondTap && secondDownAt <= pending!!) {
                val second = downUp(state, TalkPhase.IDLE, secondDownAt)
                state = second.state
                outcomes += second.effects.filter { it::class in exclusiveOutcomes }
                val late = BubbleGestureDecider.onTimer(
                    state, TimerKind.DOUBLE_TAP_WINDOW, pending + 1L
                )
                outcomes += late.effects.filter { it::class in exclusiveOutcomes }
            } else {
                val fired = BubbleGestureDecider.onTimer(
                    state, TimerKind.DOUBLE_TAP_WINDOW, pending!!
                )
                outcomes += fired.effects.filter { it::class in exclusiveOutcomes }
            }

            val starts = outcomes.count { it is Effect.StartMic }
            val expands = outcomes.count { it is Effect.Expand }
            assertEquals(
                "held tap must resolve once (startMic=$starts expand=$expands hold=$holdMs second=$secondTap)",
                1,
                starts + expands
            )
            assertFalse("must never both start mic and expand", starts > 0 && expands > 0)
        }
    }

    /**
     * Invariant 2: Every gesture that produces drag, long-press pause/resume
     * or drag-to-teardown today produces exactly that after the change, and
     * no such gesture can resolve as a tap, an expand or a mic action.
     */
    @Test
    fun `drag long-press and teardown never resolve as tap expand or mic`() {
        val rng = Random(82802)
        repeat(300) {
            when (rng.nextInt(3)) {
                0 -> assertDragIsOnlyDrag(rng)
                1 -> assertLongPressIsOnlyPause(rng)
                else -> assertTeardownIsOnlyTeardown(rng)
            }
        }
    }

    private fun assertDragIsOnlyDrag(rng: Random) {
        var state = State()
        val t0 = rng.nextLong(0L, 10_000L)
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.DOWN, 100, 200, t0, 40, 80),
            false
        ).state
        val slop = config.touchSlopPx + 1 + rng.nextInt(40)
        val moved = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.MOVE, 100 + slop, 200, t0 + 10, 40, 80),
            false
        )
        assertTrue(moved.state.moved)
        val up = BubbleGestureDecider.onPointer(
            moved.state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.UP, 100 + slop, 200, t0 + 20, 40, 80),
            false
        )
        assertTrue(up.effects.any { it is Effect.MagnetEdge })
        assertNoTapFamily(up.effects)
    }

    private fun assertLongPressIsOnlyPause(rng: Random) {
        var state = State()
        val t0 = rng.nextLong(0L, 10_000L)
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.DOWN, 100, 200, t0, 40, 80),
            false
        ).state
        val lp = BubbleGestureDecider.onTimer(
            state, TimerKind.LONG_PRESS, t0 + config.longPressTimeoutMs
        )
        assertTrue(lp.effects.any { it is Effect.TogglePause })
        assertNoTapFamily(lp.effects)
        val up = BubbleGestureDecider.onPointer(
            lp.state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.UP, 100, 200, t0 + config.longPressTimeoutMs + 10, 40, 80),
            false
        )
        assertNoTapFamily(up.effects)
        assertFalse(up.effects.any { it is Effect.MagnetEdge || it is Effect.Teardown })
    }

    private fun assertTeardownIsOnlyTeardown(rng: Random) {
        var state = State()
        val t0 = rng.nextLong(0L, 10_000L)
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.DOWN, 100, 200, t0, 40, 80),
            false
        ).state
        val slop = config.touchSlopPx + 1 + rng.nextInt(40)
        state = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.MOVE, 100 + slop, 200, t0 + 10, 40, 80),
            true
        ).state
        val up = BubbleGestureDecider.onPointer(
            state, config, TalkPhase.IDLE,
            PointerEvent(PointerKind.UP, 100 + slop, 200, t0 + 20, 40, 80),
            true
        )
        assertTrue(up.effects.any { it is Effect.Teardown })
        assertNoTapFamily(up.effects)
        assertFalse(up.effects.any { it is Effect.MagnetEdge })
    }

    private fun assertNoTapFamily(effects: List<Effect>) {
        assertTrue(
            effects.none {
                it is Effect.StartMic || it is Effect.Send || it is Effect.Expand
            }
        )
    }

    private fun downUp(
        state: State,
        phase: TalkPhase,
        tDown: Long
    ): BubbleGestureDecider.Result {
        val afterDown = BubbleGestureDecider.onPointer(
            state, config, phase,
            PointerEvent(PointerKind.DOWN, 100, 200, tDown, 40, 80),
            false
        )
        return BubbleGestureDecider.onPointer(
            afterDown.state, config, phase,
            PointerEvent(PointerKind.UP, 100, 200, tDown + 30L, 40, 80),
            false
        )
    }
}
