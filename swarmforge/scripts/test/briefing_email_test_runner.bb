#!/usr/bin/env bb
;; TDD runner for briefing_email_lib.bb (BL-214) - pure assertions plus
;; fixture-based tests (real fs I/O against a temp dir, fake send-email!
;; adapter - no real network, no real timers, no live daemon).
(ns briefing-email-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "briefing-email-test-"})))

;; ── build-briefing-subject (pure) ───────────────────────────────────────

(assert= "subject names the date and the headline"
         "SwarmForge briefing 2026-07-09 - Shipped BL-215"
         (briefing-email-lib/build-briefing-subject "2026-07-09" "Shipped BL-215\n\nDetails..."))

(assert= "subject with no content still names the date"
         "SwarmForge briefing 2026-07-09"
         (briefing-email-lib/build-briefing-subject "2026-07-09" ""))

(assert= "subject skips leading blank lines to find the headline"
         "SwarmForge briefing 2026-07-09 - Real headline"
         (briefing-email-lib/build-briefing-subject "2026-07-09" "\n  \nReal headline\nmore"))

;; ── load-sent-briefings / record-briefing-sent! / find-unsent-briefings ──

(let [dir (mk-tmp)]
  (assert= "no marker file yet -> nothing sent"
           #{}
           (briefing-email-lib/load-sent-briefings dir))
  (spit (str (fs/path dir "2026-07-08.md")) "old\n")
  (spit (str (fs/path dir "2026-07-09.md")) "new\n")
  (assert= "both unsent briefings are found, oldest first"
           ["2026-07-08.md" "2026-07-09.md"]
           (briefing-email-lib/find-unsent-briefings dir))
  (briefing-email-lib/record-briefing-sent! dir "2026-07-08.md")
  (assert= "recorded briefing is now in the sent set"
           #{"2026-07-08.md"}
           (briefing-email-lib/load-sent-briefings dir))
  (assert= "a sent briefing is excluded from unsent"
           ["2026-07-09.md"]
           (briefing-email-lib/find-unsent-briefings dir)))

(assert= "an absent briefings dir has no unsent briefings, never a crash"
         []
         (briefing-email-lib/find-unsent-briefings (str (fs/path (mk-tmp) "nonexistent"))))

(let [dir (mk-tmp)]
  (spit (str (fs/path dir "2026-07-09.md")) "content\n")
  (spit (str (fs/path dir "notes.txt")) "not a briefing\n")
  (assert= "non-.md files under briefings-dir are ignored"
           ["2026-07-09.md"]
           (briefing-email-lib/find-unsent-briefings dir)))

;; ── send-unsent-briefings! (fixture-based, fake send-email! adapter) ─────

(defn fake-log! [calls]
  (fn [& parts] (swap! calls conj (vec parts))))

;; brief-01: a newly committed briefing is sent once via the injected
;; send-email! adapter, using the daemon's configured to/from/key (the
;; adapter itself, not this library, owns that - asserted by the CALLER
;; passing a result of {:success true} only when correctly configured).
(let [dir (mk-tmp)
      calls (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline one\n")
  (let [sent (briefing-email-lib/send-unsent-briefings!
              dir
              {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
               :send-email! (fn [_subject _text] {:success true})
               :log! (fake-log! calls)})]
    (assert= "brief-01: the newly committed briefing is sent" ["2026-07-09.md"] sent)
    (assert= "brief-01: the briefing is marked sent durably"
             #{"2026-07-09.md"}
             (briefing-email-lib/load-sent-briefings dir))
    (assert= "brief-01: a sent event is logged"
             true
             (some #(= (first %) "briefing-sent") @calls))))

;; brief-02: exactly once across restarts - a second sweep against the same
;; (already-marked-sent) briefings-dir sends nothing more.
(let [dir (mk-tmp)
      send-calls (atom 0)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/record-briefing-sent! dir "2026-07-09.md")
  (let [sent (briefing-email-lib/send-unsent-briefings!
              dir
              {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
               :send-email! (fn [_s _t] (swap! send-calls inc) {:success true})
               :log! (fn [& _] nil)})]
    (assert= "brief-02: no second email is sent for an already-sent briefing" [] sent)
    (assert= "brief-02: send-email! is never even called for an already-sent briefing" 0 @send-calls)))

;; brief-03: unconfigured (send-alarm-email!-shaped :disabled/:missing-api-key
;; result) degrades to a graceful, logged skip - never marks sent, never throws.
(let [dir (mk-tmp)
      calls (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (let [sent (briefing-email-lib/send-unsent-briefings!
              dir
              {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
               :send-email! (fn [_s _t] {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"})
               :log! (fake-log! calls)})]
    (assert= "brief-03: nothing is sent when unconfigured" [] sent)
    (assert= "brief-03: the briefing is NOT marked sent (retried next sweep)"
             #{}
             (briefing-email-lib/load-sent-briefings dir))
    (assert= "brief-03: the skip is logged"
             true
             (some #(= (first %) "briefing-skip-missing-key") @calls))))

(let [dir (mk-tmp)
      calls (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_s _t] {:success false :reason :disabled :error "email not configured (notify_email_to unset)"})
    :log! (fake-log! calls)})
  (assert= "brief-03: a disabled (no recipient) skip is logged distinctly"
           true
           (some #(= (first %) "briefing-skip-disabled") @calls)))

;; A real send failure (configured, but the POST itself failed) also skips
;; marking sent, so it retries next sweep instead of being lost.
(let [dir (mk-tmp)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_s _t] {:success false :error "network error"})
    :log! (fn [& _] nil)})
  (assert= "a real send failure is not marked sent - retried next sweep"
           #{}
           (briefing-email-lib/load-sent-briefings dir)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: briefing_email_lib.bb"))
