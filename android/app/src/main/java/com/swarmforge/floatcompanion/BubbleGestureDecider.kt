package com.swarmforge.floatcompanion

/**
 * BL-828: pure collapsed-bubble gesture arbitration.
 *
 * No android.* type appears in this file's own signatures (constitution:
 * Testability Boundary — Bubble). The caller converts MotionEvent, posts
 * timers from [TimerAction] values, and performs [Effect]s against the
 * window manager / TalkEngine / panel.
 *
 * Timestamps are caller-supplied — never read from a wall clock here.
 */
object BubbleGestureDecider {

    enum class PointerKind { DOWN, MOVE, UP, CANCEL }

    /** Talk phase as the collapsed bubble routes gesture outcomes. */
    enum class TalkPhase { IDLE, RECORDING }

    data class Config(
        val touchSlopPx: Int,
        val longPressTimeoutMs: Long,
        val doubleTapTimeoutMs: Long
    )

    data class PointerEvent(
        val kind: PointerKind,
        val x: Int,
        val y: Int,
        val timestampMs: Long,
        val bubbleX: Int = 0,
        val bubbleY: Int = 0
    )

    enum class TimerKind { LONG_PRESS, DOUBLE_TAP_WINDOW }

    sealed class TimerAction {
        data class Arm(val kind: TimerKind, val fireAtMs: Long) : TimerAction()
        data class Cancel(val kind: TimerKind) : TimerAction()
    }

    sealed class Effect {
        data object SetFocusable : Effect()
        data object ClearFocusable : Effect()
        data object ShowRemoveZone : Effect()
        data object HideRemoveZone : Effect()
        data class MoveBubble(val x: Int, val y: Int) : Effect()
        data class SetRemoveHot(val hot: Boolean) : Effect()
        data object LongPressHaptic : Effect()
        data object TogglePause : Effect()
        data object MagnetEdge : Effect()
        data object Teardown : Effect()
        data object Expand : Effect()
        data object StartMic : Effect()
        data object Send : Effect()
    }

    data class State(
        val downX: Int = 0,
        val downY: Int = 0,
        val startBubbleX: Int = 0,
        val startBubbleY: Int = 0,
        val moved: Boolean = false,
        val longPressFired: Boolean = false,
        val pointerDown: Boolean = false,
        val pendingIdleTapDeadlineMs: Long? = null,
        val expandWindowDeadlineMs: Long? = null,
        val expandCandidate: Boolean = false
    )

    data class Result(
        val state: State,
        val effects: List<Effect> = emptyList(),
        val timers: List<TimerAction> = emptyList()
    )

    fun onPointer(
        state: State,
        config: Config,
        phase: TalkPhase,
        event: PointerEvent,
        overRemoveZone: Boolean
    ): Result = when (event.kind) {
        PointerKind.DOWN -> onDown(state, config, event)
        PointerKind.MOVE -> onMove(state, config, event, overRemoveZone)
        PointerKind.UP -> onUp(state, config, phase, event, overRemoveZone)
        PointerKind.CANCEL -> onCancel(state)
    }

    fun onTimer(state: State, kind: TimerKind, nowMs: Long): Result = when (kind) {
        TimerKind.LONG_PRESS -> onLongPressTimer(state, nowMs)
        TimerKind.DOUBLE_TAP_WINDOW -> onDoubleTapTimer(state, nowMs)
    }

    private fun onDown(state: State, config: Config, event: PointerEvent): Result {
        val withinExpand = withinDeadline(state.expandWindowDeadlineMs, event.timestampMs)
        val withinPending = withinDeadline(state.pendingIdleTapDeadlineMs, event.timestampMs)
        val expandCandidate = withinExpand || withinPending
        val timers = mutableListOf<TimerAction>(
            TimerAction.Cancel(TimerKind.LONG_PRESS),
            TimerAction.Arm(
                TimerKind.LONG_PRESS,
                event.timestampMs + config.longPressTimeoutMs
            )
        )
        if (withinPending) {
            timers += TimerAction.Cancel(TimerKind.DOUBLE_TAP_WINDOW)
        }
        return Result(
            state = state.copy(
                downX = event.x,
                downY = event.y,
                startBubbleX = event.bubbleX,
                startBubbleY = event.bubbleY,
                moved = false,
                longPressFired = false,
                pointerDown = true,
                pendingIdleTapDeadlineMs = if (withinPending) null else state.pendingIdleTapDeadlineMs,
                expandWindowDeadlineMs = if (withinExpand) null else state.expandWindowDeadlineMs,
                expandCandidate = expandCandidate
            ),
            effects = listOf(Effect.SetFocusable),
            timers = timers
        )
    }

