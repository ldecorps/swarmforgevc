#!/usr/bin/env bb
;; BL-1428 coder pass (BL-654 Invariants): PROPERTY tests over
;; standing_red_register_lib.bb's build-report (invariant 1) and the REAL
;; check_standing_red_register.sh (invariant 2), never a reimplementation.
;;
;; Invariant 3 ("the property-suite allowlist gate is unchanged in what it
;; refuses: this parcel edits the allowlist's rows, never its reader") is a
;; one-time structural fact about THIS parcel's own diff, not a property
;; over an arbitrary input domain a generator could vary - per BL-654's own
;; allowance for a declared invariant with no fresh executable encoding to
;; record a stated reason instead: verified by `git diff` naming only
;; property_suite_standing_allowlist.tsv's DATA rows changed (this
;; runner's own evidence doc records the exact command and result), never
;; property_suite_standing_allowlist_lib.sh or check_property_suite_drift.sh.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken build-report that emitted
;;     an allowlist-only row EVEN WHEN the register already covered it
;;     (dropping the `remove` filter) - failed on every generated case
;;     with at least one overlapping (lane,file) pair (the property's own
;;     generator always includes at least one).
;;   - P2 was run against a deliberately broken guard that read
;;     `git diff -U0` (the FULL working tree vs HEAD) instead of
;;     `git diff --cached -U0` (the staged content only) - failed on every
;;     generated case with a pre-existing bad row PLUS an untouched-file
;;     staged change, because the unstaged, on-disk stale row then showed
;;     up as "changed" too.

(ns bl1428-every-standing-red-names-an-open-owner-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "standing_red_register_lib.bb")))
(def guard-sh (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "check_standing_red_register.sh")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn seed0]
  (loop [i 0 s seed0]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

;; ── P1 (invariant 1): one notion, no double-counting across sources ──────

(defn gen-p1 [s]
  (let [[n-covered s1] (gen-int s 4)   ; 0..3 pairs the register already covers
        [n-orphan-al s2] (gen-int s1 3)  ; 0..2 allowlist-only (uncovered) files
        [n-orphan-ledger s3] (gen-int s2 3)] ; 0..2 ledger-only (uncovered) debts
    [{:n-covered n-covered :n-orphan-al n-orphan-al :n-orphan-ledger n-orphan-ledger} s3]))

(defn- p1-case [{:keys [n-covered n-orphan-al n-orphan-ledger]}]
  (let [covered-files (for [i (range n-covered)] (str "extension/test/covered" i ".property.test.js"))
        register-rows (vec (for [f covered-files]
                              {:lane "property" :file f :ticket "BL-1" :first-seen "2026-08-27"}))
        allowlist-rows (vec (concat
                              (for [f covered-files]
                                {:file (str "test" (subs f (count "extension/test"))) :disposition "allowlist" :rationale "x"})
                              (for [i (range n-orphan-al)]
                                {:file (str "test/orphan" i ".property.test.js") :disposition "allowlist" :rationale "x"})))
        ledger-rows (vec (for [i (range n-orphan-ledger)]
                            {:ticket "BL-2" :file (str "ledger-file" i ".ts") :first-seen "2026-08-19"}))
        report (standing-red-register-lib/build-report
                {:allowlist-rows allowlist-rows :register-rows register-rows :ledger-rows ledger-rows
                 :ticket-state-fn (constantly :open) :now "2026-09-06"})
        keys (map (fn [r] [(:lane r) (:file r)]) (:rows report))
        expected-count (+ n-covered n-orphan-al n-orphan-ledger)]
    (cond
      (not= (count keys) (count (distinct keys)))
      (str "duplicate (lane,file) pair(s) in rows: " (pr-str keys))

      (not= expected-count (count (:rows report)))
      (str "expected " expected-count " total rows (covered+orphan-allowlist+orphan-ledger), got " (count (:rows report)))

      :else
      (let [covered-rows (filter (fn [r] (some #(= % (:file r)) covered-files)) (:rows report))]
        (if (every? #(= "BL-1" (:ticket %)) covered-rows)
          true
          (str "a covered row's ticket did not come from the register: " (pr-str covered-rows)))))))

;; ── P2 (invariant 2): pre-existing rows never influence the verdict ──────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))
(defn- g! [dir & args] (apply sh! dir "git" args))
(defn- write! [path content] (fs/create-dirs (fs/parent path)) (spit (str path) content))

(defn gen-p2 [s]
  (let [[n-stale s1] (gen-int s 4)          ; 0..3 pre-existing bad rows
        [touches-register? s2] (gen-bool s1)
        [staged-ticket-ok? s3] (gen-bool s2)]
    [{:n-stale n-stale :touches-register? touches-register? :staged-ticket-ok? staged-ticket-ok?} s3]))

(defn- p2-case [{:keys [n-stale touches-register? staged-ticket-ok?]}]
  (let [root (str (fs/create-temp-dir {:prefix "bl1428-prop-"}))]
    (try
      (g! root "init" "-q" "-b" "main")
      (g! root "config" "user.email" "t@t")
      (g! root "config" "user.name" "t")
      (g! root "config" "commit.gpgsign" "false")
      (write! (fs/path root "swarmforge" "scripts" "property_suite_standing_allowlist.tsv") "file\tdisposition\trationale\n")
      (write! (fs/path root "backlog" "hardening-debt-ledger.yaml") "# ledger\n")
      (write! (fs/path root "backlog" "done" "M8" "BL-9999-closed.yaml") "id: BL-9999\nstatus: done\n")
      (write! (fs/path root "backlog" "active" "BL-1-open.yaml") "id: BL-1\nstatus: todo\n")
      ;; n-stale pre-existing rows, all naming the CLOSED ticket - committed
      ;; on HEAD before the tested commit.
      (write! (fs/path root "backlog" "standing-reds.tsv")
              (str "# header\n"
                   (str/join "" (for [i (range n-stale)]
                                  (str "unit\textension/test/stale" i ".test.js\tBL-9999\t2026-08-01\tstale\n")))))
      (g! root "add" "-A")
      (g! root "commit" "-q" "-m" "base with pre-existing stale rows")
      (if touches-register?
        (let [ticket (if staged-ticket-ok? "BL-1" "BL-9999")]
          (spit (str (fs/path root "backlog" "standing-reds.tsv"))
                (str "# header\n"
                     (str/join "" (for [i (range n-stale)]
                                    (str "unit\textension/test/stale" i ".test.js\tBL-9999\t2026-08-01\tstale\n")))
                     "unit\textension/test/newred.test.js\t" ticket "\t2026-09-05\tnew\n")))
        (write! (fs/path root "README-unrelated.md") "unrelated\n"))
      (g! root "add" "-A")
      (let [res (sh! root "bash" guard-sh)
            expected-exit (cond
                            (not touches-register?) 0        ; never touches the register at all - always allowed
                            staged-ticket-ok? 0               ; staged row names an open ticket - allowed
                            :else 1)]                          ; staged row names the closed ticket - refused
        (if (= expected-exit (:exit res))
          true
          (str "n-stale=" n-stale " touches-register?=" touches-register? " staged-ticket-ok?=" staged-ticket-ok?
               " expected exit " expected-exit ", got " (:exit res) " (err: " (:err res) ")")))
      (finally (fs/delete-tree root)))))

(check-all "P1: one notion of a standing red, no double-counting across the three sources" gen-p1 p1-case 1428)
(check-all "P2: rows the commit does not touch never influence the verdict, however many or however stale" gen-p2 p2-case 4281)

;; ── generator coverage (asserted reachability floors) ──────────────────

(let [p1-inputs (sweep-coverage 1428 gen-p1 identity)
      p2-inputs (sweep-coverage 4281 gen-p2 identity)
      floor (quot runs 10)
      buckets {:p1-has-covered (count (filter #(pos? (:n-covered %)) p1-inputs))
               :p1-has-orphan-allowlist (count (filter #(pos? (:n-orphan-al %)) p1-inputs))
               :p1-has-orphan-ledger (count (filter #(pos? (:n-orphan-ledger %)) p1-inputs))
               :p2-touches-register (count (filter :touches-register? p2-inputs))
               :p2-does-not-touch (count (remove :touches-register? p2-inputs))
               :p2-staged-ok (count (filter #(and (:touches-register? %) (:staged-ticket-ok? %)) p2-inputs))
               :p2-staged-bad (count (filter #(and (:touches-register? %) (not (:staged-ticket-ok? %))) p2-inputs))
               :p2-has-stale-rows (count (filter #(pos? (:n-stale %)) p2-inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 0 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ──────────────────────────────────────────────────────────────

(println (str "bl1428 every-standing-red-names-an-open-owner properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
