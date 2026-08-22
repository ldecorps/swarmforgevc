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

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg))))

(def created-temp-dirs (atom []))
;; BL-459: every temp dir this runner creates is tracked here and removed by
;; a JVM shutdown hook, registered ONCE below - fires on both a clean run
;; and an uncaught assertion/exception propagating out of this script
;; (verified empirically: Runtime/addShutdownHook runs on System/exit and on
;; an uncaught throwable unwinding to the top level), never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that - out of scope
;; here).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "briefing-email-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

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

;; ── BL-392: the headline is bounded and markdown-stripped ────────────────

(def long-lede
  (str "This sentence is intentionally long enough that it will need to be "
       "truncated at eighty characters or fewer for the subject line to stay "
       "readable in an inbox."))

(let [subject (briefing-email-lib/build-briefing-subject "2026-07-14" (str long-lede "\n\nDetails..."))
      headline (subs subject (count "SwarmForge briefing 2026-07-14 - "))
      without-ellipsis (subs headline 0 (dec (count headline)))]
  (assert= "BL-392 subject-bound-01: subject still names the briefing date"
           true
           (str/starts-with? subject "SwarmForge briefing 2026-07-14 - "))
  (assert= "BL-392 subject-bound-01: a long lede's headline is bounded to <=80 chars"
           true
           (<= (count headline) 80))
  (assert= "BL-392 subject-bound-01: the bounded headline ends with a single-character ellipsis"
           true
           (str/ends-with? headline "…"))
  (assert= "BL-392 subject-bound-01: the truncated text is an unaltered prefix of the source line"
           true
           (str/starts-with? long-lede without-ellipsis))
  (assert= "BL-392 subject-bound-01: the cut lands right before a space in the source - a word boundary, not mid-word"
           true
           (or (= (count without-ellipsis) (count long-lede))
               (= \space (.charAt long-lede (count without-ellipsis))))))

;; bound-headline's own docstring names a second branch this scenario never
;; exercises: "a pathological headline with no space within budget (one
;; unbroken long token) falls back to a hard cut - there is no word boundary
;; to prefer." subject-bound-01 above always has clean word boundaries, so
;; the `(and last-space (pos? last-space))` check's ELSE arm - the hard-cut
;; fallback - had zero coverage until now.
(let [one-long-token (apply str (repeat 100 "a"))
      subject (briefing-email-lib/build-briefing-subject "2026-07-14" one-long-token)
      headline (subs subject (count "SwarmForge briefing 2026-07-14 - "))]
  (assert= "BL-392 bound-headline hard-cut: a single unbroken token with no word boundary is still bounded to <=80 chars"
           true
           (<= (count headline) 80))
  (assert= "BL-392 bound-headline hard-cut: it still ends with a single-character ellipsis"
           true
           (str/ends-with? headline "…"))
  (assert= "BL-392 bound-headline hard-cut: falls back to a hard cut at the budget boundary (79 chars + ellipsis), not a word-boundary cut"
           (str (apply str (repeat 79 "a")) "…")
           headline))

(assert= "BL-392 subject-bound-02: bold/heading markdown markers are stripped from the headline"
         "SwarmForge briefing 2026-07-14 - Ship the release"
         (briefing-email-lib/build-briefing-subject "2026-07-14" "# **Ship the release**\n\nDetails..."))

(assert= "BL-392 subject-bound-02: backtick and underscore emphasis markers are stripped too"
         "SwarmForge briefing 2026-07-14 - Ship code and italics"
         (briefing-email-lib/build-briefing-subject "2026-07-14" "Ship `code` and _italics_\n\nDetails..."))

(assert= "BL-392 subject-bound-03: a headline already within the limit passes through unchanged"
         "SwarmForge briefing 2026-07-14 - Shipped BL-215"
         (briefing-email-lib/build-briefing-subject "2026-07-14" "Shipped BL-215\n\nDetails..."))

(let [subject (briefing-email-lib/build-briefing-subject "2026-07-14" "Shipped BL-215\n\nDetails...")]
  (assert= "BL-392 subject-bound-03: a short headline carries no ellipsis"
           false
           (str/includes? subject "…")))

(assert= "BL-392 subject-bound-04: an empty briefing still yields a date-only subject, no dangling separator"
         "SwarmForge briefing 2026-07-14"
         (briefing-email-lib/build-briefing-subject "2026-07-14" ""))

(assert= "BL-392: a headline that is markdown syntax only strips down to nothing - no dangling separator"
         "SwarmForge briefing 2026-07-14"
         (briefing-email-lib/build-briefing-subject "2026-07-14" "**  **\n\nDetails..."))

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

