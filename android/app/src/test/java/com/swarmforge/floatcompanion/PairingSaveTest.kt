package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * BL-788 invariant 3: PairingSave.merge takes plain Strings, so this runs on
 * the JVM with no android.* stub involved (BL-769 Testability Boundary).
 */
class PairingSaveTest {

    @Test
    fun `a blank input url leaves the stored url standing`() {
        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = "",
            inputToken = "new-token"
        )

        assertEquals(PairingSave.Result("https://old-tunnel.example", "new-token"), result)
    }

    @Test
    fun `a blank input token leaves the stored token standing`() {
        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = "https://new-tunnel.example",
            inputToken = ""
        )

        assertEquals(PairingSave.Result("https://new-tunnel.example", "old-token"), result)
    }

    @Test
    fun `both blank leaves both stored values standing`() {
        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = "   ",
            inputToken = "  "
        )

        assertEquals(PairingSave.Result("https://old-tunnel.example", "old-token"), result)
    }

    @Test
    fun `a non-blank input url replaces the stored url, normalized`() {
        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = "new-tunnel.example/",
            inputToken = ""
        )

        assertEquals("https://new-tunnel.example", result.baseUrl)
    }

    @Test
    fun `a non-blank input token replaces the stored token, trimmed`() {
        val result = PairingSave.merge(
            storedBaseUrl = "",
            storedToken = "old-token",
            inputBaseUrl = "",
            inputToken = "  new-token  "
        )

        assertEquals("new-token", result.token)
    }

    @Test
    fun `both non-blank replaces both — a full re-pair`() {
        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = "https://new-tunnel.example",
            inputToken = "new-token"
        )

        assertEquals(PairingSave.Result("https://new-tunnel.example", "new-token"), result)
    }
}
