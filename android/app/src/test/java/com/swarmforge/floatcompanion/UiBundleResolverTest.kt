package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * BL-825: UiBundleResolver.resolve/parseUiBundleManifest are plain data
 * classes/Strings, no `android.*` import (BL-769 Testability Boundary) —
 * encodes each Scenario Outline row of
 * specs/features/BL-825-bubble-remote-ui-bundle-resolution.feature at the
 * pure decision level.
 */
class UiBundleResolverTest {

    private fun manifest(bundleVersion: Int, minShellVersion: Int = 1, payload: String = "<html></html>") =
        UiBundleResolver.UiBundleManifest(
            schemaVersion = 1,
            bundleVersion = bundleVersion,
            minShellVersion = minShellVersion,
            payload = payload
        )

    // ── bubble-remote-ui-bundle-resolution-01 (Scenario Outline) ────────

    @Test
    fun `rendering a served bundle that is newer than the cached one`() {
        val served = manifest(bundleVersion = 3)
        val cached = manifest(bundleVersion = 2)

        val resolution = UiBundleResolver.resolve(served, servedReachable = true, cachedManifest = cached, installedShellVersion = 10)

        assertEquals(UiBundleResolver.UiBundleOutcome.FRESH, resolution.outcome)
        assertEquals(served, resolution.bundle)
        assertNull(resolution.shellBehindReason)
    }

    @Test
    fun `keeping the cached bundle when the served bundle is not newer`() {
        val served = manifest(bundleVersion = 2)
        val cached = manifest(bundleVersion = 2)

        val resolution = UiBundleResolver.resolve(served, servedReachable = true, cachedManifest = cached, installedShellVersion = 10)

        assertEquals(UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
        assertEquals(cached, resolution.bundle)
    }

    @Test
    fun `rejecting a malformed bundle whole and keeping the last good one`() {
        // A malformed served response is already rejected (null) by
        // parseUiBundleManifest before resolve() is ever called - the
        // caller passes the bridge-reachable, nothing-usable-served shape.
        val malformed = UiBundleResolver.parseUiBundleManifest("""{"schemaVersion":1,"bundleVersion":"not-a-number","payload":"x"}""")
        assertNull(malformed)

        val cached = manifest(bundleVersion = 2)
        val resolution = UiBundleResolver.resolve(malformed, servedReachable = true, cachedManifest = cached, installedShellVersion = 10)

        assertEquals(UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
        assertEquals(cached, resolution.bundle)
    }

    @Test
    fun `refusing a bundle whose minimum shell version exceeds the installed shell`() {
        val served = manifest(bundleVersion = 5, minShellVersion = 99)
        val cached = manifest(bundleVersion = 2, minShellVersion = 1)

        val resolution = UiBundleResolver.resolve(served, servedReachable = true, cachedManifest = cached, installedShellVersion = 10)

        assertEquals(UiBundleResolver.UiBundleOutcome.CACHED, resolution.outcome)
        assertEquals(cached, resolution.bundle)
        assertEquals("served bundle requires a newer shell", resolution.shellBehindReason)
    }

    @Test
    fun `falling back to the native Talk surface when no bundle is available`() {
        val resolution = UiBundleResolver.resolve(
            servedManifest = null,
            servedReachable = true,
            cachedManifest = null,
            installedShellVersion = 10
        )

        assertEquals(UiBundleResolver.UiBundleOutcome.BARE, resolution.outcome)
        assertNull(resolution.bundle)
        assertNull(resolution.shellBehindReason)
    }

    @Test
    fun `marking the rendered bundle stale when the bridge is unreachable`() {
        val cached = manifest(bundleVersion = 2)

        val resolution = UiBundleResolver.resolve(
            servedManifest = null,
            servedReachable = false,
            cachedManifest = cached,
            installedShellVersion = 10
        )

        assertEquals(UiBundleResolver.UiBundleOutcome.STALE, resolution.outcome)
        assertEquals(cached, resolution.bundle)
    }

    // ── additional example coverage (not its own Scenario Outline row,
    //    but exercised by the invariant property tests too) ─────────────

    @Test
    fun `a shell-behind bundle with nothing cached falls back to bare, carrying the reason`() {
        val served = manifest(bundleVersion = 5, minShellVersion = 99)

        val resolution = UiBundleResolver.resolve(served, servedReachable = true, cachedManifest = null, installedShellVersion = 10)

        assertEquals(UiBundleResolver.UiBundleOutcome.BARE, resolution.outcome)
        assertNull(resolution.bundle)
        assertEquals("served bundle requires a newer shell", resolution.shellBehindReason)
    }

    @Test
    fun `an unreachable bridge with no compatible cache falls back to bare`() {
        val cachedShellBehind = manifest(bundleVersion = 2, minShellVersion = 99)

        val resolution = UiBundleResolver.resolve(
            servedManifest = null,
            servedReachable = false,
            cachedManifest = cachedShellBehind,
            installedShellVersion = 10
        )

        assertEquals(UiBundleResolver.UiBundleOutcome.BARE, resolution.outcome)
        assertNull(resolution.bundle)
        assertEquals("cached bundle requires a newer shell", resolution.shellBehindReason)
    }

    @Test
    fun `a well-formed manifest parses to exactly its fields`() {
        val parsed = UiBundleResolver.parseUiBundleManifest(
            """{"schemaVersion":1,"bundleVersion":7,"minShellVersion":3,"payload":"<html></html>"}"""
        )

        assertNotNull(parsed)
        assertEquals(1, parsed!!.schemaVersion)
        assertEquals(7, parsed.bundleVersion)
        assertEquals(3, parsed.minShellVersion)
        assertEquals("<html></html>", parsed.payload)
    }
}
