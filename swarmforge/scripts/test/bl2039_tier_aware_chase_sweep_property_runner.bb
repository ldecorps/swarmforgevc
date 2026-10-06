#!/usr/bin/env bb
;; BL-2039 declared invariants (backlog/active/BL-2039-the-chase-sweep-
;; never-chases-a-seat-over-a-parcel-its-tier-refuses.yaml) - coder-
;; authored property tests per BL-654's "first authorship of each declared
;; invariant's property test rests with the coder" rule. Same seeded-LCG
;; convention as bl852_chase_sweep_ambulance_hold_property_runner.bb (and
;; the ambulance_*_property_runner.bb files it cites) - deterministic,
;; never rand (BL-472's own Babashka-property-tooling-gap note).
;;
;; Drives the REAL chase-sweep-lib/sweep-role-inbox! over a real mkdtemp
;; fixture (real roles.tsv, real pack conf, real ticket YAML, real fake
;; adapters recording calls into atoms) - never a reimplementation of the
;; tier decision or the sweep itself.
;;
;; Invariant 1: the sweep never wakes or respawns coder over a parcel its
;;   tier refuses, across randomized liveness/busy/lane readings - the
;;   tier override outranks the WHOLE stale-item ladder, not just one
;;   branch of it.
;; Invariant 2: whenever an idle eligible sibling exists for the parcel's
;;   cost, that sibling is woken.
;; Invariant 3: whenever NO seat of the stage may claim the parcel, it is
;;   dead-lettered (and coder is never respawned over it).

(ns bl2039-tier-aware-chase-sweep-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 150))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl2039-tier-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= i 1) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def config
  {:chaseIntervalSeconds 5 :chaseTimeoutSeconds 30 :maxChases 3
   :stuckInProcessTimeoutSeconds 60 :respawnCooldownSeconds 300
   :chaseBackoffBaseSeconds 5 :chaseBackoffMaxSeconds 60})

(def now-ms 1759000000000)
;; Comfortably past both chaseTimeoutSeconds and stuckInProcessTimeoutSeconds
;; so a tier-eligible item would reach decide-stale-item-action (the branch
;; the tier override must outrank for an ineligible owner).
(def stale-mtime-ms (- now-ms (* 1000 (+ (:chaseTimeoutSeconds config) 5))))
(def quiet-last-activity-ms (- now-ms (* 1000 (+ (:stuckInProcessTimeoutSeconds config) 5))))

(def tier-choices ["easy" "hard" "undeclared"])
(def cost-choices ["low" "medium" "high"])

(defn- window-line [seat tier]
  (str "window " seat " claude " (str/replace seat "@" "-")
       (when (not= tier "undeclared") (str " --seat-tier " tier))
       "\n"))

;; Builds a fresh fixture root for one property run: a coder/coder@2 stage
;; with the generated tiers, a ticket of the generated cost, and a Work
;; note for it in coder's inbox/new/, already past the chase timeout and
;; chased maxChases times (BL-1652's own stale-item precondition) -
;; mirrors bl1652/bl2039's acceptance handlers' fixture shape, never a
;; second notion of "a stuck Work note".
(defn- mk-fixture [{:keys [coder-tier coder2-tier cost coder2-busy?]}]
  (let [root (mk-tmp)
        wt2 (str (fs/path root "wt2"))]
    (doseq [sub ["inbox/new" "inbox/in_process" "inbox/completed" "inbox/abandoned" ".swarmforge" "swarmforge" "backlog/active"]]
      (fs/create-dirs (fs/path root sub)))
    (fs/create-dirs (fs/path wt2 ".swarmforge" "handoffs" "inbox" "in_process"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          (str (window-line "coder" coder-tier) (window-line "coder@2" coder2-tier)))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coder\tcoder\t" root "\tswarmforge-coder\tCoder\tclaude\ttask\n"
               "coder@2\tcoder2\t" wt2 "\tswarmforge-coder2\tCoder2\tclaude\ttask\n"))
    (spit (str (fs/path root "backlog" "active" "BL-9000-fixture.yaml"))
          (str "id: BL-9000\ntitle: \"fixture\"\nmutation_cost: " cost "\nstatus: active\n"))
    (let [item-file (str (fs/path root "inbox" "new" "01_work_note.handoff"))]
      (spit item-file "id: n01\nfrom: coordinator\nto: coder\npriority: 10\ntype: note\nmessage: Work BL-9000\ncreated_at: 2026-10-06T08:00:00Z\n\nWork BL-9000\n")
      (fs/set-last-modified-time item-file (long stale-mtime-ms))
      (spit (str item-file ".chase.json") (str "{\"chaseCount\":" (:maxChases config) "}")))
    (when coder2-busy?
      (spit (str (fs/path wt2 ".swarmforge" "handoffs" "inbox" "in_process" "held.handoff"))
            "id: h01\nfrom: specifier\nto: coder@2\npriority: 50\ntype: git_handoff\ntask: BL-9999\ncommit: 0123456789\n\nhi\n"))
    {:root root :item-file (str (fs/path root "inbox" "new" "01_work_note.handoff"))}))

