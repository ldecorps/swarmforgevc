#!/usr/bin/env bb
;; BL-1544 coder pass (BL-654 Invariants): a PROPERTY test over
;; land_step_lib.bb's own-paths/subject-attribution and task_scope_gate_
;; lib.bb's subject-names-task?, encoding the ticket's two declared
;; invariants against the REAL functions, never a reimplementation:
;;
;;   1. "A path is never silently excluded from a replay on the strength of
;;      a commit whose subject names more than one ticket id and leads with
;;      none: it is kept for the landing ticket, or the land refuses naming
;;      that commit, its ids and the path."
;;   2. "A subject that leads with a ticket id is attributed to that id
;;      alone, whatever the rest of the line mentions - land-time and
;;      send-time (task_scope_gate_lib.bb subject-names-task?) agree."
;;
;; P1 builds a real fixture repo (git, under mkdtemp with its own origin -
;; BL-1390) where a reviewing-branch commit's subject leads with neither of
;; the two ticket ids it names, touching one shared path, and randomly adds
;; a SECOND commit whose subject leads with the landing ticket's own id on
;; that SAME path. Asserts own-paths keeps the path for the landing ticket
;; when that second commit exists, and otherwise refuses by name (never
;; silently excludes it, and never silently keeps it either).
;;
;; P2 is pure over generated subject strings (no git needed): a subject
;; built from one of this codebase's own three leading-verb-prefix
;; conventions (or bare `TICKET: `) followed by a DIFFERENT ticket id
;; mentioned later in ordinary prose. Asserts subject-attribution credits
;; the leading id alone, and that task_scope_gate_lib.bb's own
;; subject-names-task? agrees for the leading id and disagrees for the
;; other one - the land-time/send-time agreement this ticket's own
;; constraint requires (task_scope_gate_lib.bb itself is unchanged).
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners (bl1472_revert_reapply_transparent_property_runner.bb is the
;; direct template for P1's fixture machinery). Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time, two ways:
;;   1. With `leading-ticket-id` reverted to `extract-ticket-id` (the
;;      pre-fix, first-token-anywhere reading), P1's no-own-touch case
;;      failed on every generated input - own-paths returned a success map
;;      silently excluding the shared path (`:excluded [... "docs/shared.md"
;;      ...]`) exactly as a89a03ee45 was, instead of refusing.
;;   2. With `leading-verb-prefixes` emptied (bare "TICKET: " only, no
;;      Close/Promote/Approve), P2 failed on every "Close"/"Promote"/
;;      "Approve" input - a genuinely-leading subject then read as
;;      ambiguous, contradicting the invariant.
;; Both restored, ALL PROPERTIES HOLD.

(ns bl1544-ambiguous-subject-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop seed0 gen-fn pred-fn]
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

;; ── P1: an ambiguous path is kept for an own touch, else refused by name ──

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (:out (sh! root "git" "rev-parse" "HEAD"))))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1544-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(def leading-words-not-allowlisted ["Update" "Fix" "Note" "Describe" "Investigate" "Tidy"])

(defn gen-p1 [s]
  (let [[own-touch? s1] (gen-int s 2)
        [word-idx s2] (gen-int s1 (count leading-words-not-allowlisted))]
    [{:own-touch? (= 1 own-touch?)
      :word (nth leading-words-not-allowlisted word-idx)}
     s2]))

