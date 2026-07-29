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

/**
 * UI shell for [TalkEngine]. Collapse finishes this activity but leaves the
 * engine (and mic) running in [OverlayService] when hands-free / mid-turn.
 */
class TalkPanelActivity : AppCompatActivity(), TalkEngine.Listener {
    private lateinit var binding: ActivityTalkPanelBinding
    private var engine: TalkEngine? = null
    private var pendingAutoRecord = false
    private var stoppingOverlay = false
    private var suppressToggleCallbacks = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            binding = ActivityTalkPanelBinding.inflate(layoutInflater)
            setContentView(binding.root)
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
     * Home / Recents: collapse to bubble on the launcher, same as the Collapse
     * button — do not leave the pairing activity or a stuck panel task visible.
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (!stoppingOverlay && !isFinishing) {
            finish()
        }
    }

    private fun showSettingsDialog(eng: TalkEngine) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_settings, null)
        val holdMusic = view.findViewById<MaterialCheckBox>(R.id.holdMusic)
        val mute = view.findViewById<MaterialCheckBox>(R.id.mute)
        val volumeSeek = view.findViewById<SeekBar>(R.id.volumeSeek)
        val volumeValue = view.findViewById<android.widget.TextView>(R.id.volumeValue)

        fun syncFromEngine() {
            val snap = eng.snapshot()
            suppressToggleCallbacks = true
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

        suppressToggleCallbacks = true
        binding.handsFree.isChecked = snapshot.handsFree
        binding.handsFree.isEnabled = !snapshot.pausedAll
        suppressToggleCallbacks = false

        val thinking = snapshot.phase == TalkEngine.Phase.THINKING
        binding.recordBtn.isEnabled = !snapshot.pausedAll && !thinking
        binding.sendTurn.isEnabled =
            !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.turnInput.isEnabled =
            !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.newSession.isEnabled =
            !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
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

    companion object {
        private const val TAG = "SfFloatPanel"
        private const val REQ_MIC = 7072
    }
}
