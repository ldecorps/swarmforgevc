package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-864 invariant 2 (BL-654 coder-authored property test): "The selector
 * never shows an engine as selected that the bridge has not accepted —
 * displayed state follows the bridge's answer, never the tap." Encoded as:
 * for any previous UI state and any [VoiceEngineSelector.ChoiceOutcome],
 * `selected` changes if and only if the outcome is [Accepted], and then
 * always becomes exactly the accepted engine — never the tapped engine
 * leaking through on a [Refused] or [Unreachable] answer.
 */
class VoiceEngineSelectorPropertyTest {

    private fun randomEngine(rng: Random): VoiceEngineSelector.Engine =
        if (rng.nextBoolean()) VoiceEngineSelector.Engine.LOCAL else VoiceEngineSelector.Engine.OPENAI

    private fun randomState(rng: Random): VoiceEngineSelector.UiState {
        val selected = when (rng.nextInt(3)) {
            0 -> null
            else -> randomEngine(rng)
        }
        return VoiceEngineSelector.UiState(
            visible = rng.nextBoolean(),
            selected = selected,
            options = listOf(
                VoiceEngineSelector.EngineOption(VoiceEngineSelector.Engine.LOCAL, disabled = rng.nextBoolean()),
                VoiceEngineSelector.EngineOption(VoiceEngineSelector.Engine.OPENAI, disabled = rng.nextBoolean())
            ),
            message = if (rng.nextBoolean()) "prior message" else null
        )
    }

    @Test
    fun `selected only changes on an Accepted outcome, and always becomes exactly the accepted engine`() {
        val rng = Random(20260812864L)
        repeat(2_000) {
            val previous = randomState(rng)
            // The tapped engine is drawn independently, including the
            // degenerate case where it matches what was already selected —
            // the invariant must hold either way.
            val tapped = randomEngine(rng)
            val outcome: VoiceEngineSelector.ChoiceOutcome = when (rng.nextInt(3)) {
                0 -> VoiceEngineSelector.ChoiceOutcome.Accepted(tapped)
                1 -> VoiceEngineSelector.ChoiceOutcome.Refused("refused: $tapped not serviceable")
                else -> VoiceEngineSelector.ChoiceOutcome.Unreachable("unreachable while choosing $tapped")
            }

            val next = VoiceEngineSelector.stateAfterChoice(previous, outcome)

            when (outcome) {
                is VoiceEngineSelector.ChoiceOutcome.Accepted -> {
                    assertEquals(
                        "an accepted outcome must select exactly the accepted engine",
                        outcome.engine,
                        next.selected
                    )
                }
                is VoiceEngineSelector.ChoiceOutcome.Refused,
                is VoiceEngineSelector.ChoiceOutcome.Unreachable -> {
                    assertEquals(
                        "a refused/unreachable outcome must never change the displayed selection " +
                            "(tapped=$tapped, previous=${previous.selected})",
                        previous.selected,
                        next.selected
                    )
                }
            }
        }
    }

    @Test
    fun `a reducer that always trusts the tap would fail this property`() {
        // Non-vacuity companion: a naive reducer that optimistically shows
        // the tapped engine as selected before the bridge answers is exactly
        // the silent-fallback-that-looks-like-success shape the human
        // forbade (BL-862) — demonstrate it fails, then confirm the real
        // reducer above does not share this behavior.
        fun optimisticStateAfterChoice(
            previous: VoiceEngineSelector.UiState,
            tapped: VoiceEngineSelector.Engine
        ): VoiceEngineSelector.UiState = previous.copy(selected = tapped)

        val previous = VoiceEngineSelector.UiState(
            visible = true,
            selected = VoiceEngineSelector.Engine.LOCAL,
            options = emptyList()
        )
        val tapped = VoiceEngineSelector.Engine.OPENAI
        val refusal = VoiceEngineSelector.ChoiceOutcome.Refused("missing key")

        val optimistic = optimisticStateAfterChoice(previous, tapped)
        assertTrue(
            "the optimistic reducer wrongly shows the tapped engine as selected on a refusal",
            optimistic.selected == tapped
        )

        val real = VoiceEngineSelector.stateAfterChoice(previous, refusal)
        assertEquals(
            "the real reducer must keep showing the previously-working engine",
            VoiceEngineSelector.Engine.LOCAL,
            real.selected
        )
    }
}
