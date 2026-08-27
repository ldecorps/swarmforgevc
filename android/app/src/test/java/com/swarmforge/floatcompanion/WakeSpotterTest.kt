package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.WakeSpotter.BubbleColour
import com.swarmforge.floatcompanion.WakeSpotter.BubbleState
import com.swarmforge.floatcompanion.WakeSpotter.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * BL-845: on-device "hey bubble" wake spotting — the decision half.
 *
 * No `android.*` type appears in [WakeSpotter]'s own signatures, so this runs
 * under the JVM unit suite with no device or emulator (constitution:
 * Testability Boundary — Bubble). The spotter ENGINE is injected as a signal
 * source exactly as BL-844 injects its clock; that a real engine hears the
 * phrase across a room, offline, without draining the battery is the ticket's
 * recorded manual procedure and deliberately has no scenario here.
 */
class WakeSpotterTest {

    // ── 01: the phrase never travels ──────────────────────────────────────

    @Test
    fun `the wake phrase is stripped from the request it arrived with`() {
        assertEquals("what is the pipeline", WakeSpotter.strip("hey bubble what is the pipeline"))
        assertEquals("stop the swarm", WakeSpotter.strip("hey bubble, stop the swarm"))
        assertEquals("", WakeSpotter.strip("hey bubble"))
    }

    @Test
    fun `stripping survives case, punctuation and stray spacing`() {
        for (heard in listOf(
            "Hey Bubble, what is the pipeline",
            "  HEY   BUBBLE what is the pipeline  ",
            "Hey, Bubble: what is the pipeline"
        )) {
            assertEquals("\"$heard\" was not stripped", "what is the pipeline", WakeSpotter.strip(heard))
        }
    }

    @Test
    fun `no stripped text ever contains the wake phrase`() {
        for (heard in listOf("hey bubble hey bubble what is the pipeline", "hey bubble what is the pipeline")) {
            assertTrue(
                "\"$heard\" left the phrase in the request",
                !WakeSpotter.strip(heard).lowercase().contains("hey bubble")
            )
        }
    }

    @Test
    fun `text that never carried the phrase is returned untouched`() {
        assertEquals("what is the pipeline", WakeSpotter.strip("what is the pipeline"))
    }

    // ── 02: passive listening is silent to the world ─────────────────────

    @Test
    fun `heard speech without the phrase asks nothing of the bridge or the model`() {
        for (heard in listOf("what is the pipeline", "the kettle is boiling", "hey bumble")) {
            val decision = WakeSpotter.onHeard(heard)
            assertTrue("\"$heard\" must not wake anything", decision is Decision.Ignore)
            val ignored = decision as Decision.Ignore
            assertTrue("an ignored utterance must carry no text onward", ignored.reason.isNotBlank())
        }
    }

    @Test
    fun `a near-miss of the phrase does not wake, and does not part-wake either`() {
        for (heard in listOf("hey bumble", "hey bubbles", "bubble", "hey", "a bubble hey")) {
            assertTrue("\"$heard\" must not wake", WakeSpotter.onHeard(heard) is Decision.Ignore)
        }
    }

    @Test
    fun `the phrase wakes and carries only what followed it`() {
        val decision = WakeSpotter.onHeard("hey bubble what is the pipeline")
        assertTrue(decision is Decision.Wake)
        assertEquals("what is the pipeline", (decision as Decision.Wake).request)
    }

    @Test
    fun `a bare wake opens the session and submits nothing`() {
        val decision = WakeSpotter.onHeard("hey bubble") as Decision.Wake
        assertEquals("", decision.request)
        assertTrue("a bare wake is not a turn", !decision.submitsTurn)
    }

    @Test
    fun `a wake carrying a request does submit a turn`() {
        assertTrue((WakeSpotter.onHeard("hey bubble what is the pipeline") as Decision.Wake).submitsTurn)
    }

    // ── 03: waking with no network still acknowledges locally ────────────

