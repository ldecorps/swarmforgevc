#!/usr/bin/env bb
;; Unit tests for daemon_cycle_guard_lib.bb (BL-967): the bounded-subprocess
;; chokepoint (sh!) and the sweep-boundary wrapper (run-sweep!).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_cycle_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; The env seam is read per call; tests must run with a small bound. The
;; suite is invoked plainly, so set it through a subshell-safe check first.
(def bound (daemon-cycle-guard-lib/subprocess-wait-bound-ms))

;; ── sh! call shapes and passthrough ───────────────────────────────────────

(let [r (daemon-cycle-guard-lib/sh! "echo" "hello")]
  (assert= "sh! varargs: exit 0" 0 (:exit r))
  (assert= "sh! varargs: stdout captured" "hello" (str/trim (:out r))))

(let [r (daemon-cycle-guard-lib/sh! ["echo" "vec"])]
  (assert= "sh! vector form: exit 0 and stdout" ["vec" 0] [(str/trim (:out r)) (:exit r)]))

;; The fixture dir is removed in a FINALLY, never merely after the last
;; assertion: an assert that throws would otherwise leak the temp root
;; permanently (engineering rule; enforced by tempDirTrapGuard.test.js).
(let [d (str (fs/create-temp-dir {:prefix "dcg-test-"}))]
  (try
    (let [r (daemon-cycle-guard-lib/sh! ["pwd"] {:dir d})]
      (assert-true "sh! vector+opts form: :dir honored"
                   (str/includes? (str/trim (:out r)) (fs/file-name d))))
    (finally (fs/delete-tree d))))

(let [r (daemon-cycle-guard-lib/sh! "false")]
  (assert= "sh! non-zero exit passes through untouched" 1 (:exit r)))

;; ── sh! bounded wait (the invariant-1 core) ───────────────────────────────
;; Run in a subprocess-scoped env so the bound seam is small without leaking
;; into other assertions: re-exec bb with the env set is heavier than needed
;; - the seam is read per call, so setting it via a wrapper script is
;; equivalent to what the daemon wiring tests do. Here: call through env.

(let [fired (atom nil)]
  (reset! daemon-cycle-guard-lib/on-timeout!
          (fn [info] (reset! fired info)))
  (reset! daemon-cycle-guard-lib/current-context "test-sweep")
  ;; A genuinely hung child: sleep far past the bound.
  (let [t0 (System/currentTimeMillis)
        r (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] 200)]
            (daemon-cycle-guard-lib/sh! "sleep" "10"))
        elapsed (- (System/currentTimeMillis) t0)]
    (assert= "a hung child returns exit 124, never hangs the caller" 124 (:exit r))
    (assert-true "the bounded wait returns promptly (well under the child's own duration)"
                 (< elapsed 5000))
    (assert-true "the timeout error names the bound and the command"
                 (and (str/includes? (:err r) "200ms") (str/includes? (:err r) "sleep")))
    (assert= "on-timeout! fired with the current sweep context" "test-sweep" (:context @fired))
    (assert= "on-timeout! carries the command" ["sleep" "10"] (:cmd @fired))
    (assert= "on-timeout! carries the bound" 200 (:bound-ms @fired)))
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
  (reset! daemon-cycle-guard-lib/current-context "outside-sweep"))

(assert= "the default bound is 60s - well under the 300s freshness threshold"
         60000 daemon-cycle-guard-lib/default-subprocess-wait-bound-ms)

;; ── run-sweep! boundary observability (the invariant-2 core) ──────────────

