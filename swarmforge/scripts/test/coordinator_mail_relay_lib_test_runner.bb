#!/usr/bin/env bb
;; TDD runner for coordinator_mail_relay_lib.bb (BL-1847) - pure assertions
;; over injected parcel/line data, mirroring coordinator_config_test_runner.bb's
;; own shape.
(ns coordinator-mail-relay-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "coordinator_mail_relay_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; A tiny stand-in for chase_sweep_lib.bb/extract-ticket-id (the real fn is
;; injected by handoffd.bb at the live call site - never re-implemented
;; here): leading "BL-<digits>" or "GH-<digits>", case-insensitive.
(defn- fake-extract-ticket-id [text]
  (when text
    (some->> (re-find #"(?i)\b(BL|GH)-?(\d+)\b" text)
             rest
             (apply format "%s-%s")
             clojure.string/upper-case)))

;; ── relay-line ────────────────────────────────────────────────────────────

(assert= "relay-line (note with message header): sender, type, ticket, message, filename"
         "QA note BL-1839: BL-1839 approved 38bc0b69e1 [f1.handoff]"
         (coordinator-mail-relay-lib/relay-line
          {:headers {"from" "QA" "type" "note" "message" "BL-1839 approved 38bc0b69e1"} :body ""}
          "f1.handoff" fake-extract-ticket-id))

(assert= "relay-line (note with no message header): falls back to the body's own first line"
         "coordinator note BL-1857: BL-1857 no parcel in flight [f2.handoff]"
         (coordinator-mail-relay-lib/relay-line
          {:headers {"from" "coordinator" "type" "note"} :body "BL-1857 no parcel in flight\n"}
          "f2.handoff" fake-extract-ticket-id))

(assert= "relay-line (git_handoff, no message/body): falls back to task/commit"
         "specifier git_handoff BL-1857: BL-1857 abcdef1234 [f3.handoff]"
         (coordinator-mail-relay-lib/relay-line
          {:headers {"from" "specifier" "type" "git_handoff" "task" "BL-1857" "commit" "abcdef1234"} :body ""}
          "f3.handoff" fake-extract-ticket-id))

(assert= "relay-line: no ticket id in either field is simply omitted, not a crash"
         "coordinator note: an unticketed observation [f4.handoff]"
         (coordinator-mail-relay-lib/relay-line
          {:headers {"from" "coordinator" "type" "note"} :body "an unticketed observation"}
          "f4.handoff" fake-extract-ticket-id))

(assert= "relay-line: only the FIRST line of a multi-line message is used"
         "QA note BL-1839: BL-1839 first line only [f5.handoff]"
         (coordinator-mail-relay-lib/relay-line
          {:headers {"from" "QA" "type" "note" "message" "BL-1839 first line only\nsecond line never appears"} :body ""}
          "f5.handoff" fake-extract-ticket-id))

;; ── relay-text ────────────────────────────────────────────────────────────

(assert= "relay-text: every line fits - joined verbatim, kept = total"
         {:text "a\nb\nc" :kept 3}
         (coordinator-mail-relay-lib/relay-text ["a" "b" "c"]))

(assert= "relay-text: zero lines - empty text, kept 0"
         {:text "" :kept 0}
         (coordinator-mail-relay-lib/relay-text []))

(let [lines (repeat 200 (apply str (repeat 50 "x")))
      {:keys [text kept]} (coordinator-mail-relay-lib/relay-text lines)]
  (assert-true "relay-text: an overflowing batch stays within Telegram's char limit"
               (<= (count text) coordinator-mail-relay-lib/telegram-char-limit))
  (assert-true "relay-text: an overflowing batch keeps fewer than the full count"
               (< kept 200))
  (assert-true "relay-text: an overflowing batch's trailer names how many were held back"
               (clojure.string/includes? text (str "and " (- 200 kept) " more"))))

(let [{:keys [text kept]} (coordinator-mail-relay-lib/relay-text
                            [(apply str (repeat 5000 "x"))])]
  (assert= "relay-text: a single line that alone exceeds the limit is still sent once, never dropped"
           1 kept)
  (assert-true "relay-text: that single oversized line is sent un-truncated"
               (= 5000 (count text))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "coordinator_mail_relay_lib_test_runner: ok")
