package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import kotlin.random.Random

private fun randomString(rng: Random, minLen: Int = 1, maxLen: Int = 40): String {
    val chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    val length = rng.nextInt(minLen, maxLen + 1)
    return (0 until length).map { chars[rng.nextInt(chars.length)] }.joinToString("")
}

private fun randomHeld(rng: Random, name: String): CompanionPackageSync.HeldPackage =
    CompanionPackageSync.HeldPackage(
        name = name,
        generation = randomString(rng, 8, 16),
        format = "json",
        formatVersion = rng.nextInt(1, 5),
        data = "{\"n\":${rng.nextInt(0, 1_000_000)}}"
    )

/**
 * BL-907 invariant 1 (BL-654 coder-authored property test): "A held package
 * and the generation it is labelled with always agree — Bubble never labels
 * content with a generation it did not receive that content at." Encoded
 * against [CompanionPackageSync.applyFetch]: for any prior held state and
 * any successful (`Ok`) fetch, the resulting held package's generation AND
 * data both come from that same fetch — never the old generation paired
 * with the new data, or the new generation paired with the old data.
 */
class CompanionPackageSyncGenerationAgreementPropertyTest {

    @Test
    fun `an Ok fetch's held generation and data always come from the same fetch, for any prior state`() {
        val rng = Random(20260816907L)
        repeat(500) {
            val name = "pkg-${rng.nextInt(1000)}"
            val priorHeld = if (rng.nextBoolean()) randomHeld(rng, name) else null
            val fetch = BridgeClient.CompanionPackageFetch.Ok(
                name = name,
                generation = randomString(rng, 8, 16),
                format = "json",
                formatVersion = rng.nextInt(1, 5),
                data = "{\"n\":${rng.nextInt(0, 1_000_000)}}"
            )

            val (result, failure) = CompanionPackageSync.applyFetch(name, priorHeld, fetch)

            assertEquals("failure=$failure prior=$priorHeld fetch=$fetch", null, failure)
            assertEquals("generation must come from the fetch, prior=$priorHeld fetch=$fetch", fetch.generation, result?.generation)
            assertEquals("data must come from the fetch, prior=$priorHeld fetch=$fetch", fetch.data, result?.data)
            // The prior generation must never survive alongside the fetch's new data,
            // unless the fetch happened to draw the same generation by chance.
            if (priorHeld != null && priorHeld.generation != fetch.generation) {
                assertNotEquals(
                    "a held record must never carry the OLD generation once new data has replaced it",
                    priorHeld.generation,
                    result?.generation
                )
            }
        }
    }

    /**
     * Non-vacuity companion: a buggy merge that keeps the OLD generation
     * while taking the NEW data (a plausible copy-paste mistake — reusing
     * `priorHeld?.generation` instead of `fetch.generation`) would pass a
     * weaker assertion that only checks `result.data == fetch.data`. Show
     * that bug fails the real property, then confirm the real implementation
     * does not share it.
     */
    @Test
    fun `a buggy merge that keeps the stale generation would fail this property`() {
        val prior = CompanionPackageSync.HeldPackage("backlog", "stale-gen", "json", 1, "{\"old\":true}")
        val fetch = BridgeClient.CompanionPackageFetch.Ok("backlog", "fresh-gen", "json", 1, "{\"new\":true}")

        fun buggyApply(held: CompanionPackageSync.HeldPackage?, fetch: BridgeClient.CompanionPackageFetch.Ok): CompanionPackageSync.HeldPackage =
            CompanionPackageSync.HeldPackage(fetch.name, held?.generation ?: fetch.generation, fetch.format, fetch.formatVersion, fetch.data)

        val buggyResult = buggyApply(prior, fetch)
        assertEquals("buggy merge mislabels new data with the stale generation", "stale-gen", buggyResult.generation)

        val (realResult, _) = CompanionPackageSync.applyFetch("backlog", prior, fetch)
        assertEquals("the real implementation must label new data with the fetch's OWN generation", "fresh-gen", realResult?.generation)
    }
}

/**
 * BL-907 invariant 2 (BL-654 coder-authored property test): "No sync
 * outcome, successful or failed, leaves the device holding less than it
 * held before: after any sync attempt the last complete package is still
 * readable at its own generation." Encoded against
 * [CompanionPackageSync.applyFetch]: for ANY held state and ANY non-Ok
 * fetch outcome (Unchanged, Unknown, Unreadable, ConnectionFailure,
 * Interrupted), the package kept is exactly what was held before — never
 * null when it was non-null, never a different package.
 */
class CompanionPackageSyncNoDataLossPropertyTest {

    private fun randomFailureFetch(rng: Random, name: String): BridgeClient.CompanionPackageFetch {
        val reason = randomString(rng, 3, 30)
        return when (rng.nextInt(4)) {
            0 -> BridgeClient.CompanionPackageFetch.Unknown(name, reason)
            1 -> BridgeClient.CompanionPackageFetch.Unreadable(name, reason)
            2 -> BridgeClient.CompanionPackageFetch.ConnectionFailure(name, reason)
            else -> BridgeClient.CompanionPackageFetch.Interrupted(name, reason)
        }
    }

    @Test
    fun `every failure outcome returns the prior held package unchanged, for any prior state`() {
        val rng = Random(20260816908L)
        repeat(500) {
            val name = "pkg-${rng.nextInt(1000)}"
            val priorHeld = if (rng.nextBoolean()) randomHeld(rng, name) else null
            val fetch = randomFailureFetch(rng, name)

            val (result, failure) = CompanionPackageSync.applyFetch(name, priorHeld, fetch)

            assertEquals("a failure must never change what is held, prior=$priorHeld fetch=$fetch", priorHeld, result)
            assertNotEquals("a failure outcome must always be reported", null, failure)
        }
    }

    @Test
    fun `an unchanged outcome also returns the prior held package unchanged, for any prior state`() {
        val rng = Random(20260816909L)
        repeat(200) {
            val name = "pkg-${rng.nextInt(1000)}"
            val priorHeld = randomHeld(rng, name)
            val fetch = BridgeClient.CompanionPackageFetch.Unchanged(name, priorHeld.generation)

            val (result, failure) = CompanionPackageSync.applyFetch(name, priorHeld, fetch)

            assertEquals(priorHeld, result)
            assertEquals(null, failure)
        }
    }

    /**
     * Non-vacuity companion: a buggy merge that clears the held package on
     * any failure (a plausible "reset on error" mistake) would fail this
     * property immediately.
     */
    @Test
    fun `a buggy merge that clears the cache on failure would fail this property`() {
        val prior = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val fetch = BridgeClient.CompanionPackageFetch.ConnectionFailure("backlog", "unreachable")

        fun buggyApply(@Suppress("UNUSED_PARAMETER") fetch: BridgeClient.CompanionPackageFetch.ConnectionFailure): CompanionPackageSync.HeldPackage? = null

        val buggyResult = buggyApply(fetch)
        assertEquals("buggy merge drops the held package on failure", null, buggyResult)

        val (realResult, realFailure) = CompanionPackageSync.applyFetch("backlog", prior, fetch)
        assertEquals("the real implementation must keep the prior package on failure", prior, realResult)
        assertNotEquals(null, realFailure)
    }
}
