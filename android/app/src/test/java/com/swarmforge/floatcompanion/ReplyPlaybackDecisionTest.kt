package com.swarmforge.floatcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyPlaybackDecisionTest {

    private fun input(
        muted: Boolean = false,
        audioBase64: String? = null,
        replySpeechText: String? = null,
        replyText: String? = null,
        fallbackText: String = "fallback"
    ) = ReplyPlaybackDecision.InitialInput(muted, audioBase64, replySpeechText, replyText, fallbackText)

    @Test
    fun `muted always resolves to the one deliberate silent branch`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(muted = true, audioBase64 = "b64", replyText = "hello")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.Muted, decision)
    }

    @Test
    fun `audio present takes priority over text`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(audioBase64 = "b64", replyText = "hello")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.PlayAudio("b64"), decision)
    }

    @Test
    fun `blank audio falls through to speech text`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(audioBase64 = "   ", replyText = "hello")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.Speak("hello"), decision)
    }

    @Test
    fun `replySpeechText is preferred over replyText when both present`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(replySpeechText = "speech version", replyText = "raw version")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.Speak("speech version"), decision)
    }

    @Test
    fun `blank speech text falls back to replyText`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(replySpeechText = "  ", replyText = "raw version")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.Speak("raw version"), decision)
    }

    @Test
    fun `nothing at all speaks the fallback line, never silence`() {
        val decision = ReplyPlaybackDecision.decideInitial(input(fallbackText = "nothing to say"))
        assertEquals(ReplyPlaybackDecision.InitialAction.SpeakFallback("nothing to say"), decision)
    }

    @Test
    fun `blank-only fields speak the fallback line`() {
        val decision = ReplyPlaybackDecision.decideInitial(
            input(audioBase64 = "", replySpeechText = "  ", replyText = "", fallbackText = "nothing to say")
        )
        assertEquals(ReplyPlaybackDecision.InitialAction.SpeakFallback("nothing to say"), decision)
    }

    @Test
    fun `a fresh failure speaks the failure line`() {
        val decision = ReplyPlaybackDecision.decideAfterFailure(wasRecoveryAttempt = false, failureLine = "sorry")
        assertEquals(ReplyPlaybackDecision.RecoveryAction.SpeakFailureLine("sorry"), decision)
    }

    @Test
    fun `a failure during the recovery attempt itself completes without chaining further`() {
        val decision = ReplyPlaybackDecision.decideAfterFailure(wasRecoveryAttempt = true, failureLine = "sorry")
        assertEquals(ReplyPlaybackDecision.RecoveryAction.Complete, decision)
    }
}
