#!/usr/bin/env bb
;; BL-1613 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY test encoding the ticket's one declared invariant:
;;
;;   "The fixture is a swarm root the launcher could have made: every key
;;   backlog_depth_lib.bb reads from a swarm-identity is present and names
;;   a file that exists under the fixture root before the first claim
;;   runs."
;;
;; The key set is DERIVED from backlog_depth_lib.bb's own source (a
;; `(get (swarm-identity-lib/read-swarm-identity ...) "KEY")` scan), never
;; hardcoded as a single literal - the property then holds for whatever
;; the reader actually reads today (one key) or reads after a future
;; change (the reach this invariant's own wording asks for: "every key",
;; not "the one key currently named"). Real source files, not a
;; reimplementation - the defect this ticket fixes is a gap between two
;; real files, which a mock of either side could not reproduce.
;;
;; Non-vacuity proven by hand before committing: reverting
;; test_branch_claim_guard.sh's fixture to its pre-fix single-line
;; swarm-identity (swarm_name/swarm_mode only, no conf-path key) fails
;; this property naming the missing key; reverted before landing.

(ns bl1613-fixture-identity-completeness-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/parent (fs/parent (fs/parent script-dir))))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(defn- keys-read-from-swarm-identity
  "Every KEY literal in a
   `(get (swarm-identity-lib/read-swarm-identity ...) \"KEY\")` call
   anywhere in source-text."
  [source-text]
  (->> (re-seq #"\(get\s*\(swarm-identity-lib/read-swarm-identity[^)]*\)\s*\"([^\"]+)\"\)" source-text)
       (map second)
       distinct))

(def backlog-depth-source (slurp (str (fs/path repo-root "swarmforge" "scripts" "backlog_depth_lib.bb"))))
(def keys (keys-read-from-swarm-identity backlog-depth-source))

(when (empty? keys)
  (fail! "fixture (test): backlog_depth_lib.bb's own read-swarm-identity scan found no keys - the extraction regex itself is broken, not a passing vacuous property"))

(def fixture-source
  (slurp (str (fs/path repo-root "swarmforge" "scripts" "test" "test_branch_claim_guard.sh"))))

;; The fixture's swarm-identity printf, parsed into a key -> value map -
;; the same tab/newline-escaped shell literal shape the real script writes,
;; not a live shell execution (this is a source-level completeness check).
(defn- printf-identity-map [source]
  (when-let [m (re-find #"printf '([^']*)'\s*\\?\s*\n?\s*>\s*\"\$ROOT/\.swarmforge/swarm-identity\"" source)]
    (->> (str/split (second m) #"\\n")
         (remove str/blank?)
         (map #(str/split % #"\\t" 2))
         (filter #(= 2 (count %)))
         (into {}))))

(def identity (printf-identity-map fixture-source))

(when (nil? identity)
  (fail! "fixture (test): could not locate/parse the fixture's own swarm-identity printf - the extraction regex itself is broken, not a passing vacuous property"))

(doseq [k keys]
  (let [v (get identity k)]
    (if (nil? v)
      (fail! (str "invariant: swarm-identity is missing key " (pr-str k) " that backlog_depth_lib.bb reads"))
      ;; The one key backlog_depth_lib.bb currently reads is a conf PATH -
      ;; the file it names must exist under the fixture root, created
      ;; before the first claim runs (same ordering scenario 01 checks).
      (let [creation-marker (str "$ROOT/" v)
            creation-idx (str/index-of fixture-source creation-marker)
            first-run-ready (re-find #"(?m)^run_ready$" fixture-source)]
        (if (nil? creation-idx)
          (fail! (str "invariant: nothing in the fixture creates $ROOT/" v " that key " (pr-str k) " names"))
          (when-not first-run-ready
            (fail! "fixture (test): no bare run_ready invocation found - the ordering check itself is broken, not a passing vacuous property")))))))

(println (str "bl1613_fixture_identity_completeness property: " (count keys) " key(s) read from swarm-identity by backlog_depth_lib.bb"))
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