;; ── prepend-content-block / maybe-mark-subject (pure, BL-619) ────────────

(assert= "a non-blank block is prepended before the existing content"
         "TOKEN BURN WARNING: run out Thursday\n\nHeadline\n"
         (briefing-email-lib/prepend-content-block "Headline\n" "TOKEN BURN WARNING: run out Thursday"))

(assert= "a nil block leaves the content untouched (prepend)"
         "Headline\n"
         (briefing-email-lib/prepend-content-block "Headline\n" nil))

(assert= "a blank block leaves the content untouched (prepend)"
         "Headline\n"
         (briefing-email-lib/prepend-content-block "Headline\n" "   "))

(assert= "maybe-mark-subject prefixes the fixed marker when true"
         "[TOKEN BURN WARNING] SwarmForge briefing 2026-07-09 - Shipped BL-215"
         (briefing-email-lib/maybe-mark-subject "SwarmForge briefing 2026-07-09 - Shipped BL-215" true))

(assert= "maybe-mark-subject leaves the subject unchanged when false"
         "SwarmForge briefing 2026-07-09 - Shipped BL-215"
         (briefing-email-lib/maybe-mark-subject "SwarmForge briefing 2026-07-09 - Shipped BL-215" false))

(assert= "maybe-mark-subject leaves the subject unchanged when nil"
         "SwarmForge briefing 2026-07-09 - Shipped BL-215"
         (briefing-email-lib/maybe-mark-subject "SwarmForge briefing 2026-07-09 - Shipped BL-215" nil))

;; ── send-unsent-briefings! + :token-burn-section adapter (BL-619) ────────

;; warning-leads-briefing-01: a leading warning is prepended ABOVE the
;; coordinator body, the subject carries the fixed marker, and the subject's
;; own headline still names the real body content, not the warning.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-subjects (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Shipped BL-215\n\nDetails...\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [subject text & _] (swap! sent-subjects conj subject) (swap! sent-texts conj text) {:success true})
    :token-burn-section (fn [] {:leading-text "TOKEN BURN WARNING: run out Thursday" :subject-marker? true})
    :log! (fn [& _] nil)})
  (assert= "warning-leads-briefing-01: the leading warning is the very first thing in the sent content"
           true
           (str/starts-with? (first @sent-texts) "TOKEN BURN WARNING: run out Thursday"))
  (assert= "warning-leads-briefing-01: the coordinator body still follows, unaltered"
           true
           (str/includes? (first @sent-texts) "Shipped BL-215"))
  (assert= "warning-leads-briefing-01: the subject carries the fixed token-burn marker"
           true
           (str/starts-with? (first @sent-subjects) "[TOKEN BURN WARNING] "))
  (assert= "warning-leads-briefing-01: the subject's own headline still names the real body, not the warning"
           "[TOKEN BURN WARNING] SwarmForge briefing 2026-07-09 - Shipped BL-215"
           (first @sent-subjects)))

;; ok-path-one-line-status-03: the ok/no-anchor/malformed one-liner joins the
;; appended sections instead - no leading text, no subject marker.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-subjects (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [subject text & _] (swap! sent-subjects conj subject) (swap! sent-texts conj text) {:success true})
    :token-burn-section (fn [] {:appended-text "Token burn: on track (~4.8%/day)" :subject-marker? false})
    :log! (fn [& _] nil)})
  (assert= "ok-path-one-line-status-03: the status line is appended, not prepended"
           true
           (str/starts-with? (first @sent-texts) "Headline"))
  (assert= "ok-path-one-line-status-03: the status line reaches the sent content"
           true
           (str/includes? (first @sent-texts) "Token burn: on track (~4.8%/day)"))
  (assert= "ok-path-one-line-status-03: no subject marker is added"
           "SwarmForge briefing 2026-07-09 - Headline"
           (first @sent-subjects)))

;; A nil-returning (or absent) :token-burn-section adapter degrades to the
;; original content unchanged - same graceful-degrade contract as every
;; other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :token-burn-section (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-619: a nil-returning :token-burn-section adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :log! (fn [& _] nil)})
  (assert= "BL-619: no :token-burn-section adapter at all -> content is unchanged (backward compatible)"
           "Headline\n"
           (first @sent-texts)))

