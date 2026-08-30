#!/usr/bin/env bb
;; BL-1182: the day-long BoB trial lifecycle — nominate, seat, assess, promote
;; or revert. PURE: every function here takes state in and returns state out.
;; Disk IO belongs to model_steward_store.bb, the seat write to
;; model_factory_store.bb, and the memory-transfer boundary to the node tool
;; the CLI shells to (Babashka cannot import BL-1177's TypeScript).
;;
;; The four verbs are ONE state machine, which is why they are one ticket and
;; one lib: a seat that can be armed but never assessed leaves a non-permanent
;; model in a role indefinitely - a worse state than never trialling.
;;
;; Cost comparison is model_factory_lib's `cost-class-rank`, not a second
;; ranking of the same three words. Invariant 1's tie-break and ModelFactory's
;; cheap mode must agree by construction; two tables would eventually disagree
;; and only one of them would be the one anybody tested.

(ns model-steward-trial-lib
  (:require [clojure.string :as str]))

(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*))
                                  "model_steward_lib.bb")))
(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*))
                                  "model_factory_lib.bb")))

(def trial-schema-version 1)

;; One operating day. Held as hours rather than "a calendar day" because the
;; window is measured from the arming instant, not from midnight - a trial
;; nominated at 23:50 must still get a day, not ten minutes.
(def trial-window-hours 24)

(def armed-status "armed")
(def promoted-status "promoted")
(def reverted-status "reverted")

(def empty-trials
  {:schema-version trial-schema-version
   :active {}    ;; role -> armed trial record
   :history []   ;; every completed trial, newest last
   :losers {}})  ;; role -> [{:provider :model :evidence :at}]

;; ── BL-1183: the go-live gate ─────────────────────────────────────────────
;;
;; The human's instruction: do not run live day-long production trials until
;; telemetry and performance-assessing tools can actually decide
;; outrank / tie / lose. So a production trial does not merely fail to be
;; useful without them - it refuses to arm.
;;
;; What "ready" MEANS here is derived from what `decide` above actually needs,
;; not invented as a separate checklist that could drift from it:
;;   - TELEMETRY is a role-matrix score for BOTH models. Without both, `decide`
;;     falls through its unscored clause and reverts on absent evidence; it
;;     never compares anything, so the trial would burn a day to learn nothing.
;;   - An ASSESSOR is battery/scorecard/bake-off evidence behind those scores -
;;     `model_steward_lib/battery-or-scorecard-evidence?`, the same predicate
;;     `ranking-authority-tier` already uses to decide which evidence may
;;     outrank which. A score with no such citation is somebody's opinion, and
;;     an opinion cannot adjudicate a day of production.
;;
;; Fail-closed by construction: `go-live-checklist` reports ready only when it
;; can positively see both, for both models. An unreadable registry, an absent
;; role matrix and a candidate nobody has scored all produce a NAMED gap rather
;; than a pass - invariant 2's "never a silent skip into live trial".

