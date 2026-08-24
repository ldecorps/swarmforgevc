#!/usr/bin/env bb
;; Unit tests for bounded_run_lib.bb (BL-1103): one shared wall-clock-bounded
;; runner. Locks the three feature scenarios and the single-implementation
;; invariant (no second copy of the group-kill / no-deref traps).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "bounded_run_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(defn- count-sleep-3600 []
  ;; Exact argv match (not pgrep -f): avoids matching this suite's own cmdline.
  (let [r (process/sh {:out :string :err :string :continue true}
                      "bash" "-c"
                      "ps -eo pid=,args= | awk '$2==\"sleep\" && $3==\"3600\" {c++} END {print c+0}'")]
    (or (parse-long (str/trim (:out r))) 0)))

(defn- with-temp-out [f]
  (let [d (str (fs/create-temp-dir {:prefix "bl1103-"}))
        out (str (fs/path d "out"))
        err (str (fs/path d "err"))]
    (try (f out err)
         (finally (fs/delete-tree d)))))

;; ── shared-bounded-runner-01: group kill on overrun ───────────────────────
(with-temp-out
  (fn [out err]
    (let [before (count-sleep-3600)
          t0 (System/currentTimeMillis)
          r (bounded-run-lib/run-bounded!
             {} 400 out err
             "bash" "-c" "sleep 3600 & sleep 3600")
          elapsed (- (System/currentTimeMillis) t0)]
      (assert-true "01: timed-out? true" (:timed-out? r))
      (assert= "01: exit nil on timeout" nil (:exit r))
      (assert-true "01: returns promptly (well under the child's sleep)" (< elapsed 5000))
      (Thread/sleep 500)
      (assert= "01: no sleep 3600 grandchild survived the group kill"
               before (count-sleep-3600)))))

;; ── shared-bounded-runner-02: no block when grandchild holds the pipe ─────
;; With FILE redirects (trap 2), an immediate parent exit does NOT take the
;; timeout branch — waitFor sees the child exit and returns. The assertion is
;; that the caller is not blocked waiting for pipe EOF from the grandchild.
;; Fifo handshake (BL-1031): parent only exits after the pipe-holder is alive.
(with-temp-out
  (fn [out err]
    (let [cmd ["bash" "-c"
               (str "echo child-output; "
                    "s=$(mktemp -u); mkfifo \"$s\" || exit 1; "
                    "(echo ready >\"$s\"; exec sleep 5) & "
                    "read _ <\"$s\"; rm -f \"$s\"; exit 0")]
          call (future (apply bounded-run-lib/run-bounded! {} 300 out err cmd))
          r (deref call 8000 ::hung)
          _ (when (= ::hung r) (future-cancel call))]
      (assert-true "02: returns rather than blocking on the undrainable pipe"
                   (not= ::hung r))
      (when (not= ::hung r)
        (assert-true "02: finished (file redirects: parent exit is the result, not a timeout)"
                     (not (:timed-out? r)))
        (assert= "02: parent's exit code passes through" 0 (:exit r))))))

;; ── shared-bounded-runner-03: in-bound finish passes through ──────────────
(with-temp-out
  (fn [out err]
    (let [r (bounded-run-lib/run-bounded!
             {} 5000 out err
             "bash" "-c" "echo fail-out; echo fail-err 1>&2; exit 42")]
      (assert-true "03: not timed out" (not (:timed-out? r)))
      (assert= "03: exit code passes through" 42 (:exit r))
      (assert= "03: stdout landed in the out file" "fail-out\n" (slurp out))
      (assert-true "03: stderr landed in the err file"
                   (str/includes? (slurp err) "fail-err")))))

;; ── single implementation: callers source the lib, do not re-copy traps ───
(let [scripts (str (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
      lib (slurp (str (fs/path scripts "bounded_run_lib.bb")))
      expedite (slurp (str (fs/path scripts "expedite_cli.bb")))
      babysitter (slurp (str (fs/path scripts "babysitter_check.bb")))
      ;; The load-bearing group-kill argument list, unique to this runner.
      kill-needle #"\"kill\" \"-KILL\" \"--\""
      setsid-needle #"\[\"setsid\"\]"]
  (assert-true "lib carries the group-kill" (re-find kill-needle lib))
  (assert-true "lib wraps with setsid" (re-find setsid-needle lib))
  (assert= "expedite_cli.bb has no second copy of the group-kill"
           0 (count (re-seq kill-needle expedite)))
  (assert= "babysitter_check.bb has no second copy of the group-kill"
           0 (count (re-seq kill-needle babysitter)))
  (assert-true "expedite_cli.bb load-files bounded_run_lib.bb"
               (str/includes? expedite "bounded_run_lib.bb"))
  (assert-true "babysitter_check.bb load-files bounded_run_lib.bb"
               (str/includes? babysitter "bounded_run_lib.bb"))
  (assert-true "expedite routes through bounded-run-lib/run-bounded!"
               (str/includes? expedite "bounded-run-lib/run-bounded!"))
  (assert-true "babysitter routes through bounded-run-lib/run-bounded!"
               (str/includes? babysitter "bounded-run-lib/run-bounded!")))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (println (str (count @failures) " FAILURE(S)"))
  (System/exit 1))
(println "ALL PASS: bounded_run_lib.bb")
