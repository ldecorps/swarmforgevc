;; idle_clear_fullness_cli.bb — BL-1238: the IO half of the agent-side
;; idle-clear fullness gate. idle_clear_fullness_lib.bb holds the pure
;; decision; this file does only the reading (config threshold, pane-
;; history proxy fullness) and composes them for the two call sites
;; (ready_for_next_task.bb / ready_for_next_batch.bb).
;;
;; No telemetry source exists on the agent side today (same reality
;; contextFullness.ts's own comment documents for the extension-host side):
;; every backend this swarm drives is captured via tmux, never self-
;; reporting token usage, so telemetry-percent is always nil here and the
;; proxy always decides. The hook stays real (not stubbed) so a future
;; telemetry source needs no interface change here.

(ns idle-clear-fullness-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "idle_clear_fullness_lib.bb")))

;; Same constant the extension-host side calibrates the identical proxy
;; against (extension/src/extension.ts CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT)
;; - kept here as a plain literal rather than parsed out of the .ts file,
;; since babashka cannot import TypeScript; both sides are pinned to 400 by
;; this comment pointing at each other, the same convention this project
;; uses elsewhere for a mirrored cross-language constant.
(def proxy-full-at-line-count 400)

(def default-fullness-threshold-percent
  "Matches extension/package.json's declared default for
   swarmforge.contextClear.fullnessThresholdPercent - read dynamically
   below when possible; this is the fallback only when neither a workspace
   override nor the package.json default itself can be read."
  75)

(defn- read-json-file [path]
  (try
    (when (fs/exists? path)
      (json/parse-string (slurp (str path)) true))
    (catch Exception _ nil)))

(defn read-fullness-threshold-percent
  "Reads the SAME setting key the extension-host path reads
   (swarmforge.contextClear.fullnessThresholdPercent) - a workspace
   .vscode/settings.json override first, else extension/package.json's own
   declared default, else the literal fallback above. Never a second,
   independently-chosen number."
  ([] (read-fullness-threshold-percent (handoff-lib/target-root)))
  ([root]
   (let [key "swarmforge.contextClear.fullnessThresholdPercent"
         workspace (get (read-json-file (fs/path root ".vscode" "settings.json")) (keyword key))
         package-default (get-in (read-json-file (fs/path root "extension" "package.json"))
                                  [:contributes :configuration :properties (keyword key) :default])]
     (cond
       (number? workspace) workspace
       (number? package-default) package-default
       :else default-fullness-threshold-percent))))

(defn- own-pane-capture-lines
  "The role's own pane scrollback, via $TMUX_PANE - the process is running
   INSIDE its own pane (the agent CLI itself), so this needs no role->
   session/window/pane lookup the way the external extension-host side
   does; tmux resolves it directly. nil when TMUX_PANE is unset or the
   capture fails - the caller's own :unavailable path, never a guessed 0."
  []
  (let [pane (System/getenv "TMUX_PANE")]
    (when-not (clojure.string/blank? pane)
      (let [res (daemon-cycle-guard-lib/sh! "tmux" "-S" (handoff-lib/tmux-socket)
                                             "capture-pane" "-p" "-t" pane
                                             "-S" (str "-" proxy-full-at-line-count))]
        (when (zero? (:exit res))
          (count (clojure.string/split-lines (:out res))))))))

(defn read-context-fullness
  "{:telemetry-percent nil :proxy-percent num-or-nil} - the raw inputs
   idle-clear-fullness-lib/resolve-fullness expects. telemetry-percent is
   always nil today (see header comment); proxy-percent is nil when the
   pane capture could not be read at all."
  []
  (let [lines (own-pane-capture-lines)]
    {:telemetry-percent nil
     :proxy-percent (when lines
                      (* 100.0 (/ (min lines proxy-full-at-line-count) proxy-full-at-line-count)))}))

(defn should-respawn?
  "The full IO-plus-decision composition both call sites use: opt-in
   (unchanged BL-089 gate) stays authoritative and first - checked before
   any pane capture or config read is even attempted, both because
   should-idle-clear? itself enforces that order and to skip the tmux call
   entirely for the common case (a role that never opted in)."
  [role]
  (and (handoff-lib/idle-clear-enabled? role)
       (idle-clear-fullness-lib/should-idle-clear?
         {:opt-in? true
          :fullness (idle-clear-fullness-lib/resolve-fullness (read-context-fullness))
          :threshold-percent (read-fullness-threshold-percent)})))
