#!/usr/bin/env bb
;; BL-859: the boot-prefix budget gate the specifier runs before committing a
;; boot-inlined constitution/article change. Measures the SAME stable boot
;; prefix prompt_engine_lib composes at boot (stable-prefix-text) - never a
;; second implementation that could drift from what boot actually pays. The
;; 44000-char budget sits below the unchanged 51200-char cap
;; (prompt_engine_test_runner.bb) so the specifier is caught at authoring
;; time, with a 7200-char band absorbing amendments landing between gate
;; runs before the suite's own cap would fail at verification time.

(ns boot-prefix-budget-gate-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "prompt_engine_lib.bb")))

(def budget 44000)

(defn measure
  "Chars in the stable boot prefix, measured through prompt-engine-lib's own
   stable-prefix-text composer - never re-derived here. root, when given,
   points that SAME composer at a synthetic constitution tree instead of the
   real repo (BL-859 testability invariant: an injected tree root, no
   *_FORCE_RESULT env bypass, no process.chdir); omitted, it measures the
   real repo."
  ([] (count (prompt-engine-lib/stable-prefix-text)))
  ([root] (count (prompt-engine-lib/stable-prefix-text root))))

(defn verdict
  "size -> {:size :budget :over :exit-code}. :over is 0 at or under budget;
   :exit-code is 0 at or under budget, 1 above it."
  [size]
  {:size size
   :budget budget
   :over (max 0 (- size budget))
   :exit-code (if (> size budget) 1 0)})

(defn format-report
  "An actionable remedy, not a bare number: states the measured size, the
   budget, and how many characters must move for a failing verdict."
  [{:keys [size budget over exit-code]}]
  (if (zero? exit-code)
    (str "boot_prefix_budget_gate: ok — " size "/" budget " chars")
    (str "boot_prefix_budget_gate: FAIL — measured " size " chars, budget " budget
         ", move " over " characters out of the boot-inlined prefix (e.g. to "
         "swarmforge/constitution/articles/reference/) before committing")))
