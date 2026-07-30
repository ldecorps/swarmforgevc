package com.swarmforge.floatcompanion

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Durable pairing backup outside private app storage so URL + token
 * can survive uninstall/reinstall (when the public file remains) and
 * always survive in-place APK updates via SharedPreferences.
 *
 * Primary: SharedPreferences (CompanionPrefs).
 * Mirror: Download/swarmforge-float-pairing.json via MediaStore / public file.
 */
object PairingBackup {
    private const val TAG = "SfFloatPairing"
    private const val FILE_NAME = "swarmforge-float-pairing.json"
    private const val MIME = "application/json"

    data class Pairing(val baseUrl: String, val token: String)

    fun write(ctx: Context, baseUrl: String, token: String) {
        val payload = JSONObject()
            .put("v", 1)
            .put("baseUrl", baseUrl)
            .put("token", token)
            .toString()
        try {
            writeMediaStore(ctx, payload)
        } catch (e: Exception) {
            Log.w(TAG, "MediaStore pairing write failed", e)
        }
        try {
            writePublicFile(payload)
        } catch (e: Exception) {
            Log.w(TAG, "public file pairing write failed", e)
        }
    }

    fun read(ctx: Context): Pairing? {
        readMediaStore(ctx)?.let { return it }
        readPublicFile()?.let { return it }
        return null
    }

    private fun writeMediaStore(ctx: Context, payload: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return
        }
        val resolver = ctx.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val existing = findDownloadUri(ctx)
        val uri = existing ?: resolver.insert(
            collection,
            ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, FILE_NAME)
                put(MediaStore.Downloads.MIME_TYPE, MIME)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        ) ?: return
        resolver.openOutputStream(uri, "wt")?.use { out ->
            out.write(payload.toByteArray(Charsets.UTF_8))
        }
        if (existing == null) {
            val done = ContentValues().apply {
                put(MediaStore.Downloads.IS_PENDING, 0)
            }
            resolver.update(uri, done, null, null)
        }
    }

    private fun readMediaStore(ctx: Context): Pairing? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return null
        }
        val uri = findDownloadUri(ctx) ?: return null
        val raw = ctx.contentResolver.openInputStream(uri)?.use {
            it.readBytes().toString(Charsets.UTF_8)
        } ?: return null
        return parse(raw)
    }

    private fun findDownloadUri(ctx: Context): Uri? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        ctx.contentResolver.query(
            collection,
            arrayOf(MediaStore.Downloads._ID),
            "${MediaStore.Downloads.DISPLAY_NAME}=?",
            arrayOf(FILE_NAME),
            null
        )?.use { c ->
            if (c.moveToFirst()) {
                val id = c.getLong(0)
                return ContentUris.withAppendedId(collection, id)
            }
        }
        return null
    }

    private fun publicFile(): File {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        return File(dir, FILE_NAME)
    }

    private fun writePublicFile(payload: String) {
        val file = publicFile()
        file.parentFile?.mkdirs()
        file.writeText(payload, Charsets.UTF_8)
    }

    private fun readPublicFile(): Pairing? {
        val file = publicFile()
        if (!file.isFile) return null
        return parse(file.readText(Charsets.UTF_8))
    }

    private fun parse(raw: String): Pairing? {
        return try {
            val json = JSONObject(raw)
            val url = json.optString("baseUrl", "").trim()
            val token = json.optString("token", "").trim()
            if (url.isEmpty() && token.isEmpty()) null
            else Pairing(url, token)
        } catch (_: Exception) {
            null
        }
    }
}
