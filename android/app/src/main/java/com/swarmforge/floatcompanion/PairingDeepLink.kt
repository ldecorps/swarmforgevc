package com.swarmforge.floatcompanion

import android.net.Uri

/**
 * BL-716 dns-05: parses the one-tap re-pair link posted to the operator's
 * Telegram topic whenever the quick-tunnel hostname changes
 * (swarmforge-bubble://pair?url=...&token=...). Near-term discovery channel
 * picked for the ticket over a stable hostname or a polled discovery doc.
 */
object PairingDeepLink {
    private const val SCHEME = "swarmforge-bubble"
    private const val HOST = "pair"

    data class Pairing(val baseUrl: String, val token: String)

    fun parse(uri: Uri): Pairing? {
        if (!uri.scheme.equals(SCHEME, ignoreCase = true) || uri.host != HOST) return null
        val url = uri.getQueryParameter("url")?.trim().orEmpty()
        val token = uri.getQueryParameter("token")?.trim().orEmpty()
        if (url.isEmpty() || token.isEmpty()) return null
        return Pairing(url, token)
    }
}
