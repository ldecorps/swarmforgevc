package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * BL-769: PairingDeepLink.parse takes a plain String (java.net.URI under the
 * hood), so this runs on the JVM with no android.net.Uri stub involved.
 */
class PairingDeepLinkTest {

    @Test
    fun `parses a well-formed pairing link`() {
        val pairing = PairingDeepLink.parse(
            "swarmforge-bubble://pair?url=https%3A%2F%2Ftunnel.example%2Fbridge&token=abc123"
        )

        assertEquals(PairingDeepLink.Pairing("https://tunnel.example/bridge", "abc123"), pairing)
    }

    @Test
    fun `trims whitespace around extracted values`() {
        val pairing = PairingDeepLink.parse(
            "swarmforge-bubble://pair?url=%20https%3A%2F%2Ftunnel.example%20&token=%20abc123%20"
        )

        assertEquals(PairingDeepLink.Pairing("https://tunnel.example", "abc123"), pairing)
    }

    @Test
    fun `rejects a link with the wrong scheme`() {
        assertNull(PairingDeepLink.parse("https://pair?url=https://tunnel.example&token=abc123"))
    }

    @Test
    fun `rejects a link with the wrong host`() {
        assertNull(PairingDeepLink.parse("swarmforge-bubble://not-pair?url=https://tunnel.example&token=abc123"))
    }

    @Test
    fun `rejects a link missing the url param`() {
        assertNull(PairingDeepLink.parse("swarmforge-bubble://pair?token=abc123"))
    }

    @Test
    fun `rejects a link missing the token param`() {
        assertNull(PairingDeepLink.parse("swarmforge-bubble://pair?url=https://tunnel.example"))
    }

    @Test
    fun `rejects a link with a blank url param`() {
        assertNull(PairingDeepLink.parse("swarmforge-bubble://pair?url=%20&token=abc123"))
    }

    @Test
    fun `rejects an unparsable link`() {
        assertNull(PairingDeepLink.parse("not a uri at all ::"))
    }
}
