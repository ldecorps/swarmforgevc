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

;; ── spec-dependent percentile thresholds (warn≈p67 / escalate≈p97) ─────────

(assert= "spec-key encodes from->to|type"
         "cleaner->architect|git_handoff"
         (flow-watchdog-lib/spec-key {:from "cleaner" :to "architect" :type "git_handoff"}))

(assert= "to-type-key wildcards the sender"
         "*->architect|git_handoff"
         (flow-watchdog-lib/to-type-key {:to "architect" :type "git_handoff"}))

(assert= "type-key wildcards both ends"
         "*->*|git_handoff"
         (flow-watchdog-lib/type-key {:type "git_handoff"}))

;; 10 samples [10..100]: ceil-rank p67 → index 6 → 70; p97 → index 9 → 100.
(assert= "percentile-ms p67 over 10 evenly spaced samples"
         70
         (flow-watchdog-lib/percentile-ms (range 10 110 10) 67))

(assert= "percentile-ms p97 over 10 evenly spaced samples"
         100
         (flow-watchdog-lib/percentile-ms (range 10 110 10) 97))

(assert= "thresholds-from-samples returns nil under the min-sample gate"
         nil
         (flow-watchdog-lib/thresholds-from-samples (range 7)))

(let [t (flow-watchdog-lib/thresholds-from-samples
         ;; Eight 1-minute samples and two long ones → raw p67 lands exactly
         ;; on the gate (1m), so it still clears (>=) and calibrates.
         (concat (repeat 8 (* 60 1000)) [(* 30 60 1000) (* 60 60 1000)]))]
  (assert= "thresholds-from-samples warn is at least the min-warn-ms gate"
           true
           (>= (:warn-ms t) flow-watchdog-lib/min-warn-ms))
  (assert= "thresholds-from-samples escalate is strictly above warn"
           true
           (> (:escalate-ms t) (:warn-ms t)))
  (assert= "thresholds-from-samples records sample count"
           10
           (:n t)))

;; BL-835: min-warn-ms is a REJECT GATE, not a floor. A raw p67 below the
;; gate must not invent a calibrated warn - no entry at all, ever (invariant:
;; "A calibrated specs entry is emitted only when the raw warn percentile is
;; >= min-warn-ms; the floor never invents a warn threshold.").
(assert= "BL-835: thresholds-from-samples rejects (nil) when raw p67 sits below min-warn-ms"
         nil
         (flow-watchdog-lib/thresholds-from-samples (repeat 10 5000)))

(let [t (flow-watchdog-lib/thresholds-from-samples
         ;; p67 well above the gate (5 min) and below the 15m global warn -
         ;; the good path (BL-835 acceptance floored-percentile-reject-03).
         (repeat 10 (* 5 60 1000)))]
  (assert= "BL-835: thresholds-from-samples calibrates at the raw p67 once it clears the gate"
           (* 5 60 1000)
           (:warn-ms t))
  (assert= "BL-835: escalate still strictly above warn once the gate clears"
           true
           (> (:escalate-ms t) (:warn-ms t))))

(let [global {:warn-ms 900000 :escalate-ms 3600000}
      specs {"cleaner->architect|git_handoff" {:warn-ms 1200000 :escalate-ms 7200000 :n 20 :source "exact"}
             "*->architect|git_handoff" {:warn-ms 1000000 :escalate-ms 6000000 :n 40 :source "to-type"}
             "*->*|git_handoff" {:warn-ms 800000 :escalate-ms 5000000 :n 80 :source "type"}}]
  (assert= "resolve-thresholds prefers the exact from->to|type key"
           {:warn-ms 1200000 :escalate-ms 7200000 :resolved-via "cleaner->architect|git_handoff"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "cleaner" :to "architect" :type "git_handoff"} specs global))
  (assert= "resolve-thresholds falls back to *->to|type when exact is missing"
           {:warn-ms 1000000 :escalate-ms 6000000 :resolved-via "*->architect|git_handoff"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "coder" :to "architect" :type "git_handoff"} specs global))
  (assert= "resolve-thresholds skips *->*|type and uses global when exact/to-type miss"
           {:warn-ms 900000 :escalate-ms 3600000 :resolved-via "global"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "coder" :to "hardender" :type "git_handoff"}
            (dissoc specs "*->architect|git_handoff") global))
  (assert= "resolve-thresholds falls back to the global conf pair when no spec matches"
           {:warn-ms 900000 :escalate-ms 3600000 :resolved-via "global"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "a" :to "b" :type "note"} {} global)))

