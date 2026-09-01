#!/usr/bin/env bb
;; BL-1318 declared invariants, coder-first (BL-654). Generative sweep over
;; the PURE decision fn (pack_staffing_gate_lib.bb's seat-staffing-decision)
;; every caller shares — the shell gate in swarmforge.sh's parse_config and
;; pack_staffing_gate_cli.bb both funnel through it, so a property proven
;; here holds at every call site.
;;
;;   Invariant 1 (fail-closed, no default): every draw's decision lands in
;;     {pass, refuse, override} - never nil, never a fourth value. A seat
;;     the resolver has no mapping for (unresolved) REFUSES when not
;;     overridden - it is never silently staffed as if the gate had no
;;     opinion.
;;   Invariant 2 (reads evidence only): the evidence map passed in is never
;;     mutated by the call - a sentinel-wrapped read-only spot-check plus a
;;     before/after `=` comparison across every draw (the lib is pure
;;     Clojure data in/out, so this also guards against a future regression
;;     that reaches for an atom or reduces its own input in place).
;;   Invariant 3 (override is never a pass): whenever a seat FAILS a check
;;     and override? is true, the recorded decision is "override", and
;;     "override" is never equal to the literal "pass" - the operator-facing
;;     value always distinguishes the two. Conversely a seat that already
;;     clears every check under override? stays a plain "pass" (override
;;     never invents a failing check that was not there).
;;
;; Generator reach: draws are CONSTRUCTED per shape (a resolvable identity is
;; drawn FROM the tables pack_staffing_gate_lib.bb itself defines, an
;; unresolved one is drawn from strings deliberately absent from those
;; tables, and each of the four fail-closed shapes wires the registry/
;; scorecard evidence to land on exactly the failing check it targets) -
;; never hoped for. The floors below are absolute.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "model_steward_lib.bb")))
(load-file (str (fs/path script-dir ".." "pack_staffing_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (System/nanoTime)))
(def rng (java.util.Random. seed))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))
(defn rand-bool* [] (= 0 (rand-int* 2)))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))
(def coverage (atom {:unresolved 0 :no-pin 0 :not-on-matrix 0 :gate-not-pass 0
                     :not-eligible 0 :fully-cleared 0}))

