#!/usr/bin/env bb
;; BL-1798 coder pass (BL-654 Invariants): PROPERTY tests over
;; prompt_engine_lib.bb's new :local-compact bootstrap-text-style, encoding
;; the ticket's two declared invariants against the REAL compose/capabilities/
;; builder functions, never a reimplementation of the dispatch itself.
;;
;; Invariant 1 ("Every agent other than local-model composes byte-
;; identically to before this change, for every role, pack flag and
;; overlay.") - P1 generates a (role, agent != local-model, two-pack?,
;; overlay-prompt) request and asserts (a) that agent's own capabilities
;; entry never reports :local-compact, (b) compose's own :system-prompt
;; equals an INDEPENDENTLY reconstructed reference built by dispatching on
;; that same style through a SEPARATE case statement here (aider/mock/
;; generic), never local-compact's, and (c) the composed text never
;; contains a path unique to the local-model cards - a leak detector for
;; any future change that widens the :local-compact branch's reach.
;;
;; Invariant 2 ("A local-model seat's composed prompt is either the loop
;; card plus its role's card within 8192 characters, or, for a role with no
;; card, exactly today's generic composition - never a truncated or partial
;; mix of the two.") - P2 generates a (role, two-pack?, overlay-prompt)
;; request over a MIX of roles that do and do not have their own
;; swarmforge/roles/local-model/<role>.note, and asserts EXACTLY one of two
;; whole shapes: the full, untruncated loop-note content immediately
;; followed by the full, untruncated role-note content (both read fresh
;; from disk, independent of compose's own cache) as a PREFIX of the
;; composed text, with total length <= 8192; or the composed text is
;; byte-identical to the generic (claude) composition of the same role/
;; two-pack?/overlay-prompt. Never anything in between.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners (e.g. prompt_engine_fragment_cache_property_runner.bb). Never
;; `rand`.
;;
;; Non-vacuity proven by hand at authoring time (mutant restored before
;; this commit; `git diff` against the pre-break copy confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken `local-model-has-role-card?`
;;     hardcoded to always return true - failed on every non-local-model
;;     case is UNCHANGED (that mutant only affects local-model's own
;;     dispatch, confirming P1 does NOT vacuously pass for unrelated
;;     reasons); then run against local-model's OWN capabilities entry
;;     temporarily widened to apply :local-compact to a second agent
;;     ("codex") - failed immediately on every codex-generated case, both
;;     on the capabilities assertion and the reference-text comparison.
;;   - P2 was run against a deliberately broken local-compact-bootstrap-text
;;     that truncated the role card to its first 10 characters - failed on
;;     every has-card case (the untruncated-prefix assertion).

(ns bl1798-local-model-compact-card-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "prompt_engine_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 60))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= i 1) s']))
(defn- gen-nth [s coll] (let [[i s'] (gen-int s (count coll))] [(nth coll i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── P1: every OTHER agent composes exactly as it did before this ticket ──

(def non-local-agents (vec (remove #{"local-model"} prompt-engine-lib/supported-agents)))
(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "specifier" "coordinator" "operator"])
(def overlay-prompts ["" "swarmforge/packs/mono-router.prompt" "swarmforge/packs/two-pack.prompt"])

(defn gen-p1 [s]
  (let [[role s1] (gen-nth s roles)
        [agent s2] (gen-nth s1 non-local-agents)
        [two-pack? s3] (gen-bool s2)
        [overlay-prompt s4] (gen-nth s3 overlay-prompts)]
    [{:role role :agent agent :two-pack? two-pack? :overlay-prompt overlay-prompt} s4]))

(defn- reference-body [role agent two-pack? overlay? overlay-prompt draft cache-atom content-fn]
  (let [style (:bootstrap-text-style (prompt-engine-lib/capabilities agent))]
    (case style
      :aider (prompt-engine-lib/aider-bootstrap-text role two-pack?)
      :mock (prompt-engine-lib/mock-bootstrap-text role)
      (prompt-engine-lib/generic-bootstrap-text role draft two-pack? overlay? overlay-prompt cache-atom content-fn))))

(defn- p1-case [{:keys [role agent two-pack? overlay-prompt]}]
  (let [normalized (prompt-engine-lib/normalize-agent agent)
        style (:bootstrap-text-style (prompt-engine-lib/capabilities normalized))
        overlay? (not (str/blank? overlay-prompt))
        draft (prompt-engine-lib/handoff-draft-path normalized)
        actual (:system-prompt (prompt-engine-lib/compose role {:agent agent :two-pack? two-pack? :overlay-prompt overlay-prompt}))
        expected (reference-body role normalized two-pack? overlay? overlay-prompt draft
                                  (atom (prompt-engine-lib/empty-fragment-cache))
                                  prompt-engine-lib/fragment-content-uncached)]
    (cond
      (= style :local-compact)
      (str "agent " agent " (normalized " normalized ") reports :local-compact - only local-model may")

      (not= expected actual)
      (str "compose output diverged from the independently-dispatched reference for agent=" agent
           " role=" role " (lengths " (count actual) " vs " (count expected) ")")

      (str/includes? actual "swarmforge/roles/local-model/")
      (str "compose output for non-local-model agent " agent " leaked a local-model card path")

      :else true)))

;; ── P2: local-model's own composition is one whole shape, never a mix ────

(defn gen-p2 [s]
  (let [[role s1] (gen-nth s roles)
        [two-pack? s2] (gen-bool s1)
        [overlay-prompt s3] (gen-nth s2 overlay-prompts)]
    [{:role role :two-pack? two-pack? :overlay-prompt overlay-prompt} s3]))

;; Independent of prompt-engine-lib/local-model-has-role-card? on purpose: a
;; mutant that breaks THAT function (e.g. hardcoding it to always answer
;; false) would make compose's own dispatch and this test's own oracle agree
;; on the WRONG branch for a role that genuinely has a card, and the
;; disjunctive assertion below ("either shape is acceptable") would then
;; pass vacuously - the has-card branch's own checks (untruncated prefix,
;; budget) would simply never run for "coder". A raw filesystem check here
;; is the ground truth compose's dispatch is supposed to match, not a second
;; call into the thing under test.
(defn- role-card-exists-on-disk? [role]
  (fs/exists? (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." "roles" "local-model" (str role ".note"))))

(defn- p2-case [{:keys [role two-pack? overlay-prompt]}]
  (let [result (prompt-engine-lib/compose role {:agent "local-model" :two-pack? two-pack? :overlay-prompt overlay-prompt})
        text (:system-prompt result)
        has-card? (role-card-exists-on-disk? role)]
    (cond
      (not= :local-compact (:bootstrap-text-style (:metadata result)))
      (str "local-model metadata style was not :local-compact for role=" role)

      has-card?
      (let [loop-content (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".."
                                              ".." "roles" "local-model" "loop.note")))
            role-content (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".."
                                              ".." "roles" "local-model" (str role ".note"))))
            expected-prefix (str loop-content "\n" role-content)]
        (cond
          (not (str/starts-with? text expected-prefix))
          (str "role=" role " has a card but the composed text does not start with the FULL, "
               "untruncated loop+role card content (expected prefix length "
               (count expected-prefix) ", got text length " (count text) ")")

          (> (count text) 8192)
          (str "role=" role " has-card composed text exceeds the 8192-character budget: " (count text))

          :else true))

      :else
      (let [generic (:system-prompt (prompt-engine-lib/compose role {:agent "claude" :two-pack? two-pack? :overlay-prompt overlay-prompt}))]
        (if (not= generic text)
          (str "role=" role " has no card but local-model composition differs from the generic (claude) "
               "composition - expected byte-identical fallback, got lengths " (count text) " vs " (count generic))
          true)))))

;; ── runner ─────────────────────────────────────────────────────────────

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1798]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(check-all "P1: every other agent composes exactly as before this ticket" gen-p1 p1-case)
(check-all "P2: local-model composes one whole shape, never a mix" gen-p2 p2-case)

;; ── generator coverage (asserted reachability floors) ──────────────────

(let [p1-agents (sweep-coverage 1798 gen-p1 :agent)
      p2-roles (sweep-coverage 1798 gen-p2 :role)
      floor (quot runs 10)
      buckets {:p1-distinct-agents (count (distinct p1-agents))
               :p2-has-card (count (filter #(= "coder" %) p2-roles))
               :p2-no-card (count (remove #(= "coder" %) p2-roles))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (when (< (:p1-distinct-agents buckets) (min (count non-local-agents) 4))
    (report! "COVERAGE p1-distinct-agents" 1798 buckets "P1 barely varying its agent dimension"))
  (doseq [k [:p2-has-card :p2-no-card]]
    (when (< (get buckets k) floor)
      (report! (str "COVERAGE " k) 1798 buckets (str k " barely exercised: " (get buckets k) " <= floor " floor)))))

;; ── report ──────────────────────────────────────────────────────────────

(println (str "bl1798 local-model compact-card properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
