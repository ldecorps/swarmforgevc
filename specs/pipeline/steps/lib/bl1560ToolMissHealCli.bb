#!/usr/bin/env bb
;; BL-1560 acceptance driver: EXECUTES the real tool-miss-heal-lib the
;; hotfix 1fc9065605 landed in swarmforge/scripts/tool_miss_heal_lib.bb -
;; a source-text assertion cannot tell a wired heal from a dead one. This
;; is a REVIEW driver only; it never modifies the hotfix's own source.
;;
;; Usage: bb bl1560ToolMissHealCli.bb <subcommand> '<json-args>'
;;   classify '{"output":"..."}'
;;     -> {"verdict":"missing-script-path"}
;;   heal '{"missClass":"missing-script-path","command":"...","worktree":"/w"}'
;;     -> {"healed":"cd '/w' && (\n...\n)"} or {"healed":null} when declined
;;   wrapper '{"command":"...","worktree":"/w"}'
;;     -> {"wrapper":"<full generated bash source>"}
;; Prints one JSON line.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def repo-root
  (-> *file* fs/absolutize fs/parent fs/parent fs/parent fs/parent fs/parent str))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "tool_miss_heal_lib.bb")))

(let [[subcommand raw-args] *command-line-args*
      args (json/parse-string raw-args true)]
  (case subcommand
    "classify"
    (println (json/generate-string
              {:verdict (name (tool-miss-heal-lib/classify-miss (:output args)))}))

    "heal"
    (let [miss-class (keyword (:missClass args))
          healed (tool-miss-heal-lib/healed-command miss-class (:command args) (:worktree args))]
      (println (json/generate-string {:healed healed})))

    "wrapper"
    (println (json/generate-string
              {:wrapper (tool-miss-heal-lib/build-healing-wrapper-command (:command args) (:worktree args))}))

    (do
      (binding [*out* *err*]
        (println (str "unknown subcommand: " subcommand)))
      (System/exit 1))))
