package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import kotlin.random.Random

/**
 * BL-825 invariant 2, part 2 (BL-654 coder-authored property test): "...and
 * a rejected bundle always leaves the last known-good cached bundle intact
 * and renderable." Encoded against [UiBundleResolver.resolve]: for ANY
 * shell-compatible cached manifest, when nothing usable is served this
 * session (nothing served, a malformed response already rejected upstream,
 * or a served bundle that is shell-behind) but the bridge is reachable and
 * the served bundle is not strictly newer, the returned bundle is the
 * SAME cached manifest object's fields, verbatim — never a mutated,
 * merged, or partial value.
 */
class UiBundleResolverKeepsCachedIntactPropertyTest {

    private fun randomManifest(rng: Random, minShellVersion: Int = 0): UiBundleResolver.UiBundleManifest =
        UiBundleResolver.UiBundleManifest(
            schemaVersion = rng.nextInt(1, 5),
            bundleVersion = rng.nextInt(0, 1000),
            minShellVersion = minShellVersion,
            payload = "payload-${rng.nextInt(1_000_000)}"
        )

    @Test
    fun `nothing usable served keeps the compatible cached bundle exactly as it was, for any prior state`() {
        val rng = Random(20260816825002L)
        repeat(500) {
            val cached = randomManifest(rng, minShellVersion = 0)
            // Either nothing was served, or a served bundle exists but is
            // not newer than the cached one and is itself shell-compatible
            // (so it can't be the FRESH branch) — CACHED must still return
            // `cached` untouched.
            val served = if (rng.nextBoolean()) null else cached.copy(bundleVersion = cached.bundleVersion)

            val resolution = UiBundleResolver.resolve(served, servedReachable = true, cachedManifest = cached, installedShellVersion = 50)

            assertEquals("served=$served cached=$cached", UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
            assertEquals("the cached bundle must come back unchanged, cached=$cached", cached, resolution.bundle)
        }
    }

    @Test
    fun `a shell-behind served bundle never displaces a compatible cached one, for any prior state`() {
        val rng = Random(20260816825003L)
        repeat(500) {
            val cached = randomManifest(rng, minShellVersion = 0)
            val shellBehindServed = randomManifest(rng, minShellVersion = 1000)

            val resolution = UiBundleResolver.resolve(shellBehindServed, servedReachable = true, cachedManifest = cached, installedShellVersion = 50)

            assertEquals(UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
            assertEquals("cached=$cached served=$shellBehindServed", cached, resolution.bundle)
            assertNotEquals("a shell-behind served bundle must never be returned as the bundle", shellBehindServed, resolution.bundle)
        }
    }

    /**
     * Non-vacuity companion: a resolver that merged the served bundle's
     * schemaVersion onto the cached bundle's other fields (a plausible
     * "partial apply" bug) would fail this property immediately.
     */
    @Test
    fun `a buggy resolver that partially merges the rejected served bundle would fail this property`() {
        val cached = UiBundleResolver.UiBundleManifest(1, 5, 0, "cached-payload")
        val malformedServed = UiBundleResolver.UiBundleManifest(99, 5, 0, "served-payload")

        fun buggyResolve(cached: UiBundleResolver.UiBundleManifest, served: UiBundleResolver.UiBundleManifest): UiBundleResolver.UiBundleManifest =
            cached.copy(schemaVersion = served.schemaVersion) // bug: leaks one field from the rejected document

        val buggyResult = buggyResolve(cached, malformedServed)
        assertNotEquals("the buggy merge wrongly leaks a field from the rejected document", cached, buggyResult)

        val realResolution = UiBundleResolver.resolve(malformedServed, servedReachable = true, cachedManifest = cached, installedShellVersion = 50)
        assertEquals("the real resolver must return the cached bundle completely untouched", cached, realResolution.bundle)
    }
}
