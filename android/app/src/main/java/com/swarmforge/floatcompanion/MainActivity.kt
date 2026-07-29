package com.swarmforge.floatcompanion

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.swarmforge.floatcompanion.databinding.ActivityMainBinding

/**
 * First-run / rare re-pair screen for bridge URL + token.
 * Day-to-day use is the floating bubble; when already paired this activity
 * starts the overlay and finishes so the old pairing UI is not left behind
 * Let's Talk.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        CompanionPrefs.hydrateFromDurableBackup(this)
        binding.bridgeUrl.setText(CompanionPrefs.getBaseUrl(this))
        binding.token.setText(CompanionPrefs.getToken(this))

        val editPairing = intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false)
        if (!editPairing && tryAutoStartBubble()) {
            return
        }

        showPairingUi(editPairing || !isPaired())

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
                if (isPaired() && tryAutoStartBubble()) return@setOnClickListener
            } else {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        }

        binding.startBubble.setOnClickListener {
            persistPairing()
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Grant draw-over permission first", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            if (!isPaired()) {
                Toast.makeText(this, "Need bridge URL and token", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            startBubbleService()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                finishAndRemoveTask()
            } else {
                finish()
            }
        }

        binding.stopBubble.setOnClickListener {
            stopService(Intent(this, OverlayService::class.java))
            refreshStatus()
        }

        refreshStatus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false) && tryAutoStartBubble()) {
            return
        }
        showPairingUi(intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false) || !isPaired())
        refreshStatus()
    }

    override fun onPause() {
        if (binding.bridgeUrlLayout.visibility == View.VISIBLE) {
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
        if (!isFinishing &&
            !intent.getBooleanExtra(EXTRA_EDIT_PAIRING, false) &&
            tryAutoStartBubble()
        ) {
            return
        }
        refreshStatus()
    }

    private fun showPairingUi(showFields: Boolean) {
        val vis = if (showFields) View.VISIBLE else View.GONE
        binding.bridgeUrlLayout.visibility = vis
        binding.tokenLayout.visibility = vis
    }

    private fun isPaired(): Boolean =
        CompanionPrefs.getBaseUrl(this).isNotBlank() &&
            CompanionPrefs.getToken(this).isNotBlank()

    /** @return true if this activity is finishing after starting the bubble. */
    private fun tryAutoStartBubble(): Boolean {
        if (!isPaired()) return false
        if (!Settings.canDrawOverlays(this)) {
            showPairingUi(false)
            refreshStatus()
            return false
        }
        startBubbleService()
        // Drop this task so Home never resurfaces the pairing screen.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask()
        } else {
            finish()
        }
        return true
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
        binding.status.text = "$overlay · $paired · BL-707 v$ver"
    }

    companion object {
        const val EXTRA_EDIT_PAIRING = "edit_pairing"
    }
}
