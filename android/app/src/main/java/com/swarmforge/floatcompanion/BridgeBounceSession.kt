package com.swarmforge.floatcompanion

/**
 * BL-763: pure decision logic behind bridge-bounce session refresh
 * (constitution invariants, coder-authored per BL-654). No android.* type
 * appears in this file's own signatures, so it runs under the JVM unit
 * suite with no device or emulator (Testability Boundary — Bubble).
 * [TalkEngine.syncBridgeInstanceAndSession] owns all android.* state (the
 * network calls, the stored preference) and reduces bridge responses to
 * these plain inputs before calling in.
 */
object BridgeBounceSession {

    data class Decision(
        val shouldResetSession: Boolean,
        /** What CompanionPrefs' last-known-instanceId should become after this sync. */
        val nextKnownInstanceId: String
    )

    /**
     * Invariant 2 (BL-763, BL-654): when Bubble sees a NEW bridge instanceId
     * and bounce-auto-session-reset is enabled, it opens a fresh Let's Talk
     * session once — not on every poll against the same instance.
     *
     * A blank [lastKnownInstanceId] (never synced before, e.g. a fresh
     * install) is never itself a "change" — there is nothing to reset FROM.
     * A blank [freshInstanceId] (the bridge fetch failed) never triggers a
     * reset and never overwrites the last-known value, so a transient
     * failure can't erase what the next successful poll needs to compare
     * against.
     */
    fun decide(lastKnownInstanceId: String, freshInstanceId: String, autoResetEnabled: Boolean): Decision {
        if (freshInstanceId.isBlank()) {
            return Decision(shouldResetSession = false, nextKnownInstanceId = lastKnownInstanceId)
        }
        val changed = lastKnownInstanceId.isNotBlank() && freshInstanceId != lastKnownInstanceId
        return Decision(
            shouldResetSession = changed && autoResetEnabled,
            nextKnownInstanceId = freshInstanceId
        )
    }
}
