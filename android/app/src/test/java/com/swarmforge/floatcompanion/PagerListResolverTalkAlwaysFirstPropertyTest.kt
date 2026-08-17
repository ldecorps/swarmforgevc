package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-829 invariant 1, pure-logic half (BL-654 coder-authored property
 * test): "Talk stays native and reachable from every pager state: no
 * remote page, and no failure of every remote page at once, can leave the
 * human without the native Talk surface."
 *
 * The device-surface half of this invariant — the pager Activity actually
 * keeping Talk's fragment alive and reachable by swipe under a real WebView
 * failure — is outside the JVM-testable boundary (Testability Boundary —
 * Bubble) and is verified instead by BL-829's recorded manual procedure.
 * This test encodes the part [PagerListResolver.resolve] itself can
 * guarantee: an arbitrary, adversarial page list (including one that names
 * a page "talk", or claims an extreme sort order) can never displace
 * [PagerListResolver.PagerEntry.Talk] from the first entry, for any
 * resolver outcome.
 */
class PagerListResolverTalkAlwaysFirstPropertyTest {

    private fun randomPage(rng: Random): PagerListResolver.RemotePage {
        val id = listOf("talk", "live", "pipeline", "health", "", "  ", "../evil").random(rng)
        val entryPath = listOf("live", "../escape", "/absolute", "http://evil.example/x", "", id).random(rng)
        return PagerListResolver.RemotePage(
            id = id,
            title = listOf("Live", "", "  ").random(rng),
            entryPath = entryPath,
            order = rng.nextInt(Int.MIN_VALUE, Int.MAX_VALUE)
        )
    }

    private fun randomPages(rng: Random): List<PagerListResolver.RemotePage> =
        List(rng.nextInt(0, 6)) { randomPage(rng) }

    @Test
    fun `Talk is always the pager's first entry, for any outcome and any adversarial page list`() {
        val rng = Random(20260817201L)
        val outcomes = UiBundleResolver.UiBundleOutcome.entries
        repeat(500) {
            val outcome = outcomes[rng.nextInt(outcomes.size)]
            val pages = randomPages(rng)

            val result = PagerListResolver.resolve(outcome, pages)

            assertTrue("outcome=$outcome pages=$pages entries=${result.entries}", result.entries.isNotEmpty())
            assertEquals("outcome=$outcome pages=$pages", PagerListResolver.PagerEntry.Talk, result.entries.first())
        }
    }

    /**
     * Non-vacuity companion: a naive resolver that appends Talk LAST when
     * the manifest supplies any pages (an easy off-by-position mistake)
     * would fail this property — demonstrate that, then confirm the real
     * resolver does not share it.
     */
    @Test
    fun `a naive talk-last resolver would fail this property`() {
        fun naiveResolve(pages: List<PagerListResolver.RemotePage>): List<PagerListResolver.PagerEntry> =
            pages.map { PagerListResolver.PagerEntry.Remote(it) } + PagerListResolver.PagerEntry.Talk

        val pages = listOf(PagerListResolver.RemotePage("live", "Live", "live", 0))
        val naiveEntries = naiveResolve(pages)
        assertTrue(naiveEntries.first() != PagerListResolver.PagerEntry.Talk)

        val realResult = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.FRESH, pages)
        assertEquals(PagerListResolver.PagerEntry.Talk, realResult.entries.first())
    }
}
