package com.swarmforge.floatcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BL-908: example-based coverage for the scenarios in
 * specs/features/BL-908-bubble-knowledge-screen-backlog-docs-panels.feature —
 * one test per Given/Then pairing, named so
 * specs/pipeline/steps/bl908BubbleKnowledgeScreenSteps.js can find them by
 * name after a real `gradlew :app:testDebugUnitTest` run (BL-769 seam, same
 * shape as BridgeClientCompanionPackageParsingTest.kt).
 */

private fun ticketJson(id: String, title: String, description: String? = null): JSONObject {
    val obj = JSONObject().put("id", id).put("title", title)
    if (description != null) obj.put("description", description)
    return obj
}

private fun backlogData(
    active: JSONArray = JSONArray(),
    paused: JSONArray = JSONArray(),
    hold: JSONArray = JSONArray(),
    done: JSONArray = JSONArray()
): String =
    JSONObject().put("active", active).put("paused", paused).put("hold", hold).put("done", done).toString()

private fun docsData(vararg docs: JSONObject): String =
    JSONObject().put("vision", JSONArray(docs.toList())).toString()

class KnowledgeReaderBacklogPanelTest {

    @Test
    fun `the backlog panel lists the tickets held under active`() {
        val data = backlogData(active = JSONArray().put(ticketJson("BL-1", "Active ticket")))
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, data)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready

        assertEquals(1, state.folders.active.size)
        assertEquals("BL-1", state.folders.active[0].id)
    }

    @Test
    fun `the backlog panel lists the tickets held under paused`() {
        val data = backlogData(paused = JSONArray().put(ticketJson("BL-2", "Paused ticket")))
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, data)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready

        assertEquals(1, state.folders.paused.size)
        assertEquals("BL-2", state.folders.paused[0].id)
    }

    @Test
    fun `the backlog panel lists the tickets held under hold`() {
        val data = backlogData(hold = JSONArray().put(ticketJson("BL-3", "Held ticket")))
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, data)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready

        assertEquals(1, state.folders.hold.size)
        assertEquals("BL-3", state.folders.hold[0].id)
    }

    @Test
    fun `the backlog panel lists the tickets held under done`() {
        val data = backlogData(done = JSONArray().put(ticketJson("BL-866", "Companion manifest + package catalog")))
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, data)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready

        assertEquals(1, state.folders.done.size)
        assertEquals("BL-866", state.folders.done[0].id)
    }

    @Test
    fun `opening a listed ticket shows the title and description the package carries`() {
        val data = backlogData(
            done = JSONArray().put(ticketJson("BL-866", "Companion manifest + package catalog", "the bridge-side contract"))
        )
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, data)

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready
        val ticket = state.folders.done.first { it.id == "BL-866" }

        assertEquals("Companion manifest + package catalog", ticket.title)
        assertEquals("the bridge-side contract", ticket.description)
    }

    @Test
    fun `the backlog panel states the generation it was read at`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, backlogData())

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.BacklogPanelState.Ready

        assertEquals("aaaa1111", state.generation)
    }

    @Test
    fun `the backlog panel reports nothing held rather than an empty list, when nothing is cached`() {
        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.NothingHeld)

        assertTrue(state is KnowledgeReader.BacklogPanelState.NothingHeld)
    }
}

class KnowledgeReaderDocsPanelTest {

    @Test
    fun `the docs panel lists and opens a markdown document`() {
        val doc = JSONObject().put("id", "specification").put("title", "Specification").put("kind", "markdown").put("content", "# Spec\n...")
        val held = CompanionPackageSync.HeldPackage("docs", "cccc3333", "json", 1, docsData(doc))

        val state = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.DocsPanelState.Ready
        val opened = state.vision.first { it.title == "Specification" }

        assertEquals("markdown", opened.kind)
        assertEquals("# Spec\n...", opened.content)
    }

    @Test
    fun `the docs panel lists and opens a mermaid document, labelled as a diagram`() {
        val doc = JSONObject().put("id", "architectureDiagram").put("title", "Architecture").put("kind", "mermaid").put("content", "graph TD; A-->B;")
        val held = CompanionPackageSync.HeldPackage("docs", "cccc3333", "json", 1, docsData(doc))

        val state = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.DocsPanelState.Ready
        val opened = state.vision.first { it.title == "Architecture" }

        assertEquals("mermaid", opened.kind)
        assertEquals("graph TD; A-->B;", opened.content)
    }

