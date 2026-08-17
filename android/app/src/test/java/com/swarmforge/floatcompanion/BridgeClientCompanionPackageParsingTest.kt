package com.swarmforge.floatcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * BL-907: parseCompanionManifest / parseCompanionPackageOk are the pure
 * parsing decisions behind fetchCompanionManifest / fetchCompanionPackage —
 * plain Strings/JSONObject, no `android.*` import (BL-769 Testability
 * Boundary).
 */
class BridgeClientCompanionManifestParsingTest {

    @Test
    fun `parses every advertised package`() {
        val raw = JSONObject().put(
            "packages",
            JSONArray()
                .put(JSONObject().put("name", "backlog").put("generation", "aaaa1111").put("format", "json").put("formatVersion", 1))
                .put(JSONObject().put("name", "docs").put("generation", "bbbb2222").put("format", "json").put("formatVersion", 1))
        ).toString()

        val entries = BridgeClient.parseCompanionManifest(raw)

        assertEquals(2, entries?.size)
        assertEquals("backlog", entries?.get(0)?.name)
        assertEquals("aaaa1111", entries?.get(0)?.generation)
        assertEquals("docs", entries?.get(1)?.name)
    }

    @Test
    fun `an empty package list parses to an empty list, not null`() {
        val raw = JSONObject().put("packages", JSONArray()).toString()

        assertEquals(emptyList<Any>(), BridgeClient.parseCompanionManifest(raw))
    }

    @Test
    fun `a missing packages field rejects the document`() {
        assertNull(BridgeClient.parseCompanionManifest(JSONObject().toString()))
    }

    @Test
    fun `an entry missing a required field rejects the whole document`() {
        val raw = JSONObject().put(
            "packages",
            JSONArray().put(JSONObject().put("name", "backlog").put("format", "json").put("formatVersion", 1))
        ).toString()

        assertNull(BridgeClient.parseCompanionManifest(raw))
    }

    // Hardener addition (BL-907 hand-authored surgical mutation sweep — no
    // mutation tool wired for .kt): an entry missing/negative formatVersion
    // is a SEPARATE check term (`formatVersion < 0`) from the other three
    // required-field checks on the same line — dropping just that term left
    // no test failing, so this locks the whole-document rejection in for the
    // field the prior test didn't cover.
    @Test
    fun `an entry with a negative formatVersion rejects the whole document`() {
        val raw = JSONObject().put(
            "packages",
            JSONArray().put(
                JSONObject().put("name", "backlog").put("generation", "aaaa1111").put("format", "json")
                    .put("formatVersion", -1)
            )
        ).toString()

        assertNull(BridgeClient.parseCompanionManifest(raw))
    }

    @Test
    fun `an entry with a missing formatVersion rejects the whole document`() {
        val raw = JSONObject().put(
            "packages",
            JSONArray().put(JSONObject().put("name", "backlog").put("generation", "aaaa1111").put("format", "json"))
        ).toString()

        assertNull(BridgeClient.parseCompanionManifest(raw))
    }

    // Hardener addition: same gap for `name.isBlank()` — a blank (not
    // merely absent) name is its own check term and was not exercised by
    // any prior test.
    @Test
    fun `an entry with a blank name rejects the whole document`() {
        val raw = JSONObject().put(
            "packages",
            JSONArray().put(
                JSONObject().put("name", "").put("generation", "aaaa1111").put("format", "json").put("formatVersion", 1)
            )
        ).toString()

        assertNull(BridgeClient.parseCompanionManifest(raw))
    }

    @Test
    fun `not valid json rejects the document`() {
        assertNull(BridgeClient.parseCompanionManifest("not json at all"))
    }
}

class BridgeClientCompanionPackageOkParsingTest {

    @Test
    fun `parses a served package body`() {
        val raw = JSONObject()
            .put("name", "backlog")
            .put("generation", "aaaa1111")
            .put("format", "json")
            .put("formatVersion", 1)
            .put("data", JSONObject().put("tickets", JSONArray()))
            .toString()

        val ok = BridgeClient.parseCompanionPackageOk("backlog", raw)

        assertEquals("backlog", ok?.name)
        assertEquals("aaaa1111", ok?.generation)
        assertEquals(1, ok?.formatVersion)
    }

    @Test
    fun `a missing generation rejects the body`() {
        val raw = JSONObject().put("name", "backlog").put("data", JSONObject()).toString()

        assertNull(BridgeClient.parseCompanionPackageOk("backlog", raw))
    }

    @Test
    fun `a missing data field rejects the body`() {
        val raw = JSONObject().put("name", "backlog").put("generation", "aaaa1111").toString()

        assertNull(BridgeClient.parseCompanionPackageOk("backlog", raw))
    }

    @Test
    fun `not valid json rejects the body`() {
        assertNull(BridgeClient.parseCompanionPackageOk("backlog", "truncated {\"name\":\"back"))
    }
}
