package com.swarmforge.floatcompanion

import java.io.UnsupportedEncodingException
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/**
 * BL-716 dns-05: parses the one-tap re-pair link posted to the operator's
 * Telegram topic whenever the quick-tunnel hostname changes
 * (swarmforge-bubble://pair?url=...&token=...). Near-term discovery channel
 * picked for the ticket over a stable hostname or a polled discovery doc.
 *
 * BL-769: takes the link as a plain String and parses it with java.net.URI
 * (a JVM class, not android.net.Uri) so this logic runs under a plain JUnit
 * test with no Android framework stub involved.
 */
object PairingDeepLink {
    private const val SCHEME = "swarmforge-bubble"
    private const val HOST = "pair"

    data class Pairing(val baseUrl: String, val token: String)

    fun parse(link: String): Pairing? {
        val uri = try {
            URI(link)
        } catch (e: URISyntaxException) {
            return null
        }
        if (!uri.scheme.equals(SCHEME, ignoreCase = true) || uri.host != HOST) return null
        val params = parseQueryParams(uri.rawQuery)
        val url = params["url"]?.trim().orEmpty()
        val token = params["token"]?.trim().orEmpty()
        if (url.isEmpty() || token.isEmpty()) return null
        return Pairing(url, token)
    }

    private fun parseQueryParams(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        return rawQuery.split("&")
            .mapNotNull { pair ->
                if (pair.isEmpty()) return@mapNotNull null
                val separator = pair.indexOf('=')
                val key = if (separator >= 0) pair.substring(0, separator) else pair
                val value = if (separator >= 0) pair.substring(separator + 1) else ""
                decode(key) to decode(value)
            }
            .toMap()
    }

    private fun decode(value: String): String = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (e: UnsupportedEncodingException) {
        value
    }
}
