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

(defn format-violation [{:keys [kind id path feature-path others message ticket-type]}]
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
    :duplicate-id (str "DUPLICATE-ID " id "  " path
                       "  also: " (str/join ", " (map :path others))
                       "  (duplicate ticket id — refuse at mint)")
    :published-corpus-unreadable (str "PUBLISHED-CORPUS-UNREADABLE  "
                                      (or message "published corpus could not be read")
                                      "  (fail closed — never treat as empty)")
    :local-corpus-unreadable (str "LOCAL-CORPUS-UNREADABLE  "
                                  (or message "local backlog corpus could not be read")
                                  "  (fail closed — never treat as empty)")
    (str "VIOLATION " id "  " path)))

(defn all-clean? [violations] (empty? violations))

;; ── BL-1105: duplicate ticket id refused at mint ───────────────────────────
(def backlog-pools ["paused" "active" "hold" "done"])

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

(defn read-local-id-index
  "Read-only scan of the local backlog tree. Fail-closed on any slurp error
   or a missing backlog root (never treat a wrong path as an empty corpus)."
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
                              (throw (ex-info (str "unreadable local ticket: " p
                                                   " (" (.getMessage e) ")")
                                              {:path p})))))
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

(defn- other-holders
  [id subject-path local-index published-index]
  (let [local (->> (get local-index id [])
                   (remove #(= (:path %) (str subject-path))))
        local-names (set (map #(path-basename (:path %)) local))
        ;; Same checkout often appears in both corpora; keep one entry.
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
