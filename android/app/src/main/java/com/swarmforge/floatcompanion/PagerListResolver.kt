package com.swarmforge.floatcompanion

/**
 * BL-829: turns a resolved UI bundle (BL-825's [UiBundleResolver.UiBundleResolution])
 * into the pager's page list. Pure decision logic — no `android.*` type in
 * any signature here (Testability Boundary — Bubble, BL-769). [RemotePageHost]
 * is the thin device edge that actually loads a resolved [RemotePage] into a
 * WebView.
 *
 * Talk is never data this object returns — it is the shell's fixed native
 * page, always constructed at the pager's position 0 by the caller. What
 * this object guarantees (BL-654 invariant 1, [PagerListResolverTalkAlwaysFirstPropertyTest])
 * is that no manifest, however malformed or adversarial, can ever cause a
 * caller who follows [resolve]'s contract to omit it: [PagerEntry.Talk] is
 * always [PagerList.entries]'s first element.
 */
object PagerListResolver {

    /** One page the manifest named — already validated whole-or-nothing by [UiBundleResolver.parseUiBundleManifest]. */
    data class RemotePage(
        val id: String,
        val title: String,
        val entryPath: String,
        val order: Int
    )

    sealed class PagerEntry {
        object Talk : PagerEntry()
        data class Remote(val page: RemotePage) : PagerEntry()
    }

    enum class PagerState { NORMAL, STALE, BARE }

    /**
     * @param entries always starts with [PagerEntry.Talk]; remote pages (if
     *   any) follow, ordered by [RemotePage.order].
     * @param bareReason non-null only when [state] is [PagerState.BARE] —
     *   BL-829 invariant 3's pure-logic half: a bare pager always carries a
     *   stated reason, never a blank/null placeholder for the caller to
     *   render as nothing.
     */
    data class PagerList(
        val state: PagerState,
        val entries: List<PagerEntry>,
        val bareReason: String?
    )

    private const val BARE_REASON = "Screens are unavailable right now."

    fun resolve(
        outcome: UiBundleResolver.UiBundleOutcome,
        manifestPages: List<RemotePage>
    ): PagerList {
        if (outcome == UiBundleResolver.UiBundleOutcome.BARE) {
            return PagerList(PagerState.BARE, listOf(PagerEntry.Talk), BARE_REASON)
        }
        val state = if (outcome == UiBundleResolver.UiBundleOutcome.STALE) PagerState.STALE else PagerState.NORMAL
        val remoteEntries = honouredPages(manifestPages).map { PagerEntry.Remote(it) }
        return PagerList(state, listOf(PagerEntry.Talk) + remoteEntries, null)
    }

    /**
     * BL-829 invariant 2's pure-logic half: an entry path that would let the
     * WebView escape the bundle it was authorized from — absolute, another
     * origin, or a `..` traversal segment — is never something the shell can
     * honour, so it is dropped here rather than trusted downstream.
     */
    private fun isHonourableEntryPath(entryPath: String): Boolean {
        if (entryPath.isBlank()) return false
        if (entryPath.startsWith("/")) return false
        if (entryPath.contains("://")) return false
        if (entryPath.split('/').any { it == ".." }) return false
        return true
    }

    private fun honouredPages(pages: List<RemotePage>): List<RemotePage> =
        pages
            .filter { it.id.isNotBlank() && it.title.isNotBlank() && isHonourableEntryPath(it.entryPath) }
            .sortedBy { it.order }

    /**
     * BL-829 invariant 2: the allowlist itself — a page id not present in
     * `pages` is refused, never fabricated or fuzzy-matched.
     */
    fun resolvePageId(pages: List<RemotePage>, requestedId: String): RemotePage? =
        pages.firstOrNull { it.id == requestedId }
}
