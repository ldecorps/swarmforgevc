#!/usr/bin/env bb
;; TDD runner for briefing_email_lib.bb (BL-214) - pure assertions plus
;; fixture-based tests (real fs I/O against a temp dir, fake send-email!
;; adapter - no real network, no real timers, no live daemon).
(ns briefing-email-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

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

;; ── append-content-block (pure, BL-252, generalized for BL-251) ──────────
;; Appends a computed content block (suite-duration trend + BL-078 flag,
;; the needs-approval section, or any future one) after the existing
;; content; a blank/nil block (the source CLI unavailable, not "no data" -
;; each CLI already produces its own non-blank "nothing to report" text for
;; that case) leaves content untouched rather than fabricating anything.
;; Named generically (BL-252 shipped it as append-suite-duration-line; BL-251
;; needed the identical behavior for a second, independent block, so this is
;; a rename, not a new function) - reused as-is by both.

(assert= "a non-blank block is appended after the existing content"
         "Headline\n\nSuite duration trend: 5s latest\n"
         (briefing-email-lib/append-content-block "Headline\n" "Suite duration trend: 5s latest"))

(assert= "a nil block leaves the content untouched"
         "Headline\n"
         (briefing-email-lib/append-content-block "Headline\n" nil))

(assert= "a blank block leaves the content untouched"
         "Headline\n"
         (briefing-email-lib/append-content-block "Headline\n" "   "))

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

;; BL-252: when a :suite-duration-line adapter is supplied, its line reaches
;; the ACTUAL emailed content - the wiring gap this ticket exists to close
;; (a real production caller, not just a tested-but-uncalled formatter).
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :suite-duration-line (fn [] "WARN Suite duration trend: 300s latest ▲")
    :log! (fn [& _] nil)})
  (assert= "BL-252: the suite-duration line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "WARN Suite duration trend: 300s latest ▲"))
  (assert= "BL-252: the original headline is preserved, unaffected by the appended line"
           true
           (str/starts-with? (first @sent-texts) "Headline")))

;; A nil-returning (or absent) :suite-duration-line adapter degrades to the
;; original content unchanged - never an error, never a blank line appended.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :log! (fn [& _] nil)})
  (assert= "BL-252: no :suite-duration-line adapter -> content is unchanged (backward compatible)"
           "Headline\n"
           (first @sent-texts)))

;; BL-251: the needs-approval section reaches the actual sent content too,
;; the same "real production caller, not a tested-but-uncalled formatter"
;; wiring bar BL-252 already established - reusing the SAME append-content-
;; block helper via a second, independent adapter.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :needs-approval-section (fn [] "Needs approval:\n  - BL-100: A ticket")
    :log! (fn [& _] nil)})
  (assert= "BL-251: the needs-approval section reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Needs approval:\n  - BL-100: A ticket")))

;; Both optional sections compose - each independently appended, neither
;; overwriting the other, in adapter-map order.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :suite-duration-line (fn [] "Suite duration trend: 5s latest")
    :needs-approval-section (fn [] "Needs approval:\n  - BL-100: A ticket")
    :log! (fn [& _] nil)})
  (assert= "both the suite-duration line and the needs-approval section land in the same sent content"
           true
           (and (str/includes? (first @sent-texts) "Suite duration trend: 5s latest")
                (str/includes? (first @sent-texts) "Needs approval:\n  - BL-100: A ticket"))))

;; A nil-returning (or absent) :needs-approval-section adapter degrades to
;; the original content unchanged - same graceful-degrade contract as
;; :suite-duration-line.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :needs-approval-section (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-251: a nil-returning :needs-approval-section adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

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

;; ── build-diagram-section (pure, BL-260) ─────────────────────────────────

;; BL-260 rendered-inline-01: available diagrams produce an html body with
;; an inline image per diagram.
(let [section (briefing-email-lib/build-diagram-section
               [{:name "architecture" :base64 "QUJD"} {:name "swarm-flow" :base64 "WFla"}])]
  (assert= "rendered-inline-01: the html section embeds each diagram as an inline data-URI image"
           true
           (and (str/includes? (:html section) "data:image/png;base64,QUJD")
                (str/includes? (:html section) "data:image/png;base64,WFla")))
  (assert= "rendered-inline-01: the note-line points at the rendered-above html view"
           true
           (str/includes? (:note-line section) "rendered inline above")))

;; BL-260 render-unavailable-degradation-04: nil/empty diagrams -> no html,
;; but still a clear, non-blank note - never silence, never a crash.
(assert= "render-unavailable-degradation-04: nil diagrams -> no html body"
         nil
         (:html (briefing-email-lib/build-diagram-section nil)))
(assert= "render-unavailable-degradation-04: nil diagrams -> a clear no-diagram note"
         true
         (str/includes? (:note-line (briefing-email-lib/build-diagram-section nil)) "unavailable"))
(assert= "render-unavailable-degradation-04: an empty diagram list behaves the same as nil"
         nil
         (:html (briefing-email-lib/build-diagram-section [])))

;; ── send-unsent-briefings! + :diagram-section adapter (BL-260) ──────────────

;; BL-260 rendered-inline-01 (wiring): a :diagram-section adapter reaches
;; :send-email! as a 3rd (html) argument, and its note-line reaches the
;; plaintext content exactly like the other optional sections.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-html (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text html] (swap! sent-texts conj text) (swap! sent-html conj html) {:success true})
    :diagram-section (fn [] (briefing-email-lib/build-diagram-section [{:name "architecture" :base64 "QUJD"}]))
    :log! (fn [& _] nil)})
  (assert= "the diagram html reaches the actual :send-email! call"
           true
           (str/includes? (first @sent-html) "data:image/png;base64,QUJD"))
  (assert= "the diagram note-line reaches the plaintext content alongside the headline"
           true
           (and (str/starts-with? (first @sent-texts) "Headline")
                (str/includes? (first @sent-texts) "rendered inline above"))))

;; BL-260 render-unavailable-degradation-04 (wiring): a :diagram-section
;; adapter that reports unavailable still sends - html is nil, and the
;; plaintext note says so, matching build-diagram-section's own contract.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-html (atom [])
      sent (atom nil)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (reset! sent
          (briefing-email-lib/send-unsent-briefings!
           dir
           {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
            :send-email! (fn [_subject text html] (swap! sent-texts conj text) (swap! sent-html conj html) {:success true})
            :diagram-section (fn [] (briefing-email-lib/build-diagram-section nil))
            :log! (fn [& _] nil)}))
  (assert= "render-unavailable-degradation-04: the email still sends (never fails) when rendering is unavailable"
           ["2026-07-09.md"]
           @sent)
  (assert= "render-unavailable-degradation-04: html is nil - a plaintext-only send, exactly as before this ticket"
           nil
           (first @sent-html))
  (assert= "render-unavailable-degradation-04: the plaintext part carries the clear no-diagram note"
           true
           (str/includes? (first @sent-texts) "unavailable")))

;; No :diagram-section adapter at all (every pre-BL-260 caller/test) -> the
;; exact 2-arg :send-email! call, unaffected, no diagram note appended.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text] (swap! sent-texts conj text) {:success true})
    :log! (fn [& _] nil)})
  (assert= "BL-260: no :diagram-section adapter -> content is unchanged (backward compatible)"
           "Headline\n"
           (first @sent-texts)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: briefing_email_lib.bb"))