    @Test
    fun `the local acknowledgement does not wait on the bridge`() {
        val reachable = WakeSpotter.acknowledge(bridgeReachable = true)
        val unreachable = WakeSpotter.acknowledge(bridgeReachable = false)
        assertTrue(reachable.acknowledgedLocally)
        assertTrue("the wake must be acknowledged with the network off", unreachable.acknowledgedLocally)
    }

    @Test
    fun `an unreachable bridge is reported as the reason the turn failed, not swallowed`() {
        val unreachable = WakeSpotter.acknowledge(bridgeReachable = false)
        assertTrue(unreachable.turnFailureReason != null)
        assertTrue(
            "the reason must name the bridge: ${unreachable.turnFailureReason}",
            unreachable.turnFailureReason!!.contains("bridge", ignoreCase = true)
        )
    }

    @Test
    fun `a reachable bridge reports no failure reason at all`() {
        assertEquals(null, WakeSpotter.acknowledge(bridgeReachable = true).turnFailureReason)
    }

    // ── 04: colour tells the truth about the mic ─────────────────────────

    @Test
    fun `each session state maps to the colour the human confirmed`() {
        assertEquals(BubbleColour.SoftTeal, WakeSpotter.colourFor(BubbleState.PassiveWake))
        assertEquals(BubbleColour.Red, WakeSpotter.colourFor(BubbleState.ActiveListen))
        assertEquals(BubbleColour.Amber, WakeSpotter.colourFor(BubbleState.Thinking))
        assertEquals(BubbleColour.Blue, WakeSpotter.colourFor(BubbleState.Speaking))
        assertEquals(BubbleColour.Gray, WakeSpotter.colourFor(BubbleState.Paused))
        assertEquals(BubbleColour.Red, WakeSpotter.colourFor(BubbleState.Error))
        assertEquals(BubbleColour.Green, WakeSpotter.colourFor(BubbleState.Ready))
    }

    @Test
    fun `red is reserved for capturing audio for the model, and passive is never red`() {
        for (state in BubbleState.values()) {
            val red = WakeSpotter.colourFor(state) == BubbleColour.Red
            assertEquals(
                "$state must ${if (WakeSpotter.capturesForModel(state) || state == BubbleState.Error) "" else "not "}be red",
                WakeSpotter.capturesForModel(state) || state == BubbleState.Error,
                red
            )
        }
        assertTrue("passive listening captures nothing for the model", !WakeSpotter.capturesForModel(BubbleState.PassiveWake))
    }

    // ── the hex values are mirrored into themes.xml by hand ──────────────

    @Test
    fun `every bubble colour agrees with the resource themes xml declares`() {
        // A constant mirrored across a boundary no import can bridge needs a
        // test asserting both literals agree; a "kept in sync" comment is not
        // a gate, and drift here shows a lie about the mic.
        // Gradle runs unit tests with the MODULE dir as the working directory,
        // but a bare `gradlew` from the repo root is easy to reach for too -
        // resolve both rather than pin one and fail confusingly.
        val themes = listOf("src/main/res/values/themes.xml", "app/src/main/res/values/themes.xml")
            .map { File(it) }
            .firstOrNull { it.exists() }
            ?.readText()
        assertEquals("themes.xml was not found from ${File(".").absolutePath}", true, themes != null)
        val declaredColours = themes!!
        for (colour in BubbleColour.values()) {
            val declared = Regex("<color name=\"${colour.resourceName}\">#FF([0-9A-Fa-f]{6})</color>")
                .find(declaredColours)
                ?.groupValues
                ?.get(1)
            assertEquals(
                "${colour.resourceName} is missing from themes.xml",
                true,
                declared != null
            )
            assertEquals(
                "${colour.resourceName} drifted from ${colour.hex}",
                colour.hex.removePrefix("#").uppercase(),
                declared!!.uppercase()
            )
        }
    }
}