(defn- scored-entry [registry role provider model]
  (->> (model-steward-lib/role-recommendations registry role {:include-uncertified? true})
       (filter #(and (= provider (:provider %)) (= model (:model %))))
       first))

(defn go-live-readiness
  "What the registry can actually see about this pairing, as data. Pure over
   the registry so the checklist is decidable offline - the ticket's own
   qa_e2e step 3 asks for exactly that."
  [registry role candidate permanent]
  (letfn [(look [who {:keys [provider model]}]
            (let [entry (scored-entry registry role provider model)]
              {:who who
               :model (str provider "/" model)
               :scored? (number? (:score entry))
               :assessed? (model-steward-lib/battery-or-scorecard-evidence? (:evidence entry))}))]
    [(look "candidate" candidate) (look "permanent" permanent)]))

(defn go-live-checklist
  "Turns readiness into a verdict that NAMES every gap. The missing list is the
   whole value of this function: a bare false would tell an operator to go
   looking, which is the same cost as no gate at all."
  [readiness]
  (let [missing (vec (concat
                      (for [{:keys [who model scored?]} readiness
                            :when (not scored?)]
                        (str "trial-comparison telemetry: no recorded score for the " who " " model))
                      (for [{:keys [who model assessed?]} readiness
                            :when (not assessed?)]
                        (str "performance assessor: no battery/scorecard/bake-off evidence for the " who " " model))))]
    {:ready? (empty? missing) :missing missing}))

(defn go-live-refusal
  "The refusal text, or nil when the checklist is satisfied. One string, so a
   caller cannot accidentally report the verdict without the reasons."
  [{:keys [ready? missing]}]
  (when-not ready?
    (str "trial refused: the BoB go-live checklist is not satisfied - "
         (clojure.string/join "; " missing))))

;; ── nomination ────────────────────────────────────────────────────────────

(defn armed-for-role [trials role]
  (get-in trials [:active role]))

(defn losers-for-role [trials role]
  (get-in trials [:losers role] []))

(defn- loser-record [trials role provider model]
  (first (filter #(and (= provider (:provider %)) (= model (:model %)))
                 (losers-for-role trials role))))

(defn silent-re-trial?
  "A candidate that already LOST a trial for this role may be nominated again
   only on evidence that is not the evidence it lost with. Without this, a
   losing model can be re-seated every day forever, each nomination looking
   reasonable in isolation - which is what invariant 2's 'against silent
   re-trial' names. `evidence` is the citation the nominator offers; blank
   evidence never clears a prior loss."
  [trials role provider model evidence]
  (if-let [prior (loser-record trials role provider model)]
    (or (str/blank? (str evidence))
        (= (str evidence) (str (:evidence prior))))
    false))

(defn ends-at
  "The trial's end instant: `started-at` plus one operating day. Both are ISO-8601
   instants; the caller supplies the clock so nothing here reads one."
  [started-at]
  (str (.plusSeconds (java.time.Instant/parse started-at) (* 60 60 trial-window-hours))))

(defn nominate
  "Arms a one-day trial of `provider`/`model` on `role`'s seat.

   Returns {:trials trials' :trial record} on success, or {:error reason} -
   never a partially-armed state. Refusals, each with its own reason so the
   steward's operator can tell them apart:
     - a trial is already armed for that role (one seat, one experiment);
     - the candidate is not assignment-eligible (the certification gate is
       ModelFactory's, and a trial seat is a live seat);
     - the candidate is already the permanent model (nothing to learn);
     - the candidate lost a prior trial and no new evidence is cited."
  [trials registry role {:keys [provider model evidence]} permanent started-at]
  (cond
    (armed-for-role trials role)
    {:error (str "trial refused: " role " already has an armed trial ("
                 (:provider (armed-for-role trials role)) "/"
                 (:model (armed-for-role trials role)) ")")}

    (not (model-steward-lib/assignment-eligible? registry provider model))
    {:error (str "trial refused: " provider "/" model " is not certified for assignment")}

    (and (= provider (:provider permanent)) (= model (:model permanent)))
    {:error (str "trial refused: " provider "/" model " is already permanent for " role)}

    (silent-re-trial? trials role provider model evidence)
    {:error (str "trial refused: " provider "/" model " already lost a trial for " role
                 " - cite new evidence to re-trial")}

    :else
    (let [entry (model-steward-lib/model-entry registry provider model)
          record {:role role
                  :provider provider
                  :model model
                  :cost_class (:cost_class entry)
                  :status armed-status
                  :evidence (when-not (str/blank? (str evidence)) (str evidence))
                  :started_at started-at
                  :ends_at (ends-at started-at)
                  :permanent (select-keys permanent [:provider :model :cost_class])}]
      {:trials (assoc-in trials [:active role] record)
       :trial record})))

;; ── assessment ────────────────────────────────────────────────────────────

(defn role-score
  "The score the role matrix records for one model, or nil when the matrix
   says nothing about it. nil is NOT zero: a model nobody scored has not been
   shown to lose, and treating silence as a loss would revert every trial
   whose scorecard has not landed yet."
  [registry role provider model]
  (->> (model-steward-lib/role-recommendations registry role {:include-uncertified? true})
       (filter #(and (= provider (:provider %)) (= model (:model %))))
       first
       :score))

(defn decide
  "Pure verdict for one trial. Returns {:decision :promote|:revert :reason s}.

   `outranks` is strict: equal scores are a TIE, and a tie is decided on cost
   class, cheaper wins. A tie on cost too keeps the permanent model - the
   incumbent holds the seat when nothing distinguishes them, so a trial that
   proves nothing changes nothing.

   An unknown trial score reverts: a trial with no recorded score has not
   outranked anything, and promoting on absent evidence is the failure this
   whole lifecycle exists to prevent."
  [{:keys [trial-score permanent-score trial-cost permanent-cost]}]
  (let [t (when (number? trial-score) (double trial-score))
        p (when (number? permanent-score) (double permanent-score))]
    (cond
      (nil? t)
      {:decision :revert :reason "trial has no recorded score for this role"}

      (and (some? p) (> t p))
      {:decision :promote :reason (str "trial outranks permanent (" t " > " p ")")}

      (nil? p)
      {:decision :promote :reason (str "trial scored " t " and the permanent model has no recorded score")}

      (< t p)
      {:decision :revert :reason (str "trial is outranked (" t " < " p ")")}

      :else
      (let [tc (model-factory-lib/cost-class-rank trial-cost)
            pc (model-factory-lib/cost-class-rank permanent-cost)]
        (cond
          (< tc pc) {:decision :promote
                     :reason (str "tie at " t "; trial cost class " trial-cost
                                  " is cheaper than " permanent-cost)}
          (> tc pc) {:decision :revert
                     :reason (str "tie at " t "; permanent cost class " permanent-cost
                                  " is cheaper than " trial-cost)}
          :else {:decision :revert
                 :reason (str "tie at " t " and equal cost class - the incumbent keeps the seat")})))))

(defn assess
  "Closes the armed trial for `role`. Returns {:trials trials' :outcome ...} or
   {:error reason}. The outcome names the seat the role must run afterwards,
   so the caller writes ONE assignment rather than re-deriving the winner.

   On a loss the losing candidate is recorded against silent re-trial, with
   the evidence it lost with - so a later nomination citing the SAME evidence
   is refused and one citing new evidence is not."
  [trials registry role assessed-at]
  (if-let [trial (armed-for-role trials role)]
    (let [permanent (:permanent trial)
          verdict (decide {:trial-score (role-score registry role (:provider trial) (:model trial))
                           :permanent-score (role-score registry role (:provider permanent) (:model permanent))
                           :trial-cost (:cost_class trial)
                           :permanent-cost (:cost_class permanent)})
          promoted? (= :promote (:decision verdict))
          seat (if promoted?
                 (select-keys trial [:provider :model :cost_class])
                 (select-keys permanent [:provider :model :cost_class]))
          closed (assoc trial
                        :status (if promoted? promoted-status reverted-status)
                        :assessed_at assessed-at
                        :decision (name (:decision verdict))
                        :reason (:reason verdict))]
      {:trials (cond-> trials
                 true (update :active dissoc role)
                 true (update :history (fnil conj []) closed)
                 (not promoted?)
                 (update-in [:losers role] (fnil conj [])
                            {:provider (:provider trial)
                             :model (:model trial)
                             :evidence (:evidence trial)
                             :reason (:reason verdict)
                             :at assessed-at}))
       :outcome {:decision (:decision verdict)
                 :reason (:reason verdict)
                 :role role
                 :seat seat
                 :trial closed}})
    {:error (str "assess refused: no armed trial for " role)}))

;; ── seat / boundary helpers ───────────────────────────────────────────────

(defn boundary-for
  "Which memory-transfer boundary a lifecycle step crosses. Both ends of a
   trial are a same-role MODEL CHANGE, which is exactly BL-1178's contract -
   and a promotion is NOT one: the seat already runs the trial model, so
   nothing switches and no transfer is owed."
  [step {:keys [from to]}]
  (when (and (some? from) (some? to) (not= from to))
    (case step
      :nominate "trial-start"
      :assess "trial-end"
      nil)))

(defn seat-id [{:keys [provider model]}]
  (when (and provider model) (str provider "/" model)))

(defn due?
  "Has the armed trial's day elapsed at `now`? The assessment is normally run
   by the end-of-day sweep, but the CLI accepts an explicit assess so an
   operator can end a trial early; this predicate is what the sweep asks."
  [trial now]
  (and trial
       (not (str/blank? (str (:ends_at trial))))
       (not (.isBefore (java.time.Instant/parse now)
                       (java.time.Instant/parse (:ends_at trial))))))
