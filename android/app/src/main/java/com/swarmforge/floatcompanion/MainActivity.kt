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

/** BL-707: pair bridge URL + token, grant overlay, start/stop bubble service. */
class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Restore last known pairing (prefs, or Downloads mirror after reinstall).
        CompanionPrefs.hydrateFromDurableBackup(this)
        binding.bridgeUrl.setText(CompanionPrefs.getBaseUrl(this))
        binding.token.setText(CompanionPrefs.getToken(this))
        refreshStatus()

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
            if (CompanionPrefs.getBaseUrl(this).isBlank() || CompanionPrefs.getToken(this).isBlank()) {
                Toast.makeText(this, "Need bridge URL and token", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            val intent = Intent(this, OverlayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            refreshStatus()
        }

        binding.stopBubble.setOnClickListener {
            stopService(Intent(this, OverlayService::class.java))
            refreshStatus()
        }
    }

    override fun onPause() {
        CompanionPrefs.save(
            this,
            binding.bridgeUrl.text?.toString().orEmpty(),
            binding.token.text?.toString().orEmpty(),
            sync = true
        )
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
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
        val url = CompanionPrefs.getBaseUrl(this)
        val token = CompanionPrefs.getToken(this)
        val paired = when {
            url.isNotBlank() && token.isNotBlank() -> "pairing saved on phone"
            url.isNotBlank() || token.isNotBlank() -> "partial pairing saved"
            else -> "not paired"
        }
        val ver = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }
        binding.status.text = "$overlay · $paired · BL-707 v$ver"
    }
}
