#!/usr/bin/env bb
;; BL-1491 acceptance driver: drives the REAL daemon_alarm_lib.bb
;; alarm-and-halt! through the REAL handoffd_supervisor.bb record-halt!/
;; write-kill-all-audit-row!/write-availability-stop-record! against a
;; throwaway fixture root - never a reimplementation. halt-swarm! and the
;; alarm email are stubbed/suppressed per the feature's own Background ("a
;; supervisor whose alarm email and swarm halt are recorded, not
;; performed"); email is additionally auto-suppressed because the fixture
;; root resolves under the system temp dir (daemon_alarm_lib.bb's own
;; test-fixture-root? fail-safe). No tmux socket file is ever created here.
;;
;; Input JSON: {reason ("stalled"|"dead"), telemetry-unwritable,
;;              append-start}
;; Output JSON: {haltCount, auditLines, auditRowNamesReason,
;;               bothExistAtHalt, foldedIntervals, failureLogWritten}

(ns bl1491-halt-records-itself-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]
            [cheshire.core :as json]))

(def repo-root (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." "..")))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))

(def fixture-root (str (fs/create-temp-dir {:prefix "bl1491-halt-"})))

;; BL-459 temp-dir trap: reclaim the root on every exit path.
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? fixture-root) (fs/delete-tree fixture-root)))))

;; handoffd_supervisor.bb unconditionally calls (-main) at load time, which
;; (with no --check-once flag) enters its supervision while-loop. Pre-seed
;; stop-file so that loop is a no-op at load (same trick bl1490's fixture
;; CLI relies on), then remove it so our own manual alarm-and-halt! call
;; below is the only thing that actually runs.
(def daemon-dir* (fs/path fixture-root ".swarmforge" "daemon"))
(fs/create-dirs daemon-dir*)
(def stop-file* (fs/path daemon-dir* "stop"))
(spit (str stop-file*) "")

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path scripts-dir "handoffd_supervisor.bb"))))

(fs/delete-if-exists stop-file*)

;; Loaded now (not shadowed - handoffd_supervisor.bb never load-files this
;; one itself) so the halt-swarm! stub below can call its read-records
;; synchronously, from INSIDE alarm-and-halt!, to prove write-ahead ordering.
(load-file (str (fs/path scripts-dir "availability_ledger_lib.bb")))

(def input (json/parse-string (slurp *in*) true))
(def reason (keyword (or (:reason input) "stalled")))
(def telemetry-unwritable? (boolean (:telemetry-unwritable input)))
(def append-start? (boolean (:append-start input)))

(def audit-file (str handoffd-supervisor/kill-all-audit-file))
(def telemetry-dir (str (fs/path fixture-root ".swarmforge" "telemetry")))

;; both-exist-at-halt is sampled from INSIDE the halt-swarm! stub - the only
;; point that can actually prove write-ahead ordering (scenario 03).
(def both-exist-at-halt (atom nil))
(def halt-count (atom 0))

(defn- audit-has-rows? []
  (and (fs/exists? audit-file)
       (not (str/blank? (slurp audit-file)))))

(defn- availability-has-stop-record? []
  (try
    (some #(= "stop" (:event %)) (availability-ledger-lib/read-records (str fixture-root "/.swarmforge")))
    (catch Exception _ false)))

(alter-var-root #'handoffd-supervisor/halt-swarm!
                (fn [_]
                  (fn []
                    (reset! both-exist-at-halt
                            {:audit (audit-has-rows?) :availability (availability-has-stop-record?)})
                    (swap! halt-count inc))))

(when telemetry-unwritable?
  (fs/create-dirs telemetry-dir)
  (fs/set-posix-file-permissions telemetry-dir "r-xr-xr-x"))

;; Drives the exact wiring handoffd_supervisor.bb's own check! uses on a
;; :dead/:stalled verdict - never a hand-rolled call into daemon-alarm-lib
;; directly, so a future rewire of alarm-and-halt!'s adapter map is caught
;; here too.
(handoffd-supervisor/alarm-and-halt! reason (or (handoffd-supervisor/read-status) {}))

(when append-start?
  (process/sh "sh" "-c" ". \"$1\"; availability_record \"$2\" start swarm-stop start-swarm.sh"
              "sh" (str (fs/path scripts-dir "availability_ledger_lib.sh")) fixture-root))

(def audit-lines
  (if (fs/exists? audit-file)
    (vec (remove str/blank? (str/split-lines (slurp audit-file))))
    []))

(def folded (availability-ledger-lib/fold (str fixture-root "/.swarmforge")))
(def records (availability-ledger-lib/read-records (str fixture-root "/.swarmforge")))
(def stop-records (filterv #(= "stop" (:event %)) records))

(println
 (json/generate-string
  {:haltCount @halt-count
   :auditLines audit-lines
   :auditRowNamesReason (boolean (some #(and (str/includes? % "handoffd_supervisor")
                                              (str/includes? % (name reason)))
                                        audit-lines))
   :bothExistAtHalt @both-exist-at-halt
   :foldedIntervals (mapv #(select-keys % [:class :provenance]) folded)
   :stopRecordCount (count stop-records)
   :stopRecordClass (:class (first stop-records))
   :stopRecordSource (:source (first stop-records))
   :failureLogWritten (boolean (some #(str/starts-with? (fs/file-name %) "handoffd-failure-")
                                      (fs/list-dir (fs/path fixture-root ".swarmforge" "daemon"))))}))

(fs/delete-tree fixture-root)
