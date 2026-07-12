;; BL-314: the coordinator's model/effort become pack-configurable instead
;; of hardcoded. Mirrors backlog_depth_lib.bb's own shape (a pure
;; conf-text parser + a shared default), reusing BL-313's own "whichever
;; conf file is EFFECTIVELY in force at launch" resolution - here that is
;; simply $CONFIG_FILE itself (already resolved by swarmforge.sh before
;; provision_coordinator runs, in the SAME process, so there is no
;; cross-process persistence need the way active_backlog_max_depth had).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "coordinator_config_lib.bb")))
;; and referred to as coordinator-config-lib/foo.

(ns coordinator-config-lib
  (:require [clojure.string :as str]))

(def default-coordinator-model
  "The now-default coordinator tier - Sonnet, not Opus. A pack that
   genuinely wants an Opus coordinator sets `config coordinator_model
   claude-opus-4-8` explicitly (BL-314)."
  "claude-sonnet-5")

(def default-coordinator-effort
  "Used only when coordinator_effort is absent/blank/malformed - never
   masks a real explicit value as a crash."
  "high")

(def default-coordinator-agent
  "BL-319: absent/blank preserves every existing pack's exact prior
   behavior (the coordinator was always claude before this ticket).
   Unlike model/effort, an EXPLICIT but unrecognized value is not this
   pure fn's concern to reject - swarmforge.sh's validate_agent (the
   same allow-list check a bogus window-line agent already fails) is the
   one enforcement point, so a provider added there is automatically
   usable here with no second allow-list to keep in sync."
  "claude")

(defn parse-config-value
  "Pure: the value of a `config <key> <value...>` line from conf-text's own
   text, or default when the line is absent or its value is
   blank/whitespace-only. Mirrors backlog_depth_lib.bb's own
   parse-max-depth shape - one shared style for every simple `config <key>
   <value>` directive, so a coordinator_model/coordinator_effort line is
   read exactly the same way active_backlog_max_depth already is."
  [conf-text key default]
  (or (some->> (str/split-lines (or conf-text ""))
               (filter #(str/starts-with? % (str "config " key)))
               first
               (re-find (re-pattern (str "^config\\s+" key "\\s+(.*)$")))
               second
               str/trim
               not-empty)
      default))

(defn coordinator-model [conf-text]
  (parse-config-value conf-text "coordinator_model" default-coordinator-model))

(defn coordinator-effort [conf-text]
  (parse-config-value conf-text "coordinator_effort" default-coordinator-effort))

(defn coordinator-agent [conf-text]
  (parse-config-value conf-text "coordinator_agent" default-coordinator-agent))
