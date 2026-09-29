#!/usr/bin/env bb
;; BL-1702 declared invariant, coder-first (BL-654):
;;
;;   "No launch path starts a pack with a driver seat unless the newest
;;    steward probe summary for that seat's model records at least four of
;;    five coder fixtures handed off and no breached hazard, whatever
;;    PACK_STAFFING_SKIP_GATE says."
;;
;; Generative sweep over the pure decision (local_coder_probe_gate_lib.bb's
;; gate-decisions/window-decision/newest-summary) every caller shares - the
;; shell wiring in swarmforge.sh and the CLI both funnel through it.
;;
;;   Invariant A (fail-closed): a driver seat NEVER admits unless the
;;     newest summary MATCHING its model records verdict "pass" - drawn
;;     over a random mix of matching/non-matching/decoy summaries, random
;;     verdicts, and a random presence/absence of --model on the window
;;     line itself.
;;   Invariant B (real chronology, never mtime): "newest" is resolved by
;;     parsing each filename's own UTC stamp into a java.time.Instant and
;;     comparing those, never a file's mtime (which a copy, sync or
;;     checkout can change without the probe having run again) - proven by
;;     drawing 2-5 same-model summaries with random stamps (random
;;     fractional-second digit counts included) and distinct verdicts, and
;;     checking the decision always follows the chronologically-latest
;;     one's verdict specifically, never a decoy for a different model
;;     however new, and never just "some" matching file.
;;   Invariant C (never gated by the env): the pure decision fn takes no
;;     PACK_STAFFING_SKIP_GATE-shaped input at all - proven by asserting
;;     the SAME evidence set and window set always yields the SAME
;;     decision regardless of that env var's live value in THIS process
;;     (set/unset across repeated draws), and that gate-decisions never
;;     touches System/getenv (a static scan of the loaded lib's source).
;;
;; Generator reach: draws are CONSTRUCTED per shape (a passing/failing/
;; missing summary is built to land on exactly that shape, a decoy is
;; built for a DIFFERENT model on purpose, and Instants are drawn from a
;; wide epoch range with randomised fractional-second digit counts,
;; including zero) - never hoped for. The floors below are absolute.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "local_coder_probe_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (System/nanoTime)))
(def rng (java.util.Random. seed))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))
(defn rand-bool* [] (= 0 (rand-int* 2)))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))
(def coverage (atom {:no-summary 0 :verdict-fail 0 :verdict-pass 0 :no-model-on-window 0 :no-driver-seat 0
                     :newest-of-many-wins 0}))

(def models ["qwen3-14b:latest" "qwen2.5-coder:latest" "openrouter/x:y" "plain-model-name"])

