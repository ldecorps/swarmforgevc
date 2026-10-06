;; BL-1982: pure decision helpers for the throttle-release ask-and-apply
;; step effective_backlog_depth_cli.bb runs on every call, after refreshing
;; the recommendation and before printing the effective cap - closing the
;; gap where a pack with no coordinator seat (config coordinator_mode
;; deterministic) would otherwise leave a BL-1981 hold episode awaiting
;; release with nobody asked.
;;
;; Every function here is pure (given the already-parsed recommendation
;; map); the CLI itself owns every IO call (process/sh, file read/write),
;; mirroring effective_backlog_depth_cli.bb's own refresh-recommendation!
;; split between decision and effect.

(ns throttle-release-ask-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_status_lib.bb")))

;; BL-1981's own definition, mirrored exactly (bl1981ThrottleHumanReleaseSteps.js
;; "the throttle recommendation reports no episode awaiting release"): an
;; open episode, unanswered, whose raw signal has already cleared.
(defn episode-awaiting-release?
  [rec]
  (let [ep (:episode rec)]
    (boolean (and ep (nil? (:answer ep)) (:clearedAtIso ep)))))

;; Invariant 1 (BL-1982): at most one question per episode - once this
;; field is set (by the CLI, after a successful role_ask.bb call), the ask
;; step never fires again for the SAME episode. updateThrottleEpisode's own
;; object-spread folding (emit-throttle-recommendation.ts) carries this
;; field forward across refreshes exactly like any other episode field, as
;; long as the episode itself stays open.
(defn question-already-asked?
  [rec]
  (boolean (get-in rec [:episode :releaseAskedAtMs])))

(defn- parse-iso-ms
  [iso]
  (.toEpochMilli (java.time.Instant/parse iso)))

(def release-options ["Release the cap" "Keep the throttle"])

;; Names the opening signal, how long it has read normal, and the
;; configured cap a release restores (scenario 01's own three naming
;; requirements) - exactly the episode's own recorded fields, nothing
;; re-derived.
(defn format-release-question
  [rec now-ms]
  (let [ep (:episode rec)
        duration (swarm-status-lib/format-duration-ms (- now-ms (parse-iso-ms (:clearedAtIso ep))))]
    (format "%s has read normal for %s - the swarm looks healthy. Safe to release the cap back to %d?"
            (:openingSignal ep) duration (:configuredCapAtOpen ep))))

;; Scenario 04: the exact reply text decides which release-intake-throttle
;; answer to apply; anything else (scenario 05) is a typed reply to record,
;; not an answer to act on.
(defn release-reply-kind
  [text]
  (cond
    (= text "Release the cap") :release
    (= text "Keep the throttle") :keep
    :else :typed))
