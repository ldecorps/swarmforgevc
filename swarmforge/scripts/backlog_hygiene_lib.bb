#!/usr/bin/env bb
;; Pure backlog epic/milestone hygiene checks for open tickets.
;; Used by backlog_epic_milestone_audit.bb and specifier_backlog_hygiene_gate.sh.

(ns backlog-hygiene-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "acceptance_pointer_gate_lib.bb")))

(defn field [text name]
  (when-let [[_ v] (re-find (re-pattern (str "(?m)^" name ":\\s*(.*)$")) text)]
    (let [v (-> v str/trim (str/replace #"^\"|\"$" "") (str/replace #"^'|'$" ""))]
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

(defn violations-for-text [text {:keys [id path]}]
  (let [id (or id (field text "id") path)
        typ (or (field text "type") "")
        epic (field text "epic")
        ms (field text "milestone")
        out (atom [])]
    (if (= typ "epic")
      (do
        (when-not epic
          (swap! out conj {:kind :missing-epic-on-epic :id id :path path}))
        (when-not ms
          (swap! out conj {:kind :missing-milestone :id id :path path})))
      (when-not epic
        (swap! out conj {:kind :missing-epic :id id :path path})))
    (when-let [v (unreadable-acceptance-violation text {:id id :path path})]
      (swap! out conj v))
    @out))

(defn violations-for-file [f]
  (let [text (slurp (str f))
        id (or (field text "id") (last (str/split (str f) #"/")))]
    (violations-for-text text {:id id :path (str f)})))

(defn format-violation [{:keys [kind id path feature-path others message]}]
  (case kind
    :missing-epic (str "MISSING-EPIC " id "  " path "  (non-epic ticket needs epic:)")
    :missing-epic-on-epic (str "MISSING-EPIC " id "  " path "  (type: epic must self-declare epic:)")
    :missing-milestone (str "MISSING-MILESTONE " id "  " path "  (type: epic needs milestone:)")
    :unreadable-acceptance (str "UNREADABLE-ACCEPTANCE " id "  " path "  (acceptance: is a block"
                                 " scalar hiding " feature-path " - rewrite as a single-line pointer)")
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
