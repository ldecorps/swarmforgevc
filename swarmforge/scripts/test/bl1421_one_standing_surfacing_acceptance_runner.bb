#!/usr/bin/env bb
;; BL-1421 acceptance test runner: drives the REAL
;; post_qa_branch_sweep_lib.bb sweep! over a JSON-supplied sequence of
;; ticks (each its own landed sha + role facts + an explicit caught-up
;; flag) against a daemon-dir state file, one invocation at a time - the
;; JS step handlers call this once per Gherkin step that advances the
;; sweep, reusing the SAME dir across calls (echoed back in the result) so
;; a "Given already told" setup step and the later "When the sweep runs"
;; step each report only their OWN tells, exactly matching what each
;; Gherkin Then actually asserts about.
;;
;; The caught-up-to-told? fact is supplied directly per tick, same
;; convention as bl1416's explicit busy flag - the real ancestor-check
;; predicate is proven wired via handoffd.bb's own caught-up-to-told?
;; function, a thin git-is-ancestor? wrapper already covered by :can-ff?'s
;; identical shape. Called from bl1421OneStandingSurfacingSteps.js.
(ns bl1421-one-standing-surfacing-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "post_qa_branch_sweep_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(def role (or (:role scenario) "coder"))
(def ticks (:ticks scenario))
;; BL-1289: dir is reused across many SEPARATE bb invocations (one per
;; Gherkin step - see file header), so a plain per-invocation shutdown hook
;; would delete it before the next step could reuse it. This invocation
;; "owns" dir only when it CREATED it fresh (no :dir in scenario); the hook
;; is then a crash-only backstop - it deletes dir if this process dies
;; before handing the path back to the caller in the printed result below,
;; and is a no-op once that hand-off has happened (bl1421OneStandingSurfacingSteps.js's
;; own afterEach owns cleanup on every normal path from there on).
(def created-fresh? (nil? (:dir scenario)))
(def dir (or (:dir scenario) (str (fs/create-temp-dir {:prefix "bl1421-acc-"}))))
(def handed-off? (atom false))
(when created-fresh?
  (.addShutdownHook (Runtime/getRuntime)
                     (Thread. (fn [] (when-not @handed-off? (try (fs/delete-tree dir) (catch Exception _ nil)))))))

(def tells (atom []))
(def logs (atom []))
(def current-facts (atom nil))
(def current-caught-up (atom nil))

(def adapters
  {:role-facts! (fn [_] @current-facts)
   :fast-forward! (fn [_ _] {:success true})
   :caught-up-to-told? (fn [_ _] @current-caught-up)
   :tell! (fn [_ reason _text wake?]
            (swap! tells conj {:reason (name reason) :wake (boolean wake?)})
            {:success true})
   :log! (fn [& parts] (swap! logs conj (vec parts)))})

;; BL-1433: containsLanded defaults to false when a tick omits it - every
;; pre-existing BL-1421/BL-1361 tick describes a HEAD that lacks the landed
;; commit, and absence must never silence a real tell (invariant 3 is
;; about an UNREADABLE fact, not an absent fixture key).
(doseq [tick ticks]
  (reset! current-facts {:head-sha "role-head"
                          :dirty? (boolean (:dirty tick))
                          :in-process? (boolean (:inProcess tick))
                          :can-ff? (boolean (:canFf tick))
                          :contains-landed? (boolean (:containsLanded tick))})
  (reset! current-caught-up (boolean (:caughtUp tick)))
  (post-qa-branch-sweep-lib/sweep! dir (:landedSha tick) [role] adapters))

(println (json/generate-string
          {:dir dir
           :tellCount (count @tells)
           :wakeCount (count (filter :wake @tells))
           :tells @tells
           :logs (mapv #(str/join " " (map str %)) @logs)}))
(reset! handed-off? true)
