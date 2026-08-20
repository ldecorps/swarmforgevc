;; aps_equivalence_lib.bb (BL-959) - the pure core of the APS
;; candidate-toolchain equivalence run: two result sets in (pinned toolchain
;; vs candidate toolchain over the same corpus), a per-entry per-gate verdict
;; matrix and an exit code out. The network fetch and the dual toolchain
;; invocation live in the thin boundary around this module
;; (aps_equivalence_runner.bb / aps_equivalence_run.sh), per the
;; thin-wrapper rule - nothing in here touches the network or spawns a
;; process.
;;
;; Fail-closed contract (declared invariant 2): a gate outcome missing from
;; EITHER result set - absent file, unreadable file, or a recorded null -
;; verdicts INCOMPLETE and the run exits non-zero. Absence is never read as
;; equivalence.
;;
;; Write-path containment (declared invariant 1, the lib's half): every path
;; this module derives for the harness to write - result files, matrix
;; renderings - sits strictly under the caller's work dir; entry-slug
;; sanitizes separators and dot-dot so no corpus entry name can climb out
;; into a pinned surface (swarmforge/vendor/aps/, swarmforge.lock.json,
;; upstream-watch.json). The harness's own discipline of CHOOSING a work dir
;; outside those surfaces is process behavior a property test cannot
;; quantify over - recorded as the stated reason in the parcel, and checked
;; live by qa_e2e step 3's git-status assertion.

(ns aps-equivalence-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def gates
  "The three gate lanes of the equivalence corpus (ticket deliverable 2):
   the lint-gate parse, IR generation + the IR-DRY checker, and
   mutation-site enumeration."
  ["lint-parse" "ir-dry" "mutation-sites"])

(def sides ["pinned" "candidate"])

(defn entry-slug
  "Filename-safe form of a corpus entry path. Literal underscores escape
   first (so a separator's `__` stays distinct from them), `..` loses its
   dots, `/` becomes `__`, and every other char outside [A-Za-z0-9._-]
   flattens to `_` - a hostile or malformed entry can never climb out of
   the work dir, and the realistic corpus (repo-relative feature paths)
   maps one-to-one."
  [entry]
  (-> (str entry)
      (str/replace "_" "_5f")
      (str/replace #"\.\." "_")
      (str/replace "/" "__")
      (str/replace #"[^A-Za-z0-9._-]" "_")))

(defn result-file-path
  "Where one gate outcome for one corpus entry lives:
   <work>/results/<side>/<gate>/<slug>.json"
  [work-dir side gate entry]
  (str work-dir "/results/" side "/" gate "/" (entry-slug entry) ".json"))

(defn temp-ir-path
  "Where one side's generated IR for one corpus entry lives while the gates
   consume it: <work>/tmp/<side>/<slug>.ir.json - under the work dir like
   every other write."
  [work-dir side entry]
  (str work-dir "/tmp/" side "/" (entry-slug entry) ".ir.json"))

(defn write-targets
  "Every path the harness writes for a run over these entries: one result
   file per side x gate x entry, the per-side IR temps, plus the two matrix
   renderings. All of them sit under work-dir by construction."
  [work-dir entries]
  (vec (concat (for [side sides, gate gates, entry entries]
                 (result-file-path work-dir side gate entry))
               (for [side sides, entry entries]
                 (temp-ir-path work-dir side entry))
               [(str work-dir "/matrix.txt")
                (str work-dir "/matrix.md")])))

(defn load-result-set
  "{entry {gate outcome}} read back from one side's result files. A missing
   side directory is the empty set (the comparator then verdicts every cell
   INCOMPLETE - fail closed, never a crash). A file that fails to parse
   contributes a nil outcome, which verdict-matrix also treats as absent."
  [work-dir side]
  (let [dir (fs/path work-dir "results" side)]
    (if-not (fs/exists? dir)
      {}
      (reduce (fn [acc gate]
                (let [gate-dir (fs/path dir gate)]
                  (if-not (fs/exists? gate-dir)
                    acc
                    (reduce (fn [acc f]
                              (let [parsed (try (json/parse-string (slurp (str f)))
                                                (catch Exception _ nil))
                                    entry (get parsed "entry")]
                                (if entry
                                  (assoc-in acc [entry gate] (get parsed "outcome"))
                                  acc)))
                            acc
                            (fs/glob gate-dir "*.json")))))
              {}
              gates))))

(def ^:private absent ::absent)

(defn- cell [result-set entry gate]
  (let [v (get-in result-set [entry gate] absent)]
    (if (nil? v) absent v)))  ; a recorded null is a write bug, not a value

(defn- short-json [v]
  (let [s (json/generate-string v)]
    (if (> (count s) 160) (str (subs s 0 160) "...") s)))

(defn verdict-matrix
  "[{:entry :gate :verdict :detail}] over the UNION of cells present in
   either result set, sorted by entry then gate. Both sides present and
   equal -> EQUIVALENT; both present and different -> DIVERGENT (detail
   shows both, truncated); either side absent or null -> INCOMPLETE naming
   the missing side. The union means a corpus entry only one toolchain
   produced results for still surfaces - as INCOMPLETE, never silently."
  [pinned candidate]
  (let [cells (->> (concat (for [[e gs] pinned, g (keys gs)] [e g])
                           (for [[e gs] candidate, g (keys gs)] [e g]))
                   distinct
                   sort)]
    (vec (for [[entry gate] cells]
           (let [p (cell pinned entry gate)
                 c (cell candidate entry gate)]
             (cond
               (and (= absent p) (= absent c))
               {:entry entry :gate gate :verdict "INCOMPLETE"
                :detail "pinned and candidate outcomes missing"}

               (= absent c)
               {:entry entry :gate gate :verdict "INCOMPLETE"
                :detail "candidate outcome missing"}

               (= absent p)
               {:entry entry :gate gate :verdict "INCOMPLETE"
                :detail "pinned outcome missing"}

               (= p c)
               {:entry entry :gate gate :verdict "EQUIVALENT" :detail nil}

               :else
               {:entry entry :gate gate :verdict "DIVERGENT"
                :detail (str "pinned=" (short-json p) " candidate=" (short-json c))}))))))

(defn exit-code
  "0 only for a non-empty, all-EQUIVALENT matrix. An empty matrix means
   nothing was compared - fail closed, that is never equivalence."
  [matrix]
  (if (and (seq matrix) (every? #(= "EQUIVALENT" (:verdict %)) matrix)) 0 1))

(defn render-line [{:keys [entry gate verdict detail]}]
  (str verdict "|" entry "|" gate (when detail (str "|" detail))))

(defn render-matrix [matrix]
  (str/join "\n" (map render-line matrix)))

(defn render-markdown
  "The verdict matrix as a markdown table (the evidence report's section 2
   body)."
  [matrix]
  (str "| corpus entry | gate | verdict | detail |\n"
       "|---|---|---|---|\n"
       (str/join "\n"
                 (map (fn [{:keys [entry gate verdict detail]}]
                        (str "| " entry " | " gate " | " verdict " | " (or detail "") " |"))
                      matrix))))

(defn normalize-lint-outcome
  "The lint-gate outcome as comparable data: a pass is {\"exit\" 0} alone
   (OK wording is not behavior); a failure carries the message with the
   repo root - and any caller-supplied volatile prefixes (throwaway clone
   dirs, temp IR paths) - scrubbed, so the two toolchains' outcomes differ
   only when the behavior differs."
  ([exit message root] (normalize-lint-outcome exit message root {}))
  ([exit message root replacements]
   (if (zero? exit)
     {"exit" 0}
     {"exit" exit
      "error" (reduce-kv (fn [s from to] (str/replace s from to))
                         (str/trim (str/replace (str message) (str root "/") ""))
                         replacements)})))

(defn normalize-dry-findings
  "The IR-DRY outcome as a finding SET, not file bytes (ticket deliverable
   2b): the report's findings vector, canonically sorted. Summary counts and
   schema fields are derived data and stay out of the verdict."
  [report]
  (vec (sort-by json/generate-string (get report "findings" []))))
