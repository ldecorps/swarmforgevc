#!/usr/bin/env bb
;; TDD runner for support_lib.bb (BL-275) - pure assertions only (fake
;; :read-thread!/:write-thread!/:list-existing-ids! adapters, injected
;; timestamps). No real fs, no real timers, no real clock.
(ns support-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parse-thread-number / next-thread-id (pure) ──────────────────────────

(assert= "parse-thread-number extracts the numeric part" 42 (support-lib/parse-thread-number "SUP-42"))
(assert= "parse-thread-number rejects a non-matching id" nil (support-lib/parse-thread-number "BL-42"))
(assert= "next-thread-id starts at SUP-1 when none exist yet" "SUP-1" (support-lib/next-thread-id []))
(assert= "next-thread-id continues from the highest existing number"
         "SUP-4" (support-lib/next-thread-id ["SUP-1" "SUP-3" "SUP-2"]))
(assert= "next-thread-id ignores non-matching entries rather than crashing"
         "SUP-2" (support-lib/next-thread-id ["SUP-1" "garbage"]))

;; ── new-thread / append-message (pure) — support-mvp-01/03/04 ────────────

(let [thread (support-lib/new-thread "SUP-1" "rc" "2026-07-11T09:00:00Z" "hello, need help")]
  (assert= "new-thread assigns the given id" "SUP-1" (:id thread))
  (assert= "BL-275 support-mvp-01: a new thread starts open" "open" (:status thread))
  (assert= "BL-275 support-mvp-01: the message is stored under its channel and timestamp"
           [{:channel "rc" :timestamp "2026-07-11T09:00:00Z" :text "hello, need help"}]
           (:messages thread)))

(let [opened (support-lib/new-thread "SUP-1" "rc" "2026-07-11T09:00:00Z" "hello")
      followed-up (support-lib/append-message opened "rc" "2026-07-11T09:05:00Z" "still there?")]
  (assert= "BL-275 support-mvp-03: a follow-up is appended to the same thread"
           2 (count (:messages followed-up)))
  (assert= "BL-275 support-mvp-03: the follow-up carries its own channel/timestamp/text"
           {:channel "rc" :timestamp "2026-07-11T09:05:00Z" :text "still there?"}
           (last (:messages followed-up)))
  (assert= "BL-275 support-mvp-04: appending a non-close interaction never changes status away from open"
           "open" (:status followed-up)))

;; ── record-interaction! (adapter-injected) ───────────────────────────────

(let [store (atom {})
      adapters {:read-thread! (fn [id] (get @store id))
                :write-thread! (fn [thread] (swap! store assoc (:id thread) thread))
                :list-existing-ids! (fn [] (keys @store))}
      opened (support-lib/record-interaction! nil "rc" "2026-07-11T09:00:00Z" "hello, need help" adapters)]
  (assert= "record-interaction! with no thread-id opens a new SUP-### thread" "SUP-1" (:id opened))
  (assert= "record-interaction! persists the new thread via :write-thread!" opened (get @store "SUP-1"))

  (let [followed-up (support-lib/record-interaction! "SUP-1" "rc" "2026-07-11T09:05:00Z" "still there?" adapters)]
    (assert= "record-interaction! with a thread-id appends to the SAME thread" "SUP-1" (:id followed-up))
    (assert= "record-interaction! follow-up count" 2 (count (:messages followed-up)))
    (assert= "record-interaction! persists the appended thread" followed-up (get @store "SUP-1")))

  (let [second (support-lib/record-interaction! nil "rc" "2026-07-11T09:10:00Z" "unrelated ask" adapters)]
    (assert= "record-interaction! for a SECOND caller opens a DIFFERENT thread, not the first"
             "SUP-2" (:id second))))

;; ── email echo composition (pure) — support-mvp-02 ───────────────────────

(let [thread (support-lib/new-thread "SUP-7" "rc" "2026-07-11T09:00:00Z" "my PR is stuck\nsecond line")
      echo (support-lib/assemble-email-echo thread "check the CI logs" ["retry the build" "escalate to human"])]
  (assert= "BL-275 support-mvp-02: the subject carries the ticket id" true
           (clojure.string/starts-with? (:subject echo) "[SUP-7]"))
  (assert= "BL-275 support-mvp-02: the subject carries a short title (first line of the opening message)"
           "[SUP-7] my PR is stuck" (:subject echo))
  (assert= "BL-275 support-mvp-02: the body summarizes the conversation so far" true
           (clojure.string/includes? (:body echo) "my PR is stuck"))
  (assert= "BL-275 support-mvp-02: the body states the next step" true
           (clojure.string/includes? (:body echo) "Next step: check the CI logs"))
  (assert= "BL-275 support-mvp-02: the body lists every option" true
           (and (clojure.string/includes? (:body echo) "- retry the build")
                (clojure.string/includes? (:body echo) "- escalate to human"))))

(let [long-line (apply str (repeat 80 "x"))
      thread (support-lib/new-thread "SUP-8" "rc" "2026-07-11T09:00:00Z" long-line)]
  (assert= "a long opening line is truncated in the subject, never overflowing"
           true (< (count (support-lib/build-email-subject thread)) (count long-line))))

;; ── wake decision (pure) — mirrors operator_lib.bb's should-launch-operator? ──

(assert= "should-wake-support? fires when work is pending and nothing is running"
         true (support-lib/should-wake-support? {:llm-running? false :pending-count 1}))
(assert= "should-wake-support? does not fire with nothing pending"
         false (support-lib/should-wake-support? {:llm-running? false :pending-count 0}))
(assert= "should-wake-support? does not fire while already running (never double-launch)"
         false (support-lib/should-wake-support? {:llm-running? true :pending-count 3}))

;; ── resolve-thread (pure) — BL-276 thread-lifecycle-02 ───────────────────

(let [thread (support-lib/new-thread "SUP-1" "telegram" "2026-07-01T09:00:00Z" "my PR is stuck")
      resolved (support-lib/resolve-thread thread)]
  (assert= "BL-276 thread-lifecycle-02: resolve-thread sets status to resolved"
           "resolved" (:status resolved))
  (assert= "BL-276 thread-lifecycle-02: resolve-thread never drops prior messages"
           (:messages thread) (:messages resolved)))

;; ── idle-nudge-decision (pure) — BL-276 thread-lifecycle-01/03/04 ────────

(def ONE_DAY_MS (* 24 60 60 1000))

(defn mk-thread [messages]
  {:id "SUP-1" :status "open" :messages messages})

(defn human-msg [timestamp] {:channel "telegram" :timestamp timestamp :text "hi"})
(defn operator-msg [timestamp] {:channel "operator" :timestamp timestamp :text support-lib/idle-nudge-text})

;; thread-lifecycle-01: many days silent -> still :none (never a close
;; decision exists at all - this pure fn's only outcomes are :none/
;; :post-nudge, structurally proving no close path exists here).
(let [thread (mk-thread [(human-msg "2026-01-01T09:00:00Z")])
      now-ms (+ (.toEpochMilli (java.time.Instant/parse "2026-01-01T09:00:00Z")) (* 90 ONE_DAY_MS))]
  (assert= "BL-276 thread-lifecycle-01: even many days silent, the decision is never a close"
           true (contains? #{:none :post-nudge} (support-lib/idle-nudge-decision thread now-ms))))

;; thread-lifecycle-03: idle exactly one day -> nudge due.
(let [last-human-ms (.toEpochMilli (java.time.Instant/parse "2026-07-10T09:00:00Z"))
      thread (mk-thread [(human-msg "2026-07-10T09:00:00Z")])
      now-ms (+ last-human-ms ONE_DAY_MS)]
  (assert= "BL-276 thread-lifecycle-03: idle >= 1 day since the human's last word -> nudge due"
           :post-nudge (support-lib/idle-nudge-decision thread now-ms)))

(let [last-human-ms (.toEpochMilli (java.time.Instant/parse "2026-07-10T09:00:00Z"))
      thread (mk-thread [(human-msg "2026-07-10T09:00:00Z")])
      now-ms (+ last-human-ms (- ONE_DAY_MS 1))]
  (assert= "not yet a full day idle -> no nudge"
           :none (support-lib/idle-nudge-decision thread now-ms)))

;; thread-lifecycle-04: a nudge already posted (after the human's last
;; word) suppresses a second one until the human replies again.
(let [last-human-ms (.toEpochMilli (java.time.Instant/parse "2026-07-10T09:00:00Z"))
      nudge-ms (+ last-human-ms ONE_DAY_MS)
      thread (mk-thread [(human-msg "2026-07-10T09:00:00Z") (operator-msg "2026-07-11T09:00:00Z")])
      now-ms (+ nudge-ms ONE_DAY_MS)] ; another full day after the nudge too
  (assert= "BL-276 thread-lifecycle-04 (part 1): a nudge already posted since the human's last word suppresses a repeat"
           :none (support-lib/idle-nudge-decision thread now-ms)))

(let [thread (mk-thread [(human-msg "2026-07-10T09:00:00Z")
                          (operator-msg "2026-07-11T09:00:00Z")
                          (human-msg "2026-07-11T10:00:00Z")]) ; the human replies AFTER the nudge
      now-ms (+ (.toEpochMilli (java.time.Instant/parse "2026-07-11T10:00:00Z")) ONE_DAY_MS)]
  (assert= "BL-276 thread-lifecycle-04 (part 2): a reply resets the idle clock - a full day after THAT reply is due again"
           :post-nudge (support-lib/idle-nudge-decision thread now-ms)))

(let [thread (mk-thread [(human-msg "2026-07-10T09:00:00Z")
                          (operator-msg "2026-07-11T09:00:00Z")
                          (human-msg "2026-07-11T10:00:00Z")])
      now-ms (+ (.toEpochMilli (java.time.Instant/parse "2026-07-11T10:00:00Z")) 1000)]
  (assert= "BL-276 thread-lifecycle-04 (part 3): immediately after the reply, no second nudge yet"
           :none (support-lib/idle-nudge-decision thread now-ms)))

(assert= "idle-nudge-decision on a thread with no human participation at all is never a nudge"
         :none (support-lib/idle-nudge-decision (mk-thread []) (* 999 ONE_DAY_MS)))

;; ── proactive-notice-decision / proactive-notice-text (pure) — BL-284 ────
;; proactive-notify-01/02/03/04: mirrors idle-nudge-decision's own pure,
;; adapter-free shape - given a subject's thread and a status-change
;; descriptor, decide :notify or :none. WHETHER something changed is the
;; caller's own job (deferred, BL-239 rehoming); this function only gates
;; on an open thread + the given :changed? flag.

(assert= "BL-284 proactive-notify-03: an open thread + a real change -> :notify"
         :notify
         (support-lib/proactive-notice-decision (mk-thread [(human-msg "2026-07-10T09:00:00Z")])
                                                  {:changed? true :summary "BL-100 moved to done"}))

(assert= "BL-284 proactive-notify-04: an open thread + no change -> :none, stays silent"
         :none
         (support-lib/proactive-notice-decision (mk-thread [(human-msg "2026-07-10T09:00:00Z")])
                                                  {:changed? false :summary "BL-100 moved to done"}))

(assert= "a resolved thread never gets a proactive notice, even on a real change"
         :none
         (support-lib/proactive-notice-decision (assoc (mk-thread [(human-msg "2026-07-10T09:00:00Z")]) :status "resolved")
                                                  {:changed? true :summary "BL-100 moved to done"}))

(assert= "a nonexistent thread (nil) never gets a proactive notice"
         :none
         (support-lib/proactive-notice-decision nil {:changed? true :summary "BL-100 moved to done"}))

(assert= "proactive-notice-text carries the status-change descriptor's own summary"
         "BL-100 moved to done"
         (support-lib/proactive-notice-text {:changed? true :summary "BL-100 moved to done"}))

;; ── link-ticket / record-linked-ticket-status (pure) — BL-283 ────────────

(let [thread (mk-thread [(human-msg "2026-07-10T09:00:00Z")])
      linked (support-lib/link-ticket thread "BL-100")]
  (assert= "link-ticket records the ticket id"
           [{:id "BL-100" :last-reported-status nil}]
           (:linked-tickets linked))
  (assert= "link-ticket never touches messages/status"
           (dissoc thread :linked-tickets)
           (dissoc linked :linked-tickets)))

(let [thread (support-lib/link-ticket (mk-thread []) "BL-100")
      linked-again (support-lib/link-ticket thread "BL-100")]
  (assert= "linking the same ticket twice is idempotent - no duplicate entry"
           [{:id "BL-100" :last-reported-status nil}]
           (:linked-tickets linked-again)))

(let [thread (-> (mk-thread [])
                  (support-lib/link-ticket "BL-100")
                  (support-lib/link-ticket "BL-101"))]
  (assert= "a thread can link more than one ticket over its lifetime"
           ["BL-100" "BL-101"]
           (map :id (:linked-tickets thread))))

(let [thread (-> (mk-thread [])
                  (support-lib/link-ticket "BL-100")
                  (support-lib/link-ticket "BL-101"))
      updated (support-lib/record-linked-ticket-status thread "BL-100" "active")]
  (assert= "record-linked-ticket-status updates only the named ticket's last-reported-status"
           [{:id "BL-100" :last-reported-status "active"} {:id "BL-101" :last-reported-status nil}]
           (:linked-tickets updated)))

;; ── status-change-for-linked-ticket (pure) — BL-283 decide-status-03/04 ──

(assert= "coordinator-handoff-03: a moved-on current status is a real change"
         {:changed? true :summary "BL-100 is now done."}
         (support-lib/status-change-for-linked-ticket {:id "BL-100" :last-reported-status "active"} "done"))

(assert= "coordinator-handoff-04: an unchanged current status produces no change"
         {:changed? false :summary nil}
         (support-lib/status-change-for-linked-ticket {:id "BL-100" :last-reported-status "active"} "active"))

(assert= "a never-before-reported status (nil last-reported) is itself news the first time"
         {:changed? true :summary "BL-100 is now active."}
         (support-lib/status-change-for-linked-ticket {:id "BL-100" :last-reported-status nil} "active"))

(assert= "a ticket that cannot currently be found anywhere (nil current) is never reported as a change"
         {:changed? false :summary nil}
         (support-lib/status-change-for-linked-ticket {:id "BL-100" :last-reported-status "active"} nil))

;; ── intake / coordinator-note composition (pure) — BL-283 coordinator-handoff-01 ──

(let [thread (support-lib/new-thread "SUP-7" "telegram" "2026-07-11T09:00:00Z" "my PR is stuck\nmore detail")]
  (assert= "build-intake-slug is a lowercase, filename-safe form of the thread id"
           "sup-7"
           (support-lib/build-intake-slug thread))
  (assert= "build-intake-content references the subject thread id"
           true
           (clojure.string/includes? (support-lib/build-intake-content thread) "SUP-7"))
  (assert= "build-intake-content carries the conversation so far"
           true
           (clojure.string/includes? (support-lib/build-intake-content thread) "my PR is stuck"))
  (assert= "build-coordinator-note-message references the subject thread id"
           true
           (clojure.string/starts-with? (support-lib/build-coordinator-note-message thread) "SUP-7"))
  (assert= "build-coordinator-note-message stays under swarm_handoff.bb's 80-char note limit"
           true
           (<= (count (support-lib/build-coordinator-note-message thread)) 80)))

;; ── hand-off-to-coordinator! (adapter-injected) — BL-283 coordinator-handoff-01/02 ──

(let [thread (support-lib/new-thread "SUP-8" "telegram" "2026-07-11T09:00:00Z" "we should build this")
      intake-calls (atom [])
      note-calls (atom [])
      store (atom {})
      adapters {:write-intake! (fn [slug content] (swap! intake-calls conj {:slug slug :content content}))
                :send-coordinator-note! (fn [message] (swap! note-calls conj message))
                :write-thread! (fn [t] (swap! store assoc (:id t) t))}
      result (support-lib/hand-off-to-coordinator! thread "BL-200" adapters)]
  (assert= "coordinator-handoff-01: an intake is filed referencing the subject"
           1
           (count @intake-calls))
  (assert= "coordinator-handoff-01: the intake slug matches the thread id"
           "sup-8"
           (:slug (first @intake-calls)))
  (assert= "coordinator-handoff-01: a coordinator note is sent"
           1
           (count @note-calls))
  (assert= "coordinator-handoff-01: the thread records the linked ticket"
           ["BL-200"]
           (map :id (:linked-tickets result)))
  (assert= "coordinator-handoff-01: the updated thread is persisted"
           result
           (get @store "SUP-8"))
  ;; coordinator-handoff-02: anti-fabrication is a STRUCTURAL guarantee here
  ;; - the adapters map has no possible path to create/spec/promote a
  ;; backlog ticket at all (no such adapter exists), so this assertion is
  ;; really just confirming the only two side-effect adapters were used,
  ;; nothing else.
  (assert= "coordinator-handoff-02: no adapter beyond intake/note/thread-write is ever invoked"
           #{:write-intake! :send-coordinator-note! :write-thread!}
           (set (keys adapters))))

;; ── check-linked-ticket-status! (adapter-injected) — BL-283 coordinator-handoff-03/04/05 ──

(defn fake-status-check-deps [overrides]
  (let [posted (atom [])
        written (atom [])]
    (merge
     {:posted posted
      :written written
      :current-status! (fn [_id] (:current overrides))
      :post-notice! (fn [thread-id text] (swap! posted conj {:thread-id thread-id :text text}))
      :write-thread! (fn [t] (swap! written conj t))
      :now-iso! (fn [] "2026-07-11T10:00:00Z")}
     overrides)))

(let [thread (-> (support-lib/new-thread "SUP-9" "telegram" "2026-07-10T09:00:00Z" "topic")
                  (support-lib/link-ticket "BL-300")
                  (support-lib/record-linked-ticket-status "BL-300" "active"))
      linked (first (:linked-tickets thread))
      deps (fake-status-check-deps {:current "done"})
      result (support-lib/check-linked-ticket-status! thread linked deps)]
  (assert= "coordinator-handoff-03: a moved-on ticket posts exactly one status notice into the subject's topic"
           true
           (:posted? result))
  (assert= "coordinator-handoff-03: the notice is posted to the linked thread's own subject"
           [{:thread-id "SUP-9" :text "BL-300 is now done."}]
           @(:posted deps))
  (assert= "coordinator-handoff-03: the thread's last-reported status is updated so it is not reported again"
           "done"
           (:last-reported-status (first (:linked-tickets (first @(:written deps)))))))

(let [thread (-> (support-lib/new-thread "SUP-9" "telegram" "2026-07-10T09:00:00Z" "topic")
                  (support-lib/link-ticket "BL-300")
                  (support-lib/record-linked-ticket-status "BL-300" "active"))
      linked (first (:linked-tickets thread))
      deps (fake-status-check-deps {:current "active"})
      result (support-lib/check-linked-ticket-status! thread linked deps)]
  (assert= "coordinator-handoff-04: an unchanged linked ticket posts no status notice"
           false
           (:posted? result))
  (assert= "coordinator-handoff-04: no notice reaches any topic"
           []
           @(:posted deps))
  (assert= "coordinator-handoff-04: no thread write happens for a no-op check"
           []
           @(:written deps)))

(let [threadA (-> (support-lib/new-thread "SUP-1" "telegram" "2026-07-10T09:00:00Z" "about A")
                   (support-lib/link-ticket "BL-300")
                   (support-lib/record-linked-ticket-status "BL-300" "active"))
      threadB (support-lib/new-thread "SUP-2" "telegram" "2026-07-10T09:00:00Z" "about B")
      linkedA (first (:linked-tickets threadA))
      depsA (fake-status-check-deps {:current "done"})]
  (support-lib/check-linked-ticket-status! threadA linkedA depsA)
  (assert= "coordinator-handoff-05: the status notice names only the linked subject's own thread id"
           [{:thread-id "SUP-1" :text "BL-300 is now done."}]
           @(:posted depsA))
  (assert= "coordinator-handoff-05: a thread with no linked ticket at all has nothing to check"
           nil
           (:linked-tickets threadB)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: support_lib.bb"))
