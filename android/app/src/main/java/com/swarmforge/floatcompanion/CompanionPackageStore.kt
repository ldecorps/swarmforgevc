package com.swarmforge.floatcompanion

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * BL-907: device storage + orchestration wiring for the offline package
 * sync. Package bodies are too big for SharedPreferences, so each held
 * package is one file under app-private storage — written atomically
 * (temp file then rename) so a sync that dies mid-write never leaves the
 * previous complete copy half-overwritten. Device-surface (`Context`, file
 * I/O): verified by this ticket's recorded manual procedure
 * (`qa_e2e_procedure`), not the JVM unit suite (BL-769 Testability
 * Boundary) — [CompanionPackageSync] carries every decision this object
 * only wires up.
 */
object CompanionPackageStore {
    private const val DIR_NAME = "companion-packages"

    private fun dir(ctx: Context): File =
        File(ctx.filesDir, DIR_NAME).apply { mkdirs() }

    private fun file(ctx: Context, name: String): File =
        File(dir(ctx), "$name.json")

    private fun readHeld(ctx: Context, name: String): CompanionPackageSync.HeldPackage? {
        val f = file(ctx, name)
        if (!f.isFile) return null
        return try {
            val json = JSONObject(f.readText(Charsets.UTF_8))
            CompanionPackageSync.HeldPackage(
                name = json.getString("name"),
                generation = json.getString("generation"),
                format = json.getString("format"),
                formatVersion = json.getInt("formatVersion"),
                data = json.getString("data")
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun writeHeld(ctx: Context, pkg: CompanionPackageSync.HeldPackage) {
        val json = JSONObject()
            .put("name", pkg.name)
            .put("generation", pkg.generation)
            .put("format", pkg.format)
            .put("formatVersion", pkg.formatVersion)
            .put("data", pkg.data)
        val target = file(ctx, pkg.name)
        val tmp = File(target.parentFile, "${pkg.name}.json.tmp")
        tmp.writeText(json.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    fun read(ctx: Context, name: String): CompanionPackageSync.ReadResult =
        CompanionPackageSync.read(readHeld(ctx, name))

    data class SyncSummary(val syncedNames: List<String>, val failures: List<CompanionPackageSync.SyncFailure>)

    /**
     * BL-907 required_wiring: the phone's only sync source is the
     * companion-manifest — a sync that never asks the bridge for it
     * (BridgeClient.fetchCompanionManifest, GET /companion-manifest) is
     * wired to nothing.
     */
    fun sync(ctx: Context, baseUrl: String, token: String): SyncSummary {
        val manifest = BridgeClient.fetchCompanionManifest(baseUrl, token)
        if (!manifest.ok) {
            // The manifest itself is unreachable: nothing can be refreshed,
            // but every already-held package stays exactly as held
            // (invariant 2) — report each as failed, drop none.
            val heldNames = dir(ctx).listFiles { f -> f.name.endsWith(".json") }
                ?.map { it.name.removeSuffix(".json") }.orEmpty()
            val reason = manifest.reason ?: "companion manifest unreachable"
            return SyncSummary(emptyList(), heldNames.map { CompanionPackageSync.SyncFailure(it, reason) })
        }

        val syncedNames = ArrayList<String>()
        val failures = ArrayList<CompanionPackageSync.SyncFailure>()
        for (entry in manifest.packages) {
            val held = readHeld(ctx, entry.name)
            val requested = CompanionPackageSync.requestedGeneration(held)
            val fetch = BridgeClient.fetchCompanionPackage(baseUrl, token, entry.name, requested)
            val (result, failure) = CompanionPackageSync.applyFetch(entry.name, held, fetch)
            if (result != null) {
                writeHeld(ctx, result)
            }
            if (failure == null) {
                syncedNames.add(entry.name)
            } else {
                failures.add(failure)
            }
        }
        return SyncSummary(syncedNames, failures)
    }
}
