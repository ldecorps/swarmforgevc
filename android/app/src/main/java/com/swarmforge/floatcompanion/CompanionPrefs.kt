package com.swarmforge.floatcompanion

import android.content.Context
import android.content.SharedPreferences

/** BL-707: persist bridge pairing + Let's Talk toggle prefs. */
object CompanionPrefs {
    private const val NAME = "sf_float_companion"
    private const val KEY_BASE_URL = "bridge_base_url"
    private const val KEY_TOKEN = "console_token"
    private const val KEY_HANDS_FREE = "hands_free"
    private const val KEY_HOLD_MUSIC = "hold_music"
    private const val KEY_MUTE = "mute"
    private const val KEY_VOLUME = "playback_volume_percent"
    private const val KEY_PREFERRED_SONG = "preferred_hold_song"
    // BL-763: the bridge instanceId last observed by syncBridgeInstanceAndSession.
    private const val KEY_LAST_BRIDGE_INSTANCE_ID = "last_bridge_instance_id"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun getBaseUrl(ctx: Context): String = prefs(ctx).getString(KEY_BASE_URL, "") ?: ""

    fun getToken(ctx: Context): String = prefs(ctx).getString(KEY_TOKEN, "") ?: ""

    fun isHandsFree(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_HANDS_FREE, false)

    fun isHoldMusic(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_HOLD_MUSIC, true)

    fun isMuted(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_MUTE, false)

    /** 0..100 playback loudness for hold music + reply voice. Default 55. */
    fun getVolumePercent(ctx: Context): Int =
        prefs(ctx).getInt(KEY_VOLUME, 55).coerceIn(0, 100)

    /** Empty string means shuffle. */
    fun getPreferredSong(ctx: Context): String =
        prefs(ctx).getString(KEY_PREFERRED_SONG, "") ?: ""

    /** Empty string means "never synced" (fresh install, or prefs wiped). */
    fun getLastBridgeInstanceId(ctx: Context): String =
        prefs(ctx).getString(KEY_LAST_BRIDGE_INSTANCE_ID, "") ?: ""

    fun setHandsFree(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_HANDS_FREE, on).apply()
    }

    fun setHoldMusic(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_HOLD_MUSIC, on).apply()
    }

    fun setMuted(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_MUTE, on).apply()
    }

    fun setVolumePercent(ctx: Context, percent: Int) {
        prefs(ctx).edit().putInt(KEY_VOLUME, percent.coerceIn(0, 100)).apply()
    }

    fun setPreferredSong(ctx: Context, name: String) {
        prefs(ctx).edit().putString(KEY_PREFERRED_SONG, name).apply()
    }

    fun setLastBridgeInstanceId(ctx: Context, instanceId: String) {
        prefs(ctx).edit().putString(KEY_LAST_BRIDGE_INSTANCE_ID, instanceId).apply()
    }

    /**
     * If SharedPreferences were wiped (uninstall without Keep data),
     * reload last pairing from the public Downloads mirror.
     * @return true when prefs were filled from the durable backup.
     */
    fun hydrateFromDurableBackup(ctx: Context): Boolean {
        return try {
            if (getBaseUrl(ctx).isNotBlank() && getToken(ctx).isNotBlank()) return false
            val pairing = PairingBackup.read(ctx) ?: return false
            if (pairing.baseUrl.isBlank() && pairing.token.isBlank()) return false
            val ed = prefs(ctx).edit()
            if (pairing.baseUrl.isNotBlank()) ed.putString(KEY_BASE_URL, pairing.baseUrl)
            if (pairing.token.isNotBlank()) ed.putString(KEY_TOKEN, pairing.token)
            ed.commit()
            getBaseUrl(ctx).isNotBlank() || getToken(ctx).isNotBlank()
        } catch (e: Exception) {
            false
        }
    }

    // BL-788 invariant 3: delegates the merge decision to PairingSave so a
    // blank field here (e.g. onPause firing mid-edit, before the human
    // finished retyping the other box) never overwrites a stored non-blank
    // credential — only a non-blank input replaces what's stored.
    fun save(ctx: Context, baseUrl: String, token: String, sync: Boolean = false) {
        val merged = PairingSave.merge(getBaseUrl(ctx), getToken(ctx), baseUrl, token)
        val ed = prefs(ctx).edit()
            .putString(KEY_BASE_URL, merged.baseUrl)
            .putString(KEY_TOKEN, merged.token)
        if (sync) ed.commit() else ed.apply()
        // Mirror outside private storage so values can survive reinstall.
        if (merged.baseUrl.isNotEmpty() || merged.token.isNotEmpty()) {
            try {
                PairingBackup.write(ctx, merged.baseUrl, merged.token)
            } catch (_: Exception) {
            }
        }
    }
}
