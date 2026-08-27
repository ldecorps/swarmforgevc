package com.swarmforge.floatcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-765 invariant 2 (BL-654 coder-authored property test): "Every
 * remote-served payload is versioned and validated before use; an
 * unparseable or wrong-schema payload is rejected whole, never applied
 * field-by-field." Encoded against [BridgeClient.parseBubbleConfig]: an
 * arbitrary all-boolean `features` document parses to exactly those flags; a
 * document with exactly one flag holding a non-boolean value anywhere in it
 * parses to null (the whole document rejected) — never a result with just
 * that one flag defaulted while the rest of the malformed document is
 * applied.
 */
class BridgeClientBubbleConfigPropertyTest {

    private val keys = listOf(
        "textTurns", "handsFree", "holdMusic", "playlist",
        "newSession", "pauseAll", "bridgeBounceAutoSessionReset", "voiceEngineSwitch"
    )

    private fun randomValidFeatures(rng: Random): JSONObject {
        val features = JSONObject()
        for (key in keys) {
            features.put(key, rng.nextBoolean())
        }
        return features
    }

    /** Each mutator plants a non-boolean value on an otherwise-valid features document. */
    private val nonBooleanValues: List<Any> = listOf(
        "not-a-bool", 0, 1, 3.14, JSONObject().put("nested", true)
    )

    @Test
    fun `an all-valid features document parses to exactly its flags`() {
        val rng = Random(20260815765L)
        repeat(500) {
            val features = randomValidFeatures(rng)
            val doc = JSONObject().put("version", 1).put("features", features)

            val parsed = BridgeClient.parseBubbleConfig(doc.toString())

            assertTrue("doc=$doc", parsed != null && parsed.ok)
            for (key in keys) {
                val expected = features.getBoolean(key)
                val actual = when (key) {
                    "textTurns" -> parsed!!.textTurns
                    "handsFree" -> parsed!!.handsFree
                    "holdMusic" -> parsed!!.holdMusic
                    "playlist" -> parsed!!.playlist
                    "newSession" -> parsed!!.newSession
                    "pauseAll" -> parsed!!.pauseAll
                    "bridgeBounceAutoSessionReset" -> parsed!!.bridgeBounceAutoSessionReset
                    "voiceEngineSwitch" -> parsed!!.voiceEngineSwitch
                    else -> error("unknown key $key")
                }
                assertEquals("key=$key doc=$doc", expected, actual)
            }
        }
    }

    @Test
    fun `a single non-boolean flag anywhere rejects the whole document, never a partial apply`() {
        val rng = Random(20260815001L)
        repeat(1_000) {
            val features = randomValidFeatures(rng)
            val badKey = keys[rng.nextInt(keys.size)]
            val badValue = nonBooleanValues[rng.nextInt(nonBooleanValues.size)]
            features.put(badKey, badValue)
            val doc = JSONObject().put("version", 1).put("features", features)

            val parsed = BridgeClient.parseBubbleConfig(doc.toString())

            assertNull(
                "a non-boolean $badKey=$badValue must reject the whole document, doc=$doc",
                parsed
            )
        }
    }

    @Test
    fun `malformed top-level shapes are rejected whole`() {
        assertNull(BridgeClient.parseBubbleConfig("not json at all"))
        assertNull(BridgeClient.parseBubbleConfig("{}"))
        assertNull(BridgeClient.parseBubbleConfig(JSONObject().put("features", "not-an-object").toString()))
        assertNull(BridgeClient.parseBubbleConfig(JSONObject().put("features", 42).toString()))
    }

    @Test
    fun `a naive field-by-field parser would fail this property`() {
        // Non-vacuity companion: a parser that defaults only the one
        // wrong-typed flag while still applying every other flag from the
        // same malformed document would still return a non-null, ok result
        // here — demonstrate that failure mode, then confirm the real
        // parser does not share it.
        val features = randomValidFeatures(Random(1)).put("textTurns", "not-a-bool")
        val doc = JSONObject().put("features", features)

        fun naiveFieldByField(raw: String): BridgeClient.BubbleConfigResult {
            val json = JSONObject(raw)
            val f = json.optJSONObject("features")
            return BridgeClient.BubbleConfigResult(
                ok = true,
                textTurns = f?.optBoolean("textTurns", true) ?: true,
                handsFree = f?.optBoolean("handsFree", true) ?: true,
                holdMusic = f?.optBoolean("holdMusic", true) ?: true,
                playlist = f?.optBoolean("playlist", true) ?: true,
                newSession = f?.optBoolean("newSession", true) ?: true,
                pauseAll = f?.optBoolean("pauseAll", true) ?: true,
                bridgeBounceAutoSessionReset = f?.optBoolean("bridgeBounceAutoSessionReset", true) ?: true,
                voiceEngineSwitch = f?.optBoolean("voiceEngineSwitch", true) ?: true
            )
        }

        val naiveResult = naiveFieldByField(doc.toString())
        assertTrue("the naive parser wrongly applies the rest of the malformed document", naiveResult.ok)
        assertEquals(features.getBoolean("holdMusic"), naiveResult.holdMusic)

        val realResult = BridgeClient.parseBubbleConfig(doc.toString())
        assertNull("the real parser must reject the whole document", realResult)
    }
}
