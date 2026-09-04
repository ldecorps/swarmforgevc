#!/usr/bin/env bb
;; BL-1362 acceptance driver for scenario 04: does the REAL review-forward
;; evidence gate refuse a forward naming the recorded commit?
;;
;; Drives swarmforge/scripts/review_forward_evidence_gate_lib.bb itself - both
;; its fs-side fact lookups and its pure `blocked?` - over a real repository,
;; never a restatement of the rule. The whole point of the scenario is that the
;; tool's output satisfies the gate BY CONSTRUCTION, and only the gate can say
;; whether it does.
;;
;; Usage: bl1362ReviewEvidenceGateProbe.bb <repo-root> <received-commit> <forwarded-commit> <task-name>
;; Prints one JSON line: {"blockedForwardingRecorded":bool,"blockedForwardingReceived":bool}

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def repo-root (fs/canonicalize (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." "..")))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "review_forward_evidence_gate_lib.bb")))

(defn- verdict
  "The gate's own decision for a cleaner->architect forward naming `commit`,
   with every fact computed by the gate's own lookups rather than assumed."
  [root received commit task]
  (review-forward-evidence-gate-lib/blocked?
   {:type "git_handoff"
    :sender "cleaner"
    :recipients ["architect"]
    :task-name task
    :commit commit
    :reroute-reason nil
    :received-commit received
    :introduces-nothing-own?
    (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root commit)
    :carries-own-evidence?
    (review-forward-evidence-gate-lib/forward-carries-own-evidence? root received commit task)}))

(let [[root received forwarded task] *command-line-args*]
  (println (json/generate-string
            {:blockedForwardingRecorded (verdict root received forwarded task)
             ;; The control: naming the bare received hash must STILL be
             ;; refused. A scenario that only proved the happy path could go
             ;; green against a gate this parcel had weakened.
             :blockedForwardingReceived (verdict root received received task)})))
