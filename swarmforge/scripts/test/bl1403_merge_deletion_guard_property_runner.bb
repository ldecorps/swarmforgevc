#!/usr/bin/env bb
;; BL-1403 property test (coder-authored, two DECLARED invariants) over the
;; REAL check_merge_deletion.sh - run as a subprocess against a real
;; generated git repository for each draw, never a reimplementation of the
;; shell/git logic in Clojure. The defect was in which git plumbing (rename
;; detection, attribution fallback) the guard's own shell script called;
;; only the real script and a real repo can answer that.
;;
;;   Invariant 1: "A path whose content survives at another path in the
;;   merge result is never reported as a deletion; a path whose content
;;   survives nowhere is reported exactly as before (every BL-1242 and
;;   BL-1341 scenario unchanged)."
;;
;;   Invariant 2: "A refusal is exemptable whenever EITHER side's history
;;   names a ticket for the path: the refusal carries that id and that
;;   commit, and (unattributed) appears only when no commit on either side
;;   names one."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause):
;; both move variants (plain, with-footer), and for the delete kind all four
;; ticket-naming combinations (neither/HEAD-only/incoming-only/both) must
;; each be hit at least once.
;;
;; FIXTURE BODY SIZE MATTERS: a one-line intake body was measured (while
;; authoring the sibling shell/acceptance tests) to drop BELOW git's default
;; 50% rename-similarity threshold once a short footer is appended, so a
;; genuine move would misreport as D+A. The body used here mirrors those
;; fixtures' size.

(ns bl1403-merge-deletion-guard-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 60))
(def failures (atom []))
(def coverage (atom {:move-plain 0 :move-footer 0
                      :delete-neither 0 :delete-head-only 0 :delete-incoming-only 0 :delete-both 0}))

(def guard (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "check_merge_deletion.sh")))

(when-not (fs/exists? guard)
  (binding [*out* *err*] (println (str "FATAL: not found: " guard)))
  (System/exit 2))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def intake-body
  (str "# Operator intake\n\nFiled via Telegram.\n\n"
       "The human asked whether the spec-tree console's live view could support a\n"
       "text filter across milestones, since scrolling through the whole tree on a\n"
       "phone screen is unusable once a few dozen tickets accumulate. This would\n"
       "mirror an existing filter already used elsewhere in the console.\n\n"
       "No further detail was given; the specifier is expected to scope the exact\n"
       "slice at mint time.\n"))

(defn- sh! [root & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir root :continue true} args)]
    {:exit exit :out out :err err}))

(defn- git! [root & args]
  (apply sh! root "git" args))

(defn- build-repo! [root {:keys [head-names-ticket]}]
  (git! root "init" "-q" "-b" "main")
  (git! root "config" "user.email" "test@test")
  (git! root "config" "user.name" "test")
  (git! root "config" "commit.gpgsign" "false")
  (git! root "commit" "-q" "--allow-empty" "-m" "seed")
  (fs/create-dirs (fs/path root "backlog"))
  (spit (str (fs/path root "backlog" "INTAKE-x.md")) intake-body)
  (git! root "add" "-A")
  ;; Invariant 2's OTHER named case (BL-1242's own original shape, must not
  ;; regress): HEAD's own introducing commit CAN already name a ticket, not
  ;; only the "raw intake, no ticket yet" shape the ticket's own motivation
  ;; centers on.
  (git! root "commit" "-q" "-m" (if head-names-ticket
                                   "BL-8001: seed a ticket-owned file"
                                   "Operator: file a question as raw intake for the swarm")))

(defn- start-incoming! [root] (git! root "checkout" "-q" "-b" "incoming"))

(defn- merge-no-commit! [root]
  (git! root "checkout" "-q" "main")
  (git! root "merge" "--no-ff" "--no-commit" "incoming"))

(defn- run-guard! [root message]
  (let [msg-file (str (fs/path root "msg.txt"))]
    (spit msg-file message)
    (let [{:keys [exit out err]} (sh! root "bash" guard msg-file)]
      {:allowed (zero? exit) :output (str out err)})))

(loop [i 0 s 1403]
  (when (< i runs)
    (let [[kind-n s1] (gen-int s 3)
          kind (nth [:move-plain :move-footer :delete] kind-n)
          [hn s2] (gen-int s1 2)
          head-names-ticket (zero? hn)
          [in_ s3] (gen-int s2 2)
          incoming-names-ticket (zero? in_)
          spec {:kind kind :head-names-ticket head-names-ticket :incoming-names-ticket incoming-names-ticket}
          root (str (fs/create-temp-dir {:prefix "bl1403-prop-"}))]
      (try
        (build-repo! root spec)
        (case kind
          (:move-plain :move-footer)
          (do
            (swap! coverage update kind inc)
            (start-incoming! root)
            (fs/create-dirs (fs/path root "backlog" "archive"))
            (git! root "mv" "backlog/INTAKE-x.md" "backlog/archive/INTAKE-x.md")
            (when (= kind :move-footer)
              (spit (str (fs/path root "backlog" "archive" "INTAKE-x.md"))
                    "\nArchived by the specifier drain.\n" :append true)
              (git! root "add" "-A"))
            (git! root "commit" "-q" "-m" "Mint BL-9009: archive its intake")
            (merge-no-commit! root)
            ;; ── Invariant 1 ──
            (let [{:keys [allowed output]} (run-guard! root "merge, no ticket named")]
              (when-not allowed
                (report! "P1 (invariant 1: a moved path is never reported as a deletion)" s spec output))))

          :delete
          (let [covkey (keyword (str "delete-"
                                      (cond (and head-names-ticket incoming-names-ticket) "both"
                                            head-names-ticket "head-only"
                                            incoming-names-ticket "incoming-only"
                                            :else "neither")))]
            (swap! coverage update covkey inc)
            (start-incoming! root)
            (git! root "rm" "-q" "backlog/INTAKE-x.md")
            (git! root "commit" "-q" "-m" (if incoming-names-ticket
                                             "Mint BL-9009: archive its intake"
                                             "chore: remove a stale intake file"))
            (merge-no-commit! root)
            ;; ── Invariant 1's other half: a genuine deletion (content
            ;; survives NOWHERE) must still be reported exactly as before. ──
            (let [{:keys [allowed output]} (run-guard! root "merge, no ticket named")]
              (when allowed
                (report! "P1 (invariant 1: a genuine deletion is still reported, unchanged)" s spec output))
              ;; ── Invariant 2 ──
              (let [any-id (or head-names-ticket incoming-names-ticket)]
                (if any-id
                  (do
                    (when-not (str/includes? output "BL-")
                      (report! "P2 (invariant 2: a refusal is attributed whenever either side names a ticket)" s spec output))
                    (when (str/includes? output "(unattributed)")
                      (report! "P2 (invariant 2: must not be unattributed when a side names a ticket)" s spec output))
                    (let [named-id (cond head-names-ticket "BL-8001" incoming-names-ticket "BL-9009")
                          {:keys [allowed]} (run-guard! root (str named-id ": deliberate removal"))]
                      (when-not allowed
                        (report! "P2 (invariant 2: naming the attributed id allows the merge)" s spec output))))
                  (when-not (str/includes? output "(unattributed)")
                    (report! "P2 (invariant 2: unattributed only when NEITHER side names a ticket)" s spec output)))))))
        (finally
          (fs/delete-tree root)))
      (recur (inc i) s3))))

(doseq [[k floor] {:move-plain 3 :move-footer 3
                    :delete-neither 2 :delete-head-only 2 :delete-incoming-only 2 :delete-both 2}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1403 merge-deletion-guard properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
