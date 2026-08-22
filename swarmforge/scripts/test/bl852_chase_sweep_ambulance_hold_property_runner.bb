#!/usr/bin/env bb
;; BL-852 declared invariants (backlog/active/BL-852-chase-sweep-respects-
;; ambulance-hold.yaml) - coder-authored property tests per BL-654's
;; "first authorship of each declared invariant's property test rests with
;; the coder" rule. Same seeded-LCG convention as
;; ambulance_wiring_property_runner.bb / ambulance_lib_property_runner.bb
;; (deterministic, never rand - see that file's header for the BL-472
;; Babashka-property-tooling-gap note this one shares).
;;
;; Invariant 1 ("no write and no wake against a held parcel ... byte-
;; identical after any number of sweeps") and invariant 2 ("the mode off,
;; and the patient's own parcels with it on, decide byte-identical to
;; today's") are both encoded against the REAL pure
;; chase-sweep-lib/decide-item-action - never a reimplementation of the
;; decision it makes.
;;
;; Invariant 3 ("this site consults the one shared ambulance predicate; no
;; second notion of held is derived here") is encoded against the REAL
;; impure wiring - chase-sweep-lib/item-ambulance-held? - proving it never
;; diverges from handoff-lib/default-ambulance-held?, the same predicate
;; every other BL-655 site already consults, over randomly generated
;; envelope/ambulance-state combinations with real fs I/O (a real marker
;; file, a real parcel file), never a hand-computed row.

(ns bl852-chase-sweep-ambulance-hold-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl852-ambulance-hold-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= i 1) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

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

(def config
  {:chaseIntervalSeconds 5 :chaseTimeoutSeconds 30 :maxChases 3
   :stuckInProcessTimeoutSeconds 60 :respawnCooldownSeconds 300
   :chaseBackoffBaseSeconds 5 :chaseBackoffMaxSeconds 60})

;; ── invariant 1: held (and not already-terminal) ALWAYS outranks every
;;    other input - the sweep can never chase/respawn/dead-letter it ───────
(defn gen-decide-inputs [s]
  (let [[age-seconds s1] (gen-int s 400)
        [chase-count s2] (gen-int s1 6)
        [liveness s3] (gen-pick s2 ["alive" "idle" "unknown" "dead" "stuck"])
        [idle-seconds s4] (gen-int s3 400)
        [has-last-chased? s5] (gen-bool s4)
        [seconds-since-chase s6] (gen-int s5 400)
        [already-terminal? s7] (gen-bool s6)
        now-ms 1000000000000
        item-mtime-ms (- now-ms (* age-seconds 1000))
        last-activity-ms (- now-ms (* idle-seconds 1000))
        last-chased-at-ms (when has-last-chased? (- now-ms (* seconds-since-chase 1000)))]
    [{:item-mtime-ms item-mtime-ms :chase-count chase-count :now-ms now-ms :liveness liveness
      :last-activity-ms last-activity-ms :last-chased-at-ms last-chased-at-ms
      :already-terminal? already-terminal?}
     s7]))

(check-all "invariant-1 held (non-terminal) always decides \"held\", regardless of age/liveness/chase-count/already-chased state"
  gen-decide-inputs
  (fn [{:keys [item-mtime-ms chase-count now-ms liveness last-activity-ms last-chased-at-ms already-terminal?]}]
    (let [decided (chase-sweep-lib/decide-item-action item-mtime-ms chase-count now-ms config liveness
                                                        last-activity-ms last-chased-at-ms already-terminal? true)]
      (cond
        already-terminal? (if (= decided "reaped") true (str "expected \"reaped\" (terminal outranks hold), got " decided))
        :else (if (= decided "held") true (str "expected \"held\", got " decided))))))

;; ── invariant 2: held?=false reproduces the EXACT pre-BL-852 ladder (the
;;    "today's" decision this invariant promises stays byte-identical) -
;;    this reference is the ladder as it existed immediately before BL-852,
;;    literally copied, never re-derived from the current implementation ──
(defn reference-pre-bl852-decision
  [item-mtime-ms chase-count now-ms cfg liveness last-activity-ms last-chased-at-ms already-terminal?]
  (if already-terminal?
    "reaped"
    (let [age-seconds (/ (- now-ms item-mtime-ms) 1000.0)]
      (if (< age-seconds (:chaseTimeoutSeconds cfg))
        "skipped"
        (let [idle-seconds (/ (- now-ms last-activity-ms) 1000.0)
              has-recent-activity? (< idle-seconds (:stuckInProcessTimeoutSeconds cfg))]
          (if has-recent-activity?
            (if (nil? last-chased-at-ms)
              "chased"
              (let [seconds-since-last-chase (/ (- now-ms last-chased-at-ms) 1000.0)
                    backoff-seconds (chase-sweep-lib/compute-chase-backoff-seconds chase-count cfg)]
                (if (>= seconds-since-last-chase backoff-seconds) "chased" "skipped")))
            (chase-sweep-lib/decide-stale-item-action chase-count cfg liveness)))))))

(check-all "invariant-2 held?=false reproduces the pre-BL-852 decision ladder byte-for-byte (mode off / patient parcels unaffected)"
  gen-decide-inputs
  (fn [{:keys [item-mtime-ms chase-count now-ms liveness last-activity-ms last-chased-at-ms already-terminal?]}]
    (let [actual (chase-sweep-lib/decide-item-action item-mtime-ms chase-count now-ms config liveness
                                                       last-activity-ms last-chased-at-ms already-terminal? false)
          expected (reference-pre-bl852-decision item-mtime-ms chase-count now-ms config liveness
                                                  last-activity-ms last-chased-at-ms already-terminal?)]
      (if (= actual expected) true (str "held?=false decided " actual " but the pre-BL-852 ladder decides " expected)))))

;; ── invariant 3: the wiring's item-ambulance-held? never derives a second
;;    notion of held - it must always agree with handoff-lib/default-
;;    ambulance-held?, the one shared predicate, over real marker files and
;;    real parcel content ───────────────────────────────────────────────────
(def ambulance-ticket "BL-654")
(def other-tickets ["BL-660" "BL-700"])

(defn gen-envelope-and-marker [s]
  (let [[marker-active? s1] (gen-bool s)
        [attributed? s2] (gen-bool s1)
        [task s3] (if attributed? (gen-pick s2 (conj other-tickets ambulance-ticket)) [nil s2])]
    [{:marker-active? marker-active? :task task} s3]))

(check-all "invariant-3 chase-sweep-lib/item-ambulance-held? never diverges from handoff-lib/default-ambulance-held? (the one shared predicate)"
  gen-envelope-and-marker
  (fn [{:keys [marker-active? task]}]
    (let [dir (mk-tmp)]
      (handoff-lib/set-project-root! dir)
      (fs/create-dirs (fs/path dir "backlog" "active"))
      (spit (str (fs/path dir "backlog" "active" (str ambulance-ticket "-fixture.yaml")))
            (str "id: " ambulance-ticket "\ntitle: \"fixture\"\nstatus: active\n"))
      (fs/create-dirs (fs/path dir ".swarmforge" "operator"))
      (when marker-active?
        (spit (str (fs/path dir ".swarmforge" "operator" "control-ambulance.json"))
              (str "{\"active\":true,\"ticket\":\"" ambulance-ticket "\"}")))
      (let [content (str "id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\n"
                          (when task (str "task: " task "\n"))
                          "commit: 0000000000\ncreated_at: 2026-07-26T00:00:00Z\n\npayload\n")
            item-file (str (fs/path dir "item.handoff"))]
        (spit item-file content)
        (let [via-wiring (chase-sweep-lib/item-ambulance-held? item-file)
              via-shared-predicate (handoff-lib/default-ambulance-held? (slurp item-file))]
          (if (= via-wiring via-shared-predicate)
            true
            (str "item-ambulance-held? returned " via-wiring
                 " but the shared default-ambulance-held? predicate returned " via-shared-predicate
                 " for the SAME content and marker state")))))))

;; ── non-vacuity: proves each property above has teeth against a
;;    plausible broken implementation ────────────────────────────────────
(defn- non-vacuity-check! [label actual-broken expected-real]
  (if (not= actual-broken expected-real)
    (println (str "non-vacuity OK: " label))
    (swap! failures conj (str "FAIL non-vacuity " label ": broken value " (pr-str actual-broken)
                               " coincidentally matches the real invariant - the property above would not catch this defect"))))

;; Simulates a broken decide-item-action that ignores held? entirely (the
;; pre-BL-852 arity) - proves invariant-1's assertion has teeth.
(non-vacuity-check! "invariant-1 (a broken decide-item-action ignoring held? would chase a held parcel)"
  (reference-pre-bl852-decision (- 1000000000000 60000) 0 1000000000000 config "alive" 1000000000000 nil false)
  "held")

;; Simulates a broken item-ambulance-held? that always returns false (never
;; consults the marker) against a REAL held case - proves invariant-3's
;; assertion has teeth. Same fixture shape as the property above (real
;; marker file, real parcel file, real handoff-lib/default-ambulance-held?)
;; so this is a genuine divergence, not a hand-picked pair of literals.
(let [dir (mk-tmp)]
  (handoff-lib/set-project-root! dir)
  (fs/create-dirs (fs/path dir "backlog" "active"))
  (spit (str (fs/path dir "backlog" "active" (str ambulance-ticket "-fixture.yaml")))
        (str "id: " ambulance-ticket "\ntitle: \"fixture\"\nstatus: active\n"))
  (fs/create-dirs (fs/path dir ".swarmforge" "operator"))
  (spit (str (fs/path dir ".swarmforge" "operator" "control-ambulance.json"))
        (str "{\"active\":true,\"ticket\":\"" ambulance-ticket "\"}"))
  (let [content (str "id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\n"
                      "task: " (first other-tickets) "\n"
                      "commit: 0000000000\ncreated_at: 2026-07-26T00:00:00Z\n\npayload\n")
        item-file (str (fs/path dir "item.handoff"))]
    (spit item-file content)
    (let [real (handoff-lib/default-ambulance-held? (slurp item-file))
          broken-always-false false]
      (non-vacuity-check! "invariant-3 (a broken item-ambulance-held? that always returns false diverges from the real shared predicate on a genuinely held parcel)"
        broken-always-false real))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "BL-852 ambulance-hold invariant properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
