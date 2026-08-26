package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * BL-829 hardening: [RemotePageHost.resolveUrl] is pure logic (no
 * `android.*` type in its own signature — BL-769 Testability Boundary)
 * even though it lives inside [RemotePageHost], which otherwise owns the
 * `android.webkit` device edge. It joins the bridge base URL and a
 * [PagerListResolver]-honoured entry path into the URL the WebView loads;
 * an off-by-one here (a doubled or missing slash) either 404s a real page
 * or, worse, silently changes what "the manifest's entry path" resolves
 * to. Coverage was previously zero for this function.
 */
class RemotePageHostResolveUrlTest {

    @Test
    fun `joins a base URL with no trailing slash and an entry path with no leading slash`() {
        assertEquals("http://127.0.0.1:9/live", RemotePageHost.resolveUrl("http://127.0.0.1:9", "live"))
    }

    @Test
    fun `joins a base URL with a trailing slash and an entry path with a leading slash without doubling it`() {
        assertEquals("http://127.0.0.1:9/live", RemotePageHost.resolveUrl("http://127.0.0.1:9/", "/live"))
    }

    @Test
    fun `joins a base URL with a trailing slash and an entry path with no leading slash`() {
        assertEquals("http://127.0.0.1:9/live", RemotePageHost.resolveUrl("http://127.0.0.1:9/", "live"))
    }

    @Test
    fun `joins a base URL with no trailing slash and an entry path with a leading slash`() {
        assertEquals("http://127.0.0.1:9/live", RemotePageHost.resolveUrl("http://127.0.0.1:9", "/live"))
    }

    @Test
    fun `collapses multiple trailing and leading slashes to exactly one separator`() {
        assertEquals("http://127.0.0.1:9/live", RemotePageHost.resolveUrl("http://127.0.0.1:9///", "///live"))
    }

    @Test
    fun `preserves a nested entry path under a page's own subdirectory`() {
        assertEquals(
            "http://127.0.0.1:9/pipeline/index.html",
            RemotePageHost.resolveUrl("http://127.0.0.1:9", "pipeline/index.html")
        )
    }
}
