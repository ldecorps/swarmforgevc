package com.swarmforge.floatcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

private fun randStr(rng: Random, minLen: Int = 3, maxLen: Int = 30): String {
    val chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_"
    val length = rng.nextInt(minLen, maxLen + 1)
    return (0 until length).map { chars[rng.nextInt(chars.length)] }.joinToString("")
}

private data class GeneratedTicket(
    val id: String,
    val title: String,
    val status: String?,
    val milestone: String?,
    val priority: Int?,
    val description: String?,
    val acceptance: String?,
    val humanApproval: String?,
    val notes: String?
) {
    fun toJson(): JSONObject {
        val obj = JSONObject().put("id", id).put("title", title)
        status?.let { obj.put("status", it) }
        milestone?.let { obj.put("milestone", it) }
        priority?.let { obj.put("priority", it) }
        description?.let { obj.put("description", it) }
        acceptance?.let { obj.put("acceptance", it) }
        humanApproval?.let { obj.put("humanApproval", it) }
        notes?.let { obj.put("notes", it) }
        return obj
    }
}

private fun randomTicket(rng: Random, id: String): GeneratedTicket = GeneratedTicket(
    id = id,
    title = randStr(rng),
    status = if (rng.nextBoolean()) listOf("todo", "active", "done").random(rng) else null,
    milestone = if (rng.nextBoolean()) "M${rng.nextInt(1, 10)}" else null,
    priority = if (rng.nextBoolean()) rng.nextInt(0, 100) else null,
    description = if (rng.nextBoolean()) randStr(rng, 10, 200) else null,
    acceptance = if (rng.nextBoolean()) "specs/features/${randStr(rng, 4, 10)}.feature" else null,
    humanApproval = if (rng.nextBoolean()) listOf("pending", "approved").random(rng) else null,
    notes = if (rng.nextBoolean()) randStr(rng, 10, 200) else null
)

private fun randomTickets(rng: Random, prefix: String): List<GeneratedTicket> =
    (0 until rng.nextInt(0, 5)).map { randomTicket(rng, "$prefix-$it") }

private fun backlogJson(active: List<GeneratedTicket>, paused: List<GeneratedTicket>, hold: List<GeneratedTicket>, done: List<GeneratedTicket>): String {
    fun arr(list: List<GeneratedTicket>) = JSONArray().apply { list.forEach { put(it.toJson()) } }
    return JSONObject()
        .put("active", arr(active))
        .put("paused", arr(paused))
        .put("hold", arr(hold))
        .put("done", arr(done))
        .toString()
}

/**
 * BL-908 invariant 1 (BL-654 coder-authored property test): "Nothing on a
 * panel is fetched, derived or inferred at browse time — every value shown
 * was read from the package held on the device." [KnowledgeReader.backlogPanelState]
 * takes no network-capable type at all — no `BridgeClient`, `Context`,
 * `baseUrl` or `token` reaches this call (enforced by the signature itself,
 * which accepts only a [CompanionPackageSync.ReadResult]); this property is
 * the executable half of the invariant — for any randomly-generated held
 * package, every field the Ready state shows for every ticket is EXACTLY
 * the value the held data carried, never a value invented, defaulted away
 * from, or drawn from anywhere else.
 */
class KnowledgeReaderBacklogNoDerivationPropertyTest {

    @Test
    fun `every ticket field shown is exactly what the held package data carried, for any generated package`() {
        val rng = Random(20260816908L)
        repeat(300) {
            val active = randomTickets(rng, "active")
            val paused = randomTickets(rng, "paused")
            val hold = randomTickets(rng, "hold")
            val done = randomTickets(rng, "done")
            val data = backlogJson(active, paused, hold, done)
            val held = CompanionPackageSync.HeldPackage("backlog", randStr(rng, 8, 16), "json", 1, data)

            val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held))

