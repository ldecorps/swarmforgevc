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
            [cheshire.core :as json]
            [clojure.string :as str]))

;; BL-313: conf-file-path used to hardcode the tracked default config,
;; silently ignoring a launch-time --pack/SWARMFORGE_CONFIG override -
;; swarmforge.sh resolves the effective config for PROVISIONING via that
;; override, but nothing propagated it to a role's own process (no env var
;; is exported into tmux panes, no other state file recorded it), so this
;; reader - and both its callers, swarm_handoff.bb's WARNING and
;; compliance_battery_lib.bb's simulated AUTO-PROMOTE check - kept
;; enforcing the default file's own cap even when a different pack
;; actually launched the swarm. swarmforge.sh now persists the effective
;; config path it resolved at launch into .swarmforge/swarm-identity
;; (write_swarm_identity_file), the same durable per-launch state
;; swarm_identity_lib.bb already reads generically.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))

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

(def default-conf-relpath
  "The tracked default config - used both as the historical BL-216 fallback
   (not the nonexistent .swarmforge/swarmforge.conf both call sites used to
   read, which made slurp throw on every call) and, per BL-313, as the
   effective config for a bare launch with no pack/override at all."
  ["swarmforge" "swarmforge.conf"])

(defn conf-file-path
  "BL-313: the EFFECTIVE config for the swarm that is actually running -
   the path swarmforge.sh persisted into .swarmforge/swarm-identity at
   launch time (whichever --pack/SWARMFORGE_CONFIG override was used), or
   the tracked default swarmforge/swarmforge.conf when no launch persisted
   one (a bare launch, or a test/compliance-battery fixture that writes a
   conf file directly and never runs swarmforge.sh at all - both must keep
   reading the default file exactly as before).

   BL-313 bounce (QA): a RELATIVE persisted path (produced whenever
   SWARMFORGE_CONFIG itself was exported as a relative path at launch) must
   resolve against project-root, never against the calling process's own
   cwd - every pipeline role invokes swarm_handoff.bb/ready_for_next.bb
   from its own .worktrees/<role> directory, never from project-root, so a
   bare relative string silently failed to resolve everywhere except the
   original launch cwd. (fs/path project-root persisted) is defense in
   depth even though swarmforge.sh now also normalizes to absolute before
   persisting: java.nio's own Path/resolve returns an ABSOLUTE second
   argument verbatim, so this is correct for both cases with no branch."
  [project-root]
  (let [persisted (get (swarm-identity-lib/read-swarm-identity project-root)
                        "active_backlog_max_depth_conf_path")]
    (if (not-empty persisted)
      (fs/path project-root persisted)
      (apply fs/path project-root default-conf-relpath))))

(defn read-max-depth
  "The impure fs-reading half: slurps the real tracked config and parses it
   via parse-max-depth above. An absent/unreadable config degrades to
   default-max-depth, never a crash."
  [project-root]
  (parse-max-depth
   (try (slurp (str (conf-file-path project-root))) (catch Exception _ nil))))

;; ── BL-432 (epic BL-429 slice 3 - ACT): the auto-throttle EFFECTIVE cap ────
;; Article 3.5 already sanctions the coordinator lowering active_backlog_max_depth
;; on a health spike and restoring it on recovery; this is the code that
;; automates it against BL-431's rework diagnosis instead of a coordinator LLM
;; turn remembering to do it by hand.

(def throttle-recommendation-relpath
  "The JSON sidecar extension/src/tools/emit-throttle-recommendation.ts (BL-432)
   writes on every call - .swarmforge/coordinator/throttle-recommendation.json.
   Babashka has no way to import compiled TS, so this reads the TS CLI's own
   persisted output rather than re-deriving the diagnosis here."
  [".swarmforge" "coordinator" "throttle-recommendation.json"])

(defn throttle-recommendation-path [project-root]
  (apply fs/path project-root throttle-recommendation-relpath))

(defn read-recommended-cap
  "The impure fs-reading half of the recommendation: nil (no throttle
   recommended - the caller applies the configured cap unchanged) for a
   missing/unreadable/malformed file, EXACTLY the same degrade-never-crash
   posture read-max-depth above uses for its own config file. A present but
   non-numeric recommendedCap (a future field-shape drift) also degrades to
   nil rather than propagating a bad value into the promotion gate."
  [project-root]
  (try
    (let [parsed (json/parse-string (slurp (str (throttle-recommendation-path project-root))) true)
          cap (:recommendedCap parsed)]
      (when (int? cap) cap))
    (catch Exception _ nil)))

(defn effective-max-depth
  "Pure: the promotion gate's actual ceiling - min(configured, recommended),
   with two guards neither ticket text nor a bare `min` alone gets right:
   (1) nil recommended (no throttle in effect) leaves configured completely
   untouched - never coerced through min at all. (2) a NO-LIMIT configured
   cap (-1, `no-limit?` above) is not a real number to `min` against; a
   negative sentinel would always 'win' a bare min and permanently lock the
   swarm at -1 regardless of any recommendation, so an unlimited configured
   cap resolves straight to the recommendation instead - the ticket's own
   'a cap of -1 is respected as no configured ceiling, but the recommendation
   can still impose a temporary finite effective ceiling' contract. Every
   other case is an ordinary min, which already guarantees the 'never raises
   above configured' contract (acceptance scenario 04) for free."
  [configured recommended]
  (cond
    (nil? recommended) configured
    (no-limit? configured) recommended
    :else (min configured recommended)))

(defn read-effective-max-depth
  "The impure end-to-end read: configured cap (read-max-depth) folded with
   the currently-recommended throttle (read-recommended-cap) via
   effective-max-depth above - the ONE value the coordinator's promotion
   decision should ever compare an active count against."
  [project-root]
  (effective-max-depth (read-max-depth project-root) (read-recommended-cap project-root)))
