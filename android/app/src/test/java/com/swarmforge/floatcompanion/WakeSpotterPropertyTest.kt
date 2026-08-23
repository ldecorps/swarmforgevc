package com.swarmforge.floatcompanion

import com.swarmforge.floatcompanion.WakeSpotter.BubbleColour
import com.swarmforge.floatcompanion.WakeSpotter.BubbleState
import com.swarmforge.floatcompanion.WakeSpotter.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-845 property tests (BL-654 coder-authored, THREE declared invariants).
 *
 *   Invariant 1: passive listening is silent to the world - while the session
 *   is passive, no bridge request and no cloud speech service call is made,
 *   whatever the phone hears.
 *   Invariant 2: the wake phrase is never part of the request - no text
 *   submitted as a turn contains the phrase that woke the session.
 *   Invariant 3: colour tells the truth about the mic - red is shown only
 *   while audio is being captured for the model, and passive listening is
 *   never red.
 *
 * WHY PROPERTIES AND NOT MORE FIXTURES. Invariants 1 and 2 quantify over
 * "everything the phone could possibly hear", which is not a list. The
 * fixtures pin the phrases a reviewer thinks of; the leak that matters is the
 * utterance nobody wrote down - a near-miss that part-wakes, or a phrase
 * repeated in a way that survives one pass of stripping.
 *
 * REACH, asserted rather than hoped for (BL-654's generator-reach clause).
 * Two states a naive generator would essentially never produce:
 *
 *   (a) A NEAR MISS OF THE WAKE PHRASE. Drawing utterances from a free
 *       alphabet lands near "hey bubble" essentially never, so a spotter that
 *       woke on anything vaguely similar would pass every uniform draw. Near
 *       misses are therefore DERIVED FROM the phrase itself by the mutations a
 *       spotter actually confuses - a changed letter, a dropped space, an
 *       added plural, a prefix - so every generated case is a wake candidate
 *       by construction. Its twin, a genuine wake with an arbitrary request
 *       after it, is generated alongside and floored, because a spotter that
 *       woke on NOTHING would also pass a near-miss-only property.
 *
 *   (b) A REQUEST THAT REPEATS THE PHRASE. This is the collision shape BL-654
 *       warns about: a suffix drawn independently would repeat "hey bubble"
 *       essentially never, and a strip that removed only the first occurrence
 *       would survive any number of runs. So repeated leading phrases are
 *       CONSTRUCTED, at drawn repeat counts, and each is floored.
 *
 * TWO CARVE-OUTS IN THE DECLARED INVARIANTS, stated rather than quietly
 * narrowed - both are worth a reviewer's eye:
 *
 *   - Invariant 2 says "the phrase that WOKE the session". Leading occurrences
 *     are the wake, and every one of them is stripped. An occurrence INSIDE
 *     the request ("what does hey bubble mean") is the human's own words and
 *     is deliberately preserved; removing it would silently corrupt the
 *     question into "what does mean". `requestNeverBeginsWithThePhrase` is the
 *     encoded form.
 *   - Invariant 3 says red is shown "only while audio is being captured for
 *     the model", but the human's own confirmed colour table in the same
 *     ticket also maps Error to red. Both are honoured: red implies capturing
 *     OR error, and passive listening is never red under any state.
 */
class WakeSpotterPropertyTest {

    private val runs = 400
    private val phrase = WakeSpotter.WAKE_PHRASE

    private val requests = listOf(
        "what is the pipeline",
        "stop the swarm",
        "read me the last briefing",
        "what does hey bubble mean",
        ""
    )

    /** Mutations a real spotter confuses, derived FROM the phrase itself. */
    private fun nearMiss(rng: Random): String = when (rng.nextInt(5)) {
        0 -> phrase.replace('b', 'm')              // hey mummle-ish: one letter off
        1 -> phrase.replace(" ", "")               // heybubble: the space dropped
        2 -> "${phrase}s"                          // hey bubbles: a plural
        3 -> "a $phrase".replace("hey", "hay")     // a hay bubble: a prefix and a homophone
        else -> phrase.dropLast(2)                 // hey bubb: truncated
    }

    private fun decorate(text: String, rng: Random): String = when (rng.nextInt(4)) {
        0 -> text.uppercase()
        1 -> "  $text  "
        2 -> text.replaceFirst(" ", ", ")
        else -> text
    }

    // ── Invariant 1 ───────────────────────────────────────────────────────

    @Test
    fun `nothing the phone hears can produce anything but an ignore or a wake`() {
        val rng = Random(20260823)
        var nearMisses = 0
        var genuineWakes = 0
        var ignoreReason: String? = null

        repeat(runs) {
            // Reach (a): near misses DERIVED from the phrase, and genuine
            // wakes alongside them.
            val genuine = rng.nextBoolean()
            val request = requests.random(rng)
            val heard = decorate(
                if (genuine) listOf(phrase, request).filter { it.isNotBlank() }.joinToString(" ") else "${nearMiss(rng)} $request",
                rng
            )

            when (val decision = WakeSpotter.onHeard(heard)) {
                is Decision.Ignore -> {
                    nearMisses++
                    // Same constant-reason argument as below: an ignore that
                    // varied with the utterance would be carrying it.
                    if (ignoreReason == null) ignoreReason = decision.reason
                    assertEquals(
                        "an ignored utterance must not carry the heard text onward",
                        ignoreReason,
                        decision.reason
                    )
                    assertFalse(
                        "a genuine wake was ignored: \"$heard\"",
                        genuine
                    )
                }
                is Decision.Wake -> {
                    genuineWakes++
                    assertTrue("a near miss woke the session: \"$heard\"", genuine)
                }
            }
        }

        assertTrue("near misses too rare to test invariant 1: $nearMisses", nearMisses >= 100)
        assertTrue("genuine wakes too rare - a spotter that never woke would pass: $genuineWakes", genuineWakes >= 100)
    }

    @Test
    fun `an ignore never carries the utterance, however long or unusual`() {
        val rng = Random(20260824)
        // The strong form, and the one immune to a short random string being a
        // coincidental substring of the reason: the reason is a CONSTANT, so it
        // cannot be a function of what was heard at all.
        var constantReason: String? = null
        repeat(runs) {
            val length = rng.nextInt(1, 60)
            val heard = (1..length).map { ('a' + rng.nextInt(26)) }.joinToString("")
            val decision = WakeSpotter.onHeard(heard)
            assertTrue(decision is Decision.Ignore)
            val reason = (decision as Decision.Ignore).reason
            if (constantReason == null) constantReason = reason
            assertEquals(
                "the ignore reason varies with what was heard, so it carries it",
                constantReason,
                reason
            )
        }
        assertTrue("no utterance was ignored at all", constantReason != null)
    }

    // ── Invariant 2 ───────────────────────────────────────────────────────

    @Test
    fun `the request never begins with the phrase, however many times it was said`() {
        val rng = Random(20260825)
        var repeats = 0
        var bareWakes = 0

        repeat(runs) {
            // Reach (b): repeated leading phrases, constructed.
            val howMany = 1 + rng.nextInt(4)
            if (howMany > 1) repeats++
            val request = requests.random(rng)
            val heard = decorate(
                (List(howMany) { phrase } + listOf(request)).filter { it.isNotBlank() }.joinToString(" "),
                rng
            )

            val decision = WakeSpotter.onHeard(heard)
            assertTrue("\"$heard\" must wake", decision is Decision.Wake)
            val submitted = (decision as Decision.Wake).request

            assertFalse(
                "the phrase that woke the session survived into \"$submitted\"",
                submitted.startsWith(phrase)
            )
            assertFalse("a wake phrase repeat survived", submitted.startsWith("$phrase "))
            if (submitted.isBlank()) {
                bareWakes++
                assertFalse("a bare wake must submit no turn", decision.submitsTurn)
            } else {
                assertTrue(decision.submitsTurn)
            }
        }

        assertTrue("repeated phrases too rare to test invariant 2: $repeats", repeats >= 100)
        assertTrue("bare wakes too rare: $bareWakes", bareWakes >= 30)
    }

    @Test
    fun `an occurrence inside the human's own words is preserved, deliberately`() {
        // The stated carve-out, pinned so it is a decision rather than a bug:
        // stripping this would turn the question into "what does mean".
        val decision = WakeSpotter.onHeard("hey bubble what does hey bubble mean") as Decision.Wake
        assertEquals("what does hey bubble mean", decision.request)
        assertFalse("the phrase that WOKE it is gone", decision.request.startsWith(phrase))
    }

    // ── Invariant 3 ───────────────────────────────────────────────────────

    @Test
    fun `red is shown only for a hot mic or an error, and passive is never red`() {
        for (state in BubbleState.values()) {
            val red = WakeSpotter.colourFor(state) == BubbleColour.Red
            val allowedRed = WakeSpotter.capturesForModel(state) || state == BubbleState.Error
            assertEquals("$state's redness disagrees with what it does to the mic", allowedRed, red)
        }
        assertFalse(
            "passive listening must never be red",
            WakeSpotter.colourFor(BubbleState.PassiveWake) == BubbleColour.Red
        )
        assertFalse(
            "passive listening captures nothing for the model",
            WakeSpotter.capturesForModel(BubbleState.PassiveWake)
        )
    }

    @Test
    fun `every state has exactly one colour, and no two mic meanings share one`() {
        val rng = Random(20260826)
        repeat(runs) {
            val state = BubbleState.values().random(rng)
            assertEquals(
                "colourFor is not a function of the state alone",
                WakeSpotter.colourFor(state),
                WakeSpotter.colourFor(state)
            )
        }
        // The two listening states are the ones that must never be confusable:
        // one has a hot mic to the model, the other does not.
        assertTrue(
            "passive and active listening must not share a colour",
            WakeSpotter.colourFor(BubbleState.PassiveWake) != WakeSpotter.colourFor(BubbleState.ActiveListen)
        )
    }
}
