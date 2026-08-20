#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib/actively-processing? — pure, no tmux.
;;
;; BL-970: the contract is the pane's RENDERED TURN STATE - a live status
;; frame line (spinner glyph + verb words + ellipsis + digit-led parens) in
;; the snapshot's tail window classifies busy; everything else - idle
;; prompts, finished-turn footers, backgrounded-shell chrome, busy-marker
;; phrases quoted inside transcript text, and even a byte-perfect frame
;; line sitting ABOVE the tail window - classifies idle. The old
;; anywhere-in-pane marker-word expectations this runner used to pin were
;; the defect (false-busy at idle prompts, self-sustaining because a
;; skipped wake never scrolls the marker away), so those assertions are
;; deliberately inverted here. The six shipped fixtures under
;; specs/features/fixtures/BL-970/ are the canonical contract; this runner
;; drives them plus the synthetic edges.

(ns actively-processing-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def fixtures-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".."
                                "specs" "features" "fixtures" "BL-970")))

(def failures (atom []))

(defn assert-busy [msg text]
  (when-not (chase-sweep-lib/actively-processing? text)
    (swap! failures conj (str "FAIL (expected busy): " msg))))

(defn assert-idle [msg text]
  (when (chase-sweep-lib/actively-processing? text)
    (swap! failures conj (str "FAIL (expected idle): " msg))))

;; ── the shipped fixture contract, verbatim ─────────────────────────────
(doseq [[f busy?] [["idle-bg-shell-running-chrome.txt" false]
                   ["idle-quoted-busy-marker.txt" false]
                   ["idle-real-qa-4-shells.txt" false]
                   ["midturn-esc-footer.txt" true]
                   ["midturn-unlisted-verb-real-capture.txt" true]
                   ["midturn-unlisted-verb-no-counter.txt" true]
                   ["empty-capture.txt" false]]]
  (let [text (slurp (str (fs/path fixtures-dir f)))]
    (if busy?
      (assert-busy (str "fixture " f) text)
      (assert-idle (str "fixture " f) text))))

;; ── live frames: any verb, any spinner glyph, counter or not ───────────
(assert-busy "listed-verb frame with counter"
             "· Whirlpooling… (6m 10s · ↓ 14.4k tokens)")
(assert-busy "unlisted single-word verb, no counter"
             "✢ Fermenting… (12s)")
(assert-busy "unlisted multi-word verb"
             "✻ Compacting conversation… (44s)")
(assert-busy "ascii-ellipsis frame"
             "* Reticulating... (1m 2s)")
(assert-busy "frame among idle footer chrome (real tail shape)"
             (str "⏺ done with the sweep.\n"
                  "✳ Hatching… (2m 10s · ↓ 5.2k tokens)\n"
                  "❯\n"
                  "  bypass permissions on (shift+tab to cycle)"))

;; ── idle shapes the old classifier misread as busy ─────────────────────
(assert-idle "finished-turn footer with lingering shells"
             (str "✻ Worked for 5m 2s · 5 shells still running\n"
                  "❯\n"
                  "  bypass permissions on"))
(assert-idle "bare backgrounded Running line at an idle prompt"
             "  Running…\n❯ \n  bypass permissions on")
(assert-idle "busy-marker phrase quoted inside a transcript detail line"
             (str "⏺ Read(babysitter_nudge_lib.bb)\n"
                  "  ⎿  {:detail \"pane mid-turn (esc to interrupt) — retry when idle\"}\n"
                  "✻ Worked for 41s\n"
                  "❯"))
(assert-idle "transcript bullet with ellipsis-parens is not a frame"
             "⏺ Retrying… (2 of 3)\n❯")
(assert-idle "byte-perfect frame line ABOVE the tail window (zone layer)"
             (str "✳ Hatching… (2m 10s · ↓ 5.2k tokens)\n"
                  (str/join "\n" (repeat 25 "scrollback line"))
                  "\n✻ Worked for 9s\n❯"))
(assert-idle "idle prompt with only permission chrome"
             "❯ \n  bypass permissions on (shift+tab to cycle)\n  ● main")
(assert-idle "plain shell output" "ls -la\ntotal 0\n❯ ")
(assert-idle "nil capture" nil)
(assert-idle "empty capture" "")

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "actively_processing_test_runner: ALL CHECKS PASSED")
