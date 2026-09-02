#!/usr/bin/env bb
;; BL-1321 acceptance driver: EXECUTES the pure gate hotfix 3d70c0f4ec landed
;; in swarmforge/scripts/mono_router_lib.bb, rather than asserting on its
;; source text. A source-text assertion cannot tell a wired gate from a dead
;; one, and the deadlock under review was a redirect that read correctly and
;; sent the resident nowhere.
;;
;; The function driven here is the landed one, loaded from the real lib:
;;   chase-rotate-decision
;;
;; Usage: bb bl1321ChaseRotateDecisionCli.bb '<json-args>'
;;   '{"preferred":"QA","poked":"specifier","seated":"QA","actionable":true}'
;;     -> {"action":"rotate","target":"specifier"}
;; Prints one JSON line. `preferred` and `seated` accept null for absent.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def repo-root
  (-> *file* fs/absolutize fs/parent fs/parent fs/parent fs/parent fs/parent str))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "mono_router_lib.bb")))

(let [args (json/parse-string (first *command-line-args*) true)
      decision (mono-router-lib/chase-rotate-decision
                {:preferred (:preferred args)
                 :poked-role (:poked args)
                 :active-role (:seated args)
                 :poked-actionable? (boolean (:actionable args))})]
  (println (json/generate-string
            {:action (name (:action decision))
             :target (if (:target decision) (str (:target decision)) "none")})))
