package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-825 invariant 1 (BL-654 coder-authored property test): "Bubble always
 * presents a usable native Talk surface: every resolver outcome, including
 * every rejection and every failure path, still leaves the human able to
 * talk." Encoded against [UiBundleResolver.resolve]: for ANY combination of
 * served/cached manifest (including nulls, mismatched shell versions,
 * negative/zero versions) and reachability, resolve() always returns
 * cleanly — never throws — and `bundle` is null if and only if `outcome` is
 * BARE. A caller can therefore always fall back to native Talk when
 * `bundle` is null, and never has an undefined/crashed state to render
 * instead.
 */
class UiBundleResolverNeverThrowsPropertyTest {

    private fun randomManifestOrNull(rng: Random): UiBundleResolver.UiBundleManifest? {
        if (rng.nextInt(4) == 0) return null
        return UiBundleResolver.UiBundleManifest(
            schemaVersion = rng.nextInt(-2, 5),
            bundleVersion = rng.nextInt(-100, 100),
            minShellVersion = rng.nextInt(-100, 100),
            payload = "p${rng.nextInt(1000)}"
        )
    }

    @Test
    fun `resolve never throws and bundle is null exactly when the outcome is bare, for any input`() {
        val rng = Random(20260816825L)
        repeat(2_000) {
            val served = randomManifestOrNull(rng)
            val reachable = rng.nextBoolean()
            val cached = randomManifestOrNull(rng)
            val installedShellVersion = rng.nextInt(-10, 20)

            val resolution = UiBundleResolver.resolve(served, reachable, cached, installedShellVersion)

            val context = "served=$served reachable=$reachable cached=$cached shell=$installedShellVersion"
            if (resolution.outcome == UiBundleResolver.UiBundleOutcome.BARE) {
                assertEquals("BARE must never carry a bundle, $context", null, resolution.bundle)
            } else {
                assertTrue("a non-BARE outcome must always carry a bundle, $context", resolution.bundle != null)
            }
        }
    }

    /**
     * Non-vacuity companion: a resolver that forgot to guard the
     * "nothing served, nothing cached" case (e.g. force-unwrapped a null)
     * would throw here instead of returning BARE cleanly.
     */
    @Test
    fun `a naive resolver that force-unwraps would throw on the all-null case, the real one does not`() {
        fun naiveResolve(cached: UiBundleResolver.UiBundleManifest?): UiBundleResolver.UiBundleManifest =
            cached!! // plausible bug: assumes a caller always has something cached

        var threw = false
        try {
            naiveResolve(null)
        } catch (_: NullPointerException) {
            threw = true
        }
        assertTrue("the naive resolver is expected to throw on this input", threw)

        val resolution = UiBundleResolver.resolve(
            servedManifest = null,
            servedReachable = true,
            cachedManifest = null,
            installedShellVersion = 10
        )
        assertEquals(UiBundleResolver.UiBundleOutcome.BARE, resolution.outcome)
        assertEquals(null, resolution.bundle)
    }
}