;; section-failure-never-blocks-send-09: the adapter contract is the SAME
;; try/catch-at-the-caller posture every *-briefing-section fn in
;; handoffd.bb already uses (a throw there degrades to nil before it ever
;; reaches this library) - proven here by the "absent adapter" case above,
;; the exact shape a failed CLI shell-out degrades to.

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
               :send-email! (fn [_subject _text & _] {:success true})
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
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
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
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
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
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :needs-approval-section (fn [] "Needs approval:\n  - BL-100: A ticket")
    :log! (fn [& _] nil)})
  (assert= "BL-251: the needs-approval section reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Needs approval:\n  - BL-100: A ticket")))

;; BL-263: the not-done-count line reaches the actual sent content too, the
;; same real-production-caller wiring bar established above.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :not-done-count-line (fn [] "Not done: 7 tickets")
    :log! (fn [& _] nil)})
  (assert= "BL-263: the not-done-count line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Not done: 7 tickets")))

;; A nil-returning (or absent) :not-done-count-line adapter degrades to the
;; original content unchanged - same graceful-degrade contract as every
;; other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :not-done-count-line (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-263: a nil-returning :not-done-count-line adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

;; BL-337: the standing-rule-violations line reaches the actual sent
;; content too, the same real-production-caller wiring bar established
;; above for every other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :standing-rule-violations-line (fn [] "Standing-rule violations: 111 cited recurrence(s) across 73 rule(s).")
    :log! (fn [& _] nil)})
  (assert= "BL-337: the standing-rule-violations line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Standing-rule violations: 111 cited recurrence(s)")))

;; A nil-returning (or absent) :standing-rule-violations-line adapter
;; degrades to the original content unchanged - same graceful-degrade
;; contract as every other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :standing-rule-violations-line (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-337: a nil-returning :standing-rule-violations-line adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

;; BL-431: the suboptimality-verdict line reaches the actual sent content
;; too, the same real-production-caller wiring bar established above for
;; every other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :suboptimality-verdict-line (fn [] "Suboptimality verdict: rework rate 60% (baseline 20%) - likely cause: role hardener.")
    :log! (fn [& _] nil)})
  (assert= "BL-431: the suboptimality-verdict line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Suboptimality verdict: rework rate 60%")))

;; A nil-returning (or absent) :suboptimality-verdict-line adapter degrades
;; to the original content unchanged - same graceful-degrade contract as
;; every other optional section (and the CLI itself returns nothing when
;; there is no verdict, so this is also the everyday healthy-pipeline path).
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :suboptimality-verdict-line (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-431: a nil-returning :suboptimality-verdict-line adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

;; Both optional sections compose - each independently appended, neither
;; overwriting the other, in adapter-map order.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
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
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
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
               :send-email! (fn [_s _t & _] (swap! send-calls inc) {:success true})
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
               :send-email! (fn [_s _t & _] {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"})
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
    :send-email! (fn [_s _t & _] {:success false :reason :disabled :error "email not configured (notify_email_to unset)"})
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
    :send-email! (fn [_s _t & _] {:success false :error "network error"})
    :log! (fn [& _] nil)})
  (assert= "a real send failure is not marked sent - retried next sweep"
           #{}
           (briefing-email-lib/load-sent-briefings dir)))

;; ── send-unsent-briefings! + :send-reason! adapter (BL-902) ──────────────
;; BL-902: an optional :send-reason! adapter, consulted BEFORE any section
;; is gathered, lets an undeliverable sweep skip the entire expensive
;; compose - the fix for the ~96s-per-cycle stall this ticket describes.
;; Mirrors the qa_e2e_procedure scenarios in BL-902's own ticket.

