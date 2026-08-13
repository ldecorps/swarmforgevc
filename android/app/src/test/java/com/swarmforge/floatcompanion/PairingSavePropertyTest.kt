package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-788 invariant 3 (BL-654 coder-authored property test): "A pairing save
 * never overwrites a stored credential with a blank one; absent input leaves
 * the stored value standing." Encoded as: for any stored/input url+token
 * pair, drawn across blank, whitespace-only, and non-blank strings
 * (including unicode, punctuation, and slash-heavy content that could
 * confuse `normalizeUrl`), a trimmed-blank input field never changes its
 * stored counterpart, and a non-blank input field always replaces it per
 * `PairingSave`'s own documented trim/normalize rules — and never with a
 * blank result.
 */
class PairingSavePropertyTest {

    private val whitespaceChars = listOf(' ', '\t', '\n', '\r')
    private val ordinaryChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.:~éü中🙂!?"

    private fun randomBlankish(rng: Random): String {
        val len = rng.nextInt(0, 6)
        return (0 until len).joinToString("") { whitespaceChars[rng.nextInt(whitespaceChars.size)].toString() }
    }

    private fun randomOrdinaryCore(rng: Random): String {
        val len = rng.nextInt(1, 24)
        return (0 until len).joinToString("") { ordinaryChars[rng.nextInt(ordinaryChars.length)].toString() }
    }

    /**
     * Non-blank content, deliberately biased toward the slash-heavy shapes
     * that `normalizeUrl`'s `trimEnd('/')` step can collapse toward empty —
     * an all-slash string is astronomically unlikely under uniform sampling
     * over ~70 ordinary characters, so it must be constructed directly
     * rather than hoped for (BL-654 generator-reach).
     */
    private fun randomNonBlankCore(rng: Random): String = when (rng.nextInt(5)) {
        0 -> "/".repeat(rng.nextInt(1, 6))
        1 -> randomOrdinaryCore(rng) + "/".repeat(rng.nextInt(1, 4))
        else -> randomOrdinaryCore(rng)
    }

    private fun randomNonBlank(rng: Random): String =
        "${randomBlankish(rng)}${randomNonBlankCore(rng)}${randomBlankish(rng)}"

    private fun randomField(rng: Random): String = if (rng.nextInt(3) == 0) randomBlankish(rng) else randomNonBlank(rng)

    /** Mirrors PairingSave's own documented (private) normalizeUrl rule, independently, as the test oracle. */
    private fun expectedNormalizedUrl(trimmedInput: String): String {
        val trimmedSlashes = trimmedInput.trimEnd('/')
        var url = if (trimmedSlashes.isNotEmpty()) trimmedSlashes else trimmedInput
        if (url.isNotEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
        return url
    }

    @Test
    fun `blank input never overwrites a stored field, non-blank input always replaces it per PairingSave's own rules`() {
        val rng = Random(20260813788L)
        repeat(3_000) {
            val storedBaseUrl = randomField(rng)
            val storedToken = randomField(rng)
            val inputBaseUrl = randomField(rng)
            val inputToken = randomField(rng)

            val result = PairingSave.merge(storedBaseUrl, storedToken, inputBaseUrl, inputToken)

            if (inputBaseUrl.trim().isEmpty()) {
                assertEquals(
                    "blank/whitespace-only input url must leave the stored url standing verbatim " +
                        "(stored=[$storedBaseUrl], input=[$inputBaseUrl])",
                    storedBaseUrl,
                    result.baseUrl
                )
            } else {
                val expected = expectedNormalizedUrl(inputBaseUrl.trim())
                assertEquals(
                    "non-blank input url must replace the stored url, normalized per PairingSave's own rules " +
                        "(stored=[$storedBaseUrl], input=[$inputBaseUrl])",
                    expected,
                    result.baseUrl
                )
                assertTrue(
                    "a non-blank input url must never normalize down to a blank result " +
                        "(input=[$inputBaseUrl] would have blanked stored=[$storedBaseUrl])",
                    result.baseUrl.isNotBlank()
                )
            }

            if (inputToken.trim().isEmpty()) {
                assertEquals(
                    "blank/whitespace-only input token must leave the stored token standing verbatim " +
                        "(stored=[$storedToken], input=[$inputToken])",
                    storedToken,
                    result.token
                )
            } else {
                assertEquals(
                    "non-blank input token must replace the stored token, trimmed " +
                        "(stored=[$storedToken], input=[$inputToken])",
                    inputToken.trim(),
                    result.token
                )
            }
        }
    }

    @Test
    fun `an unconditional-overwrite merge would fail the never-blanks-a-stored-field property`() {
        // Non-vacuity companion: the exact regression invariant 3 exists to
        // prevent — CompanionPrefs.save previously wrote whatever it was
        // handed unconditionally, including a blank field mid-edit.
        fun unconditionalMerge(inputBaseUrl: String, inputToken: String) =
            PairingSave.Result(baseUrl = inputBaseUrl, token = inputToken)

        val rng = Random(20260813789L)
        var sawViolation = false
        repeat(200) {
            val storedBaseUrl = randomNonBlank(rng)
            val storedToken = randomNonBlank(rng)
            val inputBaseUrl = randomBlankish(rng)
            val inputToken = randomBlankish(rng)

            val broken = unconditionalMerge(inputBaseUrl, inputToken)
            if (broken.baseUrl != storedBaseUrl || broken.token != storedToken) {
                sawViolation = true
            }

            val real = PairingSave.merge(storedBaseUrl, storedToken, inputBaseUrl, inputToken)
            assertEquals("the real merge must keep the stored url standing", storedBaseUrl, real.baseUrl)
            assertEquals("the real merge must keep the stored token standing", storedToken, real.token)
        }
        assertTrue(
            "an unconditional-overwrite merge should have blanked at least one stored field " +
                "in this run — the property would be vacuous otherwise",
            sawViolation
        )
    }

    @Test
    fun `an all-slash input url would blank the stored url without the trimEnd collapse guard`() {
        // Non-vacuity companion for the normalizeUrl fix: reproduces the
        // specific defect this ticket's property test found — "///" trims
        // to itself (not blank per String.isBlank()), but the pre-fix
        // normalizeUrl's trimEnd('/') collapsed it to "", silently blanking
        // a non-blank stored credential.
        fun preFixNormalizeUrl(raw: String): String {
            var url = raw.trimEnd('/')
            if (url.isNotEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://$url"
            }
            return url
        }

        val allSlashInput = "///"
        assertTrue("the input itself must be non-blank for this to be a real defect", allSlashInput.isNotBlank())
        assertEquals(
            "pre-fix normalizeUrl collapses an all-slash input to blank",
            "",
            preFixNormalizeUrl(allSlashInput)
        )

        val result = PairingSave.merge(
            storedBaseUrl = "https://old-tunnel.example",
            storedToken = "old-token",
            inputBaseUrl = allSlashInput,
            inputToken = ""
        )
        assertTrue(
            "the real (fixed) merge must never blank the stored url for a non-blank input " +
                "(got baseUrl=[${result.baseUrl}])",
            result.baseUrl.isNotBlank()
        )
    }
}