(let [headers (map (fn [i]
                     {:from "cleaner" :to "architect" :type "git_handoff"
                      :enqueued_at "2026-08-01T00:00:00Z"
                      :completed_at (str "2026-08-01T00:" (format "%02d" (+ 10 i)) ":00Z")})
                   (range 10))
      table (flow-watchdog-lib/calibrate-threshold-table headers 12345)
      exact (get-in table [:specs "cleaner->architect|git_handoff"])]
  (assert= "calibrate-threshold-table stamps calibratedAt"
           12345
           (:calibratedAt table))
  (assert= "calibrate-threshold-table emits an exact-spec entry once sample gate clears"
           true
           (boolean exact))
  (assert= "calibrate-threshold-table also emits to-type and type fallbacks"
           true
           (boolean (and (get-in table [:specs "*->architect|git_handoff"])
                         (get-in table [:specs "*->*|git_handoff"])))))

;; BL-835 acceptance floored-percentile-reject-01/02: a route whose full
;; history sits below min-warn-ms calibrates to NO entry at all (exact,
;; to-type, or type), and resolution for a parcel on that route falls
;; through to the global pair - not a floor-clamped fake warn.
(let [headers (map (fn [i]
                     {:from "coder" :to "cleaner" :type "note"
                      :enqueued_at "2026-08-01T00:00:00Z"
                      :completed_at (str "2026-08-01T00:00:" (format "%02d" (+ 1 i)) "Z")})
                   (range 8))
      table (flow-watchdog-lib/calibrate-threshold-table headers 12345)
      global {:warn-ms flow-watchdog-lib/default-warn-ms
              :escalate-ms flow-watchdog-lib/default-escalate-ms}]
  (assert= "BL-835: a sub-floor route's calibration emits no exact-spec entry"
           nil
           (get-in table [:specs "coder->cleaner|note"]))
  (assert= "BL-835: a sub-floor route's calibration emits no to-type entry either"
           nil
           (get-in table [:specs "*->cleaner|note"]))
  (assert= "BL-835: resolution for a sub-floor route falls through to the global pair"
           {:warn-ms flow-watchdog-lib/default-warn-ms
            :escalate-ms flow-watchdog-lib/default-escalate-ms
            :resolved-via "global"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "coder" :to "cleaner" :type "note"} (:specs table) global))
  (assert= "BL-835: sub-floor samples do not WARN a 90s parcel under global 15m"
           :none
           (flow-watchdog-lib/decide-tier
            {:age-ms 90000
             :warn-ms flow-watchdog-lib/default-warn-ms
             :escalate-ms flow-watchdog-lib/default-escalate-ms
             :highest-tier-alarmed nil
             :snoozed? false})))

;; threshold-table-stale? (pure): must be true for missing/malformed
;; :calibratedAt, false just under the recalibration window, and true again
;; once that window has elapsed. Nothing above exercises this directly - the
;; single run-sweep! calls below only ever see the nil-calibratedAt (always
;; stale) branch, which would stay green even if the elapsed-time clause were
;; deleted outright and the table never recalibrated again.
(assert= "threshold-table-stale? is true when calibratedAt is absent"
         true
         (flow-watchdog-lib/threshold-table-stale? {} 1000000))

