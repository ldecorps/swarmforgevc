package com.swarmforge.floatcompanion

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.swarmforge.floatcompanion.databinding.ActivityMainBinding

/**
 * Pairing / control screen. When already paired this still *stays on screen*
 * so the system splash can dismiss (killing it from onCreate froze Samsung
 * on the giant lightbulb). Overlay starts in the background; Let's Talk
 * opens from a real tap here, or from the bubble via [EXTRA_OPEN_TALK].
 */
class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        CompanionPrefs.hydrateFromDurableBackup(this)
        applyPairingDeepLinkIfPresent(intent)
        binding.bridgeUrl.setText(CompanionPrefs.getBaseUrl(this))
        binding.token.setText(CompanionPrefs.getToken(this))

        val editPairing = intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false)
        showPairingUi(editPairing || !isPaired())
        ensureOverlayRunning()
        bindControls()
        refreshStatus()
        if (intent.getBooleanExtra(EXTRA_OPEN_TALK, false)) {
            openTalkFromUi()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyPairingDeepLinkIfPresent(intent)
        showPairingUi(intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false) || !isPaired())
        ensureOverlayRunning()
        refreshStatus()
        if (intent.getBooleanExtra(EXTRA_OPEN_TALK, false)) {
            openTalkFromUi()
        }
    }

    private fun bindControls() {
        val persistWatcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                persistPairing()
                refreshStatus()
            }
        }
        binding.bridgeUrl.addTextChangedListener(persistWatcher)
        binding.token.addTextChangedListener(persistWatcher)

        binding.grantOverlay.setOnClickListener {
            if (Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Overlay already granted", Toast.LENGTH_SHORT).show()
                ensureOverlayRunning()
            } else {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                )
            }
        }

        binding.startBubble.setOnClickListener {
            persistPairing()
            openTalkFromUi()
        }

        binding.stopBubble.setOnClickListener {
            stopService(Intent(this, OverlayService::class.java))
            refreshStatus()
        }
    }

    /**
     * BL-716 dns-05: applies a swarmforge-bubble://pair deep link if this
     * intent carries one, so a revived tunnel URL reaches the phone without
     * the human hunting logs or retyping it by hand.
     */
    private fun applyPairingDeepLinkIfPresent(intent: Intent): Boolean {
        val data = intent.data ?: return false
        val pairing = PairingDeepLink.parse(data.toString()) ?: return false
        CompanionPrefs.save(this, pairing.baseUrl, pairing.token, sync = true)
        Toast.makeText(this, "Bubble pairing updated", Toast.LENGTH_SHORT).show()
        return true
    }

    override fun onPause() {
        if (binding.bridgeUrlLayout.visibility == android.view.View.VISIBLE) {
            CompanionPrefs.save(
                this,
                binding.bridgeUrl.text?.toString().orEmpty(),
                binding.token.text?.toString().orEmpty(),
                sync = true
            )
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        showPairingUi(intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false) || !isPaired())
        ensureOverlayRunning()
        refreshStatus()
    }

    private fun showPairingUi(showFields: Boolean) {
        val vis = if (showFields) android.view.View.VISIBLE else android.view.View.GONE
        binding.bridgeUrlLayout.visibility = vis
        binding.tokenLayout.visibility = vis
    }

    private fun isPaired(): Boolean =
        CompanionPrefs.getBaseUrl(this).isNotBlank() &&
            CompanionPrefs.getToken(this).isNotBlank()

    private fun ensureOverlayRunning() {
        if (!isPaired()) return
        if (!Settings.canDrawOverlays(this)) return
        startBubbleService()
    }

    private fun openTalkFromUi() {
        persistPairing()
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Grant draw-over permission first", Toast.LENGTH_LONG).show()
            return
        }
        if (!isPaired()) {
            Toast.makeText(this, "Need bridge URL and token", Toast.LENGTH_LONG).show()
            return
        }
        startBubbleService()
        startActivity(Intent(this, TalkPanelActivity::class.java))
    }

    private fun startBubbleService() {
        val intent = Intent(this, OverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun persistPairing() {
        CompanionPrefs.save(
            this,
            binding.bridgeUrl.text?.toString().orEmpty(),
            binding.token.text?.toString().orEmpty()
        )
    }

    private fun refreshStatus() {
        val overlay = if (Settings.canDrawOverlays(this)) "overlay ok" else "overlay missing"
        val paired = when {
            isPaired() -> "pairing saved on phone"
            CompanionPrefs.getBaseUrl(this).isNotBlank() ||
                CompanionPrefs.getToken(this).isNotBlank() -> "partial pairing saved"
            else -> "not paired"
        }
        val ver = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }
        binding.status.text = "$overlay · $paired · v$ver"
        binding.startBubble.text = getString(
            if (isPaired()) R.string.open_lets_talk else R.string.start_bubble
        )
    }

    companion object {
        const val EXTRA_EDIT_PAIRING = "edit_pairing"
        const val EXTRA_OPEN_TALK = "open_talk"
    }
}
