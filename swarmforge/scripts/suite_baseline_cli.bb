#!/usr/bin/env bb
;; suite_baseline_cli.bb — BL-1377: run a suite once when the base half of the
;; answer is already recorded, and twice whenever it is not.
;;
;; A role runs this INSTEAD of the bare suite command, so adopting it is one
;; substitution in the evidence step rather than a new habit:
;;
;;   suite_baseline.sh unit [--base <sha>] [--recorded-by coder] [--json]
;;
;; It prints the evidence sentence on the last line. Every decision is
;; suite_baseline_lib's; this file owns only the impure half - the base sha,
;; the config hash, the record file, and the two suite runs.
;;
;; The base run happens in a THROWAWAY WORKTREE at the base sha. The stage's
;; own worktree is never checked out from under it: a helper that moved a
;; role's HEAD to measure something would be a far worse bug than the minutes
;; it saved.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "suite_baseline_lib.bb")))

(defn- die! [code & msg]
  (binding [*out* *err*] (println (str/join " " msg)) (flush))
  (System/exit code))

(defn- sh [dir & cmd]
  (apply process/sh {:dir (str dir) :continue true} cmd))

(defn parse-args
  "Pure: argv -> options, or {:error \"...\"}. Exported so the whole parse is
   testable in-process without argv (the CLI thin-wrapper rule)."
  [argv]
  (loop [args (vec argv) acc {}]
    (if (empty? args)
      (if (:suite acc) acc {:error "no suite named"})
      (let [[a & more] args]
        (case a
          "--base" (if-let [v (first more)]
                     (recur (vec (rest more)) (assoc acc :base v))
                     {:error "--base needs a value"})
          "--recorded-by" (if-let [v (first more)]
                            (recur (vec (rest more)) (assoc acc :recorded-by v))
                            {:error "--recorded-by needs a value"})
          "--json" (recur (vec more) (assoc acc :json? true))
          (cond
            (str/starts-with? a "--") {:error (str "unknown option " a)}
            (:suite acc) {:error (str "more than one suite named: " (:suite acc) " and " a)}
            :else (recur (vec more) (assoc acc :suite a))))))))

(defn- project-root []
  (let [{:keys [exit out]} (sh "." "git" "rev-parse" "--show-toplevel")]
    (when (zero? exit) (str/trim out))))

(defn- resolve-base [root base]
  (let [rev (or base "origin/main")
        {:keys [exit out]} (if base
                             (sh root "git" "rev-parse" "--verify" "--quiet" (str base "^{commit}"))
                             (sh root "git" "merge-base" "HEAD" rev))]
    (when (zero? exit) (str/trim out))))

(defn- config-hash
  "A hash of the suite's own config files. A MISSING file contributes its
   absence rather than nothing at all: deleting a config must move the hash,
   or an old record would keep applying to a suite that no longer has one."
  [root paths]
  (let [material (str/join "\n"
                           (for [p (sort paths)
                                 :let [f (fs/path root p)]]
                             (str p "\t"
                                  (if (fs/exists? f)
                                    (str (fs/size f) ":" (hash (slurp (str f))))
                                    "ABSENT"))))]
    (format "%08x" (hash material))))

(defn- records-file [root suite]
  (fs/path root ".swarmforge" "suite-baselines" (str suite ".jsonl")))

(defn read-records
  "Every entry in the record file, in order, or {:error \"...\"}. A single
   unparseable line makes the WHOLE file unreadable rather than being skipped:
   silently dropping a line is how a record shrinks into a smaller excuse."
  [file]
  (if-not (fs/exists? file)
    {:records []}
    (try
      {:records (vec (for [line (str/split-lines (slurp (str file)))
                           :when (seq (str/trim line))]
                       (json/parse-string line true)))}
      (catch Exception e {:error (or (.getMessage e) "unparseable record file")}))))

(defn- append-record! [file entry]
  (fs/create-dirs (fs/parent file))
  (spit (str file) (str (json/generate-string entry) "\n") :append true))

;; ── the suite runs ────────────────────────────────────────────────────────
;;
;; One seam, used by both runs, so the base run and the parcel run can never
;; be measured two different ways. A test supplies its own runner; without one
;; the suite's real command runs and its failing test names are read back.

