# BL-1907: wait until a process the test orphaned on purpose reads orphaned
# to process_table_lib.bb's own parent-orphaned? - the predicate the reapers
# under test consult - never a hand-rolled "PPID == 1" check. On a host whose
# orphans are adopted by a child subreaper (WSL's Relay /init, systemd
# --user) the adopter is not PID 1, and only the predicate knows which pid it
# is. The bb process this starts sits below the same subreaper as the
# orphan, so it learns the same adopter.
#
# Usage: wait_until_orphaned <scripts-dir> <pid> [tries] [interval-seconds]
# Prints "ORPHANED parent=<ppid>" and returns 0 once the process is alive
# and reads orphaned, or prints
# "NOT_ORPHANED parent=<ppid>" and returns 1 once the tries run out. One bb
# process polls, so the wait costs one JVM-free start, not one per try.
wait_until_orphaned() {
  local scripts="$1" pid="$2" tries="${3:-50}" interval="${4:-0.1}"
  bb -e "
(load-file \"$scripts/process_table_lib.bb\")
(let [pid $pid
      ms (long (* 1000 $interval))
      ph (fn [] (.orElse (java.lang.ProcessHandle/of (long pid)) nil))
      alive? (fn [] (boolean (some-> (ph) .isAlive)))
      parent (fn [] (or (some-> (ph) .parent (.orElse nil) .pid) \"gone\"))]
  (loop [i 0]
    (cond
      ;; Alive too: the predicate reads a vanished pid as orphaned, and a
      ;; reap asserted over a process that already died would pass vacuously.
      (and (alive?) (process-table-lib/parent-orphaned? pid))
      (do (println (str \"ORPHANED parent=\" (parent))) (System/exit 0))
      (< (inc i) $tries) (do (Thread/sleep ms) (recur (inc i)))
      :else (do (println (str \"NOT_ORPHANED parent=\" (parent))) (System/exit 1)))))"
}
