#!/usr/bin/env bb
;; BL-1261: CLI for the hold divergence audit.
;; Usage: hold_divergence_audit_cli.bb <backlog-root>

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "hold_divergence_audit_lib.bb")))

(defn -main [args]
  (when (or (empty? args) (= (first args) "--help"))
    (println "Usage: hold_divergence_audit_cli.bb <backlog-root>")
    (println "")
    (println "Audit for divergence between backlog/hold/ and live parcels.")
    (println "Reports tickets in hold/ that have parcels still moving in role mailboxes.")
    (println "Report only - never moves tickets or parcels.")
    (System/exit 0))

  (let [backlog-root (first args)]
    (when-not (fs/directory? backlog-root)
      (binding [*out* *err*]
        (println (str "Error: backlog root not found: " backlog-root)))
      (System/exit 2))

    (let [result (hold-divergence-audit-lib/audit backlog-root)
          report (hold-divergence-audit-lib/format-report result)]
      (doseq [line report]
        (println line))
      ;; Exit 0 if clean, 1 if divergence found
      (System/exit (if (seq (:divergences result)) 1 0)))))

(-main *command-line-args*)