(defn- default-run [dir command]
  (let [{:keys [out err]} (sh (str (fs/path dir "extension")) "bash" "-lc" command)
        text (str out err)]
    (->> (str/split-lines text)
         (keep #(second (re-matches #"^\s*(?:FAIL|×)\s+(\S+.*?)\s*$" %)))
         distinct
         vec)))

(defn- run-suite [{:keys [suite command]} dir]
  (if-let [runner (not-empty (System/getenv "SUITE_BASELINE_RUNNER"))]
    (let [{:keys [exit out err]} (sh dir runner suite (str dir))]
      (when-not (zero? exit)
        (die! 1 (str "the suite runner failed for " suite " in " dir ":\n" err out)))
      (vec (remove str/blank? (map str/trim (str/split-lines (str out))))))
    (default-run dir command)))

(defn- with-base-worktree
  "Run `f` against a throwaway worktree at `base-sha`, removed in a finally and
   swept by prefix beforehand (BL-971: a killed run traps nothing)."
  [root base-sha f]
  (let [parent (fs/path root ".worktrees")
        prefix "suite-baseline-"
        dir (str (fs/path parent (str prefix base-sha)))]
    (doseq [d (when (fs/exists? parent) (fs/list-dir parent))
            :when (str/starts-with? (fs/file-name d) prefix)]
      (sh root "git" "worktree" "remove" "--force" (str d))
      (fs/delete-tree d))
    (let [{:keys [exit err]} (sh root "git" "worktree" "add" "--detach" dir base-sha)]
      (when-not (zero? exit)
        (die! 1 (str "could not create a base worktree at " base-sha ": " (str/trim (str err))))))
    (try
      (f dir)
      (finally
        (sh root "git" "worktree" "remove" "--force" dir)
        (fs/delete-tree dir)))))

(defn -main [& argv]
  (let [opts (parse-args argv)]
    (when-let [e (:error opts)]
      (die! 2 (str e "\nusage: suite_baseline.sh <suite> [--base <sha>] [--recorded-by <role>] [--json]"
                   "\nsuites: " (str/join ", " (suite-baseline-lib/suite-names)))))
    (let [spec (suite-baseline-lib/suite (:suite opts))]
      (when-not spec
        (die! 2 (str "unknown suite '" (:suite opts) "' - defined suites are "
                     (str/join ", " (suite-baseline-lib/suite-names)))))
      (let [root (or (project-root) (die! 1 "not inside a git repository"))
            base (or (resolve-base root (:base opts))
                     (die! 1 (str "could not resolve the base commit "
                                  (or (:base opts) "(merge-base HEAD origin/main)"))))
            key {:suite (:suite opts)
                 :base-sha base
                 :config-hash (config-hash root (:config-paths spec))}
            file (records-file root (:suite opts))
            {:keys [records error]} (read-records file)
            observed (run-suite (assoc spec :suite (:suite opts)) root)
            decision (suite-baseline-lib/decide
                      {:key key
                       :record (when-not error (suite-baseline-lib/nearest-record records key))
                       :record-error error
                       :observed observed})
            final (if-not (:second-run? decision)
                    decision
                    ;; The second run is the truth: whatever the record said,
                    ;; the base half is measured now and the diff is against
                    ;; THAT. A record is never allowed to colour this answer.
                    (let [base-reds (with-base-worktree root base #(run-suite (assoc spec :suite (:suite opts)) %))]
                      (when (:write-baseline? decision)
                        (append-record! file (suite-baseline-lib/record-entry
                                              {:key key :reds base-reds
                                               :recorded-by (or (:recorded-by opts)
                                                                (System/getenv "SWARMFORGE_ROLE"))
                                               :at (str (java.time.Instant/now))})))
                      (assoc (suite-baseline-lib/decide
                              {:key key
                               :record (suite-baseline-lib/record-entry {:key key :reds base-reds})
                               :observed observed})
                             ;; it was a two-run pass however it ends, and the
                             ;; evidence must not claim a base run was skipped.
                             :second-run? true
                             :reason (:reason decision)
                             :ran-base? true)))]
        (when (:json? opts)
          (println (json/generate-string (dissoc final :key)))
          (println (json/generate-string {:key key})))
        (println (suite-baseline-lib/evidence-line final))
        (flush)
        (System/exit 0)))))

(apply -main *command-line-args*)