;; scenario 1 (THE REGRESSION) / scenario 2 (NO GATHERING): with
;; :send-reason! reporting :missing-api-key, every section adapter -
;; including :read-briefing-content itself - is never invoked, and the
;; expected briefing-skip-missing-key line is still logged.
(let [dir (mk-tmp)
      calls (atom [])
      log-calls (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (let [sent (briefing-email-lib/send-unsent-briefings!
              dir
              {:send-reason! (fn [] :missing-api-key)
               :read-briefing-content (fn [f] (swap! calls conj :read) (slurp (str (fs/path dir f))))
               :suite-duration-line (fn [] (swap! calls conj :suite-duration) "line")
               :diagram-section (fn [] (swap! calls conj :diagram) {:html "<img/>" :note-line "note"})
               :token-burn-section (fn [] (swap! calls conj :token-burn) {:appended-text "x"})
               :send-email! (fn [& _] (throw (ex-info "must never be called - send-reason! already said undeliverable" {})))
               :log! (fake-log! log-calls)})]
    (assert= "BL-902 no-gathering-02: nothing is sent when :send-reason! reports undeliverable" [] sent)
    (assert= "BL-902 no-gathering-02: zero section/content adapters are invoked before the skip"
             []
             @calls)
    (assert= "BL-902: the same briefing-skip-missing-key line is logged as the pre-BL-902 path"
             [["briefing-skip-missing-key" "2026-07-09.md"]]
             @log-calls)))

;; :disabled reaches the same zero-gathering, correctly-keyed skip.
(let [dir (mk-tmp)
      calls (atom [])
      log-calls (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:send-reason! (fn [] :disabled)
    :read-briefing-content (fn [f] (swap! calls conj :read) (slurp (str (fs/path dir f))))
    :send-email! (fn [& _] (throw (ex-info "must never be called" {})))
    :log! (fake-log! log-calls)})
  (assert= "BL-902: a :disabled :send-reason! also skips before any gathering" [] @calls)
  (assert= "BL-902: the same briefing-skip-disabled line is logged as the pre-BL-902 path"
           [["briefing-skip-disabled" "2026-07-09.md"]]
           @log-calls))

;; scenario 3 (INVARIANT 3, UNCHANGED OUTCOME): the briefing stays NOT
;; marked sent after an early skip, and is picked up again on a second
;; sweep - same retry contract as the pre-BL-902 skip path.
(let [dir (mk-tmp)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:send-reason! (fn [] :missing-api-key)
    :send-email! (fn [& _] (throw (ex-info "must never be called" {})))
    :log! (fn [& _] nil)})
  (assert= "BL-902 unchanged-outcome-03: not marked sent after an early skip"
           #{}
           (briefing-email-lib/load-sent-briefings dir))
  (assert= "BL-902 unchanged-outcome-03: still picked up as unsent on a second sweep"
           ["2026-07-09.md"]
           (briefing-email-lib/find-unsent-briefings dir)))

;; scenario 4 (HAPPY PATH UNTOUCHED): a sendable :send-reason! (nil) does
;; not short-circuit anything - the full compose still runs, every section
;; still reaches the sent content, and the briefing is marked sent exactly
;; once, unaffected by the adapter's mere presence.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (let [sent (briefing-email-lib/send-unsent-briefings!
              dir
              {:send-reason! (fn [] nil)
               :read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
               :suite-duration-line (fn [] "Suite duration trend: 5s latest")
               :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
               :log! (fn [& _] nil)})]
    (assert= "BL-902 happy-path-04: the briefing is still composed and sent exactly once" ["2026-07-09.md"] sent)
    (assert= "BL-902 happy-path-04: an optional section still reaches the sent content"
             true
             (str/includes? (first @sent-texts) "Suite duration trend: 5s latest"))))

;; scenario 5 (WARNING NOT SPAMMED, library half): the one-shot dedup
;; itself lives in the injected :send-reason! adapter (handoffd.bb's
;; briefing-send-reason! owns the real warn-missing-key-if-needed! wiring -
;; see test_handoffd_briefing_email_wiring.sh) - this proves only that
;; send-unsent-briefings! calls :send-reason! exactly once per unsent
;; briefing per sweep, never more, so a caller's own one-shot guard is
;; never bypassed by a hidden extra invocation.
(let [dir (mk-tmp)
      reason-calls (atom 0)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:send-reason! (fn [] (swap! reason-calls inc) :missing-api-key)
    :send-email! (fn [& _] (throw (ex-info "must never be called" {})))
    :log! (fn [& _] nil)})
  (assert= "BL-902 warning-not-spammed-05: :send-reason! is consulted exactly once per unsent briefing"
           1
           @reason-calls))

;; Backward compatibility: no :send-reason! adapter at all -> the original
;; always-compose-then-send path runs unchanged (every pre-BL-902
;; caller/test above already proves this; this makes the contract explicit).
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :log! (fn [& _] nil)})
  (assert= "BL-902: no :send-reason! adapter -> the original compose-then-send path runs unaffected"
           "Headline\n"
           (first @sent-texts)))

;; ── build-diagram-section (pure, BL-260 / BL-286) ────────────────────────

;; BL-286 diagram-cid-01: available diagrams are referenced by a cid image
;; source, never a data-URI (Gmail blocks data-URI image sources - the
;; defect this ticket fixes).
(let [section (briefing-email-lib/build-diagram-section
               [{:name "architecture" :base64 "QUJD"} {:name "swarm-flow" :base64 "WFla"}])]
  (assert= "diagram-cid-01: each diagram is referenced by a cid image source"
           true
           (and (str/includes? (:html section) "cid:architecture-diagram")
                (str/includes? (:html section) "cid:swarm-flow-diagram")))
  (assert= "diagram-cid-01: the html contains no data-URI image source"
           false
           (str/includes? (:html section) "data:image"))
  (assert= "rendered-inline-01: the note-line points at the rendered-above html view"
           true
           (str/includes? (:note-line section) "rendered inline above")))

