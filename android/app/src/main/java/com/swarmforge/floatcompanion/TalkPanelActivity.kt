package com.swarmforge.floatcompanion

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
        binding.holdMusic.setOnCheckedChangeListener { _, checked ->
            if (suppressToggleCallbacks) return@setOnCheckedChangeListener
            eng.setHoldMusic(checked)
        }
        binding.mute.setOnCheckedChangeListener { _, checked ->
            if (suppressToggleCallbacks) return@setOnCheckedChangeListener
            if (eng.snapshot().pausedAll) {
                suppressToggleCallbacks = true
                binding.mute.isChecked = true
                suppressToggleCallbacks = false
                return@setOnCheckedChangeListener
            }
            eng.setMuted(checked)
        }

        eng.setListener(this)
        if (eng.snapshot().handsFree && hasMicPermission()) {
            eng.ensureListeningIfHandsFree()
        }
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

        suppressToggleCallbacks = true
        binding.handsFree.isChecked = snapshot.handsFree
        binding.holdMusic.isChecked = snapshot.holdMusicOn
        binding.mute.isChecked = snapshot.muted
        suppressToggleCallbacks = false

        binding.pauseAll.setText(
            if (snapshot.pausedAll) R.string.resume_all else R.string.pause_all
        )

        val thinking = snapshot.phase == TalkEngine.Phase.THINKING
        binding.recordBtn.isEnabled = !snapshot.pausedAll && !thinking
        binding.sendTurn.isEnabled =
            !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.turnInput.isEnabled =
            !snapshot.pausedAll && !thinking && snapshot.phase != TalkEngine.Phase.SPEAKING
        binding.handsFree.isEnabled = !snapshot.pausedAll
        binding.mute.isEnabled = !snapshot.pausedAll
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
