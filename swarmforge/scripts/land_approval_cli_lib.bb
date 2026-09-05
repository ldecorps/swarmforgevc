;; land_approval_cli_lib.bb — BL-1405's testable core, split out of
;; record_land_approval.bb because that CLI's own -main runs as a load-time
;; side effect (like every *_cli.bb entry script in this family), so
;; nothing may load-file it directly from a test or property runner.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "land_approval_cli_lib.bb")))
;; and referred to as land-approval-cli-lib/foo.

(ns land-approval-cli-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "land_step_lib.bb")))

(defn short
  "The same 10-hex truncation land-step-lib/record-land-approval! itself
   applies - computed here too so already-recorded? below can check the
   store using the EXACT value the writer will use, before ever calling it."
  [sha]
  (when (and sha (>= (count (str sha)) 7))
    (subs (str sha) 0 (min 10 (count (str sha))))))

(defn current-month-file [shared-root]
  (let [month (subs (str (java.time.Instant/now)) 0 7)]
    (fs/path shared-root ".swarmforge" "land-approvals" (str month ".jsonl"))))

(defn already-recorded?
  "BL-1405 invariant 1 (one writer, no second serializer): a READ of what
   land-step-lib/record-land-approval! already wrote - never a
   reimplementation of the line's shape, just an exact-field substring
   check against the two quoted JSON fields that make a record THIS one
   (\"commit\":\"<c>\" and \"source\":\"<src>\", both already short-form,
   so a same-length-prefix collision between two DIFFERENT full shas
   cannot false-match - short truncates to a fixed 10 chars up front, on
   both the read and the write side, from the same function).
   ('the CLI may skip an exact duplicate line' - BL-1405 direction.)"
  [root c src]
  (when-let [shared (land-step-lib/shared-target-root root)]
    (let [file (current-month-file shared)]
      (when (fs/exists? file)
        (boolean
         (some (fn [line]
                 (and (str/includes? line (str "\"commit\":\"" c "\""))
                      (str/includes? line (str "\"source\":\"" src "\""))))
               (str/split-lines (slurp (str file)))))))))
