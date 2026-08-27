#!/usr/bin/env bb
;; BL-880 declared invariants (backlog/active/BL-880-stale-acceptance-
;; pointer-refused-at-first-hop.yaml) - coder-authored property tests per
;; BL-654's "first authorship of each declared invariant's property test
;; rests with the coder" rule. Same seeded-LCG convention as
;; bl679_ambulance_perimeter_property_runner.bb / boot_prefix_budget_gate_
;; property_runner.bb (deterministic, never rand - the "*.property.test.js"
;; / vitest.properties.config.mjs home is a TypeScript convention with no
;; Babashka equivalent, BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred).
;;
;; Invariant 1 ("draft-ness, step resolution, and declaration style never
;; refuse a pre-QA hop") is split into two properties: 1a proves a NOT
;; APPLICABLE declaration (blank/absent/multi-line/block-scalar residue)
;; never produces a finding no matter what the tree/existence facts say;
;; 1b proves an APPLICABLE declaration that resolves (path-exists? true)
;; is always a clean pass regardless of what the path string itself looks
;; like - including one that ends in ".feature.draft", proving draft-ness
;; is never policed.
;;
;; Invariant 2 ("only a readable tree with the declared path absent fails
;; CLOSED; any infrastructure failure fails OPEN") is encoded directly
;; against acceptance-pointer-gate-lib/evaluate: for every combination of
;; tree-readable?/path-exists? over an applicable declaration, the finding/
;; warning shape is EXACTLY the one the invariant names, and a finding and
;; a warning are never both produced together.
;;
;; Invariant 3's "the early check adds refusals at earlier hops [only]"
;; half is encoded against the real (impure) pointer-findings-for-git-
;; handoff: a QA-addressed `to` (in any combination/position with other
;; roles) always yields the identity result, and does so WITHOUT touching
;; git or the filesystem at all - proven by passing an obviously-invalid
;; project-root and cited-commit and still getting the identity result, no
;; exception. The invariant's other half ("never removes or weakens a
;; QA-edge finding") is a code-shape/non-modification constraint - this
;; ticket's diff never touches acceptance_contract_gate_lib.bb or
;; pre_qa_gate_lib.bb's own evaluate at all, which is what keeps the QA
;; edge's own BL-761 behavior unchanged; there is no generated-input-space
;; claim left to encode once that's true by construction. It has no
;; executable property encoding for that reason - recorded here per BL-654's
;; hatch, mirroring BL-859's precedent for the same kind of non-encodable
;; invariant half. The example-based scenario-05 acceptance test (BL-880's
;; own feature file) covers the QA edge behaviorally instead.

(ns bl880-acceptance-pointer-gate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "acceptance_pointer_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pre_qa_gate_gather_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- gen-string [s n alphabet]
  (loop [i 0 sx s acc []]
    (if (= i n)
      [(apply str acc) sx]
      (let [[c sy] (gen-pick sx alphabet)]
        (recur (inc i) sy (conj acc c))))))

(def path-alphabet (vec "abcdefghijklmnop/-_."))
(def sha-alphabet (vec "0123456789abcdef"))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── invariant 1a: a NOT APPLICABLE declaration never refuses ────────────

(defn- gen-not-applicable-declaration [s]
  (let [[kind s1] (gen-pick s [:nil :blank :whitespace :multi-line :block-scalar])]
    (case kind
      :nil [nil s1]
      :blank ["" s1]
      :whitespace ["   " s1]
      :multi-line
      (let [[body s2] (gen-string s1 8 path-alphabet)]
        [(str "Feature: x\n  " body "\n") s2])
      :block-scalar
      (let [[token s2] (gen-pick s1 ["|" ">" "|-" "|+" ">-" ">+"])]
        [token s2]))))

(defn- gen-1a-case [s]
  (let [[raw-declaration s1] (gen-not-applicable-declaration s)
        [tree-readable? s2] (gen-bool s1)
        [path-exists? s3] (gen-bool s2)]
    [{:raw-declaration raw-declaration :tree-readable? tree-readable? :path-exists? path-exists?} s3]))

(check-all "invariant-1a a not-applicable declaration never produces a finding or a warning"
  gen-1a-case
  (fn [{:keys [raw-declaration tree-readable? path-exists?] :as input}]
    (let [result (acceptance-pointer-gate-lib/evaluate
                  {:ticket-id "BL-999" :raw-declaration raw-declaration :cited-commit "cccccccccc"
                   :tree-readable? tree-readable? :path-exists? path-exists?})]
      (if (= {:findings [] :warnings []} result)
        true
        (str "expected a clean pass for " (pr-str input) ", got: " (pr-str result))))))

;; ── invariant 1b: an APPLICABLE, EXISTING path is always a clean pass -
;;    draft-ness (or any other shape of the path string) is never policed ──

(defn- gen-1b-case [s]
  (let [[stem s1] (gen-string s (inc (mod s 12)) path-alphabet)
        [suffix s2] (gen-pick s1 [".feature" ".feature.draft" ".txt" ""])]
    [(str "specs/features/" stem suffix) s2]))

(check-all "invariant-1b an applicable, existing path is always a clean pass regardless of its own shape"
  gen-1b-case
  (fn [raw-declaration]
    (let [result (acceptance-pointer-gate-lib/evaluate
                  {:ticket-id "BL-999" :raw-declaration raw-declaration :cited-commit "cccccccccc"
                   :tree-readable? true :path-exists? true})]
      (if (= {:findings [] :warnings []} result)
        true
        (str "expected a clean pass for path " (pr-str raw-declaration) ", got: " (pr-str result))))))

;; ── invariant 2: fail-CLOSED / fail-OPEN split is exactly what the
;;    invariant names, and a finding + a warning are never both produced ──

(defn- gen-2-case [s]
  (let [[stem s1] (gen-string s 6 path-alphabet)
        [tree-readable? s2] (gen-bool s1)
        [path-exists? s3] (gen-bool s2)]
    [{:raw-declaration (str "specs/features/" stem ".feature")
      :tree-readable? tree-readable? :path-exists? path-exists?}
     s3]))

(check-all "invariant-2 finding-iff-(readable-tree AND path-absent), warning-iff-unreadable-tree, never both"
  gen-2-case
  (fn [{:keys [raw-declaration tree-readable? path-exists?] :as input}]
    (let [result (acceptance-pointer-gate-lib/evaluate
                  {:ticket-id "BL-999" :raw-declaration raw-declaration :cited-commit "cccccccccc"
                   :tree-readable? tree-readable? :path-exists? path-exists?})
          expect-finding? (and tree-readable? (not path-exists?))
          expect-warning? (not tree-readable?)
          got-finding? (seq (:findings result))
          got-warning? (seq (:warnings result))]
      (cond
        (and got-finding? got-warning?)
        (str "a finding and a warning fired together for " (pr-str input) ": " (pr-str result))

        (not= (boolean expect-finding?) (boolean got-finding?))
        (str "expected finding?=" expect-finding? " for " (pr-str input) ", got: " (pr-str result))

        (not= (boolean expect-warning?) (boolean got-warning?))
        (str "expected warning?=" expect-warning? " for " (pr-str input) ", got: " (pr-str result))

        :else true))))

;; ── invariant 3 (arming half): a QA-addressed `to` always yields the
;;    identity result, and never touches git/fs to get there ──────────────

(def non-qa-roles ["coder" "cleaner" "architect" "hardener" "documenter"])

(defn- gen-to-with-qa [s]
  (let [[n-others s1] (gen-int s 3)
        [others s2] (loop [i 0 sx s1 acc []]
                      (if (= i n-others)
                        [acc sx]
                        (let [[r sy] (gen-pick sx non-qa-roles)]
                          (recur (inc i) sy (conj acc r)))))
        [qa-position s3] (gen-int s2 (inc n-others))
        parts (vec (concat (take qa-position others) ["QA"] (drop qa-position others)))]
    [(str/join "," parts) s3]))

(defn- gen-3-case [s]
  (let [[to s1] (gen-to-with-qa s)
        [ticket-num s2] (gen-int s1 1000)
        [commit-suffix s3] (gen-string s2 10 sha-alphabet)]
    [{:to to :task-name (str "BL-" ticket-num "-fix") :cited-commit commit-suffix} s3]))

(check-all "invariant-3-arming a QA-addressed to: always yields the identity result with no git/fs work"
  gen-3-case
  (fn [{:keys [to task-name cited-commit] :as input}]
    (let [result (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
                  "/nonexistent/BL-880-property-proves-no-io" {:to to :task-name task-name :cited-commit cited-commit})]
      (if (= {:findings [] :warnings []} result)
        true
        (str "expected the identity result for " (pr-str input) ", got: " (pr-str result))))))

;; ── non-vacuity: proves each property above has teeth against a
;;    plausible broken implementation ────────────────────────────────────

(defn- non-vacuity-check! [label broken real]
  (if (not= broken real)
    (println (str "non-vacuity OK: " label))
    (swap! failures conj (str "FAIL non-vacuity " label ": broken value " (pr-str broken)
                               " coincidentally matches the real invariant - the property above would not catch this defect"))))

;; A broken applicable? that treats the block-scalar residue "|" as a real
;; path (the exact regression this gate's own read-yaml-field interaction
;; risked, see acceptance_pointer_gate_lib.bb's own comment) would refuse a
;; blank/inline declaration whenever the tree happens to be readable and no
;; file is literally named "|" - proving invariant-1a's assertion has teeth.
(let [real (acceptance-pointer-gate-lib/evaluate
            {:ticket-id "BL-999" :raw-declaration "|" :cited-commit "cccccccccc"
             :tree-readable? true :path-exists? false})
      broken-treats-residue-as-a-path
      {:findings [{:class :acceptance-pointer :ticket-id "BL-999"
                   :detail "declared acceptance: path \"|\" does not exist at cited commit cccccccccc"}]
       :warnings []}]
  (non-vacuity-check! "invariant-1a (a broken applicable? that treats block-scalar residue as a real path diverges from the real evaluate, which stays silent)"
    broken-treats-residue-as-a-path real))

;; A broken evaluate that also refuses on infrastructure trouble (fails
;; CLOSED instead of OPEN when the tree is unreadable) would produce a
;; finding here - proving invariant-2's fail-open assertion has teeth.
(let [real (acceptance-pointer-gate-lib/evaluate
            {:ticket-id "BL-999" :raw-declaration "specs/features/x.feature" :cited-commit "cccccccccc"
             :tree-readable? false :path-exists? nil})
      broken-fails-closed-on-infra-trouble
      {:findings [{:class :acceptance-pointer :ticket-id "BL-999"
                   :detail "declared acceptance: path \"specs/features/x.feature\" does not exist at cited commit cccccccccc"}]
       :warnings []}]
  (non-vacuity-check! "invariant-2 (a broken evaluate that fails CLOSED on infrastructure trouble diverges from the real one, which fails OPEN)"
    broken-fails-closed-on-infra-trouble real))

;; A broken pointer-findings-for-git-handoff that arms even when QA is a
;; recipient (i.e. never checks gate-armed? at all) would attempt real git
;; work against the bogus project-root and either throw or fabricate a
;; finding/warning - either way it would diverge from the real identity
;; result, proving invariant-3-arming's assertion has teeth.
(non-vacuity-check! "invariant-3-arming (a broken router that ignores QA membership diverges from the real short-circuit)"
  {:findings [{:class :acceptance-pointer :ticket-id "BL-1" :detail "fabricated - the broken router did real git work"}]
   :warnings []}
  (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
   "/nonexistent/BL-880-property-proves-no-io" {:to "QA" :task-name "BL-1-fix" :cited-commit "aaaaaaaaaa"}))

;; ── generator coverage, asserted rather than assumed (BL-654: "an asserted
;;    reachability floor, never a hoped-for one") ───────────────────────────
(let [floor (quot runs 20)
      counts (atom {:not-applicable-kind {} :invariant-2-shape {} :qa-position-is-first {}})]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[{:keys [raw-declaration]} s1] (gen-1a-case s)
            kind (cond (nil? raw-declaration) :nil
                       (str/blank? raw-declaration) :blank-or-whitespace
                       (str/includes? raw-declaration "\n") :multi-line
                       :else :block-scalar)]
        (swap! counts update-in [:not-applicable-kind kind] (fnil inc 0))
        (recur (inc i) s1))))
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[{:keys [tree-readable? path-exists?]} s1] (gen-2-case s)
            shape (cond (not tree-readable?) :warn-fail-open
                        (not path-exists?) :finding-fail-closed
                        :else :clean-pass)]
        (swap! counts update-in [:invariant-2-shape shape] (fnil inc 0))
        (recur (inc i) s1))))
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[to s1] (gen-to-with-qa s)
            first-is-qa? (= "QA" (first (str/split to #",")))]
        (swap! counts update-in [:qa-position-is-first first-is-qa?] (fnil inc 0))
        (recur (inc i) s1))))
  (println (str "  generator coverage (floor=" floor ", runs=" runs "): " (pr-str @counts)))
  (doseq [[category by-value] @counts
          [value n] by-value]
    (when (< n floor)
      (report! (str "COVERAGE " category " " (pr-str value)) 42 {:count n :floor floor}
               (str category "=" (pr-str value) " is barely exercised (" n "/" runs ") - the generator is skewed")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "BL-880 acceptance-pointer-gate invariant properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
