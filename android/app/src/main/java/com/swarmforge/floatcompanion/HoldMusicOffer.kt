package com.swarmforge.floatcompanion

/**
 * BL-765: pure decision logic behind whether hold music is offered right
 * now (constitution invariants, coder-authored per BL-654). No android.*
 * type appears in this file's own signatures, so it runs under the JVM
 * unit suite with no device or emulator (Testability Boundary — Bubble).
 * [TalkEngine] owns all android.* state (the user toggle, the pause state,
 * the synced remote capability) and reduces it to these plain inputs
 * before calling in.
 */
object HoldMusicOffer {

    /**
     * remote-config-03: disabling the holdMusic capability remotely removes
     * it without a new APK. A remote disable overrides the user's own
     * on/off toggle and the not-paused check alike — all three must hold
     * for hold music to be offered.
     */
    fun shouldOffer(holdMusicOn: Boolean, pausedAll: Boolean, capabilityEnabled: Boolean): Boolean =
        holdMusicOn && !pausedAll && capabilityEnabled
}
