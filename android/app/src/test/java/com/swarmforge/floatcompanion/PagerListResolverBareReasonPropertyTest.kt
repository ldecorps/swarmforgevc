package com.swarmforge.floatcompanion

import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-829 invariant 3, pure-logic half (BL-654 coder-authored property
 * test): "A page that cannot render says why: the shell shows the reason
 * it has, and a blank WebView is never an acceptable rendering of a
 * failure."
 *
 * The device-surface half of this invariant — an individual page's
 * WebView 404/load failure carrying its own stated reason — is a real
 * per-request network/render outcome outside the JVM-testable boundary
 * (Testability Boundary — Bubble) and is verified instead by BL-829's
 * recorded manual procedure (step 3). This test encodes the part
 * [PagerListResolver.resolve] itself owns: the BARE pager state — the one
 * outcome this pure function fully controls end to end — always carries a
 * non-blank reason, and no other state carries one at all (so a caller can
 * never mistake "no reason set" for "nothing wrong").
 */
class PagerListResolverBareReasonPropertyTest {

    private fun randomPage(rng: Random) = PagerListResolver.RemotePage(
        id = "page-${rng.nextInt(100_000)}",
        title = "Title",
        entryPath = "path",
        order = rng.nextInt()
    )

    @Test
    fun `the bare state always carries a non-blank reason, and no other state carries one at all`() {
        val rng = Random(20260817401L)
        val outcomes = UiBundleResolver.UiBundleOutcome.entries
        repeat(500) {
            val outcome = outcomes[rng.nextInt(outcomes.size)]
            val pages = List(rng.nextInt(0, 4)) { randomPage(rng) }

            val result = PagerListResolver.resolve(outcome, pages)

            if (result.state == PagerListResolver.PagerState.BARE) {
                assertTrue("outcome=$outcome reason=${result.bareReason}", !result.bareReason.isNullOrBlank())
            } else {
                assertNull("outcome=$outcome state=${result.state}", result.bareReason)
            }
        }
    }

    /**
     * Non-vacuity companion: a resolver that renders BARE with a null
     * reason (the exact "blank WebView with nothing said" failure mode
     * this invariant forbids) would fail the property above — demonstrate
     * that, then confirm the real resolver does not share it.
     */
    @Test
    fun `a naive silent-bare resolver would fail this property`() {
        fun naiveResolve(outcome: UiBundleResolver.UiBundleOutcome): PagerListResolver.PagerList =
            if (outcome == UiBundleResolver.UiBundleOutcome.BARE) {
                PagerListResolver.PagerList(PagerListResolver.PagerState.BARE, listOf(PagerListResolver.PagerEntry.Talk), null)
            } else {
                PagerListResolver.resolve(outcome, emptyList())
            }

        val naive = naiveResolve(UiBundleResolver.UiBundleOutcome.BARE)
        assertNull(naive.bareReason)

        val real = PagerListResolver.resolve(UiBundleResolver.UiBundleOutcome.BARE, emptyList())
        assertTrue(!real.bareReason.isNullOrBlank())
    }
}
