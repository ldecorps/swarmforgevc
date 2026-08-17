package com.swarmforge.floatcompanion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.material.checkbox.MaterialCheckBox
import com.swarmforge.floatcompanion.databinding.ActivityTalkPanelBinding
import com.swarmforge.floatcompanion.databinding.TalkPanelPageBinding

/**
 * UI shell for [TalkEngine]. Collapse finishes this activity but leaves the
 * engine (and mic) running in [OverlayService] when hands-free / mid-turn.
 *
 * BL-829: [rootBinding] is the pager shell (talk_panel_page.xml's old
 * content is now the pager's page 0, plus any remote pages the resolved
 * bundle names beside it); [binding] is that Talk page's own binding,
 * assigned once [TalkPagerAdapter] creates it — every method below that
 * referenced `binding.*` before BL-829 is unchanged, since page 0's view
 * IDs did not move, only which layout file and which point in the
 * lifecycle they are bound at.
 */
class TalkPanelActivity : AppCompatActivity(), TalkEngine.Listener {
    private lateinit var rootBinding: ActivityTalkPanelBinding
    private lateinit var binding: TalkPanelPageBinding
    private var engine: TalkEngine? = null
    private var pendingAutoRecord = false
    private var stoppingOverlay = false
    private var suppressToggleCallbacks = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            rootBinding = ActivityTalkPanelBinding.inflate(layoutInflater)
            setContentView(rootBinding.root)
            window?.setLayout(
                (resources.displayMetrics.widthPixels * 0.94f).toInt(),
                WindowManager.LayoutParams.WRAP_CONTENT
            )
        } catch (e: Exception) {
            Log.e(TAG, "panel inflate failed", e)
            Toast.makeText(this, "panel UI failed: ${e.message}", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        OverlayService.setBubbleVisible(this, false)
        val eng = try {
            OverlayService.requireEngine(this)
        } catch (e: Exception) {
            Log.e(TAG, "engine unavailable", e)
            Toast.makeText(this, "talk engine failed: ${e.message}", Toast.LENGTH_LONG).show()
            OverlayService.setBubbleVisible(this, true)
            finish()
            return
        }
        engine = eng

        val pagerList = currentPagerList(eng)
        rootBinding.pagerBareNotice.text = pagerList.bareReason ?: ""
        rootBinding.pagerBareNotice.visibility =
            if (pagerList.state == PagerListResolver.PagerState.BARE) View.VISIBLE else View.GONE
        rootBinding.pager.adapter = TalkPagerAdapter(pagerList, CompanionPrefs.getBaseUrl(this)) { talkPageBinding ->
            binding = talkPageBinding
            setupTalkPage(eng)
        }
    }

    /**
     * Everything BL-829 moved out of onCreate: it needs [binding] (the Talk
     * page's own view binding), which only exists once [TalkPagerAdapter]
     * has created the pager's page-0 ViewHolder — see the callback above.
     */
    private fun setupTalkPage(eng: TalkEngine) {
        binding.versionText.text = appVersionLabel()

        binding.recordBtn.setOnClickListener {
            if (!hasMicPermission()) {
                pendingAutoRecord = false
                requestMic()
                return@setOnClickListener
            }
            eng.onRecordClicked()
        }
        binding.sendTurn.setOnClickListener {
            eng.sendTextTurn(binding.turnInput.text?.toString().orEmpty())
            binding.turnInput.text?.clear()
        }
        binding.collapse.setOnClickListener { finish() }
        binding.stopOverlay.setOnClickListener {
            stoppingOverlay = true
            OverlayService.stop(this)
            finish()
        }
        binding.pauseAll.setOnClickListener { eng.togglePauseAll() }
        binding.newSession.setOnClickListener { eng.resetSession() }
        binding.knowledgeBtn.setOnClickListener {
            startActivity(Intent(this, KnowledgeActivity::class.java))
        }
        binding.settingsBtn.setOnClickListener { showSettingsDialog(eng) }
        binding.playlistBtn.setOnClickListener { showPlaylistDialog(eng) }

        binding.handsFree.setOnCheckedChangeListener { _, checked ->
            if (suppressToggleCallbacks) return@setOnCheckedChangeListener
            if (eng.snapshot().pausedAll) {
                suppressToggleCallbacks = true
                binding.handsFree.isChecked = false
                suppressToggleCallbacks = false
                return@setOnCheckedChangeListener
            }
            if (checked && !hasMicPermission()) {
                pendingAutoRecord = true
                suppressToggleCallbacks = true
                binding.handsFree.isChecked = false
                suppressToggleCallbacks = false
                requestMic()
                return@setOnCheckedChangeListener
            }
            eng.setHandsFree(checked)
        }

        eng.setListener(this)
        if (eng.snapshot().handsFree && hasMicPermission()) {
            eng.ensureListeningIfHandsFree()
        }
    }

    /**
     * BL-829: [PagerListResolver.resolve] driven by [TalkEngine]'s latest
     * synced bundle — a resolution not yet available (sync still in flight,
     * or never yet run) is treated the same as [UiBundleResolver.UiBundleOutcome.BARE]
     * (Talk alone), never as "no pages" silently rendered as NORMAL.
     */
    private fun currentPagerList(eng: TalkEngine): PagerListResolver.PagerList {
        val resolution = eng.latestUiBundleResolution
        val outcome = resolution?.outcome ?: UiBundleResolver.UiBundleOutcome.BARE
        val pages = resolution?.bundle?.pages.orEmpty().map {
            PagerListResolver.RemotePage(id = it.id, title = it.title, entryPath = it.entryPath, order = it.order)
        }
        return PagerListResolver.resolve(outcome, pages)
    }

    /**
     * Home / Recents: collapse to bubble on the launcher, same as the Collapse
     * button — do not leave the pairing activity or a stuck panel task visible.
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (!stoppingOverlay && !isFinishing) {
            finish()
        }
    }

    // BL-864: reduces a BridgeClient audio-engine result to VoiceEngineSelector's
    // plain input — the device-surface half of the selector (dialog wiring +
    // network calls), verified by the recorded manual procedure per the
    // Bubble testability boundary; the STATE decisions this calls into are
    // the JVM-tested VoiceEngineSelector.
    private fun voiceEngineStatusInput(result: BridgeClient.AudioEngineStatusResult): VoiceEngineSelector.StatusInput {
        val engineInUse = if (result.engine == "openai") {
            VoiceEngineSelector.Engine.OPENAI
        } else {
            VoiceEngineSelector.Engine.LOCAL
        }
        return VoiceEngineSelector.StatusInput(
            enabled = result.enabled,
            engineInUse = engineInUse,
            local = VoiceEngineSelector.ServiceabilityInput(result.local.serviceable, result.local.reason),
            openai = VoiceEngineSelector.ServiceabilityInput(result.openai.serviceable, result.openai.reason)
        )
    }

    private fun showSettingsDialog(eng: TalkEngine) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_settings, null)
        val holdMusic = view.findViewById<MaterialCheckBox>(R.id.holdMusic)
        val mute = view.findViewById<MaterialCheckBox>(R.id.mute)
        val volumeSeek = view.findViewById<SeekBar>(R.id.volumeSeek)
        val volumeValue = view.findViewById<android.widget.TextView>(R.id.volumeValue)
        val voiceEngineHeader = view.findViewById<android.widget.TextView>(R.id.voiceEngineHeader)
        val voiceEngineGroup = view.findViewById<android.widget.RadioGroup>(R.id.voiceEngineGroup)
        val voiceEngineLocal = view.findViewById<android.widget.RadioButton>(R.id.voiceEngineLocal)
        val voiceEngineOpenAi = view.findViewById<android.widget.RadioButton>(R.id.voiceEngineOpenAi)
        val voiceEngineMessage = view.findViewById<android.widget.TextView>(R.id.voiceEngineMessage)
        var suppressVoiceEngineCallback = false
        var voiceEngineState: VoiceEngineSelector.UiState? = null

        fun renderVoiceEngineState(state: VoiceEngineSelector.UiState) {
            voiceEngineState = state
            // BL-765: the bubble-config voiceEngineSwitch flag is a second,
            // independent gate on top of the /lets-talk/audio-engine
            // serviceability check state.visible already encodes.
            val effectiveVisible = state.visible && eng.capabilities().voiceEngineSwitch
            val visibility = if (effectiveVisible) View.VISIBLE else View.GONE
            voiceEngineHeader.visibility = visibility
            voiceEngineGroup.visibility = visibility
            if (!effectiveVisible) {
                voiceEngineMessage.visibility = View.GONE
                return
            }
            val local = state.options.first { it.engine == VoiceEngineSelector.Engine.LOCAL }
            val openai = state.options.first { it.engine == VoiceEngineSelector.Engine.OPENAI }
            suppressVoiceEngineCallback = true
            voiceEngineLocal.isEnabled = !local.disabled
            voiceEngineOpenAi.isEnabled = !openai.disabled
            voiceEngineLocal.isChecked = state.selected == VoiceEngineSelector.Engine.LOCAL
            voiceEngineOpenAi.isChecked = state.selected == VoiceEngineSelector.Engine.OPENAI
            suppressVoiceEngineCallback = false
            val reasonText = state.message ?: listOfNotNull(local.reason, openai.reason).firstOrNull()
            voiceEngineMessage.text = reasonText
            voiceEngineMessage.visibility = if (reasonText != null) View.VISIBLE else View.GONE
        }

        eng.fetchVoiceEngineStatus { result ->
            val state = if (result.ok) {
                VoiceEngineSelector.stateForStatus(voiceEngineStatusInput(result))
            } else {
                VoiceEngineSelector.UiState(visible = false, selected = null, options = emptyList())
            }
            renderVoiceEngineState(state)
        }

        voiceEngineGroup.setOnCheckedChangeListener { _, checkedId ->
            if (suppressVoiceEngineCallback) return@setOnCheckedChangeListener
            val previous = voiceEngineState ?: return@setOnCheckedChangeListener
            val tapped = if (checkedId == R.id.voiceEngineOpenAi) {
                VoiceEngineSelector.Engine.OPENAI
            } else {
                VoiceEngineSelector.Engine.LOCAL
            }
            // The RadioButton is already checked by the OS's own tap handling
            // before this listener runs. Snap it back to the last confirmed
            // state synchronously, in the same UI pass, so the tap is never
            // drawn on screen before the bridge responds — displayed
            // selection must follow the bridge's answer, never the tap
            // (BL-864 invariant, BL-864-voice-engine-selector-tap-leak).
            renderVoiceEngineState(previous)
            val wireName = if (tapped == VoiceEngineSelector.Engine.OPENAI) "openai" else "local"
            eng.chooseVoiceEngine(wireName) { result ->
                val outcome = when {
                    result.ok -> VoiceEngineSelector.ChoiceOutcome.Accepted(tapped)
                    result.connectionFailure -> VoiceEngineSelector.ChoiceOutcome.Unreachable(
                        result.reason ?: "Can't reach the bridge."
                    )
                    else -> VoiceEngineSelector.ChoiceOutcome.Refused(result.reason ?: "Choice refused.")
                }
                renderVoiceEngineState(VoiceEngineSelector.stateAfterChoice(previous, outcome))
            }
        }

        fun syncFromEngine() {
            val snap = eng.snapshot()
            suppressToggleCallbacks = true
            // BL-765 remote-config-03: hold music removed without a new APK.
            holdMusic.visibility = if (eng.capabilities().holdMusic) View.VISIBLE else View.GONE
            holdMusic.isChecked = snap.holdMusicOn
            mute.isChecked = snap.muted
            if (!volumeSeek.isPressed) {
                volumeSeek.progress = snap.volumePercent
                volumeValue.text = snap.volumePercent.toString()
            }
            mute.isEnabled = !snap.pausedAll
            volumeSeek.isEnabled = !snap.pausedAll
            suppressToggleCallbacks = false
        }
        syncFromEngine()

        holdMusic.setOnCheckedChangeListener { _, checked ->
            if (suppressToggleCallbacks) return@setOnCheckedChangeListener
            eng.setHoldMusic(checked)
        }
        mute.setOnCheckedChangeListener { _, checked ->
            if (suppressToggleCallbacks) return@setOnCheckedChangeListener
            if (eng.snapshot().pausedAll) {
                suppressToggleCallbacks = true
                mute.isChecked = true
                suppressToggleCallbacks = false
                return@setOnCheckedChangeListener
            }
            eng.setMuted(checked)
        }
        volumeSeek.max = 100
        volumeSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                volumeValue.text = progress.toString()
                if (fromUser) eng.setVolumePercent(progress)
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        AlertDialog.Builder(this)
            .setTitle(R.string.settings)
            .setView(view)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton(R.string.edit_pairing) { _, _ ->
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .putExtra(MainActivity.EXTRA_EDIT_PAIRING, true)
                )
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showPlaylistDialog(eng: TalkEngine) {
        val songs = eng.songNames()
        val labels = ArrayList<String>(songs.size + 1)
        labels.add(getString(R.string.playlist_shuffle))
        labels.addAll(songs)
        val preferred = eng.snapshot().preferredSong
        val checked = if (preferred.isBlank()) {
            0
        } else {
            val idx = songs.indexOf(preferred)
            if (idx >= 0) idx + 1 else 0
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.playlist)
            .setSingleChoiceItems(labels.toTypedArray(), checked) { _, which ->
                val name = if (which == 0) "" else songs[which - 1]
                eng.setPreferredSong(name)
                eng.previewSong(name)
                val label = if (name.isBlank()) {
                    getString(R.string.playlist_shuffle)
                } else {
                    name
                }
                Toast.makeText(
                    this,
                    getString(R.string.playlist_playing, label),
                    Toast.LENGTH_SHORT
                ).show()
            }
            .setPositiveButton(R.string.playlist_stop) { _, _ ->
                eng.stopHoldMusicPreview()
            }
            .setNegativeButton(android.R.string.ok, null)
            .show()
    }

    override fun onDestroy() {
        engine?.setListener(null)
        engine = null
        if (!stoppingOverlay) {
            OverlayService.setBubbleVisible(this, true)
        }
        super.onDestroy()
    }

    override fun onSnapshot(snapshot: TalkEngine.Snapshot) {
        if (isFinishing) return
        binding.phaseText.text = when (snapshot.phase) {
            TalkEngine.Phase.READY -> getString(R.string.phase_ready)
            TalkEngine.Phase.RECORDING -> getString(R.string.phase_recording)
            TalkEngine.Phase.THINKING -> getString(R.string.phase_thinking)
            TalkEngine.Phase.SPEAKING -> getString(R.string.phase_speaking)
            TalkEngine.Phase.ERROR -> getString(R.string.phase_error)
        }
        binding.phaseText.setTextColor(
            getColor(
                when (snapshot.phase) {
                    TalkEngine.Phase.READY, TalkEngine.Phase.RECORDING -> R.color.sf_accent
                    TalkEngine.Phase.THINKING -> android.R.color.holo_orange_light
                    TalkEngine.Phase.SPEAKING -> android.R.color.holo_blue_light
                    TalkEngine.Phase.ERROR -> android.R.color.holo_red_light
                }
            )
        )
        binding.recordBtn.text = if (snapshot.phase == TalkEngine.Phase.RECORDING) {
            getString(R.string.stop_recording)
        } else {
            getString(R.string.record)
        }
        if (snapshot.replyText.isNotEmpty()) {
            binding.replyText.text = snapshot.replyText
            binding.replyText.setTextColor(
                getColor(if (snapshot.replyIsErrorStyle) R.color.sf_muted else R.color.sf_text)
            )
        }
        if (snapshot.holdMusicTitle != null) {
            binding.holdMusicTitle.text = snapshot.holdMusicTitle
            binding.holdMusicTitle.visibility = View.VISIBLE
        } else {
            binding.holdMusicTitle.visibility = View.GONE
        }

        binding.pauseAll.setText(
            if (snapshot.pausedAll) R.string.resume_all else R.string.pause_all
        )

        // BL-765: a remotely-disabled capability is removed without a new
        // APK (remote-config-03) — bundled default is every flag enabled,
        // so an unreachable/unsynced bridge never hides anything.
        val caps = engine?.capabilities() ?: BridgeClient.BubbleConfigResult(ok = false)
        binding.handsFree.visibility = if (caps.handsFree) View.VISIBLE else View.GONE
        binding.pauseAll.visibility = if (caps.pauseAll) View.VISIBLE else View.GONE
        binding.newSession.visibility = if (caps.newSession) View.VISIBLE else View.GONE
        binding.playlistBtn.visibility = if (caps.playlist) View.VISIBLE else View.GONE
        binding.turnInput.visibility = if (caps.textTurns) View.VISIBLE else View.GONE
        binding.sendTurn.visibility = if (caps.textTurns) View.VISIBLE else View.GONE

        suppressToggleCallbacks = true
        binding.handsFree.isChecked = snapshot.handsFree
        binding.handsFree.isEnabled = !snapshot.pausedAll
        suppressToggleCallbacks = false

        val thinking = snapshot.phase == TalkEngine.Phase.THINKING
        // Record stays enabled during THINKING so the user can abort a stuck
        // bridge wait (PTT timeout / hung turn) instead of sitting disabled.
        binding.recordBtn.isEnabled = !snapshot.pausedAll
        binding.sendTurn.isEnabled =
            caps.textTurns && !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.turnInput.isEnabled =
            caps.textTurns && !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.newSession.isEnabled =
            caps.newSession && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            val eng = engine ?: return
            if (pendingAutoRecord) {
                pendingAutoRecord = false
                eng.setHandsFree(true)
                eng.ensureListeningIfHandsFree()
            } else {
                eng.onRecordClicked()
            }
        } else {
            Toast.makeText(this, R.string.need_mic_permission, Toast.LENGTH_LONG).show()
        }
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun requestMic() {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
    }

    /** Same debug line as the pairing screen (often skipped via auto-start). */
    private fun appVersionLabel(): String {
        val ver = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }
        return "v$ver"
    }

    companion object {
        private const val TAG = "SfFloatPanel"
        private const val REQ_MIC = 7072
    }
}
