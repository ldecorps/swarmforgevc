package com.swarmforge.floatcompanion

/**
 * BL-765 volume-06 (BL-654 coder-authored property test): "Music volume no
 * longer governs the reply voice" — the reply voice plays at full gain
 * regardless of the hold-music volume slider; only hold music's own volume
 * follows it. No android.* type appears in this file's own signature, so
 * it runs under the JVM unit suite (Testability Boundary — Bubble).
 * [TalkEngine] wires its one `ReplyAudioPlayer.setVolume` call through this
 * function instead of a literal, so a future edit that couples the two
 * volumes again breaks this test rather than shipping silently.
 */
object ReplyGain {
    @Suppress("UNUSED_PARAMETER")
    fun independentOfMusicVolume(musicVolumePercent: Int): Float = 1f
}
