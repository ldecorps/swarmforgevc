#!/usr/bin/env bb
;; BL-1702: the local coder probe gate CLI - the thin fs adapter over
;; local_coder_probe_gate_lib.bb's pure gate-decisions. Reads a pack conf
;; (by name under swarmforge/packs/, or a direct path - swarmforge.sh's own
;; real launch passes its already-resolved CONFIG_FILE path directly, so
;; the two never disagree about which file governs a real launch) and the
;; evidence dir, and refuses (nonzero exit) when any driver seat in that
;; pack lacks a passing steward probe summary for its declared model.
;;
;; A pack with no driver seat is a silent no-op (exit 0) - this ticket
;; touches only packs that stand up a local coder under the driver.
;;
;; This CLI reads no PACK_STAFFING_SKIP_GATE (or any other override) env
;; var at all - the ticket's own FIRM invariant is that nothing skips this
;; check, so there is deliberately no code path here that could.
;;
;; Usage:
;;   local_coder_probe_gate_cli.bb <repo-root> <pack-name-or-conf-path> [--evidence-dir <dir>]
;;
;; Exit 0, one line per driver seat "admit\t<seat>\t<model>\t\t<summary-path>",
;;   or "OK: ..." when the pack has no driver seat / no conf was found.
;; Exit 1, one line per refused driver seat "refuse\t<seat>\t<model>\t<reason>\t<summary-path>".
(ns local-coder-probe-gate-cli
  (:require [babashka.fs :as fs]))

(let [here (fs/parent (fs/canonicalize *file*))]
  (load-file (str (fs/path here "local_coder_probe_gate_lib.bb"))))

(defn- resolve-conf-path [repo-root pack-name-or-path]
  (let [direct (fs/path pack-name-or-path)]
    (if (fs/exists? direct)
      direct
      (fs/path repo-root "swarmforge" "packs" (str pack-name-or-path ".conf")))))

(defn- read-evidence-files [evidence-dir]
  (if (fs/directory? evidence-dir)
    (->> (fs/list-dir evidence-dir)
         (filter fs/regular-file?)
         (mapv (fn [p] {:filename (fs/file-name p) :content (slurp (str p))})))
    []))

(defn -main [args]
  (when (< (count args) 2)
    (binding [*out* *err*]
      (println "usage: local_coder_probe_gate_cli.bb <repo-root> <pack-name-or-conf-path> [--evidence-dir <dir>]"))
    (System/exit 2))
  (let [[repo-root pack] args
        rest-args (drop 2 args)
        evidence-dir-override (local-coder-probe-gate-lib/flag-value
                                (clojure.string/join " " rest-args) "--evidence-dir")
        conf-path (resolve-conf-path repo-root pack)
        evidence-dir (or evidence-dir-override (str (fs/path repo-root "backlog" "evidence")))]
    (if-not (fs/exists? conf-path)
      (do (println (str "OK: no pack conf found at " conf-path " - nothing to gate"))
          (System/exit 0))
      (let [windows (local-coder-probe-gate-lib/parse-window-lines (slurp (str conf-path)))
            evidence-files (read-evidence-files evidence-dir)
            decisions (local-coder-probe-gate-lib/gate-decisions windows evidence-files)]
        (if (empty? decisions)
          (do (println "OK: no driver seat in this pack - nothing to gate")
              (System/exit 0))
          (let [refusals (remove #(= "admit" (:decision %)) decisions)]
            (doseq [d decisions]
              (println (clojure.string/join "\t"
                                             [(:decision d) (:seat d) (:model d)
                                              (or (:reason d) "") (or (:summary-path d) "")])))
            (System/exit (if (seq refusals) 1 0))))))))

(-main *command-line-args*)
