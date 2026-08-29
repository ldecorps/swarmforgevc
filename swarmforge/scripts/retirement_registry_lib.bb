#!/usr/bin/env bb
;; BL-1258: a retired ticket's artefact paths, recorded somewhere every
;; worktree can read WITHOUT merging anything.
;;
;; A record committed on `main` is invisible to a branch that has not yet
;; merged main - the exact failure this ticket exists to close (the
;; BL-1247-reconcile-sweep-kill-switch incident: three uncoordinated
;; retirements, on three branches, none reaching main, and nothing stopped
;; the artefacts walking back in). Every role worktree in this swarm is a
;; `git worktree` of the SAME repository, sharing one object database and
;; one ref namespace directly - a ref update is visible to every worktree
;; the instant it happens, regardless of which branch each worktree's own
;; HEAD points at. This lib stores the registry as a single JSON blob
;; pointed at by `refs/retirement/registry` - never a branch, never
;; anything any role's HEAD could accidentally check out, and never
;; anything that depends on ordinary merge traffic to propagate.
;;
;; The registry is a flat {ticket-id [paths...]} map, written as one JSON
;; blob per update (never git-committed history - there is nothing to
;; diff or merge, only the latest map matters). read-registry/write-
;; registry! are the only two operations; retirement_registry_cli.bb is
;; the shell-callable wrapper both check_retirement_readdition.sh and the
;; specifier's own retirement ritual use.

(ns retirement-registry-lib
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def registry-ref "refs/retirement/registry")

(defn- sh-ok [repo-root & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str repo-root) :continue true} args)]
    {:exit exit :out (or out "") :err (str/trim (or err ""))}))

(defn read-registry
  "{ticket-id #{paths}}, or {} when the ref does not exist yet (no
   retirement has ever been recorded) or its blob cannot be parsed as
   JSON (fails safe to empty - never throws, never blocks a caller that
   only wants to know what NOT to refuse)."
  [repo-root]
  (let [{:keys [exit out]} (sh-ok repo-root "git" "cat-file" "-p" registry-ref)]
    (if-not (zero? exit)
      {}
      (try
        (into {} (map (fn [[k v]] [k (set v)])) (json/parse-string out))
        (catch Exception _ {})))))

(defn write-registry!
  "Writes registry-map (ticket-id -> collection-of-paths) as a fresh JSON
   blob and repoints registry-ref at it - a plain `git hash-object -w` +
   `git update-ref`, no commit, no branch, no working-tree checkout
   required of ANY worktree. Returns the new blob sha.
   `:in` (stdin content) must live in process/sh's OPTS map, never as a
   trailing keyword after the command args - the latter is silently
   spliced into argv instead (git then blocks reading a real stdin that
   never arrives, hanging the caller)."
  [repo-root registry-map]
  (let [payload (json/generate-string
                 (into {} (map (fn [[k v]] [k (vec (sort v))])) registry-map))
        {:keys [exit out err]} (process/sh {:dir (str repo-root) :continue true :in payload}
                                            "git" "hash-object" "-w" "--stdin")]
    (when-not (zero? exit)
      (throw (ex-info "retirement-registry-lib: git hash-object failed" {:err (str/trim (or err ""))})))
    (let [blob (str/trim out)
          {:keys [exit err]} (sh-ok repo-root "git" "update-ref" registry-ref blob)]
      (when-not (zero? exit)
        (throw (ex-info "retirement-registry-lib: git update-ref failed" {:err err})))
      blob)))

(defn register-retirement!
  "Merges {ticket-id #{paths}} into the current registry (a ticket already
   present has its path set REPLACED, never unioned - a re-adjudication
   that narrows a retirement's path set must not leave stale paths behind)
   and writes it back. Returns the updated registry map."
  [repo-root ticket-id paths]
  (let [updated (assoc (read-registry repo-root) ticket-id (set paths))]
    (write-registry! repo-root updated)
    updated))

(defn retired-path->ticket-id
  "The ticket id a given path was retired under, or nil when it belongs to
   no retirement. Pure over an already-read registry map (never re-reads
   git itself) so a caller checking many paths against one registry pays
   one read."
  [registry-map path]
  (some (fn [[ticket-id paths]] (when (contains? paths path) ticket-id))
        registry-map))
