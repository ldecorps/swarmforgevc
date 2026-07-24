#!/usr/bin/env bb
;; TDD runner for flow_watchdog_lib.bb (BL-577) - pure assertions over
;; provided inputs, plus fixture-based tests for the impure conf/state/scan/
;; run-sweep! halves (real fs I/O against a temp dir, no live swarm).
(ns flow-watchdog-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "flow_watchdog_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "flow-watchdog-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── parse-warn-ms / parse-escalate-ms (pure) ────────────────────────────────

(assert= "parses a positive warn-ms"
         60000
         (flow-watchdog-lib/parse-warn-ms "config flow_watchdog_warn_ms 60000"))

(assert= "parses a positive escalate-ms"
         240000
         (flow-watchdog-lib/parse-escalate-ms "config flow_watchdog_escalate_ms 240000"))

(assert= "ignores surrounding comment/blank lines and other config keys (warn)"
         60000
         (flow-watchdog-lib/parse-warn-ms "# comment\n\nconfig mutation_cooldown_days 3\nconfig flow_watchdog_warn_ms 60000\n"))

(assert= "falls back to the default when the warn-ms line is absent"
         flow-watchdog-lib/default-warn-ms
         (flow-watchdog-lib/parse-warn-ms "config mutation_cooldown_days 3"))

(assert= "falls back to the default when the escalate-ms line is absent"
         flow-watchdog-lib/default-escalate-ms
         (flow-watchdog-lib/parse-escalate-ms "config mutation_cooldown_days 3"))

(assert= "falls back to the default for nil conf text (warn)"
         flow-watchdog-lib/default-warn-ms
         (flow-watchdog-lib/parse-warn-ms nil))

(assert= "acceptance-11: malformed warn-ms value falls back to default, never disables"
         flow-watchdog-lib/default-warn-ms
         (flow-watchdog-lib/parse-warn-ms "config flow_watchdog_warn_ms banana"))

(assert= "acceptance-11: malformed escalate-ms value falls back to default, never disables"
         flow-watchdog-lib/default-escalate-ms
         (flow-watchdog-lib/parse-escalate-ms "config flow_watchdog_escalate_ms banana"))

(assert= "a non-positive warn-ms is nonsensical and falls back to default"
         flow-watchdog-lib/default-warn-ms
         (flow-watchdog-lib/parse-warn-ms "config flow_watchdog_warn_ms 0"))

;; ── read-thresholds (fixture-based fs I/O) ──────────────────────────────────

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        "config flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n")
  (assert= "acceptance-10: read-thresholds reads the effective config"
           {:warn-ms 60000 :escalate-ms 240000}
           (flow-watchdog-lib/read-thresholds root)))

(let [root (mk-tmp)]
  (assert= "read-thresholds degrades to defaults when no config exists at all"
           {:warn-ms flow-watchdog-lib/default-warn-ms :escalate-ms flow-watchdog-lib/default-escalate-ms}
           (flow-watchdog-lib/read-thresholds root)))

;; ── parcel-age-ms (pure, header precedence) ─────────────────────────────────

(assert= "age from enqueued_at when present"
         1000
         (flow-watchdog-lib/parcel-age-ms {:enqueued-at "2026-07-24T00:00:00Z" :now-ms
                                            (+ 1000 (.toEpochMilli (java.time.Instant/parse "2026-07-24T00:00:00Z")))}))

(assert= "falls back to created_at when enqueued_at is absent"
         2000
         (flow-watchdog-lib/parcel-age-ms {:created-at "2026-07-24T00:00:00Z" :now-ms
                                            (+ 2000 (.toEpochMilli (java.time.Instant/parse "2026-07-24T00:00:00Z")))}))

(assert= "enqueued_at wins over created_at when both present (redelivered parcel is fresh)"
         500
         (flow-watchdog-lib/parcel-age-ms {:enqueued-at "2026-07-24T00:00:00Z"
                                            :created-at "2020-01-01T00:00:00Z"
                                            :now-ms (+ 500 (.toEpochMilli (java.time.Instant/parse "2026-07-24T00:00:00Z")))}))