(assert= "threshold-table-stale? is true when calibratedAt is not a number"
         true
         (flow-watchdog-lib/threshold-table-stale? {:calibratedAt "oops"} 1000000))

(assert= "threshold-table-stale? is false just under the recalibration window"
         false
         (flow-watchdog-lib/threshold-table-stale?
          {:calibratedAt 1000000}
          (+ 1000000 (dec flow-watchdog-lib/threshold-recalibration-ms))))

(assert= "threshold-table-stale? is true exactly at the recalibration window (boundary)"
         true
         (flow-watchdog-lib/threshold-table-stale?
          {:calibratedAt 1000000}
          (+ 1000000 flow-watchdog-lib/threshold-recalibration-ms)))

;; read-threshold-table / write-threshold-table! round trip (fs I/O): nothing
;; above ever reads back a table this suite itself wrote - run-sweep!'s single
;; calls only ever see the freshly-computed in-memory table, never the
;; JSON-persisted-then-reread one, so cheshire's keywordized JSON object keys
;; being normalised back to string spec keys (and nested :warn-ms/:escalate-ms
;; staying numbers, not strings) is untested. A broken normalisation would not
;; crash (resolve-thresholds' (number? ...) guard just falls through to
;; global, per the never-disable invariant) - it would silently defeat
;; calibration while looking healthy, exactly the failure mode this ticket
;; exists to catch.
(let [daemon-dir (mk-tmp)
      written {:calibratedAt 555 :warnPercentile 67 :escalatePercentile 97
               :minSamples 8 :sampleCount 10
               :specs {"cleaner->architect|git_handoff"
                       {:warn-ms 1200000 :escalate-ms 7200000 :n 10 :source "exact"}}}
      _ (flow-watchdog-lib/write-threshold-table! daemon-dir written)
      read-back (flow-watchdog-lib/read-threshold-table daemon-dir)
      entry (get-in read-back [:specs "cleaner->architect|git_handoff"])]
  (assert= "read-threshold-table round-trips calibratedAt"
           555
           (:calibratedAt read-back))
  (assert= "read-threshold-table normalises spec keys back to strings"
           true
           (contains? (:specs read-back) "cleaner->architect|git_handoff"))
  (assert= "read-threshold-table keeps per-spec warn-ms/escalate-ms as numbers, not strings"
           {:warn-ms 1200000 :escalate-ms 7200000 :n 10 :source "exact"}
           entry)
  (assert= "resolve-thresholds accepts the round-tripped entry (numeric guard passes)"
           {:warn-ms 1200000 :escalate-ms 7200000 :resolved-via "cleaner->architect|git_handoff"}
           (flow-watchdog-lib/resolve-thresholds
            {:from "cleaner" :to "architect" :type "git_handoff"}
            (:specs read-back)
            {:warn-ms 900000 :escalate-ms 3600000})))

(assert= "read-threshold-table degrades to {} for a missing file, never a crash"
         {}
         (:specs (flow-watchdog-lib/read-threshold-table (mk-tmp))))

