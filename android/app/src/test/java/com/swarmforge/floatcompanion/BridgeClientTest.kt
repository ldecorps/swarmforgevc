package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * BL-769: BridgeClient's exception classification is ordinary JVM logic (no
 * android.* imports) and is the pure logic behind the BL-716 defect — an
 * unresolvable host must be classified as a connection failure, never read
 * as a healthy state.
 */
class BridgeClientTest {

    @Test
    fun `classifies an unresolvable host as a stale-pairing connection failure`() {
        val message = BridgeClient.friendlyConnectionMessage(UnknownHostException("tunnel.example"))

        assertEquals("Can't find the bridge host — pairing URL may be stale.", message)
    }

    @Test
    fun `classifies a timeout distinctly from an unresolvable host`() {
        val timeoutMessage = BridgeClient.friendlyConnectionMessage(SocketTimeoutException())
        val hostMessage = BridgeClient.friendlyConnectionMessage(UnknownHostException())

        assertEquals("Bridge connection timed out — the tunnel may be down.", timeoutMessage)
        assertNotEquals(timeoutMessage, hostMessage)
    }

    @Test
    fun `classifies a refused connection distinctly from an unresolvable host`() {
        val connectMessage = BridgeClient.friendlyConnectionMessage(ConnectException())
        val hostMessage = BridgeClient.friendlyConnectionMessage(UnknownHostException())

        assertEquals("Can't connect to the bridge — the tunnel may be down.", connectMessage)
        assertNotEquals(connectMessage, hostMessage)
    }

    @Test
    fun `falls back to a generic io message for other io exceptions`() {
        val message = BridgeClient.friendlyConnectionMessage(IOException("broken pipe"))

        assertEquals("Bridge connection error — the tunnel may be down.", message)
    }

    @Test
    fun `never surfaces the raw exception dump for an unresolvable host`() {
        val rawDump = UnknownHostException("tunnel.example").toString()
        val message = BridgeClient.friendlyConnectionMessage(UnknownHostException("tunnel.example"))

        assertNotEquals(rawDump, message)
    }

    // BL-769 hardening: the `when` branches only cover IOException and its
    // subtypes; a non-IOException (e.g. a malformed-JSON response surfacing
    // as JSONException) falls through to the generic else branch, which was
    // otherwise unreached by any test.
    @Test
    fun `falls back to a message naming the exception class for a non-io exception`() {
        val message = BridgeClient.friendlyConnectionMessage(IllegalStateException("boom"))

        assertEquals("Connection error: boom", message)
    }

    @Test
    fun `falls back to the exception class name when a non-io exception has no message`() {
        val message = BridgeClient.friendlyConnectionMessage(IllegalStateException())

        assertEquals("Connection error: IllegalStateException", message)
    }
}
