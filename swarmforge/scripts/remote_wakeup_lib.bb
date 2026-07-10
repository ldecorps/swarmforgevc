;; BL-092: pure push-event -> nudge/no-nudge decision for the second-swarm
;; remote wake-up bridge. The GH Actions workflow (no business logic
;; itself, just sync + nudge per the ticket) hands remote_wakeup_nudge.bb
;; the paths a push touched; this decides whether any changed backlog item
;; is actually assigned to the target swarm this self-hosted runner serves
;; - a push that only concerns the OTHER (e.g. primary) swarm must not wake
;; this one.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "remote_wakeup_lib.bb")))
;; and referred to as remote-wakeup-lib/foo.

(ns remote-wakeup-lib
  (:require [clojure.string :as str]))

(defn read-swarm-field
  "The swarm: field from one backlog YAML's own text, or nil - absent means
   the primary swarm (BL-090's own convention: no swarm: field written for
   the default/primary assignment)."
  [yaml-text]
  (some (fn [line]
          (let [trimmed (str/trim line)]
            (when (str/starts-with? trimmed "swarm:")
              (not-empty (str/trim (subs trimmed (count "swarm:")))))))
        (str/split-lines (or yaml-text ""))))

(defn backlog-yaml-path?
  "True for a path under backlog/active/ or backlog/paused/ ending .yaml or
   .yml - the only locations a ticket's swarm: assignment can live."
  [path]
  (boolean (re-matches #"backlog/(active|paused)/[^/]+\.ya?ml" (or path ""))))

(defn should-nudge?
  "changed-files: seq of {:path :swarm} for every changed backlog yaml in
   the push (:swarm already extracted by the caller via read-swarm-field -
   nil means primary). target-swarm: the name this runner's swarm answers
   to (e.g. \"second\", matching its own swarmforge.conf's swarm_name).
   True when at least one changed item is assigned to target-swarm."
  [changed-files target-swarm]
  (boolean (some #(= target-swarm (:swarm %)) changed-files)))