;; End-to-end: a calibrated warn ABOVE the parcel's age suppresses the alarm
;; that the flat global 60s warn would have fired — proving resolution is
;; per-spec, not a mute inside decide-tier.
(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "architect" "inbox" "new")
      completed-dir (fs/path root "architect" "inbox" "completed")
      now-ms (* 1784900000 1000)
      alarms (atom [])
      ;; Seed 10 completed hops whose residence is ~30 minutes → calibrated
      ;; warn well above the 90s live parcel age.
      _ (doseq [i (range 10)]
          (write-handoff! (str (fs/path completed-dir (str "hist" i ".handoff")))
                           [["id" (str "hist" i)] ["from" "cleaner"] ["to" "architect"]
                            ["type" "git_handoff"]
                            ["enqueued_at" "2026-08-01T00:00:00Z"]
                            ["completed_at" (str "2026-08-01T00:30:" (format "%02d" i) "Z")]]))]
  (write-handoff! (str (fs/path new-dir "live.handoff"))
                   [["id" "live"] ["from" "cleaner"] ["to" "architect"] ["type" "git_handoff"]
                    ["enqueued_at" (iso (- (quot now-ms 1000) 90))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "architect" :new-dir new-dir
     :in-process-dir (fs/path root "architect" "inbox" "in_process")
     :completed-dir completed-dir}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  (assert= "spec-dependent warn (≈p67 of ~30m history) does not fire on a 90s parcel that global 60s would catch"
           0
           (count @alarms))
  (assert= "decide-tier still has no from/to/type keys after the spec-dependent change"
           #{:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?}
           flow-watchdog-lib/tier-decision-input-keys))

;; ── BL-650: active-time clock (evaluate-effective-age) ──────────────────────

(assert= "evaluate-effective-age: nil age source (neither header parses) fails closed"
         {:effective-age-ms nil :wall-age-ms nil :outage-intervals [] :unreconstructable? false}
         (flow-watchdog-lib/evaluate-effective-age
          {:enqueued-at "not-a-date" :created-at nil :now-ms 999
           :ledger-intervals [] :provider-evidence []}))

;; BL-650 stop-interval-not-counted-01: 1m before stop, 6m stopped, 8m active
;; => wall 15m, effective 9m.
(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (* 15 60 1000))
      stop-start-ms (+ enqueued-ms (* 1 60 1000))
      stop-end-ms (+ stop-start-ms (* 6 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
            :ledger-intervals [{:start-ms stop-start-ms :end-ms stop-end-ms
                                 :class "swarm-stop" :provenance "proven"}]
            :provider-evidence []})]
  (assert= "acceptance-01 (BL-650): a swarm-stop interval is subtracted from effective age"
           (* 9 60 1000)
           (:effective-age-ms eff))
  (assert= "acceptance-01 (BL-650): wall age is untouched at 15m"
           (* 15 60 1000)
           (:wall-age-ms eff))
  (assert= "acceptance-01 (BL-650): no warn at the wall-clock 15m mark once effective age is used"
           :none
           (flow-watchdog-lib/decide-tier
            {:age-ms (:effective-age-ms eff) :warn-ms (* 15 60 1000) :escalate-ms (* 60 60 1000)
             :highest-tier-alarmed nil :snoozed? false})))

;; BL-650 overnight-cooldown-resume-no-storm-02: parcel enqueued at pause
;; start, swarm paused all night, sweep immediately at resume => effective
;; age ~ 0.
(let [now-ms (* 1784900000 1000)
      pause-start-ms (- now-ms (* 12 60 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot pause-start-ms 1000)) :now-ms now-ms
            :ledger-intervals [{:start-ms pause-start-ms :end-ms now-ms
                                 :class "control-pause" :provenance "proven"}]
            :provider-evidence []})]
  (assert= "acceptance-02 (BL-650): a full-night control-pause zeroes effective age"
           0
           (:effective-age-ms eff))
  (assert= "acceptance-02 (BL-650): wall age still shows the full 12h"
           (* 12 60 60 1000)
           (:wall-age-ms eff))
  (assert= "acceptance-02 (BL-650): nothing fires at resume - effective age is 0"
           :none
           (flow-watchdog-lib/decide-tier
            {:age-ms (:effective-age-ms eff) :warn-ms (* 15 60 1000) :escalate-ms (* 60 60 1000)
             :highest-tier-alarmed nil :snoozed? false})))

;; BL-650: an OPEN control-pause (no resume yet) subtracts up to now - a
;; currently-true fact, not a guess - and is NOT flagged unreconstructable.
(let [now-ms (* 1784900000 1000)
      pause-start-ms (- now-ms (* 5 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot pause-start-ms 1000)) :now-ms now-ms
            :ledger-intervals [{:start-ms pause-start-ms :end-ms nil
                                 :class "control-pause" :provenance "open"}]
            :provider-evidence []})]
  (assert= "BL-650: an open control-pause subtracts from its start to now"
           0
           (:effective-age-ms eff))
  (assert= "BL-650: an open control-pause is NOT flagged unreconstructable"
           false
           (:unreconstructable? eff)))

