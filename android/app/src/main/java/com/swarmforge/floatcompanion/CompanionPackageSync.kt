package com.swarmforge.floatcompanion

/**
 * BL-907: the sync and cache DECISIONS behind Bubble's offline package
 * store — pure, no `android.*` type in any signature (Bubble testability
 * boundary, BL-769). [CompanionPackageStore] wires this against real device
 * file storage and [BridgeClient]'s HTTP calls; this object only decides
 * what a sync does to what is already held, and what a read answers.
 */
object CompanionPackageSync {

    /** A package as held on the device: content and the generation it was fetched at, always together. */
    data class HeldPackage(
        val name: String,
        val generation: String,
        val format: String,
        val formatVersion: Int,
        val data: String
    )

    sealed class ReadResult {
        data class Held(val pkg: HeldPackage) : ReadResult()
        object NothingHeld : ReadResult()
    }

    /** BL-907 scenario "before any sync a read reports nothing is held, rather than an empty package". */
    fun read(held: HeldPackage?): ReadResult =
        if (held == null) ReadResult.NothingHeld else ReadResult.Held(held)

    /** The generation to ask the bridge for: the held copy's, so an unchanged package costs no body. */
    fun requestedGeneration(held: HeldPackage?): String? = held?.generation

    data class SyncFailure(val name: String, val reason: String)

    /**
     * BL-907 invariants 1 and 2 (BL-654 coder-authored property tests in
     * CompanionPackageSyncPropertyTest): applies one package's fetch outcome
     * onto what is currently held for it.
     *
     * Invariant 1 — a held package and its generation always come from the
     * SAME fetch: [BridgeClient.CompanionPackageFetch.Ok] replaces the whole
     * record (generation, format, formatVersion, data) together, never one
     * field from the new fetch and another left over from what was held.
     *
     * Invariant 2 — no sync outcome leaves the device holding less than
     * before: every non-Ok outcome (Unchanged, Unknown, Unreadable,
     * ConnectionFailure, Interrupted) returns [held] unchanged, and only
     * the failure outcomes are reported as a [SyncFailure].
     */
    fun applyFetch(
        name: String,
        held: HeldPackage?,
        fetch: BridgeClient.CompanionPackageFetch
    ): Pair<HeldPackage?, SyncFailure?> {
        return when (fetch) {
            is BridgeClient.CompanionPackageFetch.Ok ->
                HeldPackage(fetch.name, fetch.generation, fetch.format, fetch.formatVersion, fetch.data) to null
            is BridgeClient.CompanionPackageFetch.Unchanged ->
                held to null
            is BridgeClient.CompanionPackageFetch.Unknown ->
                held to SyncFailure(name, fetch.reason)
            is BridgeClient.CompanionPackageFetch.Unreadable ->
                held to SyncFailure(name, fetch.reason)
            is BridgeClient.CompanionPackageFetch.ConnectionFailure ->
                held to SyncFailure(name, fetch.reason)
            is BridgeClient.CompanionPackageFetch.Interrupted ->
                held to SyncFailure(name, fetch.reason)
        }
    }
}