(let [logged (atom [])
      log-fn (fn [event detail] (swap! logged conj [event detail]))
      clock (atom 1000)
      now-fn (fn [] @clock)]
  ;; A no-action sweep still emits its boundary with a duration.
  (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "idle-sweep" (fn [] (swap! clock + 40) nil))
  (assert= "an idle sweep still emits exactly its boundary line"
           [["sweep-boundary" "sweep=idle-sweep ms=40"]]
           @logged)

  ;; A throwing sweep logs the pre-existing "<name>-error" event AND the boundary.
  (reset! logged [])
  (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "chase-sweep"
                                     (fn [] (swap! clock + 7) (throw (Exception. "boom"))))
  (assert= "a throwing sweep keeps the existing error event name and still emits its boundary"
           [["chase-sweep-error" "boom"]
            ["sweep-boundary" "sweep=chase-sweep ms=7"]]
           @logged)

  ;; The context is the sweep's name while the thunk runs (timeout attribution).
  (let [seen (atom nil)]
    (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "push-sweep"
                                       (fn [] (reset! seen @daemon-cycle-guard-lib/current-context)))
    (assert= "current-context names the running sweep inside the thunk" "push-sweep" @seen)
    (assert= "current-context resets after the sweep" "outside-sweep"
             @daemon-cycle-guard-lib/current-context)))

;; ── invariant 1's structural half (BL-967 architect bounce D2) ────────────
;; The routing half of invariant 1 - the daemon reaches no subprocess path
;; outside this chokepoint - was previously a stated claim, and a false one:
;; D1 arrived through two in-cycle libs the claim missed. This gate makes the
;; claim executable. Over the TRANSITIVE load-file closure from handoffd.bb
;; (computed by master_checkout_drift_lib's BFS - never a hand-maintained
;; file list, which gets patched one name at a time and re-drifts), no file
;; except daemon_cycle_guard_lib.bb itself may reference babashka.process,
;; clojure.java.shell, process/sh, or process/process. Banning the two
;; namespace tokens is complete for those namespaces - an aliased call
;; cannot exist without naming the namespace in its require. Comments and
;; string contents are stripped first: handoff_lib.bb's docstrings NAME
;; clojure.java.shell while forbidding it, and prose must never trip a gate
;; that exists to catch calls.

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_checkout_drift_lib.bb")))

(defn strip-comments-and-strings
  "Blanks ;-comments and the CONTENTS of double-quoted strings (keeping
   their newlines, so line numbers survive multi-line docstrings). A
   backslash outside a string starts a char literal - its next char is
   skipped, so the \\\" char literal never opens a phantom string."
  [content]
  (let [sb (StringBuilder.)]
    (loop [chars (seq content) in-string? false escaped? false]
      (if-let [c (first chars)]
        (cond
          in-string?
          (cond
            escaped? (recur (rest chars) true false)
            (= c \\) (recur (rest chars) true true)
            (= c \") (do (.append sb c) (recur (rest chars) false false))
            (= c \newline) (do (.append sb c) (recur (rest chars) true false))
            :else (recur (rest chars) true false))
          (= c \\) (recur (rest (rest chars)) false false)
          (= c \") (do (.append sb c) (recur (rest chars) true false))
          (= c \;) (recur (drop-while #(not= % \newline) chars) false false)
          :else (do (.append sb c) (recur (rest chars) false false)))
        (str sb)))))

(let [scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) "..")
      read-file (fn [bare]
                  (let [p (fs/path scripts-dir bare)]
                    (when (fs/exists? p) (slurp (str p)))))
      closure (master-checkout-drift-lib/resolve-daemon-executed-paths
               {:entrypoints #{"handoffd.bb"} :read-file read-file})
      forbidden #"babashka\.process|clojure\.java\.shell|process/sh|process/process"
      violations (vec (for [f (sort closure)
                            :when (not= f "daemon_cycle_guard_lib.bb")
                            :let [content (read-file f)]
                            :when content
                            [i line] (map-indexed vector
                                                  (str/split-lines (strip-comments-and-strings content)))
                            :when (re-find forbidden line)]
                        (str f ":" (inc i) ": " (str/trim line))))]
  (assert-true "closure gate sanity: the BFS actually resolved handoffd.bb's dependency closure"
               (> (count closure) 20))
  (assert= "invariant 1 structural half: no subprocess path outside the chokepoint anywhere in handoffd.bb's load-file closure"
           [] violations))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: daemon_cycle_guard_lib.bb")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
