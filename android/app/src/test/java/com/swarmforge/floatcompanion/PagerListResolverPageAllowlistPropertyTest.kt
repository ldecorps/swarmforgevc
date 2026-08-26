package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.random.Random

/**
 * BL-829 invariant 2 (BL-654 coder-authored property test): "Only pages
 * the resolved bundle manifest names are ever loaded: the shell's WebView
 * never navigates to a path or origin the manifest did not authorize."
 *
 * Encoded against [PagerListResolver.resolvePageId], the allowlist lookup
 * every page open goes through. Per the generator-reach requirement, the
 * "unauthorized" id in each trial is DERIVED from an allowed id (never
 * drawn independently) — appending a random suffix to a real id is exactly
 * the transformation a fuzzy/prefix-matching implementation might wrongly
 * accept, so every generated pair is a genuine collision candidate by
 * construction, not an unrelated random string that would pass trivially.
 */
class PagerListResolverPageAllowlistPropertyTest {

    private fun randomAllowedPages(rng: Random): List<PagerListResolver.RemotePage> {
        val count = rng.nextInt(1, 6)
        return (0 until count).map { i ->
            val id = "page-${rng.nextInt(100_000)}-$i"
            PagerListResolver.RemotePage(id = id, title = "Title $i", entryPath = "path/$i", order = i)
        }
    }

    @Test
    fun `resolving an allowed id returns exactly that page`() {
        val rng = Random(20260817301L)
        repeat(500) {
            val pages = randomAllowedPages(rng)
            val target = pages[rng.nextInt(pages.size)]

            val resolved = PagerListResolver.resolvePageId(pages, target.id)

            assertEquals("pages=$pages target=$target", target, resolved)
        }
    }

    @Test
    fun `resolving an id derived from, but not equal to, an allowed id is refused`() {
        val rng = Random(20260817302L)
        repeat(500) {
            val pages = randomAllowedPages(rng)
            val allowedIds = pages.map { it.id }.toSet()
            val base = pages[rng.nextInt(pages.size)].id
            // Derive the unauthorized id FROM an allowed one — the exact
            // transformation a substring/prefix-matching bug would conflate
            // with a real match, not an unrelated random string.
            var derived = base + "-" + rng.nextInt(1_000_000)
            while (derived in allowedIds) {
                derived += "x"
            }

            val resolved = PagerListResolver.resolvePageId(pages, derived)

            assertNull("pages=$pages derived=$derived", resolved)
        }
    }

    @Test
    fun `an empty page list refuses every id`() {
        val rng = Random(20260817303L)
        repeat(50) {
            val requested = "page-${rng.nextInt(100_000)}"
            assertNull(PagerListResolver.resolvePageId(emptyList(), requested))
        }
    }

    /**
     * Non-vacuity companion: a prefix-matching resolver (an easy mistake
     * when ids are hierarchical-looking) would accept the derived id above
     * — demonstrate that, then confirm the real resolver does not share it.
     */
    @Test
    fun `a naive prefix-matching resolver would fail this property`() {
        fun naiveResolvePageId(pages: List<PagerListResolver.RemotePage>, requestedId: String) =
            pages.firstOrNull { requestedId.startsWith(it.id) }

        val pages = listOf(PagerListResolver.RemotePage("live", "Live", "live", 0))
        val derived = "live-extra-suffix"

        assertEquals(pages[0], naiveResolvePageId(pages, derived))
        assertNull(PagerListResolver.resolvePageId(pages, derived))
    }
}
