package com.swarmforge.floatcompanion

/**
 * BL-864: pure decision logic behind the Bubble Settings Local/OpenAI
 * voice-engine selector (constitution invariants, coder-authored per
 * BL-654). No android.* type appears in this file's own signatures, so it
 * runs under the JVM unit suite with no device or emulator (Testability
 * Boundary — Bubble). [TalkPanelActivity.showSettingsDialog] owns all
 * android.* state (the dialog views, [BridgeClient] network calls) and
 * reduces bridge responses to these plain inputs before calling in.
 */
object VoiceEngineSelector {

    enum class Engine { LOCAL, OPENAI }

    data class EngineOption(val engine: Engine, val disabled: Boolean, val reason: String? = null)

    /** What the Settings dialog renders for the voice-engine section. */
    data class UiState(
        val visible: Boolean,
        val selected: Engine?,
        val options: List<EngineOption>,
        val message: String? = null
    )

    private val HIDDEN = UiState(visible = false, selected = null, options = emptyList())

    data class ServiceabilityInput(val serviceable: Boolean, val reason: String? = null)

    /** What a fresh status query from the bridge reports. */
    data class StatusInput(
        val enabled: Boolean,
        val engineInUse: Engine,
        val local: ServiceabilityInput,
        val openai: ServiceabilityInput
    )

    /**
     * The dialog-open state: opens on the truth (the engine the bridge
     * reports as actually in use, never a locally cached guess), and offers
     * an unserviceable engine disabled with its reason instead of a choice
     * that will fail. When the capability is off, the selector is hidden
     * entirely — the other talk settings are untouched by this state.
     */
    fun stateForStatus(input: StatusInput): UiState {
        if (!input.enabled) return HIDDEN
        return UiState(
            visible = true,
            selected = input.engineInUse,
            options = listOf(
                EngineOption(Engine.LOCAL, disabled = !input.local.serviceable, reason = input.local.reason),
                EngineOption(Engine.OPENAI, disabled = !input.openai.serviceable, reason = input.openai.reason)
            )
        )
    }

    /** What the bridge reported after a tap asked it to store an engine. */
    sealed class ChoiceOutcome {
        data class Accepted(val engine: Engine) : ChoiceOutcome()
        data class Refused(val reason: String) : ChoiceOutcome()
        data class Unreachable(val message: String) : ChoiceOutcome()
    }

    /**
     * Invariant (BL-864, BL-654): the selector never shows an engine as
     * selected that the bridge has not accepted — [selected] only ever
     * changes on [ChoiceOutcome.Accepted]. A refusal or an unreachable
     * bridge shows its message and leaves the previously-selected (working)
     * engine exactly as it was, never the tapped one.
     */
    fun stateAfterChoice(previous: UiState, outcome: ChoiceOutcome): UiState = when (outcome) {
        is ChoiceOutcome.Accepted -> previous.copy(selected = outcome.engine, message = null)
        is ChoiceOutcome.Refused -> previous.copy(message = outcome.reason)
        is ChoiceOutcome.Unreachable -> previous.copy(message = outcome.message)
    }
}
