package com.swarmforge.floatcompanion

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/**
 * Game Boy-style hold music (Zappa arrangements) via AudioTrack.
 * Plays while the turn is in the thinking phase — same songs as Let's Talk Mini App.
 */
class HoldMusicPlayer {
    data class Song(val name: String, val bpm: Int, val steps: Array<IntArray>)

    private var track: AudioTrack? = null
    private var playThread: Thread? = null
    private val playing = AtomicBoolean(false)
    private var generation = 0
    @Volatile private var volumeGain = 0.55f
    @Volatile private var preferredSongName: String? = null
    @Volatile var currentSongName: String = ""
        private set

    /** null or blank = shuffle. */
    fun setPreferredSong(name: String?) {
        preferredSongName = name?.takeIf { it.isNotBlank() }
    }

    fun preferredSong(): String? = preferredSongName

    /** 0..1 linear gain applied live to the AudioTrack. */
    fun setVolume(gain: Float) {
        volumeGain = gain.coerceIn(0f, 1f)
        try {
            track?.setVolume(volumeGain)
        } catch (_: Exception) {
        }
    }

    fun start(onSongPicked: ((String) -> Unit)? = null) {
        stop()
        val gen = ++generation
        val preferred = preferredSongName
        val song = if (!preferred.isNullOrBlank()) {
            SONGS.find { it.name == preferred } ?: SONGS[Random.nextInt(SONGS.size)]
        } else {
            SONGS[Random.nextInt(SONGS.size)]
        }
        currentSongName = song.name
        onSongPicked?.invoke(song.name)
        playing.set(true)
        playThread = Thread({
            try {
                runSong(song, gen)
            } catch (e: Exception) {
                Log.w(TAG, "hold music failed", e)
            }
        }, "sf-hold-music").also { it.start() }
    }

    fun stop() {
        generation++
        playing.set(false)
        currentSongName = ""
        try {
            track?.pause()
            track?.flush()
            track?.release()
        } catch (_: Exception) {
        }
        track = null
        try {
            playThread?.join(300)
        } catch (_: Exception) {
        }
        playThread = null
    }