;; Open-ticket chart shares the same cid-PNG path with a readable heading.
;; BL-896 bounce 2026-08-17: the 2026-08-16 08:20 CEST human ruling
;; explicitly overrides the F1 rename recommendation and keeps the word
;; "burndown" in the heading and note-line
;; (backlog/answers-archive/ANSWER-BL-896-land-burndown-chart.md).
(let [section (briefing-email-lib/build-diagram-section
               [{:name "architecture" :base64 "QUJD"}
                {:name "not-done-burndown" :base64 "Wk9P"}])]
  (assert= "burndown-diagram-01: not-done burndown is referenced by cid"
           true
           (str/includes? (:html section) "cid:not-done-burndown-diagram"))
  (assert= "burndown-diagram-01: heading is human-readable and keeps \"burndown\" per the human ruling"
           true
           (and (str/includes? (:html section) "<h3>")
                (str/includes? (str/lower-case (:html section)) "burndown")
                (str/includes? (str/lower-case (:html section)) "open tickets remaining")))
  (assert= "burndown-diagram-01: note mentions both architecture and the open-ticket burndown chart"
           true
           (and (str/includes? (:note-line section) "Architecture")
                (str/includes? (:note-line section) "open-ticket")
                (str/includes? (str/lower-case (:note-line section)) "burndown"))))

;; BL-286 diagram-cid-02/03: each referenced diagram carries a matching
;; inline attachment, with the image bytes and a filename.
(let [section (briefing-email-lib/build-diagram-section
               [{:name "architecture" :base64 "QUJD"} {:name "swarm-flow" :base64 "WFla"}])
      attachments (:attachments section)]
  (assert= "diagram-cid-02: one attachment per referenced diagram"
           2
           (count attachments))
  (assert= "diagram-cid-02: each attachment's content-id matches the cid that references it"
           true
           (and (str/includes? (:html section) (str "cid:" (:content-id (first attachments))))
                (str/includes? (:html section) (str "cid:" (:content-id (second attachments))))))
  (assert= "diagram-cid-03: each attachment carries the diagram's image bytes and a filename"
           [{:filename "architecture-diagram.png" :content-id "architecture-diagram" :base64 "QUJD"}
            {:filename "swarm-flow-diagram.png" :content-id "swarm-flow-diagram" :base64 "WFla"}]
           attachments))

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
(assert= "diagram-cid-04: nil diagrams -> no :attachments key at all"
         false
         (contains? (briefing-email-lib/build-diagram-section nil) :attachments))

;; ── send-unsent-briefings! + :diagram-section adapter (BL-260 / BL-286) ──────

;; BL-286 diagram-cid-02/03 (wiring): a :diagram-section adapter with
;; available diagrams reaches :send-email! as a 4th (attachments) argument
;; alongside html, and its note-line reaches the plaintext content exactly
;; like the other optional sections.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-html (atom [])
      sent-attachments (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text html attachments]
                   (swap! sent-texts conj text)
                   (swap! sent-html conj html)
                   (swap! sent-attachments conj attachments)
                   {:success true})
    :diagram-section (fn [] (briefing-email-lib/build-diagram-section [{:name "architecture" :base64 "QUJD"}]))
    :log! (fn [& _] nil)})
  (assert= "the diagram html reaches the actual :send-email! call, referencing the cid"
           true
           (str/includes? (first @sent-html) "cid:architecture-diagram"))
  (assert= "BL-393 body-html-04: the html also carries the rendered briefing body alongside the diagram - neither replaces the other"
           true
           (str/includes? (first @sent-html) "<p>Headline</p>"))
  (assert= "the diagram attachments reach the actual :send-email! call"
           [{:filename "architecture-diagram.png" :content-id "architecture-diagram" :base64 "QUJD"}]
           (first @sent-attachments))
  (assert= "the diagram note-line reaches the plaintext content alongside the headline"
           true
           (and (str/starts-with? (first @sent-texts) "Headline")
                (str/includes? (first @sent-texts) "rendered inline above"))))

