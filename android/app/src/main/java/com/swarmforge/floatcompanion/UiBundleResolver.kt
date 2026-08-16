package com.swarmforge.floatcompanion

import org.json.JSONObject

/**
 * BL-825 slice A: decides which UI bundle Bubble renders, from what the
 * bridge served this session, what is cached on the device, and which
 * shell (this APK) is installed. Pure decision logic — no `android.*` type
 * in any signature here (Testability Boundary — Bubble, BL-769).
 * [BridgeClient.resolveUiBundle] is the thin device edge that gathers
 * these inputs (network fetch, file cache) and calls in.
 *
 * Versions (`bundleVersion`, `minShellVersion`, and the installed shell's
 * own version the caller supplies) are plain increasing integers, the same
 * ordering convention every sibling remote document in this app already
 * uses (`letsTalkBubbleConfig`'s `schemaVersion`, `letsTalkChiptunes`'s
 * `version`, the companion manifest's `formatVersion`) — "semver-style"
 * here means strictly-ordered comparison, not dotted major.minor.patch
 * parsing, which no other part of this app does either.
 */
object UiBundleResolver {

    /** A UI bundle: the version it is served/cached at, the shell floor it requires, and its opaque content. */
    data class UiBundleManifest(
        val schemaVersion: Int,
        val bundleVersion: Int,
        val minShellVersion: Int,
        val payload: String
    )

    enum class UiBundleOutcome { FRESH, CACHED, STALE, BARE }

    /**
     * @param outcome which of the four states to render.
     * @param bundle the bundle to render; null only for [UiBundleOutcome.BARE] (native Talk only).
     * @param shellBehindReason non-null only when a bundle was withheld for requiring
     *   a newer shell than is installed — the reason slice C turns into an update prompt.
     */
    data class UiBundleResolution(
        val outcome: UiBundleOutcome,
        val bundle: UiBundleManifest?,
        val shellBehindReason: String?
    )

    private fun usable(manifest: UiBundleManifest?, installedShellVersion: Int): UiBundleManifest? =
        manifest?.takeIf { it.minShellVersion <= installedShellVersion }

    private fun shellBehindReason(manifest: UiBundleManifest?, installedShellVersion: Int, label: String): String? =
        if (manifest != null && manifest.minShellVersion > installedShellVersion) {
            "$label bundle requires a newer shell"
        } else {
            null
        }

    /**
     * BL-654 invariants 1 and 3 (coder-authored property tests in
     * UiBundleResolverNeverThrowsPropertyTest / UiBundleResolverEvidenceConfidencePropertyTest):
     * always returns cleanly (so a caller can always fall back to native Talk),
     * never marks an unconfirmed cached bundle as current, and never returns
     * a bundle whose `minShellVersion` this shell cannot honour.
     *
     * @param servedManifest the bridge's manifest this session — null when
     *   nothing was served, or a malformed response was already rejected
     *   whole by [parseUiBundleManifest] upstream.
     * @param servedReachable false when the bridge could not be reached at
     *   all this session; a reachable bridge that served nothing or a
     *   malformed body still passes true here with `servedManifest` null.
     * @param cachedManifest the last known-good bundle, or null if none.
     * @param installedShellVersion this shell's own version — read by the
     *   caller, never here (no `android.*` type in this signature).
     */
    fun resolve(
        servedManifest: UiBundleManifest?,
        servedReachable: Boolean,
        cachedManifest: UiBundleManifest?,
        installedShellVersion: Int
    ): UiBundleResolution {
        val servedUsable = usable(servedManifest, installedShellVersion)
        val cachedUsable = usable(cachedManifest, installedShellVersion)

        if (!servedReachable) {
            return if (cachedUsable != null) {
                UiBundleResolution(UiBundleOutcome.STALE, cachedUsable, null)
            } else {
                UiBundleResolution(UiBundleOutcome.BARE, null, shellBehindReason(cachedManifest, installedShellVersion, "cached"))
            }
        }

        if (servedUsable != null) {
            val servedIsNewer = cachedUsable == null || servedUsable.bundleVersion > cachedUsable.bundleVersion
            return if (servedIsNewer) {
                UiBundleResolution(UiBundleOutcome.FRESH, servedUsable, null)
            } else {
                UiBundleResolution(UiBundleOutcome.CACHED, cachedUsable, null)
            }
        }

        // Nothing usable was served this session (nothing served, malformed
        // upstream, or shell-behind): fall back to the cache.
        val servedShellBehind = shellBehindReason(servedManifest, installedShellVersion, "served")
        return if (cachedUsable != null) {
            UiBundleResolution(UiBundleOutcome.CACHED, cachedUsable, servedShellBehind)
        } else {
            UiBundleResolution(
                UiBundleOutcome.BARE,
                null,
                servedShellBehind ?: shellBehindReason(cachedManifest, installedShellVersion, "cached")
            )
        }
    }

    /**
     * BL-654 invariant 2 (coder-authored property test in
     * UiBundleResolverParseWholeOrNothingPropertyTest): whole-document
     * rejection, same shape as [BridgeClient.parseBubbleConfig] /
     * [BridgeClient.parseChiptunesCatalog] — any missing field or
     * wrong-typed field rejects the entire document (`null`), never a
     * partially-populated manifest.
     */
    /** Accepts Int or Long (org.json's own ambiguity for a whole-number literal); rejects every other type. */
    private fun wholeIntOrNull(json: JSONObject, key: String): Int? =
        when (val value = json.opt(key)) {
            is Int -> value
            is Long -> value.toInt()
            else -> null
        }

    fun parseUiBundleManifest(raw: String): UiBundleManifest? {
        return try {
            val json = JSONObject(raw)
            val schemaVersion = wholeIntOrNull(json, "schemaVersion") ?: return null
            val bundleVersion = wholeIntOrNull(json, "bundleVersion") ?: return null
            val minShellVersion = wholeIntOrNull(json, "minShellVersion") ?: return null
            val payload = json.opt("payload") as? String ?: return null
            if (payload.isEmpty()) return null
            UiBundleManifest(schemaVersion, bundleVersion, minShellVersion, payload)
        } catch (_: Exception) {
            null
        }
    }
}
