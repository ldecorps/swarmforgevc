;; Shared backlog-depth cap reader (BL-216): swarm_handoff.bb's
;; check-backlog-depth WARNING and ready_for_next.bb's
;; promote-next-paused-item-if-needed AUTO-PROMOTE gate were copy-pasted
;; with the identical bug - a WRONG conf path (a nonexistent
;; .swarmforge/swarmforge.conf instead of the real tracked
;; swarmforge/swarmforge.conf), an UNSIGNED regex (#"\d+") that dropped the
;; documented -1 no-limit sentinel's sign (parsing as 1, the tightest
;; possible cap instead of unlimited), and NO BRANCH treating a negative
;; value as "no limit" at all - so even a path+sign fix alone would still
;; compare against -1 as a real cap. ONE shared reader here, used by both
;; call sites, so they cannot diverge again.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "backlog_depth_lib.bb")))
;; and referred to as backlog-depth-lib/foo.

(ns backlog-depth-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def default-max-depth
  "Used only when the config line is absent/unparseable - never masks a
   real negative (no-limit) cap as a crash or a false warning."
  5)

(defn parse-max-depth
  "Pure: active_backlog_max_depth's value from swarmforge.conf's own text,
   or default-max-depth when the config line is absent/unparseable. Parses
   a SIGNED integer (#\"-?\\d+\", not the previous #\"\\d+\") so -1 reads
   as -1, not 1."
  [conf-text]
  (or (some->> (str/split-lines (or conf-text ""))
               (filter #(str/starts-with? % "config active_backlog_max_depth"))
               first
               (re-find #"-?\d+")
               parse-long)
      default-max-depth))

(defn no-limit?
  "The documented sentinel: any negative max-depth means unlimited."
  [max-depth]
  (< max-depth 0))

(defn depth-exceeded?
  "swarm_handoff.bb's WARNING gate: never fires under no-limit, regardless
   of active-count."
  [active-count max-depth]
  (and (not (no-limit? max-depth)) (> active-count max-depth)))

(defn under-depth-cap?
  "ready_for_next.bb's AUTO-PROMOTE gate: always open under no-limit,
   regardless of active-count."
  [active-count max-depth]
  (or (no-limit? max-depth) (< active-count max-depth)))

(defn conf-file-path
  "The REAL tracked config - not the nonexistent .swarmforge/swarmforge.conf
   both call sites used to read (which made slurp throw on every call,
   silently masking the real -1 cap behind default-max-depth)."
  [project-root]
  (fs/path project-root "swarmforge" "swarmforge.conf"))

(defn read-max-depth
  "The impure fs-reading half: slurps the real tracked config and parses it
   via parse-max-depth above. An absent/unreadable config degrades to
   default-max-depth, never a crash."
  [project-root]
  (parse-max-depth
   (try (slurp (str (conf-file-path project-root))) (catch Exception _ nil))))
