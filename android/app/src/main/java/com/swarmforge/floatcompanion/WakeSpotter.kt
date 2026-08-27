package com.swarmforge.floatcompanion

/**
 * BL-845: on-device "hey bubble" wake spotting — the decision half.
 *
 * No `android.*` type appears in this file's own signatures, so it runs under
 * the JVM unit suite with no device or emulator (constitution: Testability
 * Boundary — Bubble). The spotter ENGINE — whatever actually hears the phrase
 * on the phone's own CPU/NPU — is injected through [Engine], exactly the way
 * BL-844 injects its clock. Choosing that engine is deliberately not this
 * slice's call: it brings a licence and a model file into the APK.
 *
 * Three invariants shape this module:
 *
 *  1. Passive listening is silent to the world. [onHeard] returns
 *     [Decision.Ignore] or [Decision.Wake] and nothing else - there is no arm
 *     that can produce a bridge request or a cloud speech call, and
 *     [Decision.Ignore] carries no heard text onward at all. Android's stock
 *     SpeechRecognizer is not usable on this path precisely because it is
 *     frequently cloud-backed, which would make "passive" mean "streaming the
 *     room to a server".
 *
 *  2. The wake phrase is never part of the request. [strip] runs on the way
 *     INTO the decision, so a [Decision.Wake] cannot be constructed carrying
 *     it - the phrase has no route to a turn even if a caller forgets.
 *
 *  3. Colour tells the truth about the mic. Red is derived from
 *     [capturesForModel], not chosen per state by hand, so a new state cannot
 *     be added as red without also declaring that it captures audio for the
 *     model. Passive listening is teal and captures nothing.
 */
object WakeSpotter {

    /** v1 spots this phrase only; variants and accent tuning are a later pass. */
    const val WAKE_PHRASE = "hey bubble"

    /**
     * The on-device spotter. Deliberately an interface with no implementation
     * in this slice: the engine choice (Porcupine-class or an equivalent open
     * on-device model) brings a licence and a model file, and is the human's
     * to make. Whatever implements it must never reach the network.
     */
    fun interface Engine {
        /** Starts spotting; [onHeard] receives each candidate utterance. */
        fun start(onHeard: (String) -> Unit)
    }

    sealed class Decision {
        /** Heard, and dropped on the phone. Carries a REASON, never the text. */
        data class Ignore(val reason: String) : Decision()

        /**
         * The phrase was spotted. [request] is what followed it, already
         * stripped; [submitsTurn] is false for a bare wake, which opens the
         * session and asks nothing.
         */
        data class Wake(val request: String) : Decision() {
            val submitsTurn: Boolean get() = request.isNotBlank()
        }
    }

    data class Acknowledgement(
        /** Always true: the wake is confirmed on the phone, never after a bridge check. */
        val acknowledgedLocally: Boolean,
        /** Set only when the follow-on turn cannot be made, and says why. */
        val turnFailureReason: String?
    )

    enum class BubbleColour(val resourceName: String, val hex: String) {
        Green("sf_bubble", "#238636"),
        SoftTeal("sf_bubble_passive", "#2A9D8F"),
        Red("sf_bubble_recording", "#DA3633"),
        Amber("sf_bubble_thinking", "#D29922"),
        Blue("sf_bubble_speaking", "#1F6FEB"),
        Gray("sf_bubble_paused", "#6E7681")
    }

    enum class BubbleState { Ready, PassiveWake, ActiveListen, Thinking, Speaking, Paused, Error }

    private fun normalize(text: String): String =
        text.lowercase().filter { it.isLetterOrDigit() || it.isWhitespace() }.trim().replace(Regex("\\s+"), " ")

    private val NORMALIZED_PHRASE = normalize(WAKE_PHRASE)

    /**
     * Whatever followed the wake phrase, or the text unchanged if it never
     * carried one. Repeated phrases are stripped too: no returned text may
     * contain the phrase.
     */
    fun strip(heard: String): String {
        var remainder = normalize(heard)
        while (remainder == NORMALIZED_PHRASE || remainder.startsWith("$NORMALIZED_PHRASE ")) {
            remainder = remainder.removePrefix(NORMALIZED_PHRASE).trim()
        }
        return remainder
    }

    fun isWake(heard: String): Boolean {
        val normalized = normalize(heard)
        return normalized == NORMALIZED_PHRASE || normalized.startsWith("$NORMALIZED_PHRASE ")
    }

    /**
     * The whole passive decision surface. Invariant 1 lives in the return
     * type: neither arm can reach the network, and [Decision.Ignore] deliberately
     * carries a reason rather than the utterance - an ignored phrase must not
     * travel even as far as a log line.
     */
    fun onHeard(heard: String): Decision =
        if (isWake(heard)) {
            Decision.Wake(strip(heard))
        } else {
            Decision.Ignore("no wake phrase in the utterance; nothing left the phone")
        }

    /**
     * The wake is acknowledged on the phone FIRST, and only then is the turn
     * attempted - so with the network off the phrase still wakes Bubble and
     * the follow-on turn fails loudly with its reason instead of silently.
     */
    fun acknowledge(bridgeReachable: Boolean): Acknowledgement =
        Acknowledgement(
            acknowledgedLocally = true,
            turnFailureReason = if (bridgeReachable) {
                null
            } else {
                "the bridge could not be reached; the wake was acknowledged on this phone but the turn was not sent"
            }
        )

    /** Whether this state has the mic open FOR THE MODEL. Red follows from this. */
    fun capturesForModel(state: BubbleState): Boolean = state == BubbleState.ActiveListen

    fun colourFor(state: BubbleState): BubbleColour = when {
        // Derived, not hand-assigned: a new state cannot become red without
        // also declaring that it captures audio for the model.
        capturesForModel(state) -> BubbleColour.Red
        state == BubbleState.Error -> BubbleColour.Red
        state == BubbleState.PassiveWake -> BubbleColour.SoftTeal
        state == BubbleState.Thinking -> BubbleColour.Amber
        state == BubbleState.Speaking -> BubbleColour.Blue
        state == BubbleState.Paused -> BubbleColour.Gray
        else -> BubbleColour.Green
    }
}
