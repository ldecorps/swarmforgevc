package com.swarmforge.floatcompanion

/**
 * BL-788 invariant 3: a pairing save must never overwrite a stored
 * credential with a blank one — absent input leaves the stored value
 * standing. CompanionPrefs.save previously wrote whatever it was handed
 * unconditionally, including a blank field mid-edit (e.g. onPause firing
 * while the human had cleared one box but not the other).
 */
object PairingSave {
    data class Result(val baseUrl: String, val token: String)

    /**
     * @param storedBaseUrl the currently persisted bridge URL (may be blank)
     * @param storedToken the currently persisted token (may be blank)
     * @param inputBaseUrl the URL just typed/received (may be blank)
     * @param inputToken the token just typed/received (may be blank)
     */
    fun merge(storedBaseUrl: String, storedToken: String, inputBaseUrl: String, inputToken: String): Result {
        val trimmedInputUrl = inputBaseUrl.trim()
        val trimmedInputToken = inputToken.trim()
        return Result(
            baseUrl = if (trimmedInputUrl.isNotEmpty()) normalizeUrl(trimmedInputUrl) else storedBaseUrl,
            token = if (trimmedInputToken.isNotEmpty()) trimmedInputToken else storedToken
        )
    }

    private fun normalizeUrl(raw: String): String {
        var url = raw.trimEnd('/')
        if (url.isNotEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
        return url
    }
}