(assert= "nil when neither header parses - fails closed"
         nil
         (flow-watchdog-lib/parcel-age-ms {:enqueued-at "not-a-date" :created-at nil :now-ms 999}))

(assert= "acceptance-06/07: mtime is never consulted - only the header keys matter"
         nil
         (flow-watchdog-lib/parcel-age-ms {:now-ms 999}))

;; ── decide-tier (pure, structurally suppression-free) ───────────────────────

(assert= "acceptance-01: fresh parcel (nil highest-tier, not snoozed) past warn threshold alarms warn"
         :warn
         (flow-watchdog-lib/decide-tier {:age-ms 100 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? false}))

(assert= "age under warn threshold never alarms"
         :none
         (flow-watchdog-lib/decide-tier {:age-ms 10 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? false}))

(assert= "acceptance-02: already alarmed at warn, still under escalate - no repeat"
         :none
         (flow-watchdog-lib/decide-tier {:age-ms 100 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed :warn :snoozed? false}))

(assert= "acceptance-03: already alarmed at warn, now past escalate - fires escalate exactly once"
         :escalate
         (flow-watchdog-lib/decide-tier {:age-ms 700 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed :warn :snoozed? false}))

(assert= "acceptance-03: a SECOND sweep past escalate with highest-tier already :escalate does not re-fire"
         :none
         (flow-watchdog-lib/decide-tier {:age-ms 700 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed :escalate :snoozed? false}))

(assert= "acceptance-12: snoozed mutes unconditionally, even when well past escalate"
         :none
         (flow-watchdog-lib/decide-tier {:age-ms 99999 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? true}))

(assert= "nil age-ms never alarms - fails closed"
         :none
         (flow-watchdog-lib/decide-tier {:age-ms nil :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? false}))

;; ── acceptance-05: structural no-suppression guarantee ──────────────────────

(assert= "decide-tier's allowed-key set carries only age/thresholds/prior-tier/snooze - no role, type, or dormancy"
         #{:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?}
         flow-watchdog-lib/tier-decision-input-keys)

(assert= "no role/type/dormancy field in :tier-decision-input-keys"
         false
         (boolean (some flow-watchdog-lib/tier-decision-input-keys [:role :type :dormancy :dormant?])))

;; Even when a caller carelessly includes :role/:type/:dormant? alongside the
;; real keys, decide-tier's own destructuring never binds them - the result
;; is byte-for-byte identical with or without them, proving they are
;; structurally inert rather than merely unused by convention.
(assert= "decide-tier ignores a :role/:type/:dormant? key present in the input map (structurally inert, not policy)"
         (flow-watchdog-lib/decide-tier {:age-ms 100 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? false})
         (flow-watchdog-lib/decide-tier {:age-ms 100 :warn-ms 60 :escalate-ms 600
                                          :highest-tier-alarmed nil :snoozed? false
                                          :role "cleaner" :type "note" :dormant? true}))

;; ── decide-verb (pure) ───────────────────────────────────────────────────────

(assert= "no live session -> rotate, regardless of mailbox"
         :rotate
         (flow-watchdog-lib/decide-verb {:mailbox :new :live-session? false}))

(assert= "no live session -> rotate (in_process too)"
         :rotate
         (flow-watchdog-lib/decide-verb {:mailbox :in_process :live-session? false}))

(assert= "live session + in_process -> investigate"
         :investigate
         (flow-watchdog-lib/decide-verb {:mailbox :in_process :live-session? true}))

(assert= "live session + inbox/new -> expedite"
         :expedite
         (flow-watchdog-lib/decide-verb {:mailbox :new :live-session? true}))

;; ── acceptance-09: incident-fixture verbs ────────────────────────────────────

(assert= "wake-budget-starved architect git_handoff (live session, in_process) -> investigate"
         :investigate
         (flow-watchdog-lib/decide-verb {:mailbox :in_process :live-session? true}))