    @Test
    fun `the docs panel states the generation it was read at`() {
        val held = CompanionPackageSync.HeldPackage("docs", "cccc3333", "json", 1, docsData())

        val state = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(held)) as KnowledgeReader.DocsPanelState.Ready

        assertEquals("cccc3333", state.generation)
    }
}

class KnowledgeReaderNetworkOffTest {

    @Test
    fun `both panels are populated with the network off, from held data only`() {
        val backlogHeld = CompanionPackageSync.HeldPackage(
            "backlog", "aaaa1111", "json", 1,
            backlogData(active = JSONArray().put(ticketJson("BL-1", "t")))
        )
        val docsHeld = CompanionPackageSync.HeldPackage(
            "docs", "cccc3333", "json", 1,
            docsData(JSONObject().put("id", "specification").put("title", "Specification").put("kind", "markdown").put("content", "x"))
        )

        // KnowledgeReader.backlogPanelState/docsPanelState take only a
        // CompanionPackageSync.ReadResult — no BridgeClient, baseUrl or
        // token reaches this call at all, so there is no network call this
        // test could even make; a Ready state here is the proof browsing
        // needed none.
        val backlogState = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(backlogHeld))
        val docsState = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(docsHeld))

        assertTrue(backlogState is KnowledgeReader.BacklogPanelState.Ready)
        assertTrue(docsState is KnowledgeReader.DocsPanelState.Ready)
    }
}

class KnowledgeReaderMalformedPackageTest {

    @Test
    fun `a malformed held backlog package reports malformed rather than throwing or showing partial content`() {
        val held = CompanionPackageSync.HeldPackage("backlog", "aaaa1111", "json", 1, "not json")

        val state = KnowledgeReader.backlogPanelState(CompanionPackageSync.ReadResult.Held(held))

        assertTrue(state is KnowledgeReader.BacklogPanelState.Malformed)
    }

    @Test
    fun `a malformed held docs package reports malformed rather than throwing or showing partial content`() {
        val held = CompanionPackageSync.HeldPackage("docs", "cccc3333", "json", 1, "not json")

        val state = KnowledgeReader.docsPanelState(CompanionPackageSync.ReadResult.Held(held))

        assertTrue(state is KnowledgeReader.DocsPanelState.Malformed)
    }
}

class KnowledgeReaderBacklogParsingTest {

    @Test
    fun `a missing folder field rejects the whole backlog document`() {
        val raw = JSONObject().put("active", JSONArray()).put("paused", JSONArray()).put("hold", JSONArray()).toString()

        assertNull(KnowledgeReader.parseBacklogPackage(raw))
    }

    @Test
    fun `a ticket missing id rejects the whole backlog document`() {
        val raw = JSONObject()
            .put("active", JSONArray().put(JSONObject().put("title", "no id")))
            .put("paused", JSONArray()).put("hold", JSONArray()).put("done", JSONArray())
            .toString()

        assertNull(KnowledgeReader.parseBacklogPackage(raw))
    }

    @Test
    fun `a ticket missing title rejects the whole backlog document`() {
        val raw = JSONObject()
            .put("active", JSONArray().put(JSONObject().put("id", "BL-1")))
            .put("paused", JSONArray()).put("hold", JSONArray()).put("done", JSONArray())
            .toString()

        assertNull(KnowledgeReader.parseBacklogPackage(raw))
    }

    @Test
    fun `not valid json rejects the backlog document`() {
        assertNull(KnowledgeReader.parseBacklogPackage("not json at all"))
    }
}

class KnowledgeReaderDocsParsingTest {

    @Test
    fun `a missing vision field rejects the whole docs document`() {
        assertNull(KnowledgeReader.parseDocsPackage(JSONObject().toString()))
    }

    @Test
    fun `a document missing title rejects the whole docs document`() {
        val raw = JSONObject()
            .put("vision", JSONArray().put(JSONObject().put("id", "x").put("kind", "markdown").put("content", "c")))
            .toString()

        assertNull(KnowledgeReader.parseDocsPackage(raw))
    }

    @Test
    fun `not valid json rejects the docs document`() {
        assertNull(KnowledgeReader.parseDocsPackage("not json at all"))
    }
}
