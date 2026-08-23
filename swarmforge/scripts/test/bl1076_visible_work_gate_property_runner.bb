#!/usr/bin/env bb
;; BL-1076 property test (coder-authored, THREE declared invariants) over the
;; batch-claim-progress observer: batch_claim_progress_lib.bb's pure decision
;; and chase_sweep_lib.bb's sidecar application.
;;
;;   Invariant 1: "The observer remains incapable of acting on a parcel. No
;;   label it can return, INCLUDING THE NEW SUPPRESSION LABEL, re-forwards,
;;   re-delivers, moves, copies or deletes a handoff; the only observable
;;   action past this namespace is still a coordinator-facing note."
;;
;;   Invariant 2: "No suppression is silent. Every observation the sweep
;;   declines to surface is recorded against the parcel id with its reason, so
;;   a worktree that is dirty forever is visible as a suppressed signal rather
;;   than as an absent one."
;;
;;   Invariant 3: "The stale clock is driven only by the sidecar recorded
;;   progress instant, and that instant moves only when HEAD actually advances.
;;   No gate defers a decision by rewriting lastProgressAtMs, so a reported age
;;   is always the true age since real progress."
;;
;; BL-678's own property runner already covers the two-label observer. What is
;; new here is a THIRD label, and a third label is exactly the shape that
;; quietly breaks all three invariants at once: the obvious way to implement
;; "don't cry wolf" is to push the clock forward instead of declining to
;; surface (breaks 3), or to drop the observation on the floor (breaks 2), or
;; to reach for the parcel (breaks 1). So each invariant is asserted against
;; the FILESYSTEM after a real sweep, not against the pure return value alone.
;;
;; P1 (invariant 1) runs the real apply-batch-claim-progress-check! over a
;; fixture and asserts the handoff file's bytes, its path, the directory
;; listing, and the absence of any inbox/new copy - for every label. Asserting
;; only "the function returns a keyword" would be vacuous: the point is that no
;; label has a side effect on the parcel.
;;
;; P2 (invariant 2) is the ACCOUNTING property, and it is the one that fails
;; against a lazy fix: every held parcel lands in exactly one of {surfaced,
;; suppressed, silent-because-fresh}, and every suppression carries the parcel
;; id and a reason. A drop-on-the-floor implementation satisfies "no false
;; note" completely while leaving a permanently dirty worktree invisible.
;;
;; P3 (invariant 3) is an EQUALITY on the persisted sidecar: after a sweep with
;; no HEAD advance, lastProgressAtMs is byte-identical to what it was before -
;; whatever the label. A gate that deferred by bumping the clock would suppress
;; correctly today and silently reset the age, so the next genuine stall would
;; be reported as minutes old when it was hours.
;;
;; P4 is the armed-ness backstop, and it is not optional: P1-P3 are ALL
;; satisfied by an observer that returns :suppressed-visible-work for
;; everything - nothing is touched, everything is recorded, no clock moves -
;; while never surfacing a genuine stall again. That is BL-678's duplicate-
;; forward near-miss reopened. So a clean worktree past its threshold must
;; still be surfaced.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The live failure needs a role WITH a raised tolerance, an age past the base
;; but under that tolerance, and a dirty worktree. Drawing an age uniformly
;; over a wide range almost never lands in the 20-90 minute band that is the
;; whole defect, so the age is DERIVED from the resolved threshold - a
;; generated fraction of it, or a generated overshoot past it - rather than
;; drawn on its own. Floors below assert the defect band, the past-tolerance
;; band and each label were reached.
;;
;; P5 is the shipped defect itself, and it exists because the obvious way to
;; state it is VACUOUS. "A hardener inside its own tolerance is not surfaced"
;; is trivially true once that tolerance has collapsed to the base - which is
;; the bug. So P5 names the number instead: an un-overridden hardener resolves
;; to at least 90 minutes, and is not surfaced inside it. Measured: with the
;; per-role map emptied, the relative phrasing fired 0 times and P5 fires 116.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 1076, 240 runs):
;;   - suppress by bumping lastProgressAtMs instead of
;;     declining to surface .............................. P3 156
;;   - drop suppressed observations instead of
;;     recording them .................................... P2 52, + a reach floor
;;   - return :suppressed-visible-work for everything .... P4 68, + a reach floor
;;   - empty the per-role map (the shipped defect) ....... P5 116, + a reach floor
;; Every number is the measured count, not an estimate.
;;
;; Three of the four also trip a coverage floor, which is the reach assertions
;; doing their second job: a break that makes a whole band of states
;; unreachable is caught even where no property statement covers it.

