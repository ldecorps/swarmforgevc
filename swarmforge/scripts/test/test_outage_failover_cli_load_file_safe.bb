#!/usr/bin/env bb
;; BL-1150: load-file of outage_failover_cli.bb must not System/exit or run -main.
;; If a bare (-main) still fires, usage calls System/exit 1 and this harness
;; never reaches PASS.
(require '[clojure.string :as str]
         '[babashka.fs :as fs])

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(def cli-path (str (fs/path scripts-dir "outage_failover_cli.bb")))

(let [src (slurp cli-path)]
  (when-not (str/includes? src "babashka.file")
    (binding [*out* *err*]
      (println "FAIL: outage_failover_cli.bb missing babashka.file entrypoint guard"))
    (System/exit 1))
  (when (re-find #"(?m)^\(-main\)$" src)
    (binding [*out* *err*]
      (println "FAIL: bare (-main) still present — load-file would exit"))
    (System/exit 1)))

(load-file cli-path)

(println "PASS: load-file of outage_failover_cli.bb did not exit and did not run -main")
(System/exit 0)
