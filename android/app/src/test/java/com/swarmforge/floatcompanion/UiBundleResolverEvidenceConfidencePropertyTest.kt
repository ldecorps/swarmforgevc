package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-825 invariant 3 (BL-654 coder-authored property test): "The rendered
 * state is never more confident than the evidence: a bundle the bridge did
 * not confirm this session is reported stale, and a bundle the shell
 * cannot honour is never rendered as if it were." Encoded against
 * [UiBundleResolver.resolve]: (a) whenever the bridge was unreachable this
 * session, the outcome is NEVER FRESH or CACHED (only STALE, when a
 * compatible cached bundle exists, or BARE) — an unconfirmed bundle is
 * never presented with the same confidence as a confirmed one; (b) for ANY
 * input, `resolution.bundle` never carries a `minShellVersion` above the
 * installed shell version.
 */
class UiBundleResolverEvidenceConfidencePropertyTest {

    private fun randomManifestOrNull(rng: Random): UiBundleResolver.UiBundleManifest? {
        if (rng.nextInt(4) == 0) return null
        return UiBundleResolver.UiBundleManifest(
            schemaVersion = rng.nextInt(1, 5),
            bundleVersion = rng.nextInt(-50, 50),
            minShellVersion = rng.nextInt(-50, 100),
            payload = "p${rng.nextInt(1000)}"
        )
    }

    @Test
    fun `an unreachable bridge is never reported as fresh or cached, for any prior state`() {
        val rng = Random(20260816825004L)
        repeat(1_000) {
            val cached = randomManifestOrNull(rng)
            val installedShellVersion = rng.nextInt(-10, 20)
            // servedManifest is irrelevant when unreachable; still fuzz it to
            // confirm it can never leak through as a confirmed outcome.
            val served = randomManifestOrNull(rng)

            val resolution = UiBundleResolver.resolve(served, servedReachable = false, cachedManifest = cached, installedShellVersion = installedShellVersion)

            assertNotEquals("unreachable must never report FRESH, cached=$cached shell=$installedShellVersion", UiBundleResolver.UiBundleOutcome.FRESH, resolution.outcome)
            assertNotEquals("unreachable must never report CACHED (as-if-confirmed), cached=$cached shell=$installedShellVersion", UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
            assertTrue(
                "unreachable must resolve to STALE or BARE only, got ${resolution.outcome}",
                resolution.outcome == UiBundleResolver.UiBundleOutcome.STALE || resolution.outcome == UiBundleResolver.UiBundleOutcome.BARE
            )
        }
    }

    @Test
    fun `the returned bundle never exceeds what the installed shell can honour, for any input`() {
        val rng = Random(20260816825005L)
        repeat(2_000) {
            val served = randomManifestOrNull(rng)
            val reachable = rng.nextBoolean()
            val cached = randomManifestOrNull(rng)
            val installedShellVersion = rng.nextInt(-50, 100)

            val resolution = UiBundleResolver.resolve(served, reachable, cached, installedShellVersion)

            val bundle = resolution.bundle
            if (bundle != null) {
                assertTrue(
                    "a returned bundle must never require a newer shell than installed: " +
                        "bundle.minShellVersion=${bundle.minShellVersion} installedShellVersion=$installedShellVersion",
                    bundle.minShellVersion <= installedShellVersion
                )
            }
        }
    }

    /**
     * Non-vacuity companion: a resolver that reported CACHED (rather than
     * STALE) whenever the bridge was unreachable but a cache existed would
     * pass a weaker "bundle is non-null" check but fail this property.
     */
    @Test
    fun `a buggy resolver that reports cached instead of stale would fail this property`() {
        val cached = UiBundleResolver.UiBundleManifest(1, 5, 0, "cached-payload")

        fun buggyResolve(cached: UiBundleResolver.UiBundleManifest?): UiBundleResolver.UiBundleOutcome =
            if (cached != null) UiBundleResolver.UiBundleOutcome.CACHED else UiBundleResolver.UiBundleOutcome.BARE

        val buggyOutcome = buggyResolve(cached)
        assertEquals("the buggy resolver wrongly presents an unconfirmed cache as current", UiBundleResolver.UiBundleOutcome.CACHED, buggyOutcome)

        val realResolution = UiBundleResolver.resolve(servedManifest = null, servedReachable = false, cachedManifest = cached, installedShellVersion = 10)
        assertEquals("the real resolver must report STALE, never CACHED, when unreachable", UiBundleResolver.UiBundleOutcome.STALE, realResolution.outcome)
    }

    /**
     * Non-vacuity companion: a resolver that compared minShellVersion with
     * the wrong operator (`<` instead of `<=`, or omitted the check
     * entirely) would return a shell-incompatible bundle here.
     */
    @Test
    fun `a buggy resolver that skips the shell-compatibility check would fail this property`() {
        val shellBehind = UiBundleResolver.UiBundleManifest(1, 5, 999, "too-new-payload")

        fun buggyResolve(served: UiBundleResolver.UiBundleManifest): UiBundleResolver.UiBundleManifest = served // bug: no gate at all

        val buggyBundle = buggyResolve(shellBehind)
        assertEquals("the buggy resolver wrongly renders a shell-incompatible bundle", 999, buggyBundle.minShellVersion)

        val realResolution = UiBundleResolver.resolve(shellBehind, servedReachable = true, cachedManifest = null, installedShellVersion = 10)
        assertEquals(UiBundleResolver.UiBundleOutcome.BARE, realResolution.outcome)
        assertEquals(null, realResolution.bundle)
    }
}