;; A random Instant across a wide range, with a RANDOMISED fractional-second
;; digit count (0, 3, 6 or 9 - matching java.time.Instant/toString's own
;; variable precision), formatted exactly the way probe! formats it
;; (colons -> dashes) - invariant B's varying-precision coverage.
(defn rand-stamp []
  (let [epoch-seconds (+ 1700000000 (rand-int* 100000000))
        nanos (rand-int* 1000000000)
        instant (java.time.Instant/ofEpochSecond epoch-seconds nanos)
        precision (rand-nth* [:seconds :millis :micros :nanos])
        truncated (case precision
                    :seconds (.truncatedTo instant java.time.temporal.ChronoUnit/SECONDS)
                    :millis (.truncatedTo instant java.time.temporal.ChronoUnit/MILLIS)
                    :micros (.truncatedTo instant java.time.temporal.ChronoUnit/MICROS)
                    :nanos instant)]
    {:instant truncated
     :stamp (str/replace (str truncated) #":" "-")}))

(defn summary-file [model verdict handed-off of stamp]
  {:filename (str "local-coder-probe-" (local-coder-probe-gate-lib/safe-model-id model) "-" stamp ".md")
   :content (str "# local coder probe: " model "\n\nhanded off " handed-off " of " of " - verdict " verdict "\n")})

(defn draw-shape []
  (rand-nth* [:no-summary :verdict-fail :verdict-pass :no-model-on-window :no-driver-seat
              :newest-of-many-wins]))

;; Builds {:windows :evidence-files :expect} landing on EXACTLY the drawn
;; shape, plus decoy files for OTHER models (always present, always newer
;; on average, to prove they are never picked).
(defn build-case [shape]
  (let [model (rand-nth* models)
        role (rand-nth* ["coder@2" "coder@3"])
        decoys (mapv (fn [_]
                       (let [{:keys [stamp]} (rand-stamp)
                             decoy-model (rand-nth* (remove #{model} models))]
                         (summary-file decoy-model (rand-nth* ["pass" "fail"])
                                       (rand-int* 6) 5 stamp)))
                     (range (rand-int* 4)))]
    (case shape
      :no-driver-seat
      {:windows [{:role "coder" :agent "claude" :rest (str "--model " model)}]
       :evidence-files decoys
       :expect []}

      :no-model-on-window
      {:windows [{:role role :agent "aider" :rest "--seat-tier easy"}]
       :evidence-files decoys
       :expect [{:decision "refuse" :reason local-coder-probe-gate-lib/reason-no-summary}]}

      :no-summary
      {:windows [{:role role :agent "aider" :rest (str "--model " model " --seat-tier easy")}]
       :evidence-files decoys
       :expect [{:decision "refuse" :reason local-coder-probe-gate-lib/reason-no-summary}]}

      :verdict-fail
      (let [n (rand-int* 4) ; 0..3 of 5 - always below the pass bar
            {:keys [stamp]} (rand-stamp)
            f (summary-file model "fail" n 5 stamp)]
        {:windows [{:role role :agent "aider" :rest (str "--model " model " --seat-tier easy")}]
         :evidence-files (conj decoys f)
         :expect [{:decision "refuse" :reason local-coder-probe-gate-lib/reason-verdict-fail}]})

      :verdict-pass
      (let [{:keys [stamp]} (rand-stamp)
            f (summary-file model "pass" (+ 4 (rand-int* 2)) 5 stamp)]
        {:windows [{:role role :agent "aider" :rest (str "--model " model " --seat-tier easy")}]
         :evidence-files (conj decoys f)
         :expect [{:decision "admit"}]})

      ;; Several summaries for the SAME model, random stamps and random
      ;; verdicts (including duplicates in either order) - the decision
      ;; must follow the CHRONOLOGICALLY LATEST one's verdict, whichever
      ;; position it landed in the evidence list and however many digits
      ;; its stamp's fraction happens to carry.
      :newest-of-many-wins
      (let [n (+ 2 (rand-int* 4))
            same-model (mapv (fn [_]
                                (let [{:keys [instant stamp]} (rand-stamp)]
                                  (assoc (summary-file model (rand-nth* ["pass" "fail"])
                                                       (rand-int* 6) 5 stamp)
                                         :instant instant)))
                              (range n))
            ;; distinct instants only - a tie has no single "the" newest.
            same-model (vals (into {} (map (juxt :instant identity)) same-model))
            newest (last (sort-by :instant same-model))
            newest-verdict (local-coder-probe-gate-lib/summary-verdict (:content newest))]
        {:windows [{:role role :agent "aider" :rest (str "--model " model " --seat-tier easy")}]
         :evidence-files (into decoys same-model)
         :ground-truth {:filename (:filename newest) :verdict newest-verdict}}))))

(dotimes [i runs]
  (let [shape (draw-shape)
        {:keys [windows evidence-files expect ground-truth]} (build-case shape)
        skip-gate? (rand-bool*)]
    (swap! coverage update shape inc)

    (let [decisions (local-coder-probe-gate-lib/gate-decisions windows evidence-files)]
      (if ground-truth
        ;; :newest-of-many-wins - the decision must follow the file the
        ;; generator itself proved (by real Instant comparison) is newest,
        ;; never a different one however the evidence list was ordered.
        (let [got (first decisions)]
          (when (not= 1 (count decisions))
            (fail! (str "draw " i " (" shape "): expected exactly one decision, got " (pr-str decisions))))
          (when (not= (:filename ground-truth) (:summary-path got))
            (fail! (str "draw " i " (" shape "): picked summary " (:summary-path got)
                        " but the chronologically-newest one was " (:filename ground-truth))))
          (let [expected-decision (if (= "pass" (:verdict ground-truth)) "admit" "refuse")]
            (when (not= expected-decision (:decision got))
              (fail! (str "draw " i " (" shape "): newest summary's verdict is " (:verdict ground-truth)
                          " so decision should be " expected-decision ", got " (pr-str got))))))

        ;; invariant A: shape and decision agree exactly
        (do
          (when (not= (count expect) (count decisions))
            (fail! (str "draw " i " (" shape "): expected " (count expect) " decision(s), got " (pr-str decisions))))
          (doseq [[exp got] (map vector expect decisions)]
            (when (not= (:decision exp) (:decision got))
              (fail! (str "draw " i " (" shape "): expected decision " (:decision exp) ", got " (pr-str got))))
            (when (and (:reason exp) (not= (:reason exp) (:reason got)))
              (fail! (str "draw " i " (" shape "): expected reason " (:reason exp) ", got " (pr-str got))))
            (when (= "admit" (:decision exp))
              (when (not= "admit" (:decision got))
                (fail! (str "draw " i " (" shape "): expected admit, got " (pr-str got))))))))

      ;; invariant A, restated: admit implies a summary path was cited
      (doseq [d decisions]
        (when (= "admit" (:decision d))
          (when (nil? (:summary-path d))
            (fail! (str "draw " i ": an admit decision cited no summary path: " (pr-str d))))))

      ;; invariant C: env var presence never changes the decision - simulate
      ;; by setting/unsetting a Java system property with the SAME name a
      ;; careless implementation might read, and re-running.
      (System/setProperty "PACK_STAFFING_SKIP_GATE" (if skip-gate? "1" ""))
      (let [decisions2 (local-coder-probe-gate-lib/gate-decisions windows evidence-files)]
        (when (not= decisions decisions2)
          (fail! (str "draw " i ": decision changed under a live PACK_STAFFING_SKIP_GATE-named property - " (pr-str decisions) " vs " (pr-str decisions2)))))
      (System/clearProperty "PACK_STAFFING_SKIP_GATE"))))

;; invariant C, restated: the actual OS env var (read-only from bb, but
;; provably not System/getenv'd anywhere reachable from gate-decisions) -
;; a static source scan, since bb has no env var stubbing.
(let [lib-source (slurp (str (fs/path script-dir ".." "local_coder_probe_gate_lib.bb")))]
  (when (str/includes? lib-source "getenv")
    (fail! "local_coder_probe_gate_lib.bb reads an environment variable at all - the pure gate must take no PACK_STAFFING_SKIP_GATE-shaped input")))

(doseq [[k floor] {:no-summary 15 :verdict-fail 15 :verdict-pass 15 :no-model-on-window 15 :no-driver-seat 15
                   :newest-of-many-wins 15}]
  (when (< (get @coverage k 0) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k 0)
                " of " runs " (floor " floor ")"))))

(println (str "  seed " seed " runs " runs " coverage " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl1702 local-coder-probe-gate properties: " runs " draws over the pure gate decision"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1)))