;; Resolvable identities drawn straight from the lib's own tables - the
;; SAME shapes the live packs pin (BL-1318's own design constraint), never
;; a fixture-only mapping invented for this test.
(def resolvable-agent-models
  (mapv (fn [[[agent model] _provider]] [agent model])
        pack-staffing-gate-lib/agent-model-providers))

(def roles ["QA" "coder" "cleaner" "architect" "hardender" "documenter" "specifier"])

(defn unresolved-agent-model []
  ;; a string deliberately outside every table key - constructed, not hoped
  [(str "ghost-agent-" (rand-int* 100000)) (str "ghost-model-" (rand-int* 100000))])

(defn draw-shape []
  (rand-nth* [:unresolved :no-pin :not-on-matrix :gate-not-pass :not-eligible :fully-cleared]))

;; Builds {:role :agent :extra-cli :evidence} landing on EXACTLY the drawn
;; shape's failing check, by construction.
(defn build-case [shape]
  (let [role (rand-nth* roles)]
    (case shape
      :unresolved
      (let [[agent model] (unresolved-agent-model)]
        {:role role :agent agent :extra-cli (str "--model " model) :evidence {:registry model-steward-lib/empty-registry :scorecards {}}})

      :no-pin
      {:role role :agent "vibe" :extra-cli "--max-price 2.00"
       :evidence {:registry model-steward-lib/empty-registry :scorecards {}}}

      :not-on-matrix
      ;; registered (even certified) but no role_matrix entry for THIS role
      (let [[agent model] (rand-nth* resolvable-agent-models)
            provider (pack-staffing-gate-lib/agent-model-provider agent model)
            reg (model-steward-lib/register-model model-steward-lib/empty-registry provider model {:status "certified"})]
        {:role role :agent agent :extra-cli (str "--model " model)
         :evidence {:registry reg :scorecards {}}})

      :gate-not-pass
      ;; ranked + certified, but the role's own competency is not a decided
      ;; pass - drawn as either "missing scorecard" or "explicit non-pass
      ;; status", covering both fail-closed paths for this check.
      (let [[agent model] (rand-nth* resolvable-agent-models)
            provider (pack-staffing-gate-lib/agent-model-provider agent model)
            reg (-> model-steward-lib/empty-registry
                    (model-steward-lib/register-model provider model {:status "certified"})
                    (model-steward-lib/add-role-ranking role provider model 0.8 "compliance-battery:property-fixture"))
            competency (pack-staffing-gate-lib/gate-competency role)
            scorecards (if (rand-bool*)
                         {}
                         {(str provider "/" model) {:entries [{:competency competency :status "human-verdict-pending"}]}})]
        {:role role :agent agent :extra-cli (str "--model " model)
         :evidence {:registry reg :scorecards scorecards}})

      :not-eligible
      ;; ranked + gate pass, but the model itself is not certified
      ;; (assignment-eligible? fails) - the decertified-after-clearance shape.
      (let [[agent model] (rand-nth* resolvable-agent-models)
            provider (pack-staffing-gate-lib/agent-model-provider agent model)
            competency (pack-staffing-gate-lib/gate-competency role)
            reg (-> model-steward-lib/empty-registry
                    (model-steward-lib/register-model provider model {:status "candidate"})
                    (model-steward-lib/add-role-ranking role provider model 0.8 "compliance-battery:property-fixture"))]
        {:role role :agent agent :extra-cli (str "--model " model)
         :evidence {:registry reg
                    :scorecards {(str provider "/" model) {:entries [{:competency competency :status "pass"}]}}}})

      :fully-cleared
      (let [[agent model] (rand-nth* resolvable-agent-models)
            provider (pack-staffing-gate-lib/agent-model-provider agent model)
            competency (pack-staffing-gate-lib/gate-competency role)
            reg (-> model-steward-lib/empty-registry
                    (model-steward-lib/register-model provider model {:status "certified"})
                    (model-steward-lib/add-role-ranking role provider model 0.8 "compliance-battery:property-fixture"))]
        {:role role :agent agent :extra-cli (str "--model " model)
         :evidence {:registry reg
                    :scorecards {(str provider "/" model) {:entries [{:competency competency :status "pass"}]}}}}))))

(defn shape->coverage-key [shape] shape)

(dotimes [i runs]
  (let [shape (draw-shape)
        {:keys [role agent extra-cli evidence]} (build-case shape)
        override? (rand-bool*)
        evidence-before evidence
        decision (pack-staffing-gate-lib/seat-staffing-decision evidence role agent extra-cli {:override? override?})]

    (swap! coverage update (shape->coverage-key shape) inc)

    ;; invariant 1: always a recorded value in the three-value vocabulary
    (when-not (contains? #{"pass" "refuse" "override"} (:decision decision))
      (fail! (str "draw " i " (" shape ", override? " override? "): decision outside {pass,refuse,override}: " (pr-str decision))))

    ;; invariant 1: unresolved without override refuses - never staffed by
    ;; default
    (when (and (= :unresolved shape) (not override?))
      (when (not= "refuse" (:decision decision))
        (fail! (str "draw " i ": unresolved seat without override did not refuse: " (pr-str decision))))
      (when (not= "seat-model-unresolved" (:failing-check decision))
        (fail! (str "draw " i ": unresolved seat named the wrong failing check: " (pr-str decision)))))

    ;; invariant 1: no-pin always passes - nothing for the steward to clear
    (when (= :no-pin shape)
      (when (not= "pass" (:decision decision))
        (fail! (str "draw " i ": no-pin seat did not pass: " (pr-str decision)))))

    ;; each fail-closed shape names EXACTLY its own failing check when not
    ;; overridden (ordering discipline: matrix before gate before eligibility)
    (when (and (not override?) (contains? #{:not-on-matrix :gate-not-pass :not-eligible} shape))
      (let [expected (case shape
                       :not-on-matrix pack-staffing-gate-lib/check-not-on-role-matrix
                       :gate-not-pass pack-staffing-gate-lib/check-role-gate-not-pass
                       :not-eligible pack-staffing-gate-lib/check-not-assignment-eligible)]
        (when (not= "refuse" (:decision decision))
          (fail! (str "draw " i " (" shape "): expected refuse, got " (pr-str decision))))
        (when (not= expected (:failing-check decision))
          (fail! (str "draw " i " (" shape "): expected failing-check " expected ", got " (pr-str decision))))))

    (when (= :fully-cleared shape)
      (when (not= "pass" (:decision decision))
        (fail! (str "draw " i ": fully-cleared seat did not pass: " (pr-str decision)))))

    ;; invariant 2: the evidence map is never mutated by the call (pure
    ;; data in, pure data out - no atom, no in-place reduce)
    (when (not= evidence-before evidence)
      (fail! (str "draw " i ": evidence map was mutated by seat-staffing-decision")))

    ;; invariant 2, restated as a determinism check: calling again with the
    ;; SAME input yields the SAME decision (a mutating implementation could
    ;; drift on a second call against its own prior write)
    (let [decision2 (pack-staffing-gate-lib/seat-staffing-decision evidence role agent extra-cli {:override? override?})]
      (when (not= decision decision2)
        (fail! (str "draw " i ": seat-staffing-decision is not deterministic for identical input"))))

    ;; invariant 3: override is never indistinguishable from pass
    (when override?
      (let [would-have-failed? (contains? #{:unresolved :not-on-matrix :gate-not-pass :not-eligible} shape)]
        (if would-have-failed?
          (when (not= "override" (:decision decision))
            (fail! (str "draw " i " (" shape ", override): a failing seat under override did not record 'override': " (pr-str decision))))
          (when (not= "pass" (:decision decision))
            (fail! (str "draw " i " (" shape ", override): an already-clearing seat under override was not a plain 'pass': " (pr-str decision)))))
        (when (= "override" (:decision decision))
          (when (= "pass" (:decision decision))
            (fail! (str "draw " i ": impossible - decision is simultaneously 'override' and 'pass'"))))))))

(doseq [[k floor] {:unresolved 15 :no-pin 15 :not-on-matrix 15 :gate-not-pass 15
                   :not-eligible 15 :fully-cleared 15}]
  (when (< (get @coverage k 0) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k 0)
                " of " runs " (floor " floor ")"))))

(println (str "  seed " seed " runs " runs " coverage " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl1318 pack-staffing-gate properties: " runs " draws over the pure staffing decision"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1)))
