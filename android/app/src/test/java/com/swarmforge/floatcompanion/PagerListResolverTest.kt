package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-829: PagerListResolver.resolve/resolvePageId are plain data
 * classes/Strings, no `android.*` import (BL-769 Testability Boundary) —
 * encodes each Scenario Outline row plus scenarios 04/05 of
 * specs/features/BL-829-bubble-remote-page-pager.feature at the pure
 * decision level.
 */
class PagerListResolverTest {

    private fun page(id: String, order: Int, entryPath: String = id) =
        PagerListResolver.RemotePage(id = id, title = id.replaceFirstChar { it.uppercase() }, entryPath = entryPath, order = order)

    private fun remoteIdsInOrder(list: PagerListResolver.PagerList): List<String> =
        list.entries.drop(1).map { (it as PagerListResolver.PagerEntry.Remote).page.id }

    // ── pager-list-resolution-03 (Scenario Outline) ──────────────────────

    @Test
    fun `ordering the pager entries as the manifest orders its pages`() {
        val pages = listOf(page("pipeline", order = 2), page("live", order = 0), page("health", order = 1))

        val result = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.FRESH, pages)

        assertEquals(listOf("live", "health", "pipeline"), remoteIdsInOrder(result))
    }

    @Test
    fun `dropping a page entry the installed shell cannot honour`() {
        val pages = listOf(
            page("live", order = 0),
            page("escape", order = 1, entryPath = "../evil"),
            page("absolute", order = 2, entryPath = "/etc/passwd"),
            page("otherOrigin", order = 3, entryPath = "http://evil.example/x")
        )

        val result = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.FRESH, pages)

        assertEquals(listOf("live"), remoteIdsInOrder(result))
    }

    @Test
    fun `offering Talk alone when the resolver returned the bare outcome`() {
        val pages = listOf(page("live", order = 0), page("pipeline", order = 1))

        val result = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.BARE, pages)

        assertEquals(PagerListResolver.PagerState.BARE, result.state)
        assertEquals(listOf(PagerListResolver.PagerEntry.Talk), result.entries)
        assertTrue(!result.bareReason.isNullOrBlank())
    }

    @Test
    fun `marking the pager entries stale when the resolver returned the stale outcome`() {
        val pages = listOf(page("live", order = 0))

        val result = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.STALE, pages)

        assertEquals(PagerListResolver.PagerState.STALE, result.state)
        assertEquals(listOf("live"), remoteIdsInOrder(result))
        assertNull(result.bareReason)
    }

    // ── pager-opens-on-talk-04 ────────────────────────────────────────────

    @Test
    fun `Talk remaining the pager's opening page whatever the bundle offers`() {
        val adversarial = listOf(
            emptyList(),
            listOf(page("talk", order = Int.MIN_VALUE)),
            listOf(page("live", order = -999), page("pipeline", order = 999))
        )
        val outcomes = listOf(
            UiBundleResolver.UiBundleOutcome.FRESH,
            UiBundleResolver.UiBundleOutcome.CACHED,
            UiBundleResolver.UiBundleOutcome.STALE,
            UiBundleResolver.UiBundleOutcome.BARE
        )

        for (outcome in outcomes) {
            for (pages in adversarial) {
                val result = PagerListResolver.resolve(outcome, pages)
                assertEquals("outcome=$outcome pages=$pages", PagerListResolver.PagerEntry.Talk, result.entries.first())
            }
        }
    }

    // ── page-allowlist-05 ─────────────────────────────────────────────────

    @Test
    fun `refusing to resolve a page id the manifest did not name`() {
        val pages = listOf(page("live", order = 0), page("pipeline", order = 1))

        assertEquals(pages[0], PagerListResolver.resolvePageId(pages, "live"))
        assertNull(PagerListResolver.resolvePageId(pages, "livex"))
        assertNull(PagerListResolver.resolvePageId(pages, "unknown-page"))
    }
}
