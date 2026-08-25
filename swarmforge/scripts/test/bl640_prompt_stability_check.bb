#!/usr/bin/env bb
;; BL-640 scenarios no-steady-state-prompt-growth-04 / top-level-articles-
;; unchanged-06: the freshness guard this ticket adds lives OUTSIDE
;; PromptEngine's compose (ready_for_next.bb, never prompt_engine_lib.bb),
;; so composing must behave exactly as it did before this change - no
;; growth when nothing changed, and a top-level articles/*.prompt amendment
;; still reaches the composed prompt (BL-911's existing delivery,
;; unregressed). Drives the REAL prompt-engine-lib/stable-prefix-text
;; against a materialized synthetic root (the same root seam BL-859 added
;; for the boot-prefix budget gate) - never a parallel reimplementation of
;; compose.

(ns bl640-prompt-stability-check
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "prompt_engine_lib.bb")))

(def failures (atom []))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

(defn report-block!
  "Prints PASS: <marker>: <description> only when nothing in this block has
   failed so far (before-count == count after the block's own assertions) -
   the shell/JS callers grep stdout for this exact marker, so a block that
   actually failed must never also print a false PASS line."
  [marker description before-failure-count]
  (when (= before-failure-count (count @failures))
    (println (str "PASS: " marker ": " description))))

(defn- mk-synthetic-root []
  (let [root (str (fs/create-temp-dir {:prefix "bl640-prompt-stability-"}))
        articles-dir (fs/path root "swarmforge" "constitution" "articles")
        ref-dir (fs/path articles-dir "reference")]
    (fs/create-dirs articles-dir)
    (fs/create-dirs ref-dir)
    (spit (str (fs/path root "swarmforge" "constitution.prompt")) "Constitution preamble.\n")
    (spit (str (fs/path root "swarmforge" "PIPELINE.md")) "Pipeline text.\n")
    (spit (str (fs/path articles-dir "01_workflow.prompt")) "Top-level workflow rule: v1.\n")
    (spit (str (fs/path ref-dir "workflow-detailed.prompt"))
          "Elaboration body, deliberately distinct text that must never be inlined.\n")
    (str root)))

;; ── scenario 04: no growth when nothing changed ───────────────────────────
(let [before-count (count @failures)
      root (mk-synthetic-root)]
  (try
    (let [first-compose (prompt-engine-lib/stable-prefix-text root)
          second-compose (prompt-engine-lib/stable-prefix-text root)]
      (assert-true "04: byte size matches the prior baseline when nothing changed"
                   (= (count first-compose) (count second-compose)))
      (assert-true "04: content is byte-identical, not just same length"
                   (= first-compose second-compose))
      (report-block! "04" "a no-op recompose matches the prior byte size exactly" before-count))
    (finally
      (fs/delete-tree root))))

;; ── scenario 06: a top-level article amendment still reaches compose ─────
(let [before-count (count @failures)
      root (mk-synthetic-root)]
  (try
    (let [before (prompt-engine-lib/stable-prefix-text root)]
      (spit (str (fs/path root "swarmforge" "constitution" "articles" "01_workflow.prompt"))
            "Top-level workflow rule: v2 AMENDED.\n")
      (let [after (prompt-engine-lib/stable-prefix-text root)]
        (assert-true "06: the amended top-level rule reaches the composed prompt"
                     (str/includes? after "v2 AMENDED"))
        (assert-true "06: the amendment actually changed the composed output"
                     (not= before after))
        (report-block! "06" "the amended top-level rule reaches the composed prompt" before-count)))
    (finally
      (fs/delete-tree root))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "bl640_prompt_stability_check: ok"))