(defn- build-p1-case [root {:keys [own-touch? word]}]
  (sh! root "git" "checkout" "-q" "-b" "reviewing" "main")
  ;; Both named-but-not-leading siblings are APPROVED - riding as passengers
  ;; is the shape this invariant tests (BL-1332/BL-1481 blocking is a
  ;; different, already-covered question; see land_step_lib_test_runner.bb).
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\nhuman_approval: approved\n"
           "BL-9002: sibling ticket file")
  (commit! root "backlog/active/BL-9003-x.yaml" "id: BL-9003\nhuman_approval: approved\n"
           "BL-9003: third-ticket ticket file")
  (commit! root "docs/shared.md" "v1\n"
           (str word " the shared doc for BL-9002 and BL-9003's chokepoint fold"))
  (when own-touch?
    (commit! root "docs/shared.md" "v2\n" "BL-9001: land-owning touch on the shared doc"))
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own bookkeeping")
  (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- p1-case [{:keys [own-touch?] :as input}]
  (with-fixture [root]
    (commit! root "base.txt" "base\n" "seed base")
    (mark-origin-main-here! root)
    (let [tip (build-p1-case root input)
          {:keys [paths warning excluded] :as result} (land-step-lib/own-paths root tip "BL-9001")]
      (cond
        own-touch?
        (if (and (nil? warning) (some #{"docs/shared.md"} (or paths [])))
          true
          (str "an own-touch on the shared path must be kept, never refused or excluded: "
               (pr-str result)))

        (some? paths)
        (str "no own touch: the path must never be silently included (nor silently excluded) "
             "- own-paths returned a success map instead of a refusal: " (pr-str result))

        (and warning
             (str/includes? warning "docs/shared.md")
             (str/includes? warning "BL-9002")
             (str/includes? warning "BL-9003"))
        true

        :else
        (str "no own touch: refusal must name the path and both ambiguous ids: " (pr-str result))))))

(check-all "P1: ambiguous path kept for an own touch, else refused by name (never silently excluded)"
           1544 gen-p1 p1-case)

;; ── P2: a subject that leads with a ticket id is that id's alone ─────────

(def leading-verbs ["Close" "Promote" "Approve" nil])
(def trailing-phrases ["decouple unlanded %s gate wiring"
                       "cite %s evidence"
                       "chokepoint fold for %s"
                       "run the deferred %s gate"])

(defn gen-p2 [s]
  (let [[verb-idx s1] (gen-int s (count leading-verbs))
        [lead-n s2] (gen-int s1 9000)
        [offset s3] (gen-int s2 500)
        [phrase-idx s4] (gen-int s3 (count trailing-phrases))]
    [{:verb (nth leading-verbs verb-idx)
      :lead-id (+ 1000 lead-n)
      :other-id (+ 1000 lead-n (inc offset))
      :phrase (nth trailing-phrases phrase-idx)}
     s4]))

(defn- p2-subject [{:keys [verb lead-id other-id phrase]}]
  (let [lead (str "BL-" lead-id)
        other (str "BL-" other-id)]
    (str (if verb (str verb " " lead ": ") (str lead ": "))
         (format phrase other))))

(defn- p2-case [{:keys [lead-id other-id] :as input}]
  (let [lead (str "BL-" lead-id)
        other (str "BL-" other-id)
        subject (p2-subject input)
        attr (land-step-lib/subject-attribution subject)]
    (cond
      (not= {:ids #{lead} :ambiguous? false} attr)
      (str "subject-attribution disagrees for a subject that leads with its own id: "
           (pr-str attr) " subject=" (pr-str subject))

      (not (true? (task-scope-gate-lib/subject-names-task? subject lead)))
      (str "task_scope_gate_lib.bb's subject-names-task? disagrees the subject names its own "
           "leading id: " (pr-str subject))

      (not (false? (task-scope-gate-lib/subject-names-task? subject other)))
      (str "task_scope_gate_lib.bb's subject-names-task? wrongly agrees the subject names the "
           "OTHER (non-leading, merely-mentioned) id: " (pr-str subject))

      :else true)))

(check-all "P2: a subject that leads with a ticket id is that id's alone (land-time/send-time agree)"
           1545 gen-p2 p2-case)

;; ── generator reach (asserted reachability floors) ───────────────────────

(let [inputs (sweep-coverage 1544 gen-p1 identity)
      floor (quot runs 10)
      buckets {:own-touch (count (filter :own-touch? inputs))
               :no-own-touch (count (remove :own-touch? inputs))}]
  (println (str "  P1 generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE P1 " k) 1544 buckets (str k " barely exercised: " v " <= floor " floor)))))

(let [inputs (sweep-coverage 1545 gen-p2 identity)
      buckets (frequencies (map :verb inputs))]
  (println (str "  P2 generator coverage (leading form): " (pr-str buckets)))
  (doseq [verb leading-verbs]
    (when-not (contains? buckets verb)
      (report! "COVERAGE P2 leading-form" 1545 buckets
                (str "never sampled leading form " (pr-str verb) " across the configured run budget")))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1544 ambiguous-subject property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