;; BL-650 unreconstructable-interval-degrades-to-wall-clock-05: an OPEN
;; swarm-stop subtracts nothing and is flagged.
(let [now-ms (* 1784900000 1000)
      stop-start-ms (- now-ms (* 20 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot stop-start-ms 1000)) :now-ms now-ms
            :ledger-intervals [{:start-ms stop-start-ms :end-ms nil
                                 :class "swarm-stop" :provenance "open"}]
            :provider-evidence []})]
  (assert= "acceptance-05 (BL-650): an open swarm-stop subtracts nothing - falls back to wall clock"
           (:wall-age-ms eff)
           (:effective-age-ms eff))
  (assert= "acceptance-05 (BL-650): an open swarm-stop is flagged unreconstructable"
           true
           (:unreconstructable? eff))
  (let [text (flow-watchdog-lib/format-alarm-text
              {:id "p" :from "a" :to "b" :type "note" :age-ms (:effective-age-ms eff)
               :wall-age-ms (:wall-age-ms eff) :role "coder" :mailbox :new :verb :rotate
               :tier :warn :unreconstructable? (:unreconstructable? eff)})]
    (assert= "acceptance-05 (BL-650): alarm text flags the unreconstructable interval"
             true
             (clojure.string/includes? text "could not be reconstructed"))))

;; ── BL-650: format-alarm-text stays byte-identical for pre-existing callers ─

(assert= "BL-650: format-alarm-text with no new keys is unchanged from before"
         "⚠️ WARN flow-stall: parcel x (a->b, note) aged 1m in cleaner in_process - investigate."
         (flow-watchdog-lib/format-alarm-text
          {:id "x" :from "a" :to "b" :type "note" :age-ms 60000 :role "cleaner"
           :mailbox :in_process :verb :investigate :tier :warn}))

;; ── BL-650 alarm-text-states-clock-and-outage-07 ────────────────────────────

(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (* 15 60 1000))
      outage-start-ms (+ enqueued-ms (* 3 60 1000))
      outage-end-ms (+ outage-start-ms (* 6 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
            :ledger-intervals []
            :provider-evidence [{:ts-ms outage-start-ms :provider "anthropic" :text "529 Overloaded attempt 1/5"}
                                 {:ts-ms outage-end-ms :provider "anthropic" :text "529 Overloaded attempt 5/5"}]})]
  (assert= "acceptance-07 (BL-650): a 6m provider outage inside a 15m wall span leaves 9m effective"
           (* 9 60 1000)
           (:effective-age-ms eff))
  (let [text (flow-watchdog-lib/format-alarm-text
              {:id "p7" :from "cleaner" :to "architect" :type "note"
               :age-ms (:effective-age-ms eff) :wall-age-ms (:wall-age-ms eff)
               :role "architect" :mailbox :new :verb :investigate :tier :warn
               :outage-intervals (:outage-intervals eff)})]
    (assert= "acceptance-07: alarm text reads both active and wall age"
             true
             (and (clojure.string/includes? text "9m") (clojure.string/includes? text "15m")))
    (assert= "acceptance-07: alarm text names the subtracted provider-outage interval"
             true
             (clojure.string/includes? text "anthropic"))))

;; ── BL-650 provider-outage-interval-tracked-per-provider-08 ─────────────────

(assert= "provider-outage-intervals groups per provider, never merging distinct providers"
         2
         (count (flow-watchdog-lib/provider-outage-intervals
                 [{:ts-ms 1000 :provider "anthropic" :text "529"}
                  {:ts-ms 1500 :provider "anthropic" :text "529"}
                  {:ts-ms 1200 :provider "openai" :text "503"}])))