;; BL-286 diagram-cid-04 (wiring): a :diagram-section adapter that reports
;; unavailable still sends - no attachments are passed (only the 3-arg
;; :send-email! call is made, matching build-diagram-section's own
;; no-:attachments-key contract), and the plaintext note says so.
;; BL-393 body-html-05: html is no longer nil here - it now carries the
;; rendered briefing body (there is simply no diagram content to merge into
;; it), so a run with no diagrams still sends the rendered body as html.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-args (atom [])
      sent (atom nil)]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (reset! sent
          (briefing-email-lib/send-unsent-briefings!
           dir
           {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
            :send-email! (fn [& args] (swap! sent-texts conj (second args)) (swap! sent-args conj args) {:success true})
            :diagram-section (fn [] (briefing-email-lib/build-diagram-section nil))
            :log! (fn [& _] nil)}))
  (assert= "render-unavailable-degradation-04: the email still sends (never fails) when rendering is unavailable"
           ["2026-07-09.md"]
           @sent)
  (assert= "diagram-cid-04: its send payload carries no attachments - only html (3-arg) is passed"
           3
           (count (first @sent-args)))
  (assert= "BL-393 body-html-05: html carries the rendered body (plus the plaintext-mirrored no-diagram note) even with no diagrams available"
           "<p>Headline</p><p>Architecture diagrams: unavailable this run (renderer not installed) - see docs/diagrams/ in the repo.</p>"
           (nth (first @sent-args) 2))
  (assert= "BL-393: no diagram reference leaks into the html when rendering is unavailable"
           false
           (str/includes? (nth (first @sent-args) 2) "cid:"))
  (assert= "render-unavailable-degradation-04: the plaintext part carries the clear no-diagram note"
           true
           (str/includes? (first @sent-texts) "unavailable")))

;; BL-393 diagram-cid-05 (updated - the shipped contract this ticket named
;; explicitly): no :diagram-section adapter at all -> the send payload now
;; ALWAYS carries html (the rendered body) as a 3rd arg, but still never
;; carries attachments. The old "neither html nor attachments" claim
;; predates BL-393; html is no longer conditional on a diagram section.
(let [dir (mk-tmp)
      sent-texts (atom [])
      sent-args (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [& args] (swap! sent-texts conj (second args)) (swap! sent-args conj args) {:success true})
    :log! (fn [& _] nil)})
  (assert= "BL-260: no :diagram-section adapter -> content is unchanged (backward compatible)"
           "Headline\n"
           (first @sent-texts))
  (assert= "diagram-cid-05: no :diagram-section adapter -> the send payload carries html (the rendered body) but no attachments arg"
           3
           (count (first @sent-args)))
  (assert= "diagram-cid-05: the html arg is the rendered body, not nil"
           "<p>Headline</p>"
           (nth (first @sent-args) 2)))

;; render-markdown-to-html's own pure tests live in
;; markdown_to_html_test_runner.bb (BL-393 cleaner extraction) - it moved to
;; its own module (markdown_to_html_lib.bb), so its tests moved with it.

;; BL-454: the qa-bounce line reaches the actual sent content too, the same
;; real-production-caller wiring bar established above for every other
;; optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :qa-bounce-line (fn [] "QA bounces: 3 total - by role: coder x2, architect x1 - by ticket type: feature x2, bug x1")
    :log! (fn [& _] nil)})
  (assert= "BL-454: the qa-bounce line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "QA bounces: 3 total")))

;; A nil-returning (or absent) :qa-bounce-line adapter degrades to the
;; original content unchanged - same graceful-degrade contract as every
;; other optional section (and the CLI itself returns nothing when there
;; are no recorded bounces yet, so this is also the everyday pre-backfill
;; path).
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :qa-bounce-line (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-454: a nil-returning :qa-bounce-line adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

;; BL-511: the Telegram bridge-cost line reaches the actual sent content
;; too, the same real-production-caller wiring bar established above for
;; every other optional section.
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :telegram-bridge-cost-line (fn [] "Telegram bridge cost: $0.06 today (1 front-desk call, Operator $0.02 attributed)")
    :log! (fn [& _] nil)})
  (assert= "BL-511: the Telegram bridge-cost line reaches the actual sent content"
           true
           (str/includes? (first @sent-texts) "Telegram bridge cost: $0.06 today")))

;; A nil-returning (or absent) :telegram-bridge-cost-line adapter degrades to
;; the original content unchanged - same graceful-degrade contract as every
;; other optional section (and the CLI itself returns nothing on a
;; no-activity, absent, or unreadable log, so this is also the everyday
;; no-Telegram-activity path).
(let [dir (mk-tmp)
      sent-texts (atom [])]
  (spit (str (fs/path dir "2026-07-09.md")) "Headline\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] (swap! sent-texts conj text) {:success true})
    :telegram-bridge-cost-line (fn [] nil)
    :log! (fn [& _] nil)})
  (assert= "BL-511: a nil-returning :telegram-bridge-cost-line adapter leaves content unchanged"
           "Headline\n"
           (first @sent-texts)))

