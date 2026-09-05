#!/usr/bin/env bb
;; BL-1121 invariants over check_property_suite_drift.sh source + behavior markers.
;; I1: SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD remains recovery-only (documented;
;;     standing skip uses skip-reconcile-import, not the env).
;; I2: non-reconcile staging of extension/src still reaches the run marker.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo (str (fs/canonicalize (fs/path script-dir ".." ".." ".."))))
(def guard (str (fs/path repo "swarmforge" "scripts" "check_property_suite_drift.sh")))
(def guard-src (slurp guard))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

;; I1: recovery override stays recovery-only in the standing script text.
(when-not (re-find #"recovery-only" guard-src)
  (fail! "guard must document SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD as recovery-only"))
(when-not (re-find #"skip-reconcile-import" guard-src)
  (fail! "guard must emit skip-reconcile-import for the standing recipe"))
(when (re-find #"SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1.*standing" guard-src)
  (fail! "must not describe the env override as the standing recipe"))

(defn- sh!
  ([args] (sh! args nil))
  ([args dir]
   (let [opts (cond-> {:out :string :err :string}
                dir (assoc :dir dir))
         r @(process/process args opts)]
     {:exit (:exit r) :out (str (:out r) (:err r))})))

(defn- git! [root & args]
  (sh! (into ["git" "-C" root "-c" "user.email=test@test" "-c" "user.name=test"] args)))

;; I2: ordinary extension/src stage → run marker (no MERGE_HEAD).
(let [tmp (str (fs/create-temp-dir {:prefix "bl1121-prop-"}))
      _ (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))
      _ (git! tmp "init" "-q" "-b" "main")
      _ (git! tmp "commit" "-q" "--allow-empty" "-m" "init")
      rel "extension/src/pipelineBoard.ts"
      full (str (fs/path tmp rel))]
  (fs/create-dirs (fs/parent full))
  (spit full "fresh\n")
  (git! tmp "add" rel)
  (let [r (sh! ["bash" guard "bash" "-c" "exit 0"] tmp)]
    (when-not (zero? (:exit r))
      (fail! (str "I2: ordinary commit guard must exit 0, got " (:exit r) " " (:out r))))
    (when-not (re-find #"property-suite-guard: run" (:out r))
      (fail! (str "I2: ordinary extension/src must print run; out=" (:out r))))
    (when (re-find #"skip-reconcile-import" (:out r))
      (fail! "I2: ordinary commit must not print skip-reconcile-import"))))

(if (empty? @failures)
  (println "bl1121_reconcile_import_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1121_reconcile_import_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