(assert= "provider-outage-intervals starts a new interval once the gap exceeds max-gap-ms"
         2
         (count (flow-watchdog-lib/provider-outage-intervals
                 [{:ts-ms 0 :provider "anthropic" :text "529"}
                  {:ts-ms 1000000 :provider "anthropic" :text "529"}]
                 600000)))

(assert= "acceptance-08 (BL-650): no evidence for a provider subtracts nothing - falls back to wall clock"
         true
         (let [now-ms (* 1784900000 1000)
               enqueued-ms (- now-ms (* 10 60 1000))
               eff (flow-watchdog-lib/evaluate-effective-age
                    {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
                     :ledger-intervals [] :provider-evidence []})]
           (= (:wall-age-ms eff) (:effective-age-ms eff))))

(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (* 15 60 1000))
      swarm-stop-start (+ enqueued-ms (* 1 60 1000))
      swarm-stop-end (+ swarm-stop-start (* 2 60 1000))
      outage-start (+ enqueued-ms (* 5 60 1000))
      outage-end (+ outage-start (* 2 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
            :ledger-intervals [{:start-ms swarm-stop-start :end-ms swarm-stop-end
                                 :class "swarm-stop" :provenance "proven"}]
            :provider-evidence [{:ts-ms outage-start :provider "anthropic" :text "529"}
                                 {:ts-ms outage-end :provider "anthropic" :text "529"}]})]
  (assert= "acceptance-08 (BL-650): a non-overlapping provider-outage and swarm-stop subtract independently"
           (* 11 60 1000) ;; 15m wall - 2m stop - 2m outage
           (:effective-age-ms eff)))

;; ── BL-650: merge-and-sum-ms (no double subtraction, invariant 1) ───────────

(assert= "merge-and-sum-ms sums disjoint intervals"
         2000
         (flow-watchdog-lib/merge-and-sum-ms
          [{:start-ms 0 :end-ms 1000} {:start-ms 2000 :end-ms 3000}] 0 10000))

(assert= "merge-and-sum-ms merges overlapping intervals instead of double-counting"
         800
         (flow-watchdog-lib/merge-and-sum-ms
          [{:start-ms 100 :end-ms 600} {:start-ms 400 :end-ms 900}] 0 1000))

(assert= "merge-and-sum-ms merges a nested interval into its container"
         500
         (flow-watchdog-lib/merge-and-sum-ms
          [{:start-ms 0 :end-ms 500} {:start-ms 100 :end-ms 300}] 0 1000))

(assert= "merge-and-sum-ms tolerates out-of-order input (sorts internally)"
         800
         (flow-watchdog-lib/merge-and-sum-ms
          [{:start-ms 400 :end-ms 900} {:start-ms 100 :end-ms 600}] 0 1000))

(assert= "merge-and-sum-ms ignores a zero-length interval"
         0
         (flow-watchdog-lib/merge-and-sum-ms [{:start-ms 500 :end-ms 500}] 0 1000))

(assert= "merge-and-sum-ms clips an interval extending past the span"
         200
         (flow-watchdog-lib/merge-and-sum-ms [{:start-ms 800 :end-ms 1500}] 0 1000))

(assert= "merge-and-sum-ms clips an interval starting before the span"
         200
         (flow-watchdog-lib/merge-and-sum-ms [{:start-ms -500 :end-ms 200}] 0 1000))

(assert= "merge-and-sum-ms ignores an interval entirely outside the span"
         0
         (flow-watchdog-lib/merge-and-sum-ms [{:start-ms 2000 :end-ms 3000}] 0 1000))

;; ── BL-650 rotation-pack-threshold-vs-parallel-pack-06 ──────────────────────

(assert= "parse-router-warn-ms parses a positive value"
         1200000
         (flow-watchdog-lib/parse-router-warn-ms "config flow_watchdog_router_warn_ms 1200000"))

