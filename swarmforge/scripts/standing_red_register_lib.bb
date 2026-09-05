;; standing_red_register_lib.bb — BL-1428: pure decision core for the
;; standing-red register, the one reader of the three places a tolerated
;; red is recorded (invariant 1): the property-suite allowlist
;; (property_suite_standing_allowlist.tsv, BL-1175), the hardening-debt
;; ledger (backlog/hardening-debt-ledger.yaml, BL-942), and the register
;; itself (backlog/standing-reds.tsv, BL-1428). Every consumer of "is this
;; red owned, and by whom" is meant to ask this reader rather than parse a
;; TSV or the ledger a second time.
;;
;; The register is authoritative for a (lane, file) pair when it names one:
;; its own header comment states the property-lane rows it carries are
;; EXACTLY the allowlist's rows minus the five that had gone green ("Five
;; allowlist rows were green and are not registered"). An allowlist or
;; ledger row the register does NOT already cover contributes its own row,
;; unowned (nil ticket) - never silently dropped, and never a guessed
;; ticket read out of the allowlist's own free-form rationale text
;; (invariant: "the rationale column is free text the lib never parses").

(ns standing-red-register-lib
  (:require [clojure.string :as str]))

(defn- comment-or-blank? [line]
  (or (str/blank? line) (str/starts-with? (str/trim line) "#")))

(defn parse-allowlist-rows
  "property_suite_standing_allowlist.tsv text (file<TAB>disposition<TAB>
   rationale, header row 'file...') -> vector of {:file :disposition
   :rationale}. The header row and any comment/blank line are skipped."
  [text]
  (->> (str/split-lines (or text ""))
       (remove comment-or-blank?)
       (map #(str/split % #"\t" -1))
       (remove #(= "file" (first %)))
       (keep (fn [cols]
               (when (>= (count cols) 2)
                 {:file (nth cols 0)
                  :disposition (nth cols 1)
                  :rationale (nth cols 2 "")})))
       vec))

(defn parse-register-rows
  "backlog/standing-reds.tsv text -> vector of {:lane :file :ticket
   :first-seen :note}. The file carries no header ROW (only leading `#`
   comment lines), so only comment/blank lines are skipped."
  [text]
  (->> (str/split-lines (or text ""))
       (remove comment-or-blank?)
       (map #(str/split % #"\t" -1))
       (keep (fn [cols]
               (when (>= (count cols) 4)
                 {:lane (nth cols 0)
                  :file (nth cols 1)
                  :ticket (nth cols 2)
                  :first-seen (nth cols 3)
                  :note (nth cols 4 "")})))
       vec))

(defn allowlist-file->register-path
  "test/x.property.test.js -> extension/test/x.property.test.js: the
   register's own repo-relative convention. The allowlist's own paths are
   already extension-relative (its own ps_allowlist_normalize_file strips
   the SAME prefix in the other direction, property_suite_standing_
   allowlist_lib.sh), so this is the exact inverse, never a second
   normalization rule invented independently."
  [file]
  (if (str/starts-with? file "extension/") file (str "extension/" file)))

(defn age-days
  "Whole days between first-seen and now (both \"YYYY-MM-DD\"), or nil when
   either is nil or unparseable - never a guessed age standing in for one
   this function could not compute."
  [first-seen now]
  (try
    (when (and first-seen now)
      (let [d1 (java.time.LocalDate/parse first-seen)
            d2 (java.time.LocalDate/parse now)]
        (.between java.time.temporal.ChronoUnit/DAYS d1 d2)))
    (catch Exception _ nil)))

(defn build-report
  "Pure combine, no filesystem or git of its own (ticket-state-fn is
   injected: ticket-id -> :open | :closed | :absent).

   {:allowlist-rows [{:file :disposition}]
    :register-rows  [{:lane :file :ticket :first-seen}]
    :ledger-rows    [{:ticket :file :first-seen}]   ; lane is always 'hardening'
    :ticket-state-fn fn
    :now \"YYYY-MM-DD\"}
   ->
   {:rows [{:lane :file :ticket :first_seen :age_days :owned}]
    :count n
    :oldest_age_days n-or-nil
    :unowned [rows whose :owned is false]}

   Every register row is emitted directly (it IS the ownership record). An
   allowlist row with disposition=allowlist, or a ledger row, contributes
   its OWN row only when the register does not already name one for that
   (lane, file) - the register's property/hardening rows are the join
   target, never re-emitted twice for the same red (BL-1428 acceptance
   scenario 01: 'every ... row appears once')."
  [{:keys [allowlist-rows register-rows ledger-rows ticket-state-fn now]}]
  (let [register-index (into #{} (for [r register-rows] [(:lane r) (:file r)]))
        finalize (fn [lane file ticket first-seen]
                   (let [state (when ticket (ticket-state-fn ticket))]
                     {:lane lane
                      :file file
                      :ticket ticket
                      :first_seen first-seen
                      :age_days (age-days first-seen now)
                      :owned (= :open state)}))
        register-emitted (mapv (fn [r] (finalize (:lane r) (:file r) (:ticket r) (:first-seen r)))
                                register-rows)
        allowlist-only (->> allowlist-rows
                            (filter #(= "allowlist" (:disposition %)))
                            (map #(allowlist-file->register-path (:file %)))
                            (remove #(contains? register-index ["property" %]))
                            (map #(finalize "property" % nil nil)))
        ledger-only (->> ledger-rows
                         (remove #(contains? register-index ["hardening" (:file %)]))
                         (map #(finalize "hardening" (:file %) (:ticket %) (:first-seen %))))
        rows (vec (concat register-emitted allowlist-only ledger-only))
        ages (keep :age_days rows)]
    {:rows rows
     :count (count rows)
     :oldest_age_days (when (seq ages) (apply max ages))
     :unowned (vec (remove :owned rows))}))
