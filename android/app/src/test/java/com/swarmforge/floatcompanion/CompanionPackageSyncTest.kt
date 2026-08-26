package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-907: CompanionPackageSync.applyFetch/read/requestedGeneration are
 * plain Strings/data classes, no `android.*` import (BL-769 Testability
 * Boundary) — encodes each scenario of
 * specs/features/BL-907-bubble-offline-package-sync.feature at the pure
 * decision level.
 */
class CompanionPackageSyncTest {

    private val ok = BridgeClient.CompanionPackageFetch.Ok(
        name = "backlog",
        generation = "aaaa1111",
        format = "json",
        formatVersion = 1,
        data = "{\"tickets\":[]}"
    )

    // ── first-sync-caches-and-labels-01 ─────────────────────────────────
    @Test
    fun `a first successful sync caches the served body at the generation it was served`() {
        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held = null, fetch = ok)

        assertEquals(ok.data, result?.data)
        assertEquals(ok.generation, result?.generation)
        assertNull(failure)
    }

    // ── unchanged-generation-costs-no-body-02 ───────────────────────────
    @Test
    fun `the held generation is what gets requested, so an unchanged package asks for its own generation`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{}")

        assertEquals("aaaa1111", CompanionPackageSync.requestedGeneration(held))
    }

    @Test
    fun `an unchanged answer keeps the cached copy exactly as held`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val unchanged = BridgeClient.CompanionPackageFetch.Unchanged("backlog", "aaaa1111")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, unchanged)

        assertEquals(held, result)
        assertNull(failure)
    }

    // ── moved-generation-replaces-and-relabels-03 ───────────────────────
    @Test
    fun `a moved generation replaces the cached copy and the label moves with it`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val moved = BridgeClient.CompanionPackageFetch.Ok("backlog", "bbbb2222", "json", 1, "{\"tickets\":[1]}")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, moved)

        assertEquals("bbbb2222", result?.generation)
        assertEquals("{\"tickets\":[1]}", result?.data)
        assertNull(failure)
    }

    // ── offline-reads-come-from-the-cache-04 ────────────────────────────
    @Test
    fun `a read is served from the cache, labelled at its own generation, no fetch involved`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")

        val result = CompanionPackageSync.read(held)

        assertEquals(CompanionPackageSync.ReadResult.Held(held), result)
    }

    // ── a-failed-sync-never-damages-the-cache-05 (Scenario Outline) ─────
    @Test
    fun `an unreachable bridge leaves the cached copy intact and reports the failure`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val fetch = BridgeClient.CompanionPackageFetch.ConnectionFailure("backlog", "Can't connect to the bridge")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, fetch)

        assertEquals(held, result)
        assertEquals(CompanionPackageSync.SyncFailure("backlog", "Can't connect to the bridge"), failure)
    }

    @Test
    fun `an unreadable package leaves the cached copy intact and reports the failure`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val fetch = BridgeClient.CompanionPackageFetch.Unreadable("backlog", "source unreadable")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, fetch)

        assertEquals(held, result)
        assertEquals(CompanionPackageSync.SyncFailure("backlog", "source unreadable"), failure)
    }

    @Test
    fun `an unknown package leaves the cached copy intact and reports the failure`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val fetch = BridgeClient.CompanionPackageFetch.Unknown("backlog", "no package named \"backlog\"")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, fetch)

        assertEquals(held, result)
        assertEquals(CompanionPackageSync.SyncFailure("backlog", "no package named \"backlog\""), failure)
    }

    @Test
    fun `an interrupted transfer leaves the cached copy intact and reports the failure`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "{\"tickets\":[]}")
        val fetch = BridgeClient.CompanionPackageFetch.Interrupted("backlog", "transfer interrupted: EOFException")

        val (result, failure) = CompanionPackageSync.applyFetch("backlog", held, fetch)

        assertEquals(held, result)
        assertEquals(CompanionPackageSync.SyncFailure("backlog", "transfer interrupted: EOFException"), failure)
    }

    // ── before-any-sync-a-read-says-so-06 ───────────────────────────────
    @Test
    fun `before any successful sync a read reports nothing held, not an empty package`() {
        val result = CompanionPackageSync.read(held = null)

        assertTrue(result is CompanionPackageSync.ReadResult.NothingHeld)
    }
}