(defn- run-real-sweep! [{:keys [root]} {:keys [liveness pane-busy? lane-running?]}]
  (handoff-lib/set-project-root! root)
  (let [wakes (atom []) respawns (atom []) dead-letters (atom [])
        adapters {:get-liveness (fn [_role] liveness)
                  :send-wake-up! (fn [role] (swap! wakes conj role) true)
                  :trigger-respawn! (fn [role _readings] (swap! respawns conj role))
                  :log-dead-letter! (fn [role _path] (swap! dead-letters conj role))
                  :get-last-activity-ms (fn [_role] quiet-last-activity-ms)
                  :role-agent-busy? (fn [_role] pane-busy?)
                  :role-lane-running? (fn [_role] lane-running?)
                  :on-stuck-escalation! (fn [_role _escalated] nil)
                  :log-telemetry! (fn [_event _now-ms] nil)
                  :get-rate-limit-cooldown-until-ms (fn [_role] nil)
                  :get-rate-limit-cooldown-woken-marker (fn [_role] nil)
                  :mark-rate-limit-cooldown-woken! (fn [_role _until-ms] nil)}]
    (chase-sweep-lib/sweep-role-inbox!
     "coder" (str (fs/path root "inbox" "new")) (str (fs/path root "inbox" "completed"))
     (str (fs/path root "inbox" "abandoned")) now-ms config adapters)
    {:wakes @wakes :respawns @respawns :dead-letters @dead-letters}))

;; Ground truth for the generated params, read from the REAL pure
;; functions over the REAL fixture's conf/roles.tsv - never a hand-derived
;; second notion of eligible.
(defn- ground-truth [{:keys [root]} cost]
  (let [conf-text (slurp (str (fs/path root "swarmforge" "swarmforge.conf")))
        ctx {:conf-text conf-text
             :tiers (seat-difficulty-lib/parse-seat-tiers conf-text)
             :models {}
             :sibling-role-infos (chase-sweep-lib/stage-sibling-role-infos "coder" root)}
        tier-eligible? (chase-sweep-lib/item-tier-eligible? "coder" ctx cost)
        any-eligible? (chase-sweep-lib/any-stage-member-eligible? "coder" ctx cost)
        idle-sibling (chase-sweep-lib/idle-eligible-sibling ctx cost)]
    {:tier-eligible? tier-eligible? :any-eligible? any-eligible? :idle-sibling idle-sibling}))

(defn gen-scenario [s]
  (let [[coder-tier s1] (gen-pick s tier-choices)
        [coder2-tier s2] (gen-pick s1 tier-choices)
        [cost s3] (gen-pick s2 cost-choices)
        [coder2-busy? s4] (gen-bool s3)
        [liveness s5] (gen-pick s4 ["alive" "idle" "unknown" "dead" "stuck"])
        [pane-busy? s6] (gen-bool s5)
        [lane-running? s7] (gen-bool s6)]
    [{:coder-tier coder-tier :coder2-tier coder2-tier :cost cost :coder2-busy? coder2-busy?
      :liveness liveness :pane-busy? pane-busy? :lane-running? lane-running?}
     s7]))

