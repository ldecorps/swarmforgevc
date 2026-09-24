;; BL-1720: pure TSV row-filtering core for retire_seat.sh - one seat's
;; row is dropped from a roles.tsv or sessions.tsv text, in the SAME
;; column shape swarmforge.sh's own write_roles_file/write_sessions_file
;; already produce (never a second format). The shell script supplies the
;; text (read from disk) and writes the result back; nothing here touches
;; a file, a socket, or a process.

(ns retire-seat-lib
  (:require [clojure.string :as str]))

(defn- rows [text]
  (->> (str/split-lines (or text ""))
       (remove str/blank?)
       (map #(str/split % #"\t"))))

(defn filter-out-seat-rows
  "Every row of text whose column at col-idx is NOT seat, rejoined with
   newlines, line order preserved. roles.tsv's seat column is 0 (role);
   sessions.tsv's is 1 (role) - see write_roles_file/write_sessions_file
   in swarmforge.sh for both column layouts."
  [text seat col-idx]
  (->> (rows text)
       (remove (fn [cols] (= seat (nth cols col-idx nil))))
       (map #(str/join "\t" %))
       (str/join "\n")))

(defn seat-row
  "The first roles.tsv row (as a vector of columns) whose role column (0)
   equals seat, or nil when no such row exists - the existence check
   retire_seat.sh refuses on before touching any file."
  [roles-text seat]
  (some (fn [cols] (when (= seat (first cols)) cols)) (rows roles-text)))

(defn worktree-paths
  "Distinct, non-blank worktree-path column (2, 0-indexed) values from
   roles.tsv text, in first-seen order - every worktree copy retire_seat.sh
   must update, INCLUDING the retired seat's own (its files stay in place;
   only its roster row goes, same as every other copy's)."
  [roles-text]
  (->> (rows roles-text)
       (map #(nth % 2 nil))
       (remove str/blank?)
       distinct
       vec))
