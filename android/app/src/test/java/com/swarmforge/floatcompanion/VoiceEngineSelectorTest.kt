package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-864: maps every scenario in
 * specs/features/BL-864-bubble-settings-voice-engine-selector.feature onto
 * [VoiceEngineSelector], per the Testability Boundary — Bubble (the
 * selector's STATE decisions belong in a pure Kotlin function).
 */
class VoiceEngineSelectorTest {

    private val serviceable = VoiceEngineSelector.ServiceabilityInput(serviceable = true)

    // BL-864 selector-shows-the-engine-in-use-01
    @Test
    fun `selector opens on the engine the bridge reports as in use - local`() {
        val state = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        )
        assertTrue(state.visible)
        assertEquals(VoiceEngineSelector.Engine.LOCAL, state.selected)
    }

    // BL-864 selector-shows-the-engine-in-use-01
    @Test
    fun `selector opens on the engine the bridge reports as in use - openai`() {
        val state = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.OPENAI,
                local = serviceable,
                openai = serviceable
            )
        )
        assertEquals(VoiceEngineSelector.Engine.OPENAI, state.selected)
    }

    // BL-864 refusal-shows-a-reason-and-does-not-stick-03
    @Test
    fun `a refused choice shows the reason and leaves the working engine selected`() {
        val opened = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        )
        val afterRefusal = VoiceEngineSelector.stateAfterChoice(
            opened,
            VoiceEngineSelector.ChoiceOutcome.Refused("openai audio engine unavailable: the OpenAI key is missing")
        )
        assertEquals(VoiceEngineSelector.Engine.LOCAL, afterRefusal.selected)
        assertEquals("openai audio engine unavailable: the OpenAI key is missing", afterRefusal.message)
    }

    // BL-864 refusal-shows-a-reason-and-does-not-stick-03 vs unserviceable-engine-is-offered-disabled-04:
    // a transient write-time refusal must not itself mark the option disabled
    // (that is a distinct, separately-reported moment — see the next test).
    @Test
    fun `a refused choice does not mark the tapped option disabled`() {
        val opened = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        )
        val afterRefusal = VoiceEngineSelector.stateAfterChoice(
            opened,
            VoiceEngineSelector.ChoiceOutcome.Refused("missing key")
        )
        val openaiOption = afterRefusal.options.first { it.engine == VoiceEngineSelector.Engine.OPENAI }
        assertTrue("a refusal is transient, not a serviceability verdict", !openaiOption.disabled)
    }

    // BL-864 unserviceable-engine-is-offered-disabled-04
    @Test
    fun `an engine the host cannot serve is offered disabled, with its reason`() {
        val state = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = VoiceEngineSelector.ServiceabilityInput(
                    serviceable = false,
                    reason = "openai audio engine unavailable: the OpenAI key is missing"
                )
            )
        )
        val openaiOption = state.options.first { it.engine == VoiceEngineSelector.Engine.OPENAI }
        assertTrue(openaiOption.disabled)
        assertEquals("openai audio engine unavailable: the OpenAI key is missing", openaiOption.reason)
    }

    // BL-864 choice-survives-relaunch-05: a relaunch just re-opens the
    // dialog, which re-queries the bridge — the durable preference (BL-863)
    // is what the bridge reports back as engineInUse, same as scenario 01.
    @Test
    fun `the chosen engine survives a relaunch because status always reflects the durable preference`() {
        val state = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.OPENAI,
                local = serviceable,
                openai = serviceable
            )
        )
        assertEquals(VoiceEngineSelector.Engine.OPENAI, state.selected)
    }

    // BL-864 selector-hidden-when-capability-off-06
    @Test
    fun `with the capability disabled the selector is hidden`() {
        val state = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = false,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        )
        assertTrue(!state.visible)
        assertTrue(state.options.isEmpty())
        assertNull(state.selected)
    }

    // BL-864 unreachable-bridge-does-not-fake-a-choice-07
    @Test
    fun `an unreachable bridge shows the failure and does not report the tapped engine as selected`() {
        val opened = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        )
        val afterUnreachable = VoiceEngineSelector.stateAfterChoice(
            opened,
            VoiceEngineSelector.ChoiceOutcome.Unreachable("Can't connect to the bridge — the tunnel may be down.")
        )
        assertEquals(VoiceEngineSelector.Engine.LOCAL, afterUnreachable.selected)
        assertEquals("Can't connect to the bridge — the tunnel may be down.", afterUnreachable.message)
    }

    // BL-864 choosing-an-engine-writes-it-to-the-bridge-02: an accepted
    // choice updates the displayed selection and clears any prior message.
    @Test
    fun `an accepted choice updates the displayed selection and clears the message`() {
        val opened = VoiceEngineSelector.stateForStatus(
            VoiceEngineSelector.StatusInput(
                enabled = true,
                engineInUse = VoiceEngineSelector.Engine.LOCAL,
                local = serviceable,
                openai = serviceable
            )
        ).copy(message = "stale message from a prior refusal")

        val afterAccept = VoiceEngineSelector.stateAfterChoice(
            opened,
            VoiceEngineSelector.ChoiceOutcome.Accepted(VoiceEngineSelector.Engine.OPENAI)
        )
        assertEquals(VoiceEngineSelector.Engine.OPENAI, afterAccept.selected)
        assertNull(afterAccept.message)
    }
}
