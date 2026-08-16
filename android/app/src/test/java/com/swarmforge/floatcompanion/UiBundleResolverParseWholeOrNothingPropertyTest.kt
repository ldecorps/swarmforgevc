package com.swarmforge.floatcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-825 invariant 2, part 1 (BL-654 coder-authored property test): "A
 * bundle is applied whole or not at all: no partially-validated bundle is
 * ever rendered..." Encoded against [UiBundleResolver.parseUiBundleManifest],
 * same shape as [BridgeClientBubbleConfigPropertyTest]: an arbitrary
 * well-formed manifest document parses to exactly its fields; a document
 * with exactly one field holding a wrong-typed or missing value parses to
 * null (the whole document rejected) — never a result with the other
 * fields applied around a defaulted bad one.
 */
class UiBundleResolverParseWholeOrNothingPropertyTest {

    private fun randomValidManifest(rng: Random): JSONObject =
        JSONObject()
            .put("schemaVersion", rng.nextInt(1, 5))
            .put("bundleVersion", rng.nextInt(0, 1000))
            .put("minShellVersion", rng.nextInt(0, 100))
            .put("payload", "payload-${rng.nextInt(100_000)}")

    private val wrongTypedValues: List<Any> = listOf(
        "not-a-number", 3.14, true, JSONObject().put("nested", 1)
    )

    @Test
    fun `an all-valid manifest document parses to exactly its fields`() {
        val rng = Random(20260816001L)
        repeat(500) {
            val doc = randomValidManifest(rng)

            val parsed = UiBundleResolver.parseUiBundleManifest(doc.toString())

            assertTrue("doc=$doc", parsed != null)
            assertEquals(doc.getInt("schemaVersion"), parsed!!.schemaVersion)
            assertEquals(doc.getInt("bundleVersion"), parsed.bundleVersion)
            assertEquals(doc.getInt("minShellVersion"), parsed.minShellVersion)
            assertEquals(doc.getString("payload"), parsed.payload)
        }
    }

    @Test
    fun `a single wrong-typed or missing numeric field rejects the whole document`() {
        val rng = Random(20260816002L)
        val numericKeys = listOf("schemaVersion", "bundleVersion", "minShellVersion")
        repeat(1_000) {
            val doc = randomValidManifest(rng)
            val badKey = numericKeys[rng.nextInt(numericKeys.size)]
            if (rng.nextBoolean()) {
                doc.remove(badKey)
            } else {
                doc.put(badKey, wrongTypedValues[rng.nextInt(wrongTypedValues.size)])
            }

            val parsed = UiBundleResolver.parseUiBundleManifest(doc.toString())

            assertNull("bad $badKey must reject the whole document, doc=$doc", parsed)
        }
    }

    @Test
    fun `a missing, non-string, or empty payload rejects the whole document`() {
        val rng = Random(20260816003L)
        repeat(300) {
            val doc = randomValidManifest(rng)
            when (rng.nextInt(3)) {
                0 -> doc.remove("payload")
                1 -> doc.put("payload", 12345)
                else -> doc.put("payload", "")
            }

            val parsed = UiBundleResolver.parseUiBundleManifest(doc.toString())

            assertNull("doc=$doc", parsed)
        }
    }

    @Test
    fun `malformed top-level shapes are rejected whole`() {
        assertNull(UiBundleResolver.parseUiBundleManifest("not json at all"))
        assertNull(UiBundleResolver.parseUiBundleManifest("{}"))
        assertNull(UiBundleResolver.parseUiBundleManifest("[]"))
    }

    /**
     * Non-vacuity companion: a parser that defaults only the one bad field
     * while still applying every other field from the same malformed
     * document would still return a non-null result here — demonstrate that
     * failure mode, then confirm the real parser does not share it.
     */
    @Test
    fun `a naive field-by-field parser would fail this property`() {
        val doc = randomValidManifest(Random(1)).put("bundleVersion", "not-a-number")

        fun naiveFieldByField(raw: String): UiBundleResolver.UiBundleManifest {
            val json = JSONObject(raw)
            return UiBundleResolver.UiBundleManifest(
                schemaVersion = json.optInt("schemaVersion", 1),
                bundleVersion = json.optInt("bundleVersion", 0),
                minShellVersion = json.optInt("minShellVersion", 0),
                payload = json.optString("payload", "")
            )
        }

        val naiveResult = naiveFieldByField(doc.toString())
        assertEquals("the naive parser wrongly applies the rest of the malformed document", doc.getInt("schemaVersion"), naiveResult.schemaVersion)

        val realResult = UiBundleResolver.parseUiBundleManifest(doc.toString())
        assertNull("the real parser must reject the whole document", realResult)
    }
}
