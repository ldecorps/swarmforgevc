#!/usr/bin/env bb
;; aps_equivalence_runner.bb (BL-959) - runs ONE toolchain (pinned vendored
;; copy or the candidate clone) over the equivalence corpus and writes its
;; result set under the work dir. The comparator (aps_equivalence_cli.bb)
;; then turns two such result sets into the verdict matrix.
;;
;;   usage: aps_equivalence_runner.bb <side> <toolchain-dir> <repo-root> <work-dir>
;;     side          pinned | candidate
;;     toolchain-dir a directory holding bb.edn + bb/src (the vendored copy,
;;                   or the throwaway candidate clone)
;;
;; The toolchain's OWN code runs - its bb/src goes on the classpath and its
;; namespaces are called exactly as its CLIs call them (never reimplemented,
;; per engineering.prompt):
;;   - lint-parse: aps.gherkin/parse-file + write-json! (the gherkin-parser
;;     CLI's exact body; each side's 1-arg call is its own CLI default -
;;     the candidate's defaults inference ON, which is what a pin bump would
;;     give gherkin_lint_gate.sh), then the REAL gherkin_lint_gate_cli.bb is
;;     spawned over the produced IR - the same two-step sequence
;;     gherkin_lint_gate.sh runs.
;;   - ir-dry: aps.json/read-json-file + aps.dry/analyze (the
;;     gherkin-ir-dry-checker CLI's exact body, include-exact off = its
;;     default); the outcome is the FINDING SET, not file bytes.
;;   - mutation-sites: aps.gherkin/parse-file + aps.mutation/discover over
;;     the existing gherkin-mutation fixture - enumeration only, no
;;     mutation loop runs.
;;
;; Every write goes to a lib-derived path under the work dir (declared
;; invariant 1 - the pinned surfaces are read-only to this run; the
;; toolchain dir itself is only ever READ).

(require '[babashka.fs :as fs]
         '[babashka.classpath :as cp]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "aps_equivalence_lib.bb")))

(def mutation-fixture "specs/pipeline/test/fixtures/mutation-wiring.feature")

(defn- die! [msg]
  (binding [*out* *err*] (println msg))
  (System/exit 2))

(def ^:private cli-args
  (let [[side toolchain-dir repo-root work-dir corpus-limit] *command-line-args*]
    (when-not (and (#{"pinned" "candidate"} side) toolchain-dir repo-root work-dir)
      (die! "usage: aps_equivalence_runner.bb <side> <toolchain-dir> <repo-root> <work-dir> [corpus-limit]"))
    (let [toolchain (str (fs/canonicalize toolchain-dir))]
      (when-not (fs/exists? (fs/path toolchain "bb" "src"))
        (die! (str "toolchain dir has no bb/src: " toolchain)))
      {:side side
       :toolchain toolchain
       :root (str (fs/canonicalize repo-root))
       :work (str (fs/canonicalize work-dir))
       :corpus-limit corpus-limit})))

;; The toolchain's own code goes on the classpath BEFORE the next top-level
;; form is analyzed, so the aliases below resolve.
(cp/add-classpath (str (fs/path (:toolchain cli-args) "bb" "src")))

(require '[aps.gherkin :as gherkin]
         '[aps.dry :as dry]
         '[aps.json :as aps-json]
         '[aps.mutation :as mutation])

(let [{:keys [side toolchain root work corpus-limit]} cli-args
      ;; Shim-evaluation seam (report section 4): APS_EQUIVALENCE_NO_INFER=1
      ;; parses via the candidate's {:infer? false} arity - the exact IR a
      ;; --do-not-infer shim would give the gates. Candidate toolchain only:
      ;; the pinned parse-file has no options arity.
      no-infer? (some? (System/getenv "APS_EQUIVALENCE_NO_INFER"))
      parse-feature (if no-infer?
                      #(gherkin/parse-file % {:infer? false})
                      #(gherkin/parse-file %))
      scrub {toolchain "<toolchain>" work "<work>"}
      jsonify #(json/parse-string (json/generate-string %))
      write-outcome! (fn [gate entry outcome]
                       (let [p (aps-equivalence-lib/result-file-path work side gate entry)]
                         (fs/create-dirs (fs/parent p))
                         (spit p (json/generate-string {:entry entry :outcome outcome}))))
      corpus (cond->> (->> (fs/glob (fs/path root "specs" "features") "*.feature")
                           (map #(str "specs/features/" (fs/file-name %)))
                           sort)
               corpus-limit (take (parse-long corpus-limit)))]
  (println (str side ": " (count corpus) " corpus entries, toolchain " toolchain))

  (doseq [entry corpus]
    (let [abs (str (fs/path root entry))
          ir (aps-equivalence-lib/temp-ir-path work side entry)
          _ (fs/create-dirs (fs/parent ir))
          parse (try (gherkin/write-json! ir (parse-feature abs))
                     {:exit 0}
                     (catch Exception e {:exit 1 :error (.getMessage e)}))]
      ;; lint-parse: parser verdict, then the real lint CLI over the IR
      (write-outcome!
       "lint-parse" entry
       (if (not= 0 (:exit parse))
         (aps-equivalence-lib/normalize-lint-outcome 1 (:error parse) root scrub)
         (let [{:keys [exit out err]} @(process/process
                                        ["bb" (str (fs/path root "swarmforge" "scripts" "gherkin_lint_gate_cli.bb"))
                                         abs ir root]
                                        {:out :string :err :string})]
           (aps-equivalence-lib/normalize-lint-outcome exit (str out err) root scrub))))
      ;; ir-dry: the checker CLI's body over the same IR
      (write-outcome!
       "ir-dry" entry
       (if (not= 0 (:exit parse))
         {"exit" 1 "error" "parser failed - no IR to analyze"}
         (try {"exit" 0
               "findings" (aps-equivalence-lib/normalize-dry-findings
                           (jsonify (dry/analyze (aps-json/read-json-file ir) {:include-exact false})))}
              (catch Exception e
                {"exit" 1
                 "error" (reduce-kv (fn [s from to] (str/replace s from to))
                                    (str/replace (str (.getMessage e)) (str root "/") "")
                                    scrub)}))))))

  ;; mutation-sites: enumeration only over the existing fixture
  (write-outcome!
   "mutation-sites" mutation-fixture
   (try {"exit" 0
         "sites" (jsonify (mutation/discover (parse-feature (str (fs/path root mutation-fixture)))))}
        (catch Exception e
          {"exit" 1 "error" (str/replace (str (.getMessage e)) (str root "/") "")})))

  (println (str side ": done - results under " work "/results/" side)))
