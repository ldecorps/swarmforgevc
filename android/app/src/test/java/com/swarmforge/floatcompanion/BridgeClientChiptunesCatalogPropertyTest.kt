package com.swarmforge.floatcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * BL-765 invariant 2 (BL-654 coder-authored property test): "Every
 * remote-served payload is versioned and validated before use; an
 * unparseable or wrong-schema payload is rejected whole, never applied
 * field-by-field." Encoded against [BridgeClient.parseChiptunesCatalog]: an
 * arbitrary catalog with every song well-formed parses to exactly that song
 * list; a catalog with exactly one malformed song entry anywhere in it
 * parses to null (the whole document rejected) — never a list missing just
 * the bad entry.
 */
class BridgeClientChiptunesCatalogPropertyTest {

    private fun randomValidSong(rng: Random): JSONObject {
        val stepCount = rng.nextInt(1, 6)
        val steps = JSONArray()
        repeat(stepCount) {
            steps.put(JSONArray(listOf(rng.nextInt(0, 90), rng.nextInt(0, 90), rng.nextInt(0, 90), rng.nextInt(0, 3))))
        }
        return JSONObject()
            .put("name", "song-${rng.nextInt(100_000)}")
            .put("bpm", rng.nextInt(40, 220))
            .put("steps", steps)
    }

    /** Each mutator corrupts an otherwise-valid song in exactly one way. */
    private val mutators: List<(JSONObject, Random) -> Unit> = listOf(
        { song, _ -> song.remove("name") },
        { song, _ -> song.put("name", "") },
        { song, _ -> song.remove("bpm") },
        { song, _ -> song.put("bpm", "not-a-number") },
        { song, _ -> song.put("bpm", 0) },
        { song, _ -> song.remove("steps") },
        { song, _ -> song.put("steps", JSONArray()) },
        { song, _ ->
            val steps = song.getJSONArray("steps")
            if (steps.length() == 0) steps.put(JSONArray(listOf(0, 0, 0, 0)))
            steps.put(0, JSONArray(listOf(1, 2, 3))) // wrong row length
        },
        { song, _ ->
            val steps = song.getJSONArray("steps")
            if (steps.length() == 0) steps.put(JSONArray(listOf(0, 0, 0, 0)))
            steps.put(0, JSONArray(listOf("x", 2, 3, 4))) // non-integer cell
        }
    )

    @Test
    fun `an all-valid catalog parses to exactly its songs`() {
        val rng = Random(20260814765L)
        repeat(500) {
            val songCount = rng.nextInt(1, 8)
            val songs = List(songCount) { randomValidSong(rng) }
            val catalog = JSONObject().put("version", 1).put("songs", JSONArray(songs))

            val parsed = BridgeClient.parseChiptunesCatalog(catalog.toString())

            assertEquals("catalog=$catalog", songCount, parsed?.size)
            for ((i, song) in songs.withIndex()) {
                assertEquals(song.getString("name"), parsed!![i].name)
                assertEquals(song.getInt("bpm"), parsed[i].bpm)
            }
        }
    }

    @Test
    fun `a single malformed song anywhere rejects the whole catalog, never a partial list`() {
        val rng = Random(20260814001L)
        repeat(1_000) {
            val songCount = rng.nextInt(1, 8)
            val songs = List(songCount) { randomValidSong(rng) }
            val badIndex = rng.nextInt(songCount)
            val mutate = mutators[rng.nextInt(mutators.size)]
            mutate(songs[badIndex], rng)
            val catalog = JSONObject().put("version", 1).put("songs", JSONArray(songs))

            val parsed = BridgeClient.parseChiptunesCatalog(catalog.toString())

            assertNull(
                "a malformed song at index $badIndex must reject the whole catalog, catalog=$catalog",
                parsed
            )
        }
    }

    @Test
    fun `malformed top-level shapes are rejected whole`() {
        assertNull(BridgeClient.parseChiptunesCatalog("not json at all"))
        assertNull(BridgeClient.parseChiptunesCatalog("{}"))
        assertNull(BridgeClient.parseChiptunesCatalog(JSONObject().put("songs", JSONArray()).toString()))
        assertNull(BridgeClient.parseChiptunesCatalog(JSONObject().put("songs", "not-an-array").toString()))
    }

    @Test
    fun `a naive field-by-field parser would fail this property`() {
        // Non-vacuity companion: a parser that keeps whatever songs happen to
        // parse and silently drops the bad ones would still return a
        // non-null, non-empty list here — demonstrate that failure mode,
        // then confirm the real parser does not share it.
        val good = randomValidSong(Random(1))
        val bad = randomValidSong(Random(2)).apply { remove("bpm") }
        val catalog = JSONObject().put("songs", JSONArray(listOf(good, bad)))

        fun naiveKeepWhatParses(raw: String): List<BridgeClient.ChiptunesSong> {
            val songsJson = JSONObject(raw).getJSONArray("songs")
            val kept = ArrayList<BridgeClient.ChiptunesSong>()
            for (i in 0 until songsJson.length()) {
                val obj = songsJson.getJSONObject(i)
                if (obj.has("bpm")) {
                    kept.add(BridgeClient.ChiptunesSong(obj.getString("name"), obj.getInt("bpm"), emptyList()))
                }
            }
            return kept
        }

        val naiveResult = naiveKeepWhatParses(catalog.toString())
        assertTrue("the naive parser wrongly keeps the good song", naiveResult.isNotEmpty())

        val realResult = BridgeClient.parseChiptunesCatalog(catalog.toString())
        assertNull("the real parser must reject the whole catalog", realResult)
    }
}