(ns bl1076-visible-work-gate-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 240))
(def failures (atom []))
(def coverage (atom {:defect-band 0 :past-tolerance 0 :under-base 0
                     :label-silent 0 :label-suspect 0 :label-suppressed 0
                     :role-hardener 0 :role-other 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
;; High-bits LCG draw: the raw value is capped at 32767 regardless of the range
;; asked for, so every magnitude below is SCALED explicitly rather than
;; requested as a wide range (the reach trap BL-1035's runner was bitten by).
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def base-ms (* 20 60 1000))
;; The number the defect is about: a Stryker pass routinely runs an hour before
;; the first commit, and BL-528's task-mode ladder already grants hardender 90
;; minutes for exactly that reason. P5 asserts against this literal rather than
;; against the resolver's own answer, so a collapsed tolerance cannot satisfy
;; the property by making its premise unreachable.
(def hardener-floor-ms (* 90 60 1000))
(def tmp-root (str (fs/create-temp-dir {:prefix "bl1076-prop-"})))
;; BL-971: in a finally-equivalent, so a throw above cannot leak the fixture.
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (try (fs/delete-tree tmp-root) (catch Exception _ nil)))))

(defn- write-parcel! [dir basename ticket]
  (fs/create-dirs dir)
  (let [fp (str (fs/path dir basename))]
    (spit fp (str "id: t\nfrom: specifier\nto: batchrole\nrecipient: batchrole\npriority: 50\n"
                  "type: git_handoff\ntask: " ticket "\ncommit: 1234567890\n"
                  "created_at: 2026-08-22T20:20:18Z\n\nbody\n"))
    fp))