(assert= "parse-router-warn-ms falls back to the router default when absent"
         flow-watchdog-lib/default-router-warn-ms
         (flow-watchdog-lib/parse-router-warn-ms "config mutation_cooldown_days 3"))

(assert= "parse-router-escalate-ms falls back to the router default when absent"
         flow-watchdog-lib/default-router-escalate-ms
         (flow-watchdog-lib/parse-router-escalate-ms nil))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        "config rotation router\nconfig flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n")
  (assert= "read-pack-aware-global-thresholds uses the router pair under `config rotation router`"
           {:warn-ms flow-watchdog-lib/default-router-warn-ms :escalate-ms flow-watchdog-lib/default-router-escalate-ms}
           (flow-watchdog-lib/read-pack-aware-global-thresholds root)))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        "config flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n")
  (assert= "read-pack-aware-global-thresholds keeps the plain pair with no rotation directive (parallel/all-resident)"
           {:warn-ms 60000 :escalate-ms 240000}
           (flow-watchdog-lib/read-pack-aware-global-thresholds root)))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        "config rotation sequential\nconfig flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n")
  (assert= "read-pack-aware-global-thresholds keeps the plain pair under `config rotation sequential` (mono-rotate, not router)"
           {:warn-ms 60000 :escalate-ms 240000}
           (flow-watchdog-lib/read-pack-aware-global-thresholds root)))

;; End-to-end acceptance-06: the SAME nominal-rotation-wait parcel (wall age
;; just past the plain 15m default-warn-ms) does not warn under a
;; rotation-router pack, but still warns under a parallel/all-resident pack.
(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms flow-watchdog-lib/default-warn-ms 1000)
      router-root (mk-tmp)
      parallel-root (mk-tmp)
      new-dir-for (fn [root] (fs/path root "cleaner" "inbox" "new"))
      daemon-dir-for (fn [root] (fs/path root ".swarmforge" "daemon"))]
  (fs/create-dirs (fs/path router-root "swarmforge"))
  (spit (str (fs/path router-root "swarmforge" "swarmforge.conf")) "config rotation router\n")
  (fs/create-dirs (fs/path parallel-root "swarmforge"))
  (spit (str (fs/path parallel-root "swarmforge" "swarmforge.conf")) "")
  (doseq [root [router-root parallel-root]]
    (write-handoff! (str (fs/path (new-dir-for root) "p06.handoff"))
                     [["id" "p06"] ["from" "QA"] ["to" "cleaner"] ["type" "note"]
                      ["enqueued_at" (iso (quot enqueued-ms 1000))]]))
  (let [router-alarms (atom [])
        parallel-alarms (atom [])]
    (flow-watchdog-lib/run-sweep!
     [{:role "cleaner" :new-dir (new-dir-for router-root)
       :in-process-dir (fs/path router-root "cleaner" "inbox" "in_process")}]
     now-ms (str router-root) (daemon-dir-for router-root)
     {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! router-alarms conj text))})
    (flow-watchdog-lib/run-sweep!
     [{:role "cleaner" :new-dir (new-dir-for parallel-root)
       :in-process-dir (fs/path parallel-root "cleaner" "inbox" "in_process")}]
     now-ms (str parallel-root) (daemon-dir-for parallel-root)
     {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! parallel-alarms conj text))})
    (assert= "acceptance-06: a nominal rotation wait does NOT warn under a rotation-router pack"
             0
             (count @router-alarms))
    (assert= "acceptance-06: the identical wall age still warns under a parallel/all-resident pack"
             1
             (count @parallel-alarms))))

;; ── BL-650 scenarios 09/10: mono-router detour vs orphaned claim ────────────
;; Neither needs new mechanism - both prove the active-time clock still
;; carries decide-tier's unsuppressable-by-design guarantee: a short active
;; detour never alarms, and active time crossing warn always does, regardless
;; of in_process/live-session status.

