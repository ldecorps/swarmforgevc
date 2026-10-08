;; BL-2065: compiles main's COMMITTED extension/ tree, never whatever the
;; master checkout's working tree happens to hold. front_desk_supervisor.bb's
;; own ensure-current-build! used to run `npm run compile` directly inside
;; the live checkout's extension/ - tsc compiled whatever was on disk at that
;; moment, uncommitted/untracked files included, then stamped the result
;; with main's sha as if it had compiled THAT. On 2026-10-07 an uncommitted,
;; hand-made BL-1911 implementation sat in the master checkout from 07:41Z
;; and every recompile from 07:46Z (about twenty that morning) built it in,
;; and the cursor bridges the bridge supervisor started loaded it with a
;; leaky secret filter (QA note 003900).
;;
;; `git archive <sha> -- extension` reads ONLY the committed tree at that
;; sha - it never touches the working tree or the index, so an uncommitted
;; edit or an untracked file has no path into the export (invariant 1). The
;; export lands in a fresh temp directory, never inside the master
;; checkout's own extension/ (except the final swap of out/ itself, the
;; designated compiled-output destination) - nothing else under the master
;; checkout's working tree is ever read, written, staged, restored or
;; deleted (invariant 2).
;;
;; node_modules is never committed, so it is symlinked in (read-only, from
;; the live checkout, into the fresh temp dir - never the other direction)
;; for the compile step to resolve its own dependencies, same shape
;; pre_qa_gate_gather_lib.bb's materialize-pipeline-tree-at-commit! already
;; uses for specs/pipeline fixtures.
;;
;; BUILD_SHA is stamped here directly with the sha this function was TOLD to
;; build (never re-derived by shelling `git rev-parse HEAD` inside the
;; export, which has no .git of its own and would either fail or - if the
;; temp dir happened to be nested under a real checkout - report the wrong
;; thing). extension/scripts/stampBuildSha.js's own postcompile write (it
;; fails soft when it finds no .git) is simply overwritten by this, the one
;; correct answer.
;;
;; Deliberately no adapter injection (unlike front_desk_supervisor_lib.bb's
;; own pure decisions): every scenario here drives the REAL git/npm/fs
;; calls against a real fixture project, never a mock - the same posture
;; mergedCodeReachesDaemonsSteps.js and pre_qa_gate_gather_lib.bb already
;; take for their own fixture-driven acceptance coverage.
(ns safe-recompile-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]))

(defn- export-main-tree!
  "Writes main-sha's committed extension/ subtree into tmp-dir/extension,
   via git's own archive of that commit - the working tree and index are
   never consulted, so whatever either holds cannot reach the export."
  [project-root main-sha tmp-dir]
  (let [archive-path (str (fs/path tmp-dir "main-extension.tar"))]
    (let [{:keys [exit err]} (process/sh {:continue true :dir (str project-root)}
                                          "git" "archive" "--format=tar" "-o" archive-path main-sha "--" "extension")]
      (when-not (zero? exit)
        (throw (ex-info (str "git archive failed: " err) {}))))
    (let [{:keys [exit err]} (process/sh {:continue true :dir (str tmp-dir)} "tar" "-xf" archive-path)]
      (when-not (zero? exit)
        (throw (ex-info (str "tar extract failed: " err) {}))))
    (fs/delete archive-path)))

(defn- link-node-modules!
  "Best-effort: node_modules is never committed, so it has no place in
   main's archived tree. A fixture project with no node_modules of its own
   (every BL-2065 acceptance scenario) simply compiles without it."
  [project-root tmp-dir]
  (let [target (fs/path project-root "extension" "node_modules")]
    (when (fs/exists? target)
      (fs/create-sym-link (fs/path tmp-dir "extension" "node_modules") (fs/canonicalize target)))))

(defn- stamp-build-sha! [tmp-dir main-sha]
  (let [out-dir (fs/path tmp-dir "extension" "out")]
    (fs/create-dirs out-dir)
    (spit (str (fs/path out-dir "BUILD_SHA")) (str main-sha "\n"))))

(defn- stage-and-swap-out!
  "Replaces the master checkout's extension/out with the freshly compiled
   one. built-out may be on a different filesystem from the live checkout
   (the temp dir is not required to be a sibling of it) - staging is copied
   in first so the one rename that actually replaces the live out/ is a
   same-device, same-parent rename, never a cross-device one. Every other
   file under the master checkout's extension/ is untouched - this never
   reads, writes, stages, restores or deletes anything outside out/ itself."
  [project-root tmp-dir]
  (let [built-out (fs/path tmp-dir "extension" "out")
        live-extension (fs/path project-root "extension")
        live-out (fs/path live-extension "out")
        staging (fs/path live-extension (str "out.building-" (System/currentTimeMillis) "-" (System/nanoTime)))]
    (when-not (fs/exists? built-out)
      (throw (ex-info "compile produced no out/ directory" {})))
    (fs/copy-tree built-out staging)
    (try
      (when (fs/exists? live-out)
        (fs/delete-tree live-out))
      (fs/move staging live-out {:atomic-move true})
      (catch Exception e
        (fs/delete-tree staging {:force true})
        (throw e)))))

(defn recompile-extension-from-main!
  "Compiles project-root's main-sha-committed extension/ tree and swaps the
   result into the live extension/out, whatever the working tree currently
   holds. Returns nil on success, or an error string on failure - a failed
   recompile is a caller decision (front_desk_supervisor.bb still respawns
   on the stale build rather than staying down), never an exception that
   propagates out of this function."
  [project-root main-sha]
  (let [tmp-dir (str (fs/create-temp-dir {:prefix "sfvc-safe-recompile-"}))]
    (try
      (export-main-tree! project-root main-sha tmp-dir)
      (link-node-modules! project-root tmp-dir)
      (let [{:keys [exit err]} (process/sh {:continue true :dir (str (fs/path tmp-dir "extension"))} "npm" "run" "compile")]
        (if (zero? exit)
          (do
            (stamp-build-sha! tmp-dir main-sha)
            (stage-and-swap-out! project-root tmp-dir)
            nil)
          (str "npm run compile failed: " err)))
      (catch Exception e (ex-message e))
      (finally (fs/delete-tree tmp-dir {:force true})))))
