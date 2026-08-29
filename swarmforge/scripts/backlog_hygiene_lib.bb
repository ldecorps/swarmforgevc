#!/usr/bin/env bb
;; Pure backlog epic/milestone hygiene checks for open tickets.
;; Used by backlog_epic_milestone_audit.bb and specifier_backlog_hygiene_gate.sh.

(ns backlog-hygiene-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "acceptance_pointer_gate_lib.bb")))

(defn- strip-yaml-quotes [s]
  (-> s str/trim (str/replace #"^[\"']|[\"']$" "")))

(defn field [text name]
  (when-let [[_ v] (re-find (re-pattern (str "(?m)^" name ":\\s*(.*)$")) text)]
    (let [v (strip-yaml-quotes v)]
      (when-not (str/blank? v) v))))

(defn- acceptance-line-tail-and-body
  "[tail body-lines] for the ticket's `acceptance:` line - tail is that
   line's own trailing text (mirrors pre_qa_gate_gather_lib.bb's
   read-yaml-field, which is what the pre-QA gates actually see), and
   body-lines is every immediately-following blank-or-indented line (a
   would-be block-scalar body), stopping at the first top-level
   (non-indented, non-blank) line. nil when there is no acceptance: line."
  [text]
  (let [lines (str/split-lines text)
        idx (first (keep-indexed (fn [i l] (when (re-matches #"^acceptance:.*$" l) i)) lines))]
    (when idx
      [(str/trim (str/replace (nth lines idx) #"^acceptance:\s*" ""))
       (->> (drop (inc idx) lines)
            (take-while #(or (str/blank? %) (re-matches #"^\s+.*$" %))))])))

(defn unreadable-acceptance-violation
  "BL-922: a block-scalar acceptance: (bare `|`/`>` + optional chomping,
   the SAME residue acceptance-pointer-gate-lib's pre-QA gates see once the
   body is stripped away) whose indented body names a real, single
   specs/features/*.feature path is caught HERE, at mint/hygiene-gate time,
   instead of five stages later at the documenter->QA hop. A block scalar
   naming no feature file (an honest not-yet-drafted placeholder) is never
   reported - that is BL-626's business, not this gate's (invariant 3). A
   glob-shaped mention (`specs/features/BL-555-*.feature`, prose describing
   a file the specifier has not yet named) is likewise never a real
   pointer - `*` is excluded from the path charset, not just whitespace,
   or 'not yet written' placeholders that happen to preview their own
   eventual filename would be misreported as already-armed (measured
   against the live backlog: BL-555, BL-588)."
  [text {:keys [id path]}]
  (when-let [[tail body] (acceptance-line-tail-and-body text)]
    (when (acceptance-pointer-gate-lib/block-scalar-residue? tail)
      (when-let [feature-path (some #(re-find #"specs/features/[^\s*]+\.feature\b" %) body)]
        {:kind :unreadable-acceptance :id id :path path :feature-path feature-path}))))

(defn- hygiene-repo-root
  "Working-tree root for mint-time path probes (BL-1027). Prefer an explicit
   option/env; otherwise walk up from the ticket path looking for the
   swarmforge/scripts sibling, else fall back to user.dir."
  [{:keys [repo-root path]}]
  (or repo-root
      (System/getenv "BACKLOG_HYGIENE_REPO_ROOT")
      (when path
        (loop [dir (fs/parent (fs/absolutize path))]
          (when dir
            (if (fs/directory? (fs/path dir "swarmforge" "scripts"))
              (str dir)
              (recur (fs/parent dir))))))
      (System/getProperty "user.dir")))

(defn dangling-acceptance-violation
  "BL-1027: a single-line acceptance: pointer that applicable? would check
   at the pre-QA hop, but whose path is absent from the WORKING TREE, is
   refused at mint. Uses acceptance-pointer-gate-lib/applicable? as the
   sole checkability predicate (invariant 1) - never a second copy of
   which declarations are real pointers. Reads the acceptance: LINE's own
   tail (acceptance-line-tail-and-body), the SAME residue pre-QA/BL-922
   see - not field/, which can span an indented body. Absent / block-scalar
   / epic nested none: are never refused here (invariant 2)."
  [text {:keys [id path] :as opts}]
  (when-let [[tail _] (acceptance-line-tail-and-body text)]
    (when (acceptance-pointer-gate-lib/applicable? tail)
      (let [root (hygiene-repo-root opts)
            abs (str (fs/path root tail))]
        (when-not (fs/exists? abs)
          {:kind :dangling-acceptance :id id :path path :feature-path tail})))))

(defn- git-ls-files-tracked?
  "True when `git ls-files --error-unmatch` succeeds for rel path under root."
  [repo-root rel]
  (try
    (let [r @(process/process ["git" "-C" (str repo-root) "ls-files" "--error-unmatch" (str rel)]
                              {:out :string :err :string})]
      (zero? (:exit r)))
    (catch Exception _
      false)))

(defn untracked-acceptance-violation
  "BL-533: acceptance path exists on disk but is absent from git ls-files —
   never pass the spec-ready hygiene gate (untracked working-tree half)."
  [text {:keys [id path] :as opts}]
  (when-let [[tail _] (acceptance-line-tail-and-body text)]
    (when (acceptance-pointer-gate-lib/applicable? tail)
      (let [root (hygiene-repo-root opts)
            abs (str (fs/path root tail))]
        (when (and (fs/exists? abs)
                   (not (git-ls-files-tracked? root tail)))
          {:kind :untracked-acceptance :id id :path path :feature-path tail})))))

(defn read-yaml-list-field
  "Flow `[a, b]` or block `- a` list under a column-0 field. Empty when absent."
  [text field]
  (let [lines (str/split-lines (or text ""))
        prefix (str field ":")
        idx (some (fn [[i l]] (when (str/starts-with? l prefix) i)) (map-indexed vector lines))]
    (if (nil? idx)
      []
      (let [line (str/trim (nth lines idx))
            after (str/trim (subs line (inc (str/index-of line ":"))))]
        (cond
          (and (str/starts-with? after "[") (str/ends-with? after "]"))
          (->> (str/split (subs after 1 (dec (count after))) #",")
               (map strip-yaml-quotes)
               (remove str/blank?)
               vec)

          (str/blank? after)
          (->> (drop (inc idx) lines)
               (take-while #(or (str/blank? %) (re-matches #"^\s+.*$" %)))
               (keep #(when-let [[_ item] (re-matches #"^\s+-\s+(.+?)\s*$" %)]
                        (strip-yaml-quotes item)))
               vec)

          :else [])))))

(defn required-wiring-nonempty?
  "True when required_wiring is present with at least one non-blank entry."
  [ticket-text]
  (boolean (seq (read-yaml-list-field ticket-text "required_wiring"))))

(defn epic-wiring-exit-checklist
  "BL-533: epic with >=2 decomposes_into children fails unless at least one
   child declares non-empty required_wiring. child-texts is a seq of YAML
   bodies aligned to those children (missing bodies count as unwired).
   Returns {:ok? bool :applicable? bool :child-count n}."
  [epic-text child-texts]
  (let [children (read-yaml-list-field epic-text "decomposes_into")
        n (count children)
        texts (vec (or child-texts []))]
    (if (< n 2)
      {:ok? true :applicable? false :child-count n}
      (let [wired? (some required-wiring-nonempty? texts)]
        {:ok? (boolean wired?)
         :applicable? true
         :child-count n}))))

(defn- resolve-child-ticket-text
  "Slurp first matching BL-*-yaml for child id under backlog pools, else \"\"."
  [backlog-root child-id]
  (or (some (fn [pool]
              (when-let [hits (seq (fs/glob (fs/path backlog-root pool)
                                            (str child-id "-*.yaml")))]
                (slurp (str (first hits)))))
            ["active" "paused" "hold" "done"])
      ""))

(defn epic-wiring-exit-violation
  "When type: epic, >=2 decomposes_into, and child YAML bodies are available
   via :child-texts or :resolve-children? + :backlog-root — fail if no child
   has non-empty required_wiring."
  [text {:keys [id path child-texts resolve-children? backlog-root]}]
  (when (= "epic" (or (field text "type") ""))
    (let [ids (read-yaml-list-field text "decomposes_into")
          bodies (cond
                   (some? child-texts) (mapv str child-texts)
                   (and resolve-children? backlog-root)
                   (mapv #(resolve-child-ticket-text backlog-root %) ids)
                   :else nil)]
      (when bodies
        (let [result (epic-wiring-exit-checklist text bodies)]
          (when (and (:applicable? result) (not (:ok? result)))
            {:kind :epic-wiring-missing :id id :path path
             :child-count (:child-count result)}))))))

(defn violations-for-text [text {:keys [id path] :as opts}]
  (let [id (or id (field text "id") path)
        typ (or (field text "type") "")
        epic (field text "epic")
        ms (field text "milestone")
        opts (assoc opts :id id :path path)
        out (atom [])]
    (if (= typ "epic")
      (do
        (when-not epic
          (swap! out conj {:kind :missing-epic-on-epic :id id :path path}))
        (when-not ms
          (swap! out conj {:kind :missing-milestone :id id :path path}))
        (when-let [v (epic-wiring-exit-violation text opts)]
          (swap! out conj v)))
      (when-not epic
        (swap! out conj {:kind :missing-epic :id id :path path})))
    (when-let [v (unreadable-acceptance-violation text opts)]
      (swap! out conj v))
    (when-let [v (dangling-acceptance-violation text opts)]
      (swap! out conj v))
    (when-let [v (untracked-acceptance-violation text opts)]
      (swap! out conj v))
    ;; BL-1095: type: bug is retired from the expedite lane — refuse at mint
    ;; so a later bug ticket cannot silently lose expedite eligibility.
    (when (= typ "bug")
      (swap! out conj {:kind :retired-ticket-type :id id :path path :ticket-type "bug"}))
    @out))

(defn violations-for-file
  "Slurp a ticket path and collect hygiene violations. Second arg may be a
   repo-root string (BL-1027) or an opts map (:repo-root, :child-texts,
   :resolve-children?, :backlog-root)."
  ([f] (violations-for-file f nil))
  ([f root-or-opts]
   (let [text (slurp (str f))
         id (or (field text "id") (last (str/split (str f) #"/")))
         opts (cond
                (string? root-or-opts) {:id id :path (str f) :repo-root root-or-opts}
                (map? root-or-opts) (merge {:id id :path (str f)} root-or-opts)
                :else {:id id :path (str f)})]
     (violations-for-text text opts))))

;; ── BL-1105: duplicate ticket id refused at mint ───────────────────────────
(def backlog-pools ["paused" "active" "hold" "done"])

;; ── BL-1216: pool classification + content verdict for DUPLICATE-ID ────────
(def live-pools #{"paused" "active"})
(def terminal-pools #{"hold" "done"})

(defn path-pool
  "Which backlog pool a path sits in (paused/active/hold/done), or nil when
   none of them appears as a path segment."
  [p]
  (some (fn [pool] (when (re-find (re-pattern (str "(^|/)" pool "/")) (str p)) pool))
        backlog-pools))

(defn pool-classification
  "\"live\" (active/paused — the coordinator promotes and routes out of
   these), \"terminal\" (hold/done — nothing auto-promotes out of either),
   or nil for an unrecognized pool."
  [pool]
  (cond
    (contains? live-pools pool) "live"
    (contains? terminal-pools pool) "terminal"
    :else nil))

(defn- describe-path
  [p]
  (let [pool (path-pool p)]
    (str p " [" (or pool "unknown") "/" (or (pool-classification pool) "unknown") "]")))

(defn- safe-read
  [read-fn p]
  (try (read-fn p) (catch Exception _ nil)))

(defn content-verdict
  "\"CONTENT IDENTICAL\" only when every colliding path is readable and its
   content is byte-identical to the subject's; \"CONTENT DIFFERS\" otherwise,
   including any unreadable file (fail closed — invariant 2, BL-1216: an
   unreadable file must never be reported as identical)."
  ([subject-path other-paths] (content-verdict subject-path other-paths slurp))
  ([subject-path other-paths read-fn]
   (let [subject-text (safe-read read-fn subject-path)]
     (if (and subject-text
              (every? #(= subject-text (safe-read read-fn %)) other-paths))
       "CONTENT IDENTICAL"
       "CONTENT DIFFERS"))))

(defn- sole-live-keep
  "The one path to keep when exactly one of subject+others sits in a live
   pool; nil otherwise (BL-1216 invariant 3 — never name a keep when zero or
   more than one colliding copy is live)."
  [path others]
  (let [all-paths (cons path (map :path others))
        live (filter #(= "live" (pool-classification (path-pool %))) all-paths)]
    (when (= 1 (count live)) (first live))))

(defn format-violation
  ([v] (format-violation v slurp))
  ([{:keys [kind id path feature-path others message ticket-type]} read-fn]
   (case kind
    :missing-epic (str "MISSING-EPIC " id "  " path "  (non-epic ticket needs epic:)")
    :missing-epic-on-epic (str "MISSING-EPIC " id "  " path "  (type: epic must self-declare epic:)")
    :missing-milestone (str "MISSING-MILESTONE " id "  " path "  (type: epic needs milestone:)")
    :unreadable-acceptance (str "UNREADABLE-ACCEPTANCE " id "  " path "  (acceptance: is a block"
                                 " scalar hiding " feature-path " - rewrite as a single-line pointer)")
    :dangling-acceptance (str "DANGLING-ACCEPTANCE " id "  " path
                              "  (acceptance: pointer \"" feature-path "\" does not exist on the working tree)")
    :untracked-acceptance (str "UNTRACKED-ACCEPTANCE " id "  " path
                               "  (acceptance: pointer \"" feature-path
                               "\" exists on disk but is not in git ls-files)")
    :epic-wiring-missing (str "EPIC-WIRING-MISSING " id "  " path
                              "  (runtime-wiring declaration is missing — "
                              "multi-slice epic needs required_wiring on a child)")
    :retired-ticket-type (str "RETIRED-TICKET-TYPE " id "  " path
                              "  (type: " (or ticket-type "bug") " is retired — use type: defect)")
    :duplicate-id (let [verdict (content-verdict path (map :path others) read-fn)
                        keep (sole-live-keep path others)]
                    (str "DUPLICATE-ID " id "  " (describe-path path)
                         "  also: " (str/join ", " (map #(describe-path (:path %)) others))
                         "  (" verdict "; duplicate ticket id — refuse at mint"
                         (when keep (str "; keep: " keep))
                         ")"))
    :published-corpus-unreadable (str "PUBLISHED-CORPUS-UNREADABLE  "
                                      (or message "published corpus could not be read")
                                      "  (fail closed — never treat as empty)")
    :local-corpus-unreadable (str "LOCAL-CORPUS-UNREADABLE  "
                                  (or message "local backlog corpus could not be read")
                                  "  (fail closed — never treat as empty)")
    (str "VIOLATION " id "  " path))))

(defn all-clean? [violations] (empty? violations))

(defn- ticket-yaml-path?
  [p]
  (str/ends-with? (str p) ".yaml"))

(defn merge-id-indexes
  "Merge {id -> [{:path ...}]} maps, concatenating path lists."
  [a b]
  (merge-with into a b))

(defn index-ticket-text
  "One file's contribution to an id index. Blank/missing id yields {}."
  [path text]
  (if-let [id (field text "id")]
    {id [{:path (str path)}]}
    {}))

(defn index-ticket-files
  "Build an id index from [path text] pairs. Returns {:ok index} or
   {:error msg} — any unreadable/nil text fails the whole corpus (invariant 2)."
  [path-text-pairs]
  (try
    {:ok (reduce (fn [acc [path text]]
                   (when (nil? text)
                     (throw (ex-info (str "unreadable ticket: " path) {:path path})))
                   (merge-id-indexes acc (index-ticket-text path text)))
                 {}
                 path-text-pairs)}
    (catch Exception e
      {:error (.getMessage e)})))

(defn list-backlog-ticket-files
  "Every ticket YAML under backlog/{paused,active,hold,done}/."
  [backlog-root]
  (->> backlog-pools
       (mapcat (fn [pool]
                 (let [dir (fs/path backlog-root pool)]
                   (when (fs/directory? dir)
                     (fs/glob dir "**.yaml")))))
       (map str)
       (filter ticket-yaml-path?)
       vec))

(defn- ticket-id-from-filename
  "Best-effort id from a `<ID>-slug.yaml` filename (the backlog naming
   convention this file's own resolve-child-ticket-text already relies on),
   e.g. \"BL-1216-example.yaml\" -> \"BL-1216\". nil when the name doesn't fit."
  [p]
  (when-let [[_ id] (re-find #"^([A-Za-z]+-\d+)-.*\.ya?ml$" (last (str/split (str p) #"/")))]
    id))

(defn read-local-id-index
  "Read-only scan of the local backlog tree. Fail-closed on a missing backlog
   root (never treat a wrong path as an empty corpus). BL-1216: an individual
   ticket file that cannot be read (e.g. permission-denied) no longer aborts
   the whole corpus scan PROVIDED its id is still recoverable from its
   filename per the `<ID>-slug.yaml` convention — the file still surfaces in
   the index (so a real collision is still caught, never silently dropped),
   just without real content for duplicate-id-violations' content-verdict to
   compare against. A file whose id cannot even be guessed from its name
   still fails the whole corpus closed, unchanged from before."
  [backlog-root]
  (try
    (when-not (fs/directory? backlog-root)
      (throw (ex-info (str "local backlog corpus could not be read: not a directory: "
                           backlog-root)
                      {:path backlog-root})))
    (let [files (list-backlog-ticket-files backlog-root)
          pairs (map (fn [p]
                       (try [p (slurp p)]
                            (catch Exception e
                              (if-let [id (ticket-id-from-filename p)]
                                [p (str "id: " id "\n")]
                                (throw (ex-info (str "unreadable local ticket: " p
                                                     " (" (.getMessage e) ")")
                                                {:path p}))))))
                     files)]
      (index-ticket-files pairs))
    (catch Exception e
      {:error (.getMessage e)})))

(defn read-dir-id-index
  "Same shape as read-local-id-index, for a published-corpus fixture directory."
  [published-root]
  (read-local-id-index published-root))

(defn- git-show-text
  [git-dir ref rel]
  (let [proc (process/shell {:dir git-dir :out :string :err :string :continue true}
                            "git" "show" (str ref ":" rel))]
    (when (zero? (:exit proc))
      (:out proc))))

(defn read-published-id-index-from-git
  "Ids published on `ref` under backlog pools. Fail-closed if the ref or any
   ticket blob cannot be read (invariant 2)."
  [git-dir ref]
  (try
    (let [proc (process/shell {:dir git-dir :out :string :err :string :continue true}
                              "git" "ls-tree" "-r" "--name-only" ref "--" "backlog/")
          _ (when-not (zero? (:exit proc))
              (throw (ex-info (str "published corpus could not be read at " ref
                                   ": " (str/trim (:err proc)))
                              {:ref ref})))
          rels (->> (str/split-lines (:out proc))
                    (filter #(re-find #"^backlog/(paused|active|hold|done)/.+\.yaml$" %)))
          pairs (map (fn [rel]
                       (let [text (git-show-text git-dir ref rel)]
                         (when-not text
                           (throw (ex-info (str "published corpus could not be read: "
                                                ref ":" rel)
                                           {:ref ref :rel rel})))
                         [rel text]))
                     rels)]
      (index-ticket-files pairs))
    (catch Exception e
      {:error (.getMessage e)})))

(defn- path-basename
  [p]
  (last (str/split (str p) #"/")))

(defn- backlog-relative
  "BL-1194: strip any prefix up to and including the nearest backlog pool
   directory (paused|active|hold|done), leaving `<pool>/<filename>`. Pure
   string operation — no filesystem access — so the same id+file compares
   equal regardless of whether it was spelled as a working-directory-relative
   path (the documented invocation), an absolute checkout path (what
   `read-local-id-index` always produces), or a git-relative published path
   (what `read-published-id-index-from-git` always produces). Falls back to
   the input itself when no pool segment is present, so a test fixture that
   passes bare relative paths still round-trips."
  [p]
  (or (second (re-find #"(?:^|/)((?:paused|active|hold|done)/[^/]+)$" (str p)))
      (str p)))

(defn- other-holders
  [id subject-path local-index published-index]
  (let [;; BL-1194 bug #1: the local corpus index is always built from an
        ;; ABSOLUTE backlog-root, so every local entry is absolute; a subject
        ;; passed by a working-directory-relative path (the documented
        ;; invocation) never string-equals its own absolute entry and was
        ;; never excluded. Normalize both sides to a pool-relative form
        ;; before comparison so the subject's own entry is excluded
        ;; regardless of how the caller spelled its path.
        subject-norm (backlog-relative subject-path)
        local (->> (get local-index id [])
                   (remove #(= (backlog-relative (:path %)) subject-norm)))
        subject-basename (path-basename subject-path)
        ;; BL-1194 bug #2: the published-side "same checkout" dedup was
        ;; deriving its exclusion set from OTHER local holders (after
        ;; subject removal) — empty for the ordinary case of one local
        ;; holder — so a published entry that was simply the subject's own
        ;; already-committed copy was never filtered. Include the subject's
        ;; OWN basename in the exclusion set so its own published copy is
        ;; recognized as "this ticket", not as another holder.
        local-names (into #{subject-basename}
                          (map #(path-basename (:path %)) local))
        pub (->> (get published-index id [])
                 (remove #(contains? local-names (path-basename (:path %)))))]
    (vec (concat local pub))))

(defn- subject-peer-duplicates
  "Duplicates among the gated subjects themselves (same id, different paths)."
  [subjects]
  (->> subjects
       (filter :id)
       (group-by :id)
       (mapcat (fn [[id xs]]
                 (when (> (count xs) 1)
                   (for [s xs]
                     {:kind :duplicate-id
                      :id id
                      :path (:path s)
                      :others (mapv #(select-keys % [:path])
                                    (remove #(= (:path %) (:path s)) xs))}))))))

(defn duplicate-id-violations
  "Corpus-level duplicate-id check (BL-1105). Pure over subjects + indexes.
   published-result is {:ok index} or {:error msg}; error fails closed."
  [subjects local-result published-result]
  (cond
    (:error local-result)
    [{:kind :local-corpus-unreadable :message (:error local-result)}]

    (:error published-result)
    [{:kind :published-corpus-unreadable :message (:error published-result)}]

    :else
    (let [local (:ok local-result)
          published (:ok published-result)
          from-corpus (keep (fn [{:keys [id path]}]
                              (when id
                                (let [others (other-holders id path local published)]
                                  (when (seq others)
                                    {:kind :duplicate-id :id id :path path :others others}))))
                            subjects)
          from-peers (subject-peer-duplicates subjects)]
      (vec (concat from-corpus from-peers)))))