(assert= "dormant role with dead-lettered note (no live session) -> rotate"
         :rotate
         (flow-watchdog-lib/decide-verb {:mailbox :new :live-session? false}))

;; ── humanize-age-ms (pure) ───────────────────────────────────────────────────

(assert= "sub-hour age formats as Nm" "25m" (flow-watchdog-lib/humanize-age-ms (* 25 60 1000)))
(assert= "over-hour age formats as NhNm" "1h30m" (flow-watchdog-lib/humanize-age-ms (* 90 60 1000)))
(assert= "zero age formats as 0m" "0m" (flow-watchdog-lib/humanize-age-ms 0))

;; ── format-alarm-text (pure) ─────────────────────────────────────────────────

(let [text (flow-watchdog-lib/format-alarm-text
            {:id "20260724T163937Z_000357_from_specifier" :from "specifier" :to "coder"
             :type "git_handoff" :age-ms (* 20 60 1000) :role "coder" :mailbox :new
             :verb :expedite :tier :warn})]
  (assert= "warn-tier alarm text names id, from->to, type, age, mailbox, and verb"
           true
           (every? #(clojure.string/includes? text %)
                   ["20260724T163937Z_000357_from_specifier" "specifier->coder" "git_handoff"
                    "20m" "coder" "new" "expedite"])))

(let [text (flow-watchdog-lib/format-alarm-text
            {:id "x" :from "a" :to "b" :type "note" :age-ms 100 :role "cleaner"
             :mailbox :in_process :verb :investigate :tier :escalate})]
  (assert= "escalate-tier alarm text is visually distinct from warn-tier"
           true
           (clojure.string/includes? text "ESCALATE")))

;; ── durable state: read/write/highest-tier-alarmed/snoozed?/prune ──────────

(let [root (mk-tmp)
      daemon-dir (fs/path root ".swarmforge" "daemon")]
  (assert= "read-state degrades to {} when no state file exists"
           {}
           (flow-watchdog-lib/read-state daemon-dir))
  (flow-watchdog-lib/write-state! daemon-dir {:p1 {:tier "warn" :alarmedAt 1000}})
  (assert= "write-state! + read-state round-trips"
           {:p1 {:tier "warn" :alarmedAt 1000}}
           (flow-watchdog-lib/read-state daemon-dir))
  (assert= "highest-tier-alarmed reads the parcel's prior tier as a keyword"
           :warn
           (flow-watchdog-lib/highest-tier-alarmed (flow-watchdog-lib/read-state daemon-dir) "p1"))
  (assert= "highest-tier-alarmed is nil for an unknown parcel id"
           nil
           (flow-watchdog-lib/highest-tier-alarmed (flow-watchdog-lib/read-state daemon-dir) "unknown")))

(let [root (mk-tmp)]
  (assert= "read-state degrades to {} for a malformed state file"
           {}
           (do (fs/create-dirs (fs/path root "d"))
               (spit (str (flow-watchdog-lib/state-file-path (fs/path root "d"))) "not json")
               (flow-watchdog-lib/read-state (fs/path root "d")))))

(assert= "acceptance-12: snoozed? reads a snooze entry as true"
         true
         (flow-watchdog-lib/snoozed? {:p1 {:tier "warn" :snoozed true}} "p1"))

(assert= "snoozed? is false for a parcel with no snooze entry"
         false
         (flow-watchdog-lib/snoozed? {:p1 {:tier "warn"}} "p1"))