    private fun onMove(
        state: State,
        config: Config,
        event: PointerEvent,
        overRemoveZone: Boolean
    ): Result {
        if (!state.pointerDown) return Result(state)
        if (state.longPressFired) return Result(state)
        val dx = event.x - state.downX
        val dy = event.y - state.downY
        val pastSlop = kotlin.math.abs(dx) > config.touchSlopPx ||
            kotlin.math.abs(dy) > config.touchSlopPx
        if (!state.moved && !pastSlop) return Result(state)
        val effects = mutableListOf<Effect>()
        val timers = mutableListOf<TimerAction>()
        var next = state
        if (!state.moved) {
            timers += TimerAction.Cancel(TimerKind.LONG_PRESS)
            if (state.expandCandidate || state.pendingIdleTapDeadlineMs != null) {
                timers += TimerAction.Cancel(TimerKind.DOUBLE_TAP_WINDOW)
            }
            effects += Effect.ShowRemoveZone
            next = next.copy(
                moved = true,
                expandCandidate = false,
                pendingIdleTapDeadlineMs = null,
                expandWindowDeadlineMs = null
            )
        }
        effects += Effect.MoveBubble(next.startBubbleX + dx, next.startBubbleY + dy)
        effects += Effect.SetRemoveHot(overRemoveZone)
        return Result(next, effects, timers)
    }

    private fun onUp(
        state: State,
        config: Config,
        phase: TalkPhase,
        event: PointerEvent,
        overRemoveZone: Boolean
    ): Result {
        val timers = mutableListOf<TimerAction>(TimerAction.Cancel(TimerKind.LONG_PRESS))
        val base = state.copy(pointerDown = false)
        return when {
            state.longPressFired -> Result(
                base.copy(expandCandidate = false),
                listOf(Effect.HideRemoveZone, Effect.ClearFocusable),
                timers
            )
            !state.moved -> onTapUp(base, config, phase, event.timestampMs, timers)
            overRemoveZone -> Result(
                clearWindows(base),
                listOf(Effect.ClearFocusable, Effect.HideRemoveZone, Effect.Teardown),
                timers + cancelDoubleTapIfArmed(state)
            )
            else -> Result(
                clearWindows(base),
                listOf(Effect.HideRemoveZone, Effect.MagnetEdge, Effect.ClearFocusable),
                timers + cancelDoubleTapIfArmed(state)
            )
        }
    }

    private fun onTapUp(
        state: State,
        config: Config,
        phase: TalkPhase,
        nowMs: Long,
        timers: MutableList<TimerAction>
    ): Result {
        if (state.expandCandidate) {
            timers += TimerAction.Cancel(TimerKind.DOUBLE_TAP_WINDOW)
            return Result(
                clearWindows(state).copy(expandCandidate = false),
                listOf(Effect.HideRemoveZone, Effect.Expand),
                timers
            )
        }
        if (phase == TalkPhase.RECORDING) {
            val deadline = nowMs + config.doubleTapTimeoutMs
            timers += TimerAction.Arm(TimerKind.DOUBLE_TAP_WINDOW, deadline)
            return Result(
                state.copy(
                    expandCandidate = false,
                    pendingIdleTapDeadlineMs = null,
                    expandWindowDeadlineMs = deadline
                ),
                listOf(Effect.HideRemoveZone, Effect.Send),
                timers
            )
        }
        val deadline = nowMs + config.doubleTapTimeoutMs
        timers += TimerAction.Arm(TimerKind.DOUBLE_TAP_WINDOW, deadline)
        return Result(
            state.copy(
                expandCandidate = false,
                pendingIdleTapDeadlineMs = deadline,
                expandWindowDeadlineMs = null
            ),
            listOf(Effect.HideRemoveZone),
            timers
        )
    }

    private fun onCancel(state: State): Result = Result(
        clearWindows(state.copy(pointerDown = false, expandCandidate = false)),
        listOf(Effect.HideRemoveZone, Effect.ClearFocusable),
        listOf(
            TimerAction.Cancel(TimerKind.LONG_PRESS),
            TimerAction.Cancel(TimerKind.DOUBLE_TAP_WINDOW)
        )
    )

    private fun onLongPressTimer(state: State, nowMs: Long): Result {
        if (!state.pointerDown || state.moved || state.longPressFired) return Result(state)
        // Defensive: ignore a stale long-press if the caller fires early.
        if (nowMs < 0L) return Result(state)
        return Result(
            state.copy(longPressFired = true, expandCandidate = false),
            listOf(Effect.LongPressHaptic, Effect.TogglePause)
        )
    }

    private fun onDoubleTapTimer(state: State, nowMs: Long): Result {
        val pending = state.pendingIdleTapDeadlineMs
        if (pending != null) {
            if (nowMs < pending) return Result(state)
            return Result(
                state.copy(pendingIdleTapDeadlineMs = null, expandWindowDeadlineMs = null),
                listOf(Effect.StartMic)
            )
        }
        val expand = state.expandWindowDeadlineMs ?: return Result(state)
        if (nowMs < expand) return Result(state)
        return Result(state.copy(expandWindowDeadlineMs = null))
    }

    private fun withinDeadline(deadlineMs: Long?, nowMs: Long): Boolean =
        deadlineMs != null && nowMs <= deadlineMs

    private fun clearWindows(state: State): State = state.copy(
        pendingIdleTapDeadlineMs = null,
        expandWindowDeadlineMs = null,
        expandCandidate = false
    )

    private fun cancelDoubleTapIfArmed(state: State): List<TimerAction> =
        if (state.pendingIdleTapDeadlineMs != null ||
            state.expandWindowDeadlineMs != null ||
            state.expandCandidate
        ) {
            listOf(TimerAction.Cancel(TimerKind.DOUBLE_TAP_WINDOW))
        } else {
            emptyList()
        }
}
