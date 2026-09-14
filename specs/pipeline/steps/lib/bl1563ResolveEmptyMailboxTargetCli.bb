#!/usr/bin/env bb
;; BL-1563 acceptance driver: EXECUTES the pure resolver hotfix 0b727b286c
;; landed in swarmforge/scripts/mono_router_lib.bb, rather than asserting on
;; its source text. A source-text assertion cannot tell a wired resolver
;; from a dead one (BL-1321's own rationale for this same shape).
;;
;; The function driven here is the landed one, loaded from the real lib:
;;   resolve-empty-mailbox-target
;;
;; Usage: bb bl1563ResolveEmptyMailboxTargetCli.bb '<json-args>'
;;   '{"forwardTarget":"coder","forwardReason":"recipient-is-home",
;;     "homeRole":"coder","role":"QA","routerPreferred":"hardender",
;;     "knownRoles":["specifier","coder","cleaner","architect","hardender",
;;                   "documenter","QA","coordinator"]}'
;;     -> {"target":"hardender","reason":"router-preferred"}
;; Prints one JSON line. `routerPreferred` accepts null/"none" for absent.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def repo-root
  (-> *file* fs/absolutize fs/parent fs/parent fs/parent fs/parent fs/parent str))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "mono_router_lib.bb")))

(let [args (json/parse-string (first *command-line-args*) true)
      router-preferred (let [rp (:routerPreferred args)]
                          (when (and rp (not= rp "none")) rp))
      final (mono-router-lib/resolve-empty-mailbox-target
             {:forward {:target (:forwardTarget args) :reason (keyword (:forwardReason args))}
              :home-role (:homeRole args)
              :role (:role args)
              :router-preferred router-preferred
              :known-roles (:knownRoles args)})]
  (println (json/generate-string
            {:target (str (:target final))
             :reason (name (:reason final))})))