            assertTrue("expected Ready for well-formed data, got $state", state is KnowledgeReader.BacklogPanelState.Ready)
            val ready = state as KnowledgeReader.BacklogPanelState.Ready
            assertFoldersMatch(active, ready.folders.active)
            assertFoldersMatch(paused, ready.folders.paused)
            assertFoldersMatch(hold, ready.folders.hold)
            assertFoldersMatch(done, ready.folders.done)
        }
    }

    private fun assertFoldersMatch(expected: List<GeneratedTicket>, actual: List<KnowledgeReader.BacklogTicket>) {
        assertEquals(expected.size, actual.size)
        expected.zip(actual).forEach { (e, a) ->
            assertEquals(e.id, a.id)
            assertEquals(e.title, a.title)
            assertEquals(e.status, a.status)
            assertEquals(e.milestone, a.milestone)
            assertEquals(e.priority, a.priority)
            assertEquals(e.description, a.description)
            assertEquals(e.acceptance, a.acceptance)
            assertEquals(e.humanApproval, a.humanApproval)
            assertEquals(e.notes, a.notes)
        }
    }

    /**
     * Non-vacuity companion: a buggy reader that INFERS a missing status
     * from priority (a plausible "derive it since we can" shortcut) would
     * fail this property immediately.
     */
    @Test
    fun `a buggy reader that infers status from priority would fail this property`() {
        val ticket = JSONObject().put("id", "BL-1").put("title", "t").put("priority", 5)
        val data = JSONObject()
            .put("active", JSONArray().put(ticket))
            .put("paused", JSONArray())
            .put("hold", JSONArray())
            .put("done", JSONArray())
            .toString()
        val held = CompanionPackageSync.HeldPackage("backlog", "gen1", "json", 1, data)

        fun buggyInferStatus(priority: Int?): String? = if (priority != null && priority < 10) "active" else null
        val buggyStatus = buggyInferStatus(5)
        assertEquals("a buggy reader would invent a status the package never carried", "active", buggyStatus)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready
        assertEquals(
            "the real reader must show null (the package carried none), not an inferred value",
            null,
            state.folders.active[0].status
        )
    }
}

/**
 * BL-908 invariant 2 (BL-654 coder-authored property test): "No view
 * presents package content without stating the generation it was read at."
 * Encoded against [KnowledgeReader.backlogPanelState] / [KnowledgeReader.docsPanelState]:
 * whenever a read yields content (a Ready state), the generation it carries
 * is EXACTLY the held package's own generation. The data class shape
 * already makes a Ready with content but no generation unrepresentable —
 * this property exercises the WIRING (that the held generation actually
 * reaches the state, never a stale or substitute one), across the full
 * range of generation strings and both package kinds.
 */
class KnowledgeReaderGenerationAlwaysStatedPropertyTest {

    @Test
    fun `a Ready backlog state always carries the held package's own generation, for any generation and data`() {
        val rng = Random(20260816910L)
        repeat(300) {
            val generation = randStr(rng, 1, 24)
            val active = randomTickets(rng, "a")
            val data = backlogJson(active, emptyList(), emptyList(), emptyList())
            val held = CompanionPackageSync.HeldPackage("backlog", generation, "json", 1, data)

            val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held))

            assertTrue(state is KnowledgeReader.BacklogPanelState.Ready)
            assertEquals(generation, (state as KnowledgeReader.BacklogPanelState.Ready).generation)
        }
    }

    @Test
    fun `a Ready docs state always carries the held package's own generation, for any generation and data`() {
        val rng = Random(20260816911L)
        repeat(300) {
            val generation = randStr(rng, 1, 24)
            val visionJson = JSONArray().put(
                JSONObject().put("id", "specification").put("title", "Specification").put("kind", "markdown")
                    .put("content", randStr(rng, 5, 100))
            )
            val data = JSONObject().put("vision", visionJson).toString()
            val held = CompanionPackageSync.HeldPackage("docs", generation, "json", 1, data)

            val state = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(held))

            assertTrue(state is KnowledgeReader.DocsPanelState.Ready)
            assertEquals(generation, (state as KnowledgeReader.DocsPanelState.Ready).generation)
        }
    }

    /**
     * Non-vacuity companion: a buggy state that shows content labelled with
     * a stale generation (e.g. reused from a prior view) instead of the
     * held package's own would fail this property.
     */
    @Test
    fun `a buggy state carrying a stale generation instead of the held one would fail this property`() {
        val held = CompanionPackageSync.HeldPackage(
            "backlog", "fresh-gen", "json", 1,
            backlogJson(emptyList(), emptyList(), emptyList(), emptyList())
        )

        val buggyGeneration = "stale-gen-from-last-view"
        assertTrue(buggyGeneration != held.generation)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready
        assertEquals(
            "the real state must carry the held package's OWN generation, never a stale one",
            held.generation,
            state.generation
        )
    }
}
