#!/usr/bin/env bb
;; BL-1847 acceptance driver: a thin CLI over the REAL
;; ticket_close_guard_lib.bb/qa-approved-ticket? predicate - scenario 03
;; proves a relayed QA approval still satisfies the SAME guard the ticket
;; close commit reads, never a reimplementation of its own mailbox-scan
;; logic.
;;
;; Usage: bl1847TicketCloseGuardCheckCli.bb <root> <ticket-id>
;; Prints "true" or "false".

(require '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def lib-path (str (fs/path script-dir ".." ".." ".." ".." "swarmforge" "scripts" "ticket_close_guard_lib.bb")))

(load-file lib-path)

(let [[root ticket-id] *command-line-args*]
  (println (ticket-close-guard-lib/qa-approved-ticket? root ticket-id)))