;; ── invariant 1: an ineligible owner is never woken or respawned, over
;;    every randomized liveness/busy/lane reading ───────────────────────────
(check-all "invariant-1 the sweep never wakes or respawns coder over a parcel its own tier refuses"
  gen-scenario
  (fn [{:keys [coder-tier coder2-tier cost coder2-busy? liveness pane-busy? lane-running?] :as scenario}]
    (let [fixture (mk-fixture scenario)
          truth (ground-truth fixture cost)
          result (run-real-sweep! fixture scenario)]
      (if (:tier-eligible? truth)
        true ;; nothing to assert here - invariant 2/3 cover the eligible-elsewhere/unclaimable cases
        (cond
          (some #{"coder"} (:wakes result))
          (str "coder was woken over an ineligible parcel (tiers " coder-tier "/" coder2-tier " cost " cost "): " result)

          (some #{"coder"} (:respawns result))
          (str "coder was respawned over an ineligible parcel (tiers " coder-tier "/" coder2-tier " cost " cost "): " result)

          :else true)))))

;; ── invariant 2: an idle eligible sibling is woken ──────────────────────────
(check-all "invariant-2 an idle eligible sibling of an ineligible owner's parcel is woken"
  gen-scenario
  (fn [scenario]
    (let [fixture (mk-fixture scenario)
          truth (ground-truth fixture (:cost scenario))
          result (run-real-sweep! fixture scenario)]
      (if (or (:tier-eligible? truth) (nil? (:idle-sibling truth)))
        true
        (if (= [(:role (:idle-sibling truth))] (:wakes result))
          true
          (str "expected exactly one wake to " (:role (:idle-sibling truth)) ", got " (:wakes result)
               " for " (dissoc scenario :liveness :pane-busy? :lane-running?)))))))

;; ── invariant 3: an unclaimable parcel is dead-lettered, never respawned ──
(check-all "invariant-3 a parcel no seat of the stage may claim is dead-lettered and coder is never respawned"
  gen-scenario
  (fn [scenario]
    (let [fixture (mk-fixture scenario)
          truth (ground-truth fixture (:cost scenario))
          result (run-real-sweep! fixture scenario)]
      (if (:any-eligible? truth)
        true
        (cond
          (not= ["coder"] (:dead-letters result))
          (str "expected coder's parcel dead-lettered exactly once, got dead-letters=" (:dead-letters result)
               " for " (dissoc scenario :liveness :pane-busy? :lane-running?))

          (seq (:respawns result))
          (str "expected no respawn for an unclaimable parcel, got " (:respawns result))

          :else true)))))

;; ── non-vacuity: proves each property above has teeth against a
;;    plausible broken implementation (the pre-BL-2039 ladder, which knows
;;    nothing about tiers at all) ────────────────────────────────────────────
(defn- non-vacuity-check! [label actual-broken expected-real]
  (if (not= actual-broken expected-real)
    (println (str "non-vacuity OK: " label))
    (swap! failures conj (str "FAIL non-vacuity " label ": broken value " (pr-str actual-broken)
                               " coincidentally matches the real invariant - the property above would not catch this defect"))))

;; A pre-BL-2039 sweep (11-arg decide-item-action, no tier awareness at
;; all - the broken value) over an easy owner with a medium-cost parcel
;; decides "respawned", same dead-liveness/quiet-pane inputs that make the
;; REAL, tier-aware 13-arg call (tier-eligible?=false, any-eligible?=true,
;; matching an easy owner next to a hard sibling over a medium ticket)
;; decide "tier-deferred" instead - proving invariant-1's assertion has
;; teeth against exactly the regression this ticket exists to prevent.
(non-vacuity-check! "invariant-1 (the pre-BL-2039 11-arg ladder would respawn coder over a medium parcel it cannot claim, instead of deferring to its eligible sibling)"
  (chase-sweep-lib/decide-item-action stale-mtime-ms (:maxChases config) now-ms config "dead"
                                       quiet-last-activity-ms (- now-ms 1000) false false false false)
  (chase-sweep-lib/decide-item-action stale-mtime-ms (:maxChases config) now-ms config "dead"
                                       quiet-last-activity-ms (- now-ms 1000) false false false false false true))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "BL-2039 tier-aware chase-sweep invariant properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