(assert= "acceptance-04: prune-progressed-entries removes an entry whose parcel id is no longer present"
         {}
         (flow-watchdog-lib/prune-progressed-entries {:p1 {:tier "warn"}} #{}))

(assert= "prune-progressed-entries keeps an entry whose parcel id is still present"
         {:p1 {:tier "warn"}}
         (flow-watchdog-lib/prune-progressed-entries {:p1 {:tier "warn"}} #{"p1"}))

(assert= "acceptance-12: prune-progressed-entries keeps a snoozed entry's data intact while present"
         {:p1 {:tier "warn" :snoozed true}}
         (flow-watchdog-lib/prune-progressed-entries {:p1 {:tier "warn" :snoozed true}} #{"p1"}))

;; ── scan-mailbox-dir / parcel-record (fixture-based fs I/O) ─────────────────

(defn write-handoff! [path headers]
  (fs/create-dirs (fs/parent path))
  (spit path (str (apply str (for [[k v] headers] (str k ": " v "\n"))) "\nbody\n")))

(let [root (mk-tmp)
      new-dir (fs/path root "inbox" "new")]
  (write-handoff! (str (fs/path new-dir "a.handoff"))
                   [["id" "abc123"] ["from" "specifier"] ["to" "coder"] ["type" "git_handoff"]
                    ["enqueued_at" "2026-07-24T16:00:00Z"]])
  (let [records (flow-watchdog-lib/scan-mailbox-dir new-dir)]
    (assert= "scan-mailbox-dir finds one parcel" 1 (count records))
    (assert= "parcel-record reads the id header" "abc123" (:id (first records)))
    (assert= "parcel-record reads from/to/type/enqueued_at headers"
             {:from "specifier" :to "coder" :type "git_handoff" :enqueued-at "2026-07-24T16:00:00Z"}
             (select-keys (first records) [:from :to :type :enqueued-at]))))

(let [root (mk-tmp)
      new-dir (fs/path root "inbox" "new")
      batch-dir (fs/path new-dir "batch_001")]
  (write-handoff! (str (fs/path batch-dir "b.handoff")) [["id" "batched1"]])
  (assert= "scan-mailbox-dir recurses one level into batch_* dirs (batch roles: cleaner/hardener)"
           ["batched1"]
           (mapv :id (flow-watchdog-lib/scan-mailbox-dir new-dir))))

(assert= "scan-mailbox-dir degrades to [] for a non-existent directory"
         []
         (flow-watchdog-lib/scan-mailbox-dir (fs/path (mk-tmp) "does-not-exist")))

;; ── acceptance-08: coverage spans master-resident and worktree mailboxes ────
;; scan-mailbox-dir itself is layout-agnostic (any directory path); the
;; master-resident-vs-worktree distinction is entirely in WHICH directories
;; run-sweep!'s caller passes in (handoffd.bb's role-inboxes, built from
;; handoff-lib/mailbox-dir - BL-128's own shared resolver already covers
;; both layouts). Proven here by scanning two differently-shaped roots.

(let [master-root (mk-tmp)
      worktree-root (mk-tmp)]
  (write-handoff! (str (fs/path master-root "specifier-new" "s.handoff")) [["id" "spec1"]])
  (write-handoff! (str (fs/path worktree-root "cleaner-new" "c.handoff")) [["id" "clean1"]])
  (assert= "master-resident specifier inbox/new scans correctly"
           ["spec1"]
           (mapv :id (flow-watchdog-lib/scan-mailbox-dir (fs/path master-root "specifier-new"))))
  (assert= "worktree cleaner inbox/new scans correctly"
           ["clean1"]
           (mapv :id (flow-watchdog-lib/scan-mailbox-dir (fs/path worktree-root "cleaner-new")))))

;; ── run-sweep! end-to-end (fixture-based fs I/O + fake adapters) ───────────

(defn iso [epoch-seconds]
  (str (java.time.Instant/ofEpochSecond epoch-seconds)))

(defn mk-sweep-fixture! []
  (let [root (mk-tmp)]
    (fs/create-dirs (fs/path root "swarmforge"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          "config flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n")
    root))

;; acceptance-01: an over-threshold parcel in a dormant role's inbox alarms.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (write-handoff! (str (fs/path new-dir "p1.handoff"))
                   [["id" "p1"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false)
    :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-01: exactly one alarm is emitted for the over-threshold parcel"
           1
           (count @alarms))
  (assert= "acceptance-01: the alarm names the dormant role (rotate verb, no live session)"
           true
           (clojure.string/includes? (first @alarms) "rotate"))
  (assert= "the durable state records the parcel at warn tier"
           "warn"
           (:tier (get (flow-watchdog-lib/read-state daemon-dir) :p1))))

;; acceptance-02: repeated sweeps within one tier never repeat the alarm.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      adapters {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))}]
  (write-handoff! (str (fs/path new-dir "p2.handoff"))
                   [["id" "p2"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir adapters)
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir adapters)
  (assert= "acceptance-02: a second sweep at the same age emits no additional alarm"
           1
           (count @alarms)))

;; acceptance-03: crossing the escalate tier re-alarms exactly once.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      base-ms (* 1784900000 1000)
      alarms (atom [])
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      adapters {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))}
      enqueued-epoch-s (quot base-ms 1000)]
  (write-handoff! (str (fs/path new-dir "p3.handoff"))
                   [["id" "p3"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso enqueued-epoch-s)]])
  ;; Sweep 1: age 90s >= warn(60s), < escalate(240s) -> warn alarm.
  (flow-watchdog-lib/run-sweep! inboxes (+ base-ms 90000) (str root) daemon-dir adapters)
  ;; Sweep 2: age 300s >= escalate(240s) -> escalate alarm.
  (flow-watchdog-lib/run-sweep! inboxes (+ base-ms 300000) (str root) daemon-dir adapters)
  ;; Sweep 3: still past escalate, already alarmed at :escalate -> no re-fire.
  (flow-watchdog-lib/run-sweep! inboxes (+ base-ms 310000) (str root) daemon-dir adapters)
  (assert= "acceptance-03: exactly one warn alarm then exactly one escalate alarm - no third repeat"
           2
           (count @alarms))
  (assert= "acceptance-03: the second alarm is the escalate tier"
           true
           (clojure.string/includes? (second @alarms) "ESCALATE")))

