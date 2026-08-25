package com.swarmforge.floatcompanion

import org.json.JSONArray
import org.json.JSONObject

/**
 * BL-908: the panel-content DECISIONS behind the browsable knowledge
 * screen — pure, no `android.*` type in any signature (Bubble testability
 * boundary, BL-769). Every function here reads only a
 * [CompanionPackageSync.ReadResult] — the package [CompanionPackageStore]
 * already holds on the device — never a network call, so a Ready state is
 * reachable identically with the network on or off (BL-908 invariant 1).
 * [KnowledgeActivity] wires this against the real store and real views.
 */
object KnowledgeReader {

    data class BacklogTicket(
        val id: String,
        val title: String,
        val status: String?,
        val milestone: String?,
        val priority: Int?,
        val description: String?,
        val acceptance: String?,
        val humanApproval: String?,
        val notes: String?
    )

    data class BacklogFolders(
        val active: List<BacklogTicket>,
        val paused: List<BacklogTicket>,
        val hold: List<BacklogTicket>,
        val done: List<BacklogTicket>
    )

    data class VisionDoc(val id: String, val title: String, val kind: String, val content: String)

    /**
     * A Ready state always carries [generation] alongside its content —
     * BL-908 invariant 2 ("no view presents package content without
     * stating the generation it was read at") holds structurally: there is
     * no way to construct a Ready with content and no generation.
     */
    sealed class BacklogPanelState {
        object NothingHeld : BacklogPanelState()
        data class Malformed(val reason: String) : BacklogPanelState()
        data class Ready(val generation: String, val folders: BacklogFolders) : BacklogPanelState()
    }

    sealed class DocsPanelState {
        object NothingHeld : DocsPanelState()
        data class Malformed(val reason: String) : DocsPanelState()
        data class Ready(val generation: String, val vision: List<VisionDoc>) : DocsPanelState()
    }

    fun backlogPanelState(read: CompanionPackageSync.ReadResult): BacklogPanelState =
        when (read) {
            is CompanionPackageSync.ReadResult.NothingHeld -> BacklogPanelState.NothingHeld
            is CompanionPackageSync.ReadResult.Held -> {
                val folders = parseBacklogPackage(read.pkg.data)
                if (folders == null) {
                    BacklogPanelState.Malformed("malformed backlog package")
                } else {
                    BacklogPanelState.Ready(read.pkg.generation, folders)
                }
            }
        }

    fun docsPanelState(read: CompanionPackageSync.ReadResult): DocsPanelState =
        when (read) {
            is CompanionPackageSync.ReadResult.NothingHeld -> DocsPanelState.NothingHeld
            is CompanionPackageSync.ReadResult.Held -> {
                val vision = parseDocsPackage(read.pkg.data)
                if (vision == null) {
                    DocsPanelState.Malformed("malformed docs package")
                } else {
                    DocsPanelState.Ready(read.pkg.generation, vision)
                }
            }
        }

    /**
     * Whole-document rejection, same shape as BridgeClient's parse*
     * functions one file over — `internal` (BL-769 precedent) so the JVM
     * unit suite can exercise it directly. Matches the bridge-side shape
     * `{ active, paused, hold, done }` (extension/src/panel/backlogReader.ts
     * readBacklogFolders / companionManifest.ts readBacklogPackage).
     */
    internal fun parseBacklogPackage(data: String): BacklogFolders? {
        return try {
            val json = JSONObject(data)
            val active = parseTicketList(json.optJSONArray("active") ?: return null) ?: return null
            val paused = parseTicketList(json.optJSONArray("paused") ?: return null) ?: return null
            val hold = parseTicketList(json.optJSONArray("hold") ?: return null) ?: return null
            val done = parseTicketList(json.optJSONArray("done") ?: return null) ?: return null
            BacklogFolders(active, paused, hold, done)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseTicketList(arr: JSONArray): List<BacklogTicket>? {
        val out = ArrayList<BacklogTicket>(arr.length())
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: return null
            out.add(parseTicket(obj) ?: return null)
        }
        return out
    }

    private fun parseTicket(obj: JSONObject): BacklogTicket? {
        val id = obj.optString("id", "")
        val title = obj.optString("title", "")
        if (id.isBlank() || title.isBlank()) return null
        return BacklogTicket(
            id = id,
            title = title,
            status = obj.optString("status", "").ifBlank { null },
            milestone = obj.optString("milestone", "").ifBlank { null },
            priority = if (obj.has("priority") && !obj.isNull("priority")) obj.optInt("priority") else null,
            description = obj.optString("description", "").ifBlank { null },
            acceptance = obj.optString("acceptance", "").ifBlank { null },
            humanApproval = obj.optString("humanApproval", "").ifBlank { null },
            notes = obj.optString("notes", "").ifBlank { null }
        )
    }

    /**
     * Whole-document rejection, same shape as [parseBacklogPackage] above.
     * Matches the bridge-side shape `{ vision: VisionDoc[] }`
     * (extension/src/docs/docsTree.ts readVisionDocs / companionManifest.ts
     * readDocsPackage).
     */
    internal fun parseDocsPackage(data: String): List<VisionDoc>? {
        return try {
            val json = JSONObject(data)
            val visionJson = json.optJSONArray("vision") ?: return null
            val docs = ArrayList<VisionDoc>(visionJson.length())
            for (i in 0 until visionJson.length()) {
                val obj = visionJson.optJSONObject(i) ?: return null
                val id = obj.optString("id", "")
                val title = obj.optString("title", "")
                val kind = obj.optString("kind", "")
                if (id.isBlank() || title.isBlank() || kind.isBlank()) return null
                docs.add(VisionDoc(id, title, kind, obj.optString("content", "")))
            }
            docs
        } catch (_: Exception) {
            null
        }
    }
}