;; ── BL-821 Leg B: briefing-date-label / briefing-in-window? (pure, no clock) ─

(assert= "BL-821: a plain YYYY-MM-DD.md name is its own date label"
         "2026-08-17" (briefing-email-lib/briefing-date-label "2026-08-17.md"))
(assert= "BL-821: a name with a suffix beyond the date has no date label (decided deliberately, not treated as dated)"
         nil (briefing-email-lib/briefing-date-label "2026-07-30-evening.md"))
(assert= "BL-821: a name with no date at all has no date label"
         nil (briefing-email-lib/briefing-date-label "README.md"))

(assert= "BL-821: today is in the window" true (briefing-email-lib/briefing-in-window? "2026-08-17.md" "2026-08-17"))
(assert= "BL-821: yesterday is in the window" true (briefing-email-lib/briefing-in-window? "2026-08-16.md" "2026-08-17"))
(assert= "BL-821: two days ago is outside the window" false (briefing-email-lib/briefing-in-window? "2026-08-15.md" "2026-08-17"))
(assert= "BL-821: a month ago is outside the window" false (briefing-email-lib/briefing-in-window? "2026-07-17.md" "2026-08-17"))
(assert= "BL-821: tomorrow (a clock-skew/malformed edge, not a real briefing) is outside the window, never negative-days-old admitted"
         false (briefing-email-lib/briefing-in-window? "2026-08-18.md" "2026-08-17"))
(assert= "BL-821: a suffixed name is never mailed by the window (out-of-scope note: decided deliberately, not crashed on)"
         false (briefing-email-lib/briefing-in-window? "2026-07-30-evening.md" "2026-08-17"))
(assert= "BL-821: a malformed today-str fails closed rather than throwing"
         false (briefing-email-lib/briefing-in-window? "2026-08-17.md" "not-a-date"))

(assert= "BL-821: partition-by-window splits mailable vs suppressed, preserving order"
         {:mailable ["2026-08-16.md" "2026-08-17.md"] :suppressed ["2026-07-17.md" "2026-07-30-evening.md"]}
         (briefing-email-lib/partition-by-window
          ["2026-07-17.md" "2026-07-30-evening.md" "2026-08-16.md" "2026-08-17.md"]
          "2026-08-17"))

;; ── BL-821 Leg B wiring: send-unsent-briefings! ─────────────────────────────