(loop [i 0 s 1076]
  (when (< i runs)
    (let [;; The role is drawn, because "which role" is half the defect.
          [role-pick s1] (gen-int s 2)
          role (if (zero? role-pick) "hardender" "cleaner")
          [over-pick s2] (gen-int s1 4)
          ;; An operator override sometimes, so the resolver's whole precedence
          ;; chain is exercised and not just its built-in arm.
          [over-raw s3] (gen-int s2 30)
          overrides (if (zero? over-pick) {role (* (inc over-raw) 60 1000)} {})
          threshold (batch-claim-progress-lib/resolve-stale-threshold-ms role base-ms overrides)
          ;; DERIVED from the resolved threshold, never drawn independently:
          ;; the live failure sits in the band above the BASE and below the
          ;; ROLE's tolerance, which a uniform draw over "some number of
          ;; minutes" reaches almost never.
          [band s4] (gen-int s3 3)
          [frac s5] (gen-int s4 1000)
          age-ms (case band
                   0 (quot (* threshold frac) 1001)          ; strictly under
                   1 threshold                               ; exactly at
                   2 (+ threshold (* 1000 frac) 1))          ; past
          [dirt s6] (gen-int s5 2)
          dirty? (zero? dirt)
          [advance s7] (gen-int s6 4)
          advanced? (zero? advance)
          now-ms 1000000000
          last-progress-ms (- now-ms age-ms)
          dir (str (fs/path tmp-root (str "run-" i)))
          ;; Three parcels in the claim, as the live incident had.
          fps (vec (for [n [1 2 3]] (write-parcel! dir (str n "_item.handoff") (str "BL-90" n "-demo"))))
          _ (doseq [fp fps]
              (spit (str fp ".batch-claim-progress.json")
                    (json/generate-string {:ownerRole role :parcelId (str "P" i)
                                           :claimAtMs last-progress-ms
                                           :lastProgressAtMs last-progress-ms
                                           :lastCommit "commitaaaa"})))
          before-bytes (mapv slurp fps)
          before-listing (set (map str (fs/list-dir dir)))
          {:keys [suspects suppressed]}
          (chase-sweep-lib/apply-batch-claim-progress-check!
           (mapv (fn [fp] {:filePath fp}) fps) now-ms threshold
           (if advanced? "commitbbbb" "commitaaaa") dirty?)
          input {:role role :threshold-min (quot threshold 60000) :age-min (quot age-ms 60000)
                 :dirty? dirty? :advanced? advanced? :overrides overrides :band band}]

      (swap! coverage update (if (= role "hardender") :role-hardener :role-other) inc)
      (when (and (= role "hardender") (> age-ms base-ms) (< age-ms threshold))
        (swap! coverage update :defect-band inc))
      (when (>= age-ms threshold) (swap! coverage update :past-tolerance inc))
      (when (< age-ms base-ms) (swap! coverage update :under-base inc))
      (cond (seq suspects) (swap! coverage update :label-suspect inc)
            (seq suppressed) (swap! coverage update :label-suppressed inc)
            :else (swap! coverage update :label-silent inc))

      ;; ── P1 (invariant 1): no label touches the parcel. Asserted against the
      ;; filesystem, for every label, every time.
      (doseq [[fp before] (map vector fps before-bytes)]
        (when-not (fs/exists? fp)
          (report! "P1 (invariant 1: the observer never deletes or moves a parcel)" s input
                   (str "the handoff file is gone: " fp)))
        (when (and (fs/exists? fp) (not= before (slurp fp)))
          (report! "P1 (invariant 1: the observer never rewrites a parcel)" s input
                   (str "the handoff file's bytes changed: " fp))))
      (let [after-listing (set (map str (fs/list-dir dir)))
            new-files (clojure.set/difference after-listing before-listing)]
        ;; The only file this namespace may create is a sidecar. Anything else
        ;; is a copy or a re-delivery by another name.
        (doseq [f new-files]
          (when-not (clojure.string/ends-with? f ".batch-claim-progress.json")
            (report! "P1 (invariant 1: the observer never copies or re-delivers)" s input
                     (str "an unexpected file appeared: " f)))))

      ;; ── P2 (invariant 2): full accounting. Every held parcel is surfaced,
      ;; suppressed, or genuinely fresh - never quietly dropped - and every
      ;; suppression names the parcel and its reason.
      ;; "Stale" here means stale AFTER the sweep: a real HEAD advance refreshes
      ;; the clock to now, so an advanced parcel is legitimately fresh and
      ;; legitimately unaccounted-for. Judging it on the pre-sweep age would
      ;; make this property fail on correct behaviour.
      (let [accounted (+ (count suspects) (count suppressed))
            stale-after-sweep? (and (not advanced?) (>= age-ms threshold))]
        (when (and stale-after-sweep? (not= accounted (count fps)))
          (report! "P2 (invariant 2: a stale claim is accounted for, never dropped)" s input
                   (str "held " (count fps) " parcels past the threshold, accounted for " accounted)))
        (doseq [item suppressed]
          (when (clojure.string/blank? (str (:item-id item)))
            (report! "P2 (invariant 2: a suppression names its parcel)" s input
                     "a suppression carried no parcel id"))
          (when (clojure.string/blank? (str (:reason item)))
            (report! "P2 (invariant 2: a suppression carries its reason)" s input
                     (str "a suppression carried no reason: " (pr-str item))))))

      ;; ── P3 (invariant 3): the clock moves ONLY on a real HEAD advance. Any
      ;; gate that deferred by bumping it would pass P1 and P2 and silently
      ;; reset the reported age of the next genuine stall.
      (doseq [fp fps]
        (let [after (json/parse-string (slurp (str fp ".batch-claim-progress.json")) true)]
          (if advanced?
            (do
              (when (not= now-ms (:lastProgressAtMs after))
                (report! "P3 (invariant 3: a real HEAD advance does move the clock)" s input
                         (str "expected " now-ms ", got " (:lastProgressAtMs after))))
              (when (not= "commitbbbb" (:lastCommit after))
                (report! "P3 (invariant 3: a real HEAD advance records the new commit)" s input
                         (str "got " (:lastCommit after)))))
            (when (not= last-progress-ms (:lastProgressAtMs after))
              (report! "P3 (invariant 3: no gate defers by rewriting lastProgressAtMs)" s input
                       (str "the clock moved with no HEAD advance: " last-progress-ms
                            " -> " (:lastProgressAtMs after)))))))

      ;; ── P4: the observer is still ARMED. Without this, suppressing
      ;; everything satisfies P1, P2 and P3 and reopens BL-678's near-miss.
      (when (and (not advanced?) (>= age-ms threshold) (not dirty?))
        (when-not (= (count fps) (count suspects))
          (report! "P4 (a clean worktree past its own tolerance is still surfaced)" s input
                   (str "expected " (count fps) " suspects, got " (count suspects)
                        " (suppressed " (count suppressed) ")"))))

      ;; ── P5: the shipped defect, stated ABSOLUTELY rather than relative to
      ;; whatever the resolver happens to return. "A hardener inside its own
      ;; tolerance is not surfaced" is vacuously true when the tolerance has
      ;; collapsed to the base - which is precisely the bug - so the claim has
      ;; to name the number: an un-overridden hardener gets at least the 90
      ;; minutes a Stryker pass needs, and is not surfaced inside it.
      (when (and (= role "hardender") (empty? overrides))
        (when (< threshold hardener-floor-ms)
          (report! "P5 (the shipped defect: a hardener's tolerance covers a mutation pass)" s input
                   (str "resolved " (quot threshold 60000) "m, needs at least "
                        (quot hardener-floor-ms 60000) "m")))
        (when (and (< age-ms hardener-floor-ms) (seq suspects))
          (report! "P5 (the shipped defect: a hardener mid-mutation-pass is not a suspect)" s input
                   (str "surfaced " (count suspects) " suspects at " (quot age-ms 60000)
                        "m - the live incident fired at 20m against a 120m window"))))

      (fs/delete-tree dir)
      (recur (inc i) s7))))

(doseq [[k floor] {:defect-band 15 :past-tolerance 60 :under-base 40
                   :label-silent 40 :label-suspect 30 :label-suppressed 30
                   :role-hardener 90 :role-other 90}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1076 visible-work-gate properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