    private fun runSong(song: Song, gen: Int) {
        val sampleRate = 22050
        val stepMs = (60_000.0 / song.bpm / 2.0) // eighth notes
        val samplesPerStep = (sampleRate * stepMs / 1000.0).toInt().coerceAtLeast(64)
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val at = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minBuf.coerceAtLeast(samplesPerStep * 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track = at
        try {
            at.setVolume(volumeGain)
        } catch (_: Exception) {
        }
        at.play()
        var step = 0
        val phase = DoubleArray(3)
        while (playing.get() && gen == generation) {
            val s = song.steps[step % song.steps.size]
            val buf = ShortArray(samplesPerStep)
            val f1 = midiHz(s[0])
            val f2 = midiHz(s[1])
            val f3 = midiHz(s[2])
            val hat = s[3]
            for (i in 0 until samplesPerStep) {
                var sample = 0.0
                if (f1 > 0) {
                    phase[0] += f1 / sampleRate
                    sample += square(phase[0]) * 0.22
                }
                if (f2 > 0) {
                    phase[1] += f2 / sampleRate
                    sample += square(phase[1]) * 0.14
                }
                if (f3 > 0) {
                    phase[2] += f3 / sampleRate
                    sample += triangle(phase[2]) * 0.18
                }
                if (hat == 1 && i < samplesPerStep / 8) {
                    sample += (Random.nextDouble() * 2 - 1) * 0.08
                } else if (hat == 2 && i < samplesPerStep / 4) {
                    sample += (Random.nextDouble() * 2 - 1) * 0.18
                }
                // Master gain (half of prior 0.35) — quieter hold music under speech
                val out = (sample * MASTER_GAIN).coerceIn(-1.0, 1.0)
                buf[i] = (out * Short.MAX_VALUE).toInt().toShort()
            }
            if (!playing.get() || gen != generation) break
            at.write(buf, 0, buf.size)
            step++
        }
        try {
            at.stop()
            at.release()
        } catch (_: Exception) {
        }
        if (track === at) track = null
    }

    private fun midiHz(midi: Int): Double {
        if (midi <= 0) return 0.0
        return 440.0 * Math.pow(2.0, (midi - 69) / 12.0)
    }

    private fun square(phase: Double): Double =
        if ((phase % 1.0) < 0.5) 1.0 else -1.0

    private fun triangle(phase: Double): Double {
        val p = phase % 1.0
        return if (p < 0.5) (p * 4 - 1) else (3 - p * 4)
    }

    companion object {
        private const val TAG = "SfFloatHold"
        /** Peak mix scale before soft clip; 0.175 ≈ half the earlier loudness. */
        private const val MASTER_GAIN = 0.175
        private const val R = 0
        private const val C3 = 48; private const val D3 = 50; private const val Eb3 = 51
        private const val E3 = 52; private const val F3 = 53; private const val Fs3 = 54
        private const val G3 = 55; private const val Ab3 = 56; private const val A3 = 57
        private const val Bb3 = 58; private const val B3 = 59
        private const val C4 = 60; private const val D4 = 62; private const val Eb4 = 63
        private const val E4 = 64; private const val F4 = 65; private const val Fs4 = 66
        private const val G4 = 67; private const val Ab4 = 68; private const val A4 = 69
        private const val Bb4 = 70; private const val B4 = 71
        private const val C5 = 72; private const val D5 = 74; private const val Eb5 = 75
        private const val E5 = 76; private const val F5 = 77; private const val Fs5 = 78
        private const val G5 = 79; private const val Ab5 = 80; private const val A5 = 81
        private const val Bb5 = 82; private const val B5 = 83
        private const val C6 = 84

        @Volatile private var remoteSongs: List<Song>? = null

        /**
         * BL-765 invariant 1 (BL-654 coder-authored property test in
         * HoldMusicPlayerPropertyTest): a missing/empty/unusable remote
         * catalog leaves the bundled defaults in place, never an empty
         * songs list. `internal` (BL-769 precedent) so the JVM unit suite
         * can exercise the pure decision directly.
         */
        internal fun chooseEffectiveSongs(remote: List<Song>?): List<Song> =
            if (remote.isNullOrEmpty()) BUNDLED_DEFAULT_SONGS else remote

        /** Called on pair/resume once [BridgeClient.fetchChiptunesCatalog] resolves. */
        fun applyRemoteCatalog(songs: List<Song>?) {
            remoteSongs = songs
        }

        val SONGS: List<Song> get() = chooseEffectiveSongs(remoteSongs)

        // Ported from letsTalkUiHtml.ts chiptuneSongs (pulse1, pulse2, triangle, hat)
        private val BUNDLED_DEFAULT_SONGS: List<Song> = listOf(
            Song("Peaches en Regalia", 138, arrayOf(
                intArrayOf(E5,G4,C3,1), intArrayOf(G5,B4,C3,0), intArrayOf(A5,C5,E3,1), intArrayOf(G5,B4,E3,0),
                intArrayOf(F5,A4,F3,1), intArrayOf(E5,G4,F3,0), intArrayOf(D5,F4,G3,2), intArrayOf(C5,E4,G3,0),
                intArrayOf(E5,G4,A3,1), intArrayOf(G5,B4,A3,0), intArrayOf(A5,C5,F3,1), intArrayOf(B5,D5,F3,0),
                intArrayOf(C6,E5,C3,1), intArrayOf(B5,D5,C3,0), intArrayOf(A5,C5,G3,2), intArrayOf(G5,B4,G3,0),
                intArrayOf(F5,A4,Bb3,1), intArrayOf(E5,Ab4,Bb3,0), intArrayOf(F5,A4,F3,1), intArrayOf(Ab5,C5,F3,0),
                intArrayOf(G5,Bb4,Eb3,1), intArrayOf(F5,Ab4,Eb3,0), intArrayOf(Eb5,G4,Bb3,2), intArrayOf(D5,F4,Bb3,0),
                intArrayOf(E5,G4,C3,1), intArrayOf(D5,F4,C3,0), intArrayOf(E5,G4,G3,1), intArrayOf(G5,B4,G3,0),
                intArrayOf(A5,C5,F3,1), intArrayOf(G5,Bb4,F3,0), intArrayOf(F5,A4,C3,2), intArrayOf(E5,G4,C3,0)
            )),
            Song("Cosmik Debris", 112, arrayOf(
                intArrayOf(E4,R,E3,1), intArrayOf(R,R,E3,0), intArrayOf(G4,B3,G3,1), intArrayOf(A4,C4,G3,0),
                intArrayOf(B4,E4,A3,2), intArrayOf(A4,C4,A3,0), intArrayOf(G4,B3,E3,1), intArrayOf(R,R,E3,0),
                intArrayOf(E4,G3,C3,1), intArrayOf(G4,B3,C3,0), intArrayOf(A4,C4,D3,1), intArrayOf(B4,D4,D3,2),
                intArrayOf(C5,E4,A3,1), intArrayOf(B4,D4,A3,0), intArrayOf(A4,C4,E3,1), intArrayOf(G4,B3,E3,0),
                intArrayOf(E5,G4,E3,1), intArrayOf(D5,Fs4,E3,0), intArrayOf(E5,G4,A3,1), intArrayOf(R,R,A3,2),
                intArrayOf(B4,E4,B3,1), intArrayOf(A4,C4,B3,0), intArrayOf(G4,B3,E3,1), intArrayOf(Fs4,A3,E3,0),
                intArrayOf(E4,G3,A3,1), intArrayOf(R,R,A3,0), intArrayOf(G4,B3,E3,2), intArrayOf(A4,C4,E3,0),
                intArrayOf(B4,D4,G3,1), intArrayOf(C5,E4,G3,0), intArrayOf(B4,D4,E3,1), intArrayOf(A4,C4,E3,2)
            )),
            Song("Muffin Man", 120, arrayOf(
                intArrayOf(A4,E4,A3,1), intArrayOf(R,R,A3,0), intArrayOf(A4,E4,E3,1), intArrayOf(B4,Fs4,E3,2),
                intArrayOf(C5,G4,F3,1), intArrayOf(B4,Fs4,F3,0), intArrayOf(A4,E4,C3,1), intArrayOf(R,R,C3,0),
                intArrayOf(G4,D4,G3,1), intArrayOf(A4,E4,G3,0), intArrayOf(B4,Fs4,D3,2), intArrayOf(C5,G4,D3,0),
                intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0), intArrayOf(B4,Fs4,A3,1), intArrayOf(A4,E4,A3,0),
                intArrayOf(E5,B4,A3,1), intArrayOf(D5,A4,A3,0), intArrayOf(C5,G4,F3,2), intArrayOf(B4,Fs4,F3,0),
                intArrayOf(A4,E4,E3,1), intArrayOf(R,R,E3,0), intArrayOf(G4,D4,A3,1), intArrayOf(A4,E4,A3,2),
                intArrayOf(B4,Fs4,B3,1), intArrayOf(C5,G4,B3,0), intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0),
                intArrayOf(B4,Fs4,E3,2), intArrayOf(A4,E4,E3,0), intArrayOf(G4,D4,A3,1), intArrayOf(A4,E4,A3,0)
            )),
            Song("Montana", 126, arrayOf(
                intArrayOf(B4,Fs4,B3,1), intArrayOf(D5,A4,B3,0), intArrayOf(E5,B4,E3,1), intArrayOf(D5,A4,E3,2),
                intArrayOf(B4,Fs4,Fs3,1), intArrayOf(A4,E4,Fs3,0), intArrayOf(B4,Fs4,B3,1), intArrayOf(R,R,B3,0),
                intArrayOf(Fs5,D5,D3,1), intArrayOf(E5,B4,D3,0), intArrayOf(D5,A4,A3,2), intArrayOf(B4,Fs4,A3,0),
                intArrayOf(A4,E4,E3,1), intArrayOf(B4,Fs4,E3,0), intArrayOf(D5,A4,B3,1), intArrayOf(E5,B4,B3,0),
                intArrayOf(Fs5,D5,Fs3,1), intArrayOf(E5,B4,Fs3,0), intArrayOf(D5,A4,D3,2), intArrayOf(E5,B4,D3,0),
                intArrayOf(Fs5,D5,A3,1), intArrayOf(R,R,A3,0), intArrayOf(E5,B4,E3,1), intArrayOf(D5,A4,E3,2),
                intArrayOf(B4,Fs4,B3,1), intArrayOf(A4,E4,B3,0), intArrayOf(Fs4,D4,Fs3,1), intArrayOf(A4,E4,Fs3,0),
                intArrayOf(B4,Fs4,B3,2), intArrayOf(D5,A4,B3,0), intArrayOf(E5,B4,E3,1), intArrayOf(Fs5,D5,E3,0)
            )),
            Song("Willie the Pimp", 108, arrayOf(
                intArrayOf(A4,E4,A3,1), intArrayOf(C5,G4,A3,0), intArrayOf(D5,A4,D3,2), intArrayOf(C5,G4,D3,0),
                intArrayOf(A4,E4,A3,1), intArrayOf(R,R,A3,0), intArrayOf(G4,D4,E3,1), intArrayOf(A4,E4,E3,0),
                intArrayOf(C5,G4,F3,1), intArrayOf(D5,A4,F3,2), intArrayOf(E5,B4,A3,1), intArrayOf(D5,A4,A3,0),
                intArrayOf(C5,G4,G3,1), intArrayOf(A4,E4,G3,0), intArrayOf(G4,D4,D3,2), intArrayOf(A4,E4,D3,0),
                intArrayOf(E5,C5,A3,1), intArrayOf(D5,A4,A3,0), intArrayOf(C5,G4,E3,1), intArrayOf(D5,A4,E3,2),
                intArrayOf(E5,B4,F3,1), intArrayOf(R,R,F3,0), intArrayOf(D5,A4,D3,1), intArrayOf(C5,G4,D3,0),
                intArrayOf(A4,E4,A3,2), intArrayOf(G4,D4,A3,0), intArrayOf(A4,E4,E3,1), intArrayOf(C5,G4,E3,0),
                intArrayOf(D5,A4,A3,1), intArrayOf(E5,B4,A3,0), intArrayOf(D5,A4,D3,2), intArrayOf(C5,G4,D3,0)
            )),
            Song("Inca Roads", 132, arrayOf(
                intArrayOf(E5,B4,E3,1), intArrayOf(Fs5,D5,E3,0), intArrayOf(G5,E5,A3,1), intArrayOf(Fs5,D5,A3,2),
                intArrayOf(E5,B4,B3,1), intArrayOf(D5,A4,B3,0), intArrayOf(B4,Fs4,E3,1), intArrayOf(R,R,E3,0),
                intArrayOf(D5,A4,D3,1), intArrayOf(E5,B4,D3,0), intArrayOf(Fs5,D5,G3,2), intArrayOf(E5,B4,G3,0),
                intArrayOf(D5,A4,A3,1), intArrayOf(B4,Fs4,A3,0), intArrayOf(A4,E4,E3,1), intArrayOf(B4,Fs4,E3,0),
                intArrayOf(E5,B4,C3,1), intArrayOf(G5,E5,C3,0), intArrayOf(Fs5,D5,G3,2), intArrayOf(E5,B4,G3,0),
                intArrayOf(D5,A4,D3,1), intArrayOf(E5,B4,D3,0), intArrayOf(Fs5,D5,A3,1), intArrayOf(R,R,A3,0),
                intArrayOf(G5,E5,E3,1), intArrayOf(Fs5,D5,E3,2), intArrayOf(E5,B4,B3,1), intArrayOf(D5,A4,B3,0),
                intArrayOf(B4,Fs4,E3,1), intArrayOf(D5,A4,E3,0), intArrayOf(E5,B4,A3,2), intArrayOf(Fs5,D5,A3,0)
            )),
            Song("Zomby Woof", 140, arrayOf(
                intArrayOf(E4,B3,E3,1), intArrayOf(G4,D4,E3,0), intArrayOf(A4,E4,A3,2), intArrayOf(Bb4,F4,A3,0),
                intArrayOf(C5,G4,C3,1), intArrayOf(Bb4,F4,C3,0), intArrayOf(A4,E4,G3,1), intArrayOf(G4,D4,G3,0),
                intArrayOf(E4,B3,E3,2), intArrayOf(R,R,E3,0), intArrayOf(G4,D4,Bb3,1), intArrayOf(A4,E4,Bb3,0),
                intArrayOf(Bb4,F4,F3,1), intArrayOf(C5,G4,F3,2), intArrayOf(D5,A4,Bb3,1), intArrayOf(C5,G4,Bb3,0),
                intArrayOf(Bb4,F4,G3,1), intArrayOf(A4,E4,G3,0), intArrayOf(G4,D4,E3,2), intArrayOf(A4,E4,E3,0),
                intArrayOf(Bb4,F4,Bb3,1), intArrayOf(C5,G4,Bb3,0), intArrayOf(D5,A4,F3,1), intArrayOf(Eb5,Bb4,F3,2),
                intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0), intArrayOf(Bb4,F4,E3,1), intArrayOf(A4,E4,E3,0),
                intArrayOf(G4,D4,C3,2), intArrayOf(A4,E4,C3,0), intArrayOf(Bb4,F4,G3,1), intArrayOf(C5,G4,G3,0)
            )),
            Song("City of Tiny Lites", 118, arrayOf(
                intArrayOf(Fs4,D4,D3,1), intArrayOf(A4,Fs4,D3,0), intArrayOf(B4,G4,G3,1), intArrayOf(A4,Fs4,G3,2),
                intArrayOf(Fs4,D4,A3,1), intArrayOf(E4,C4,A3,0), intArrayOf(D4,A3,D3,1), intArrayOf(R,R,D3,0),
                intArrayOf(Fs4,D4,Fs3,1), intArrayOf(A4,Fs4,Fs3,0), intArrayOf(B4,G4,B3,2), intArrayOf(C5,A4,B3,0),
                intArrayOf(D5,B4,D3,1), intArrayOf(C5,A4,D3,0), intArrayOf(B4,G4,G3,1), intArrayOf(A4,Fs4,G3,0),
                intArrayOf(Fs5,D5,D3,1), intArrayOf(E5,C5,D3,2), intArrayOf(D5,B4,A3,1), intArrayOf(C5,A4,A3,0),
                intArrayOf(B4,G4,E3,1), intArrayOf(A4,Fs4,E3,0), intArrayOf(Fs4,D4,D3,2), intArrayOf(E4,C4,D3,0),
                intArrayOf(D4,A3,A3,1), intArrayOf(Fs4,D4,A3,0), intArrayOf(A4,Fs4,D3,1), intArrayOf(B4,G4,D3,2),
                intArrayOf(C5,A4,G3,1), intArrayOf(B4,G4,G3,0), intArrayOf(A4,Fs4,D3,1), intArrayOf(Fs4,D4,D3,0)
            )),
            Song("Camarillo Brillo", 116, arrayOf(
                intArrayOf(D5,A4,D3,1), intArrayOf(C5,G4,D3,0), intArrayOf(A4,E4,A3,1), intArrayOf(G4,D4,A3,2),
                intArrayOf(F4,C4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(A4,E4,C3,1), intArrayOf(R,R,C3,0),
                intArrayOf(Bb4,F4,Bb3,1), intArrayOf(A4,E4,Bb3,0), intArrayOf(G4,D4,F3,2), intArrayOf(F4,C4,F3,0),
                intArrayOf(E4,B3,C3,1), intArrayOf(F4,C4,C3,0), intArrayOf(G4,D4,G3,1), intArrayOf(A4,E4,G3,0),
                intArrayOf(D5,A4,D3,1), intArrayOf(E5,B4,D3,2), intArrayOf(F5,C5,F3,1), intArrayOf(E5,B4,F3,0),
                intArrayOf(D5,A4,Bb3,1), intArrayOf(C5,G4,Bb3,0), intArrayOf(Bb4,F4,F3,1), intArrayOf(A4,E4,F3,2),
                intArrayOf(G4,D4,C3,1), intArrayOf(A4,E4,C3,0), intArrayOf(Bb4,F4,G3,1), intArrayOf(C5,G4,G3,0),
                intArrayOf(D5,A4,D3,2), intArrayOf(C5,G4,D3,0), intArrayOf(A4,E4,A3,1), intArrayOf(G4,D4,A3,0)
            )),
            Song("Black Napkins", 100, arrayOf(
                intArrayOf(G4,D4,G3,1), intArrayOf(Bb4,F4,G3,0), intArrayOf(C5,G4,C3,1), intArrayOf(Bb4,F4,C3,2),
                intArrayOf(G4,D4,Eb3,1), intArrayOf(F4,C4,Eb3,0), intArrayOf(Eb4,Bb3,Bb3,1), intArrayOf(R,R,Bb3,0),
                intArrayOf(F4,C4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(Bb4,F4,Bb3,2), intArrayOf(C5,G4,Bb3,0),
                intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0), intArrayOf(Bb4,F4,D3,1), intArrayOf(G4,D4,D3,0),
                intArrayOf(F5,C5,Eb3,1), intArrayOf(Eb5,Bb4,Eb3,0), intArrayOf(D5,A4,Bb3,2), intArrayOf(C5,G4,Bb3,0),
                intArrayOf(Bb4,F4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(F4,C4,C3,1), intArrayOf(Eb4,Bb3,C3,2),
                intArrayOf(D4,A3,G3,1), intArrayOf(Eb4,Bb3,G3,0), intArrayOf(F4,C4,Bb3,1), intArrayOf(G4,D4,Bb3,0),
                intArrayOf(Bb4,F4,Eb3,2), intArrayOf(C5,G4,Eb3,0), intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0)
            )),
            Song("Watermelon in Easter Hay", 72, arrayOf(
                intArrayOf(E5,B4,E3,1), intArrayOf(R,R,E3,0), intArrayOf(D5,A4,A3,1), intArrayOf(R,R,A3,0),
                intArrayOf(B4,Fs4,B3,2), intArrayOf(R,R,B3,0), intArrayOf(A4,E4,E3,1), intArrayOf(R,R,E3,0),
                intArrayOf(G4,D4,C3,1), intArrayOf(R,R,C3,0), intArrayOf(A4,E4,D3,1), intArrayOf(R,R,D3,2),
                intArrayOf(B4,Fs4,E3,1), intArrayOf(R,R,E3,0), intArrayOf(D5,A4,A3,1), intArrayOf(R,R,A3,0),
                intArrayOf(E5,B4,E3,1), intArrayOf(R,R,E3,0), intArrayOf(Fs5,D5,Fs3,2), intArrayOf(R,R,Fs3,0),
                intArrayOf(E5,B4,A3,1), intArrayOf(R,R,A3,0), intArrayOf(D5,A4,B3,1), intArrayOf(R,R,B3,0),
                intArrayOf(B4,Fs4,E3,2), intArrayOf(R,R,E3,0), intArrayOf(A4,E4,A3,1), intArrayOf(R,R,A3,0),
                intArrayOf(G4,D4,G3,1), intArrayOf(R,R,G3,0), intArrayOf(A4,E4,E3,2), intArrayOf(B4,Fs4,E3,0)
            )),
            Song("Apostrophe (')", 144, arrayOf(
                intArrayOf(A4,E4,A3,1), intArrayOf(C5,G4,A3,0), intArrayOf(E5,B4,C3,2), intArrayOf(C5,G4,C3,0),
                intArrayOf(A4,E4,E3,1), intArrayOf(G4,D4,E3,0), intArrayOf(E4,B3,A3,1), intArrayOf(G4,D4,A3,0),
                intArrayOf(A4,E4,D3,2), intArrayOf(C5,G4,D3,0), intArrayOf(D5,A4,A3,1), intArrayOf(C5,G4,A3,0),
                intArrayOf(A4,E4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(A4,E4,C3,2), intArrayOf(R,R,C3,0),
                intArrayOf(C5,G4,A3,1), intArrayOf(D5,A4,A3,0), intArrayOf(E5,B4,E3,2), intArrayOf(D5,A4,E3,0),
                intArrayOf(C5,G4,G3,1), intArrayOf(A4,E4,G3,0), intArrayOf(G4,D4,D3,1), intArrayOf(A4,E4,D3,0),
                intArrayOf(C5,G4,A3,2), intArrayOf(E5,B4,A3,0), intArrayOf(D5,A4,F3,1), intArrayOf(C5,G4,F3,0),
                intArrayOf(A4,E4,E3,1), intArrayOf(G4,D4,E3,0), intArrayOf(A4,E4,A3,2), intArrayOf(C5,G4,A3,0)
            )),
            // BL-705 iconic homages (same names/steps as letsTalkUiHtml.ts)
            Song("Thanatos", 96, arrayOf(
                intArrayOf(E4,B3,E3,1), intArrayOf(R,R,E3,0), intArrayOf(G4,E4,E3,1), intArrayOf(B4,G4,G3,2),
                intArrayOf(A4,E4,A3,1), intArrayOf(G4,D4,A3,0), intArrayOf(E4,B3,E3,1), intArrayOf(R,R,E3,0),
                intArrayOf(D4,A3,D3,1), intArrayOf(E4,B3,D3,0), intArrayOf(F4,C4,F3,2), intArrayOf(E4,B3,F3,0),
                intArrayOf(D4,A3,A3,1), intArrayOf(C4,G3,A3,0), intArrayOf(B3,Fs3,E3,1), intArrayOf(R,R,E3,0),
                intArrayOf(E5,B4,E3,1), intArrayOf(D5,A4,E3,0), intArrayOf(B4,G4,G3,2), intArrayOf(A4,E4,G3,0),
                intArrayOf(G4,D4,A3,1), intArrayOf(E4,B3,A3,0), intArrayOf(D4,A3,D3,1), intArrayOf(E4,B3,D3,0),
                intArrayOf(F4,C4,F3,2), intArrayOf(G4,D4,F3,0), intArrayOf(A4,E4,A3,1), intArrayOf(G4,D4,A3,0),
                intArrayOf(E4,B3,E3,1), intArrayOf(R,R,E3,0), intArrayOf(B3,G3,E3,2), intArrayOf(E4,B3,E3,0)
            )),
            Song("Ghost'n Goblins", 128, arrayOf(
                intArrayOf(E5,B4,E3,1), intArrayOf(D5,A4,E3,0), intArrayOf(C5,G4,A3,1), intArrayOf(B4,Fs4,A3,2),
                intArrayOf(A4,E4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(A4,E4,E3,1), intArrayOf(B4,Fs4,E3,0),
                intArrayOf(C5,G4,C3,2), intArrayOf(D5,A4,C3,0), intArrayOf(E5,B4,G3,1), intArrayOf(D5,A4,G3,0),
                intArrayOf(C5,G4,A3,1), intArrayOf(B4,Fs4,A3,0), intArrayOf(A4,E4,E3,2), intArrayOf(R,R,E3,0),
                intArrayOf(G5,E5,E3,1), intArrayOf(Fs5,D5,E3,0), intArrayOf(E5,B4,A3,1), intArrayOf(D5,A4,A3,2),
                intArrayOf(C5,G4,F3,1), intArrayOf(B4,Fs4,F3,0), intArrayOf(A4,E4,E3,1), intArrayOf(G4,D4,E3,0),
                intArrayOf(A4,E4,A3,2), intArrayOf(B4,Fs4,A3,0), intArrayOf(C5,G4,C3,1), intArrayOf(D5,A4,C3,0),
                intArrayOf(E5,B4,E3,1), intArrayOf(D5,A4,E3,0), intArrayOf(B4,Fs4,B3,2), intArrayOf(E5,B4,E3,0)
            )),
            Song("Zelda Overworld", 120, arrayOf(
                intArrayOf(Bb4,F4,Bb3,1), intArrayOf(F4,D4,Bb3,0), intArrayOf(Bb4,F4,F3,1), intArrayOf(Bb4,F4,F3,0),
                intArrayOf(C5,G4,Eb3,1), intArrayOf(D5,A4,Eb3,2), intArrayOf(Eb5,Bb4,Bb3,1), intArrayOf(D5,A4,Bb3,0),
                intArrayOf(C5,G4,F3,1), intArrayOf(Bb4,F4,F3,0), intArrayOf(A4,F4,C3,1), intArrayOf(Bb4,F4,C3,2),
                intArrayOf(C5,G4,F3,1), intArrayOf(R,R,F3,0), intArrayOf(F5,C5,Bb3,1), intArrayOf(Eb5,Bb4,Bb3,0),
                intArrayOf(D5,A4,G3,2), intArrayOf(C5,G4,G3,0), intArrayOf(Bb4,F4,Eb3,1), intArrayOf(A4,F4,Eb3,0),
                intArrayOf(Bb4,F4,Bb3,1), intArrayOf(C5,G4,Bb3,0), intArrayOf(D5,A4,F3,2), intArrayOf(Eb5,Bb4,F3,0),
                intArrayOf(F5,C5,Bb3,1), intArrayOf(Eb5,Bb4,Bb3,0), intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0),
                intArrayOf(Bb4,F4,Bb3,2), intArrayOf(A4,F4,Bb3,0), intArrayOf(Bb4,F4,F3,1), intArrayOf(C5,G4,F3,0)
            )),
            Song("Tron Lightcycle", 110, arrayOf(
                intArrayOf(E4,B3,E3,1), intArrayOf(E4,B3,E3,0), intArrayOf(B4,E4,E3,1), intArrayOf(E4,B3,E3,2),
                intArrayOf(Fs4,D4,Fs3,1), intArrayOf(Fs4,D4,Fs3,0), intArrayOf(B4,Fs4,Fs3,1), intArrayOf(Fs4,D4,Fs3,0),
                intArrayOf(G4,E4,G3,2), intArrayOf(G4,E4,G3,0), intArrayOf(B4,G4,G3,1), intArrayOf(G4,E4,G3,0),
                intArrayOf(A4,E4,A3,1), intArrayOf(A4,E4,A3,0), intArrayOf(E5,A4,A3,2), intArrayOf(A4,E4,A3,0),
                intArrayOf(B4,Fs4,B3,1), intArrayOf(B4,Fs4,B3,0), intArrayOf(Fs5,B4,B3,1), intArrayOf(B4,Fs4,B3,2),
                intArrayOf(A4,E4,A3,1), intArrayOf(G4,E4,G3,0), intArrayOf(Fs4,D4,Fs3,1), intArrayOf(E4,B3,E3,0),
                intArrayOf(E5,B4,E3,2), intArrayOf(B4,Fs4,E3,0), intArrayOf(A4,E4,A3,1), intArrayOf(G4,D4,A3,0),
                intArrayOf(Fs4,D4,B3,1), intArrayOf(E4,B3,B3,0), intArrayOf(B3,Fs3,E3,2), intArrayOf(E4,B3,E3,0)
            )),
            Song("Tetris", 140, arrayOf(
                intArrayOf(E5,B4,E3,1), intArrayOf(B4,G4,E3,0), intArrayOf(C5,A4,A3,1), intArrayOf(D5,B4,A3,2),
                intArrayOf(C5,A4,E3,1), intArrayOf(B4,G4,E3,0), intArrayOf(A4,E4,A3,1), intArrayOf(C5,A4,A3,0),
                intArrayOf(E5,C5,C3,2), intArrayOf(D5,B4,C3,0), intArrayOf(C5,A4,G3,1), intArrayOf(B4,G4,G3,0),
                intArrayOf(E4,B3,E3,1), intArrayOf(R,R,E3,0), intArrayOf(E5,B4,E3,2), intArrayOf(B4,G4,E3,0),
                intArrayOf(C5,A4,A3,1), intArrayOf(D5,B4,A3,0), intArrayOf(C5,A4,E3,2), intArrayOf(B4,G4,E3,0),
                intArrayOf(A4,E4,A3,1), intArrayOf(C5,A4,A3,0), intArrayOf(E5,C5,C3,1), intArrayOf(D5,B4,C3,0),
                intArrayOf(C5,A4,G3,2), intArrayOf(B4,G4,G3,0), intArrayOf(A4,E4,A3,1), intArrayOf(R,R,A3,0),
                intArrayOf(B4,G4,E3,1), intArrayOf(C5,A4,E3,0), intArrayOf(D5,B4,G3,2), intArrayOf(E5,C5,G3,0)
            )),
            Song("Mega Man", 150, arrayOf(
                intArrayOf(G4,D4,G3,1), intArrayOf(G4,D4,G3,0), intArrayOf(G4,D4,G3,1), intArrayOf(Bb4,F4,G3,2),
                intArrayOf(C5,G4,C3,1), intArrayOf(Bb4,F4,C3,0), intArrayOf(G4,D4,G3,1), intArrayOf(R,R,G3,0),
                intArrayOf(F4,C4,F3,1), intArrayOf(G4,D4,F3,0), intArrayOf(Bb4,F4,Bb3,2), intArrayOf(C5,G4,Bb3,0),
                intArrayOf(D5,A4,G3,1), intArrayOf(C5,G4,G3,0), intArrayOf(Bb4,F4,D3,1), intArrayOf(G4,D4,D3,0),
                intArrayOf(G5,D5,G3,2), intArrayOf(F5,C5,G3,0), intArrayOf(D5,A4,Bb3,1), intArrayOf(C5,G4,Bb3,0),
                intArrayOf(Bb4,F4,F3,1), intArrayOf(A4,F4,F3,0), intArrayOf(G4,D4,G3,2), intArrayOf(R,R,G3,0),
                intArrayOf(Bb4,F4,Bb3,1), intArrayOf(C5,G4,Bb3,0), intArrayOf(D5,A4,G3,1), intArrayOf(F5,C5,G3,2),
                intArrayOf(D5,A4,C3,1), intArrayOf(C5,G4,C3,0), intArrayOf(Bb4,F4,G3,1), intArrayOf(G4,D4,G3,0)
            ))
        )
    }
}