(let [dir (mk-tmp)
      sent (atom [])
      logs (atom [])]
  (spit (str (fs/path dir "2026-07-01.md")) "old\n")
  (spit (str (fs/path dir "2026-08-17.md")) "today\n")
  (let [result (briefing-email-lib/send-unsent-briefings!
                dir
                {:today-str "2026-08-17"
                 :read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
                 :send-email! (fn [_subject text & _] (swap! sent conj text) {:success true})
                 :log! (fn [& parts] (swap! logs conj (vec parts)))})]
    (assert= "BL-821: only the in-window briefing is sent when :today-str is supplied"
             ["2026-08-17.md"] result)
    (assert-true "BL-821: the suppressed briefing is reported, distinguishable from no briefing at all"
                 (some #(= % ["briefing-suppressed-outside-window" "2026-07-01.md"]) @logs))))

(let [dir (mk-tmp)
      sent (atom [])]
  (spit (str (fs/path dir "2026-07-01.md")) "old\n")
  (spit (str (fs/path dir "2026-08-17.md")) "today\n")
  (let [result (briefing-email-lib/send-unsent-briefings!
                dir
                {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
                 :send-email! (fn [_subject text & _] (swap! sent conj text) {:success true})
                 :log! (fn [& _] nil)})]
    (assert= "BL-821: omitting :today-str leaves every unsent file mailable (backward compatible with every pre-BL-821 caller)"
             ["2026-07-01.md" "2026-08-17.md"] result)))

;; ── BL-821 Leg A wiring: :commit-marker! ────────────────────────────────────

(let [dir (mk-tmp)
      commit-calls (atom [])]
  (spit (str (fs/path dir "2026-08-17.md")) "today\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] {:success true})
    :commit-marker! (fn [briefings-dir] (swap! commit-calls conj briefings-dir) {:ok true})
    :log! (fn [& _] nil)})
  (assert= "BL-821: :commit-marker! is called once, with briefings-dir, after a successful send"
           [dir] @commit-calls))

(let [dir (mk-tmp)
      commit-calls (atom [])]
  (spit (str (fs/path dir "2026-08-17.md")) "today\n")
  (briefing-email-lib/send-unsent-briefings!
   dir
   {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
    :send-email! (fn [_subject text & _] {:success false :reason :missing-api-key :error "no key"})
    :commit-marker! (fn [briefings-dir] (swap! commit-calls conj briefings-dir) {:ok true})
    :log! (fn [& _] nil)})
  (assert= "BL-821: :commit-marker! is never called on a failed/skipped send"
           [] @commit-calls))

(let [dir (mk-tmp)
      logs (atom [])]
  (spit (str (fs/path dir "2026-08-17.md")) "today\n")
  (let [result (briefing-email-lib/send-unsent-briefings!
                dir
                {:read-briefing-content (fn [f] (slurp (str (fs/path dir f))))
                 :send-email! (fn [_subject text & _] {:success true})
                 :commit-marker! (fn [_] {:ok false :reason "simulated git failure"})
                 :log! (fn [& parts] (swap! logs conj (vec parts)))})]
    (assert= "BL-821: a send is still recorded as sent even when the durable-store commit fails"
             ["2026-08-17.md"] result)
    (assert-true "BL-821: a commit failure is reported via :log!"
                 (some #(= (first %) "briefing-marker-commit-failed") @logs))))

;; ── BL-821 Leg A: commit-sent-marker! (injected sh-fn, no real git process) ─

(let [dir (mk-tmp)
      calls (atom [])
      sh-fn (fn [repo-dir & args]
              (swap! calls conj (vec (cons repo-dir args)))
              {:exit 0 :out "" :err ""})]
  (spit (str (fs/path dir ".sent.json")) "{}")
  (let [result (briefing-email-lib/commit-sent-marker! dir sh-fn)
        add-call (first @calls)
        commit-call (second @calls)
        marker-path (briefing-email-lib/sent-state-path dir)]
    (assert= "BL-821: a clean add+commit reports ok" {:ok true} result)
    (assert= "BL-821: git add is scoped to exactly the marker path, nothing else, run inside briefings-dir"
             [dir "git" "add" "--" marker-path]
             add-call)
    (assert= "BL-821: git commit is scoped to exactly the marker path too, never a broad `git commit -a`"
             ["--" marker-path]
             (take-last 2 commit-call))))

(let [dir (mk-tmp)
      sh-fn (fn [_repo-dir & args]
              (if (= (second args) "add")
                {:exit 1 :out "" :err "fatal: add failed"}
                {:exit 0 :out "" :err ""}))]
  (assert-true "BL-821: a git add failure is reported, never thrown"
               (not (:ok (briefing-email-lib/commit-sent-marker! dir sh-fn)))))

(let [dir (mk-tmp)
      sh-fn (fn [_repo-dir & args]
              (if (= (second args) "commit")
                {:exit 1 :out "" :err "nothing to commit, working tree clean"}
                {:exit 0 :out "" :err ""}))]
  (assert= "BL-821: \"nothing to commit\" (a racing second host already committed the same content) is ok, not a failure"
           {:ok true :reason :nothing-to-commit}
           (briefing-email-lib/commit-sent-marker! dir sh-fn)))

(let [dir (mk-tmp)
      sh-fn (fn [_repo-dir & args]
              (if (= (second args) "commit")
                {:exit 1 :out "On branch main\nUntracked files:\n\t(use \"git add\" to track)\n\nnothing added to commit but untracked files present (use \"git add\" to track)\n" :err ""}
                {:exit 0 :out "" :err ""}))]
  (assert= "BL-821: git's OTHER \"nothing to commit\" phrasing - printed instead of \"working tree clean\" whenever ANY untracked file exists anywhere else in the repo, which real-fixture testing found is the common case for this chronically-not-pristine checkout - is ok too, not a failure"
           {:ok true :reason :nothing-to-commit}
           (briefing-email-lib/commit-sent-marker! dir sh-fn)))

(let [dir (mk-tmp)
      sh-fn (fn [_repo-dir & args]
              (if (= (second args) "commit")
                {:exit 1 :out "" :err "fatal: unable to lock ref"}
                {:exit 0 :out "" :err ""}))]
  (assert-true "BL-821: a real git commit failure is reported, never thrown"
               (not (:ok (briefing-email-lib/commit-sent-marker! dir sh-fn)))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: briefing_email_lib.bb"))
