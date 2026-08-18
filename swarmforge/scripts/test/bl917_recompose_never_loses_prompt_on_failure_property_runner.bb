#!/usr/bin/env bb
;; BL-917 coder pass (BL-654 Invariants): PROPERTY test over
;; handoff_lib.bb's recompose-role-prompt! - the single shared function
;; BOTH re-exec call sites (rotate-resident-to! for a different-role
;; rotation, respawn-self! for the same-role idle-boundary clear this
;; ticket adds recompose to) rely on - encoding the ticket's declared
;; invariant 2:
;;
;;   "A recompose failure never blocks the boot: the role still comes up on
;;    the prompt it already had, and the failure is reported rather than
;;    swallowed."
;;
;; Invariant 1 ("every path that re-execs a role's launch script recomposes
;; first") is a structural/wiring claim over the codebase's own finite,
;; already-enumerated set of re-exec call sites (exactly two:
;; rotate-resident-to!, respawn-self!) - not a claim over a runtime input
;; space a generator could usefully sample. It admits no executable
;; PROPERTY encoding for that reason (BL-654's "quantifies over prose or
;; process rather than a pure, testable module" carve-out); it is instead
;; fully covered by test_rotate_recomposes_role_prompt.sh's scenarios
;; 01/02/05, which deterministically prove recompose precedes the respawn
;; on BOTH call sites, and by this fix's own diff (respawn-self! now calls
;; recompose-role-prompt! before its respawn-pane, exactly mirroring
;; rotate-resident-to!'s already-landed BL-911 call).
;;
;; Invariant 2, in contrast, genuinely varies over role name and pre-
;; existing prompt content - a real generative input space - so it gets
;; the property test below: for ANY role and ANY prior prompt-file content,
;; a recompose with no metadata sidecar (forcing failure) must leave the
;; file byte-identical and return {:ok false ...} rather than throwing or
;; silently succeeding with different content.
;;
;; Deliberately in-process (no subprocess forking per run) - matches every
;; existing *_property_runner.bb in this directory (see
;; bl812_project_root_override_property_runner.bb's header for the
;; babashka-startup-cost rationale). Uses handoff-lib/set-project-root! -
;; its own docstring says tests reset target-root between cases this way -
;; so no git repo or tmux fixture is needed at all: the failure branch
;; returns before recompose-role-prompt! ever calls prompt-engine-lib or
;; tmux.
;;
;; Non-vacuity proven by hand at authoring time: temporarily made
;; recompose-role-prompt!'s no-metadata-sidecar branch `spit` a hardcoded
;; "[[recomposed anyway]]" sentinel onto the prompt file before returning
;; {:ok false ...} (the exact regression shape this invariant exists to
;; catch - a "failure" path that still clobbers the existing prompt) -
;; every generated run failed (the file no longer matched its prior
;; content) - then restored before commit.
(ns bl917-recompose-never-loses-prompt-on-failure-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-nth [s coll] (let [[i s'] (gen-int s (count coll))] [(nth coll i) s']))

(def prior-alphabet "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n#-_.")

(defn- gen-char [s]
  (let [[i s'] (gen-int s (count prior-alphabet))]
    [(nth prior-alphabet i) s']))

(defn- gen-string [s min-len max-len]
  (let [[len s1] (gen-int s (inc (- max-len min-len)))
        target (+ min-len len)]
    (loop [i 0 s' s1 acc []]
      (if (= i target)
        [(apply str acc) s']
        (let [[c s''] (gen-char s')]
          (recur (inc i) s'' (conj acc c)))))))

;; Real role names this repo ships, same list prompt_engine_fragment_cache's
;; own property runner already uses - realistic inputs, no invented names.
(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "specifier" "coordinator"])

(defn gen-case [s]
  (let [[role s1] (gen-nth s roles)
        [prior s2] (gen-string s1 0 200)]
    [{:role role :prior prior} s2]))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  role:  " (:role input) "\n  prior-length: " (count (:prior input)) "\n  " msg)))

;; ── P: a failed recompose leaves the prompt file byte-identical, for any ──
;; role and any prior content, and never throws.
(loop [i 0 s 29]
  (when (< i runs)
    (let [[{:keys [role prior] :as case} s'] (gen-case s)
          tmp (str (fs/create-temp-dir {:prefix "bl917-prop-"}))]
      (try
        (handoff-lib/set-project-root! tmp)
        (fs/create-dirs (fs/path tmp ".swarmforge" "prompts"))
        (let [prompt-file (handoff-lib/prompt-file-path role)]
          (spit prompt-file prior)
          ;; No metadata sidecar written for this role -> composition must
          ;; fail before ever reaching prompt-engine-lib/compose or tmux.
          (let [result (handoff-lib/recompose-role-prompt! role)
                after (slurp prompt-file)]
            (when (:ok result)
              (report! "P (invariant): a missing metadata sidecar is a failure, never a silent success" s case
                        (str "expected {:ok false ...}, got: " (pr-str result))))
            (when (not= prior after)
              (report! "P (invariant): a failed recompose leaves the prompt byte-identical" s case
                        (str "prompt changed on a composition failure: was " (count prior) " chars, now " (count after) " chars")))))
        (catch Exception e
          (report! "P (invariant): recompose-role-prompt! never throws on a composition failure" s case
                    (str "threw: " (.getMessage e))))
        (finally
          (handoff-lib/set-project-root! nil)
          (fs/delete-tree tmp {:force true})))
      (recur (inc i) s'))))

;; ── generator coverage, asserted rather than assumed ──────────────────────
(let [distinct-count (loop [i 0 s 29 seen #{}]
                        (if (= i runs)
                          (count seen)
                          (let [[case s'] (gen-case s)]
                            (recur (inc i) s' (conj seen (:role case))))))]
  (println (str "  generator coverage: distinct roles=" distinct-count "/" (count roles)))
  (when (< distinct-count (count roles))
    (report! "COVERAGE distinct generated roles" 29 {:role "n/a" :prior ""} "generator did not reach every role")))

(println (str "handoff_lib recompose-role-prompt! failure-never-clobbers property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