(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (* 2 60 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
            :ledger-intervals [] :provider-evidence []})]
  (assert= "acceptance-09 (BL-650): a short legitimate detour does not alarm"
           :none
           (flow-watchdog-lib/decide-tier
            {:age-ms (:effective-age-ms eff) :warn-ms flow-watchdog-lib/default-warn-ms
             :escalate-ms flow-watchdog-lib/default-escalate-ms
             :highest-tier-alarmed nil :snoozed? false})))

(let [now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (+ flow-watchdog-lib/default-warn-ms 1000))
      eff (flow-watchdog-lib/evaluate-effective-age
           {:enqueued-at (iso (quot enqueued-ms 1000)) :now-ms now-ms
            :ledger-intervals [] :provider-evidence []})]
  (assert= "acceptance-10 (BL-650): an orphaned in_process claim still alarms once active time crosses warn"
           :warn
           (flow-watchdog-lib/decide-tier
            {:age-ms (:effective-age-ms eff) :warn-ms flow-watchdog-lib/default-warn-ms
             :escalate-ms flow-watchdog-lib/default-escalate-ms
             :highest-tier-alarmed nil :snoozed? false})))

;; ── BL-650 run-sweep! wiring: ledger fold from real fs state ────────────────

(defn write-ledger-record! [root month line]
  ;; run-sweep! reads via state-dir = (fs/parent daemon-dir) = root/.swarmforge
  ;; (daemon-dir itself is root/.swarmforge/daemon) - write to that same
  ;; root/.swarmforge/telemetry, not root/telemetry.
  (let [dir (availability-ledger-lib/telemetry-dir (fs/path root ".swarmforge"))]
    (fs/create-dirs dir)
    (spit (str (fs/path dir (str "availability-" month ".jsonl"))) (str line "\n") :append true)))

(let [root (mk-sweep-fixture!)
      daemon-dir (fs/path root ".swarmforge" "daemon")
      new-dir (fs/path root "cleaner" "inbox" "new")
      now-ms (* 1784900000 1000)
      enqueued-ms (- now-ms (* 20 60 1000))
      stop-start-ms (+ enqueued-ms (* 1 60 1000))
      stop-end-ms (+ stop-start-ms (* 18 60 1000)) ;; 18m real stop
      alarms (atom [])]
  (write-ledger-record! root "2026-07"
                         (json/generate-string {:ts (iso (quot stop-start-ms 1000)) :event "stop"
                                                 :class "swarm-stop" :source "kill_pipeline_swarm.sh"}))
  (write-ledger-record! root "2026-07"
                         (json/generate-string {:ts (iso (quot stop-end-ms 1000)) :event "start"
                                                 :class "swarm-stop" :source "start-swarm.sh"}))
  (write-handoff! (str (fs/path new-dir "pledger.handoff"))
                   [["id" "pledger"] ["from" "specifier"] ["to" "cleaner"] ["type" "note"]
                    ["enqueued_at" (iso (quot enqueued-ms 1000))]])
  (flow-watchdog-lib/run-sweep!
   [{:role "cleaner" :new-dir new-dir :in-process-dir (fs/path root "cleaner" "inbox" "in_process")}]
   now-ms (str root) daemon-dir
   {:live-session? (fn [_role] false) :emit-alarm! (fn [text] (swap! alarms conj text))})
  ;; wall 20m minus an 18m real stop leaves 2m effective: crosses
  ;; mk-sweep-fixture!'s 1m warn but stays under its 4m escalate. Wall clock
  ;; alone (20m) would have crossed escalate outright - proof the REAL
  ;; on-disk ledger, not just a hand-built fixture map, is what downgraded it.
  (assert= "run-sweep! reads the REAL on-disk availability ledger and subtracts a real swarm-stop"
           1
           (count @alarms))
  (assert= "the fired alarm is WARN, not the ESCALATE wall-clock-alone would have fired"
           true
           (clojure.string/includes? (first @alarms) "⚠️ WARN")))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: flow_watchdog_lib.bb"))