;; acceptance-04: a parcel that progresses (removed from new/in_process) never alarms again.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      adapters {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))}
      file (str (fs/path new-dir "p4.handoff"))]
  (write-handoff! file
                   [["id" "p4"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir adapters)
  (assert= "acceptance-04 setup: parcel alarmed once before progressing"
           1
           (count @alarms))
  (fs/delete file)
  (flow-watchdog-lib/run-sweep! inboxes (+ now-ms 600000) (str root) daemon-dir adapters)
  (assert= "acceptance-04: no new alarm once the parcel has left new/in_process (claimed/completed/reaped)"
           1
           (count @alarms))
  (assert= "acceptance-04: the state entry itself is cleared, not just left stale"
           nil
           (get (flow-watchdog-lib/read-state daemon-dir) :p4)))

;; acceptance-06: an old-header, fresh-mtime parcel still alarms (mtime never
;; consulted - the fixture file's own mtime is "now", far fresher than its
;; enqueued_at header).
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (write-handoff! (str (fs/path new-dir "p6.handoff"))
                   [["id" "p6"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-06: old-header/fresh-mtime parcel alarms" 1 (count @alarms)))

;; acceptance-07: a fresh-header parcel does not alarm regardless of mtime.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (write-handoff! (str (fs/path new-dir "p7.handoff"))
                   [["id" "p7"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (quot now-ms 1000))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-07: fresh-header parcel does not alarm" 0 (count @alarms)))

;; acceptance-12: a per-parcel snooze mutes only the snoozed parcel.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (fs/create-dirs daemon-dir)
  (flow-watchdog-lib/write-state! daemon-dir {:p8b {:snoozed true}})
  (write-handoff! (str (fs/path new-dir "p8a.handoff"))
                   [["id" "p8a"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (write-handoff! (str (fs/path new-dir "p8b.handoff"))
                   [["id" "p8b"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-12: only the unsnoozed parcel alarms" 1 (count @alarms))
  (assert= "acceptance-12: the snoozed parcel's alarm names p8a, not p8b"
           true
           (clojure.string/includes? (first @alarms) "p8a"))
  (assert= "acceptance-12: the snooze entry remains readable in the state file after the sweep"
           true
           (:snoozed (get (flow-watchdog-lib/read-state daemon-dir) :p8b))))

;; acceptance-10: thresholds come from the effective config.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (write-handoff! (str (fs/path new-dir "p10.handoff"))
                   [["id" "p10"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-10: a parcel aged 90s with configured warn-ms 60000 alarms"
           1
           (count @alarms)))

;; acceptance-11: malformed config falls back to defaults and never disables.
(let [root (mk-tmp)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      alarms (atom [])]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        "config flow_watchdog_warn_ms banana\nconfig flow_watchdog_escalate_ms banana\n")
  (write-handoff! (str (fs/path new-dir "p11.handoff"))
                   [["id" "p11"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) (inc (quot flow-watchdog-lib/default-warn-ms 1000))))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "acceptance-11: malformed config still alarms on the default warn threshold - degraded, never disabled"
           1
           (count @alarms)))

;; acceptance-13 (BL-577 bounce fix): an unconfirmed emit-alarm! (returns
;; falsy, e.g. the Telegram outbox write failed) must NOT be recorded as
;; alarmed - the next sweep retries rather than silently suppressing.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      attempts (atom 0)
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      failing-adapters {:live-session? (fn [_role] false)
                         :emit-alarm! (fn [_text] (swap! attempts inc) false)}]
  (write-handoff! (str (fs/path new-dir "p13.handoff"))
                   [["id" "p13"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir failing-adapters)
  (assert= "acceptance-13: an unconfirmed emit-alarm! attempt is made"
           1
           @attempts)
  (assert= "acceptance-13: an unconfirmed write is NOT recorded as alarmed in durable state"
           nil
           (:tier (get (flow-watchdog-lib/read-state daemon-dir) :p13)))
  (flow-watchdog-lib/run-sweep! inboxes (+ now-ms 1000) (str root) daemon-dir failing-adapters)
  (assert= "acceptance-13: a still-unconfirmed alarm is RE-ATTEMPTED next sweep, never suppressed"
           2
           @attempts))

;; acceptance-13b: emit-alarm! throwing is treated the same as a falsy
;; return - never crashes the sweep, never recorded as alarmed.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      throwing-adapters {:live-session? (fn [_role] false)
                          :emit-alarm! (fn [_text] (throw (ex-info "outbox write failed" {})))}]
  (write-handoff! (str (fs/path new-dir "p13c.handoff"))
                   [["id" "p13c"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir throwing-adapters)
  (assert= "acceptance-13b: a throwing emit-alarm! does not crash the sweep and is not recorded as alarmed"
           nil
           (:tier (get (flow-watchdog-lib/read-state daemon-dir) :p13c))))

;; acceptance-13c: once emit-alarm! starts confirming, the retried alarm is
;; finally recorded and stops re-firing.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      confirm? (atom false)
      alarms (atom [])
      inboxes [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
      flaky-adapters {:live-session? (fn [_role] false)
                       :emit-alarm! (fn [text] (swap! alarms conj text) @confirm?)}]
  (write-handoff! (str (fs/path new-dir "p13d.handoff"))
                   [["id" "p13d"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep! inboxes now-ms (str root) daemon-dir flaky-adapters)
  (reset! confirm? true)
  (flow-watchdog-lib/run-sweep! inboxes (+ now-ms 1000) (str root) daemon-dir flaky-adapters)
  (assert= "acceptance-13c: exactly two attempts before the write confirms"
           2
           (count @alarms))
  (assert= "acceptance-13c: once confirmed, the tier is finally recorded"
           "warn"
           (:tier (get (flow-watchdog-lib/read-state daemon-dir) :p13d)))
  (flow-watchdog-lib/run-sweep! inboxes (+ now-ms 2000) (str root) daemon-dir flaky-adapters)
  (assert= "acceptance-13c: no further re-attempt once confirmed and tier unchanged"
           2
           (count @alarms)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: flow_watchdog_lib.bb"))
