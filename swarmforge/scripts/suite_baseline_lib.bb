;; suite_baseline_lib.bb — BL-1377: a suite's failure set, recorded once per
;; base commit.
;;
;; A stage must SHOW that a red was already red before its parcel (BL-1063),
;; never assert it, and today it shows that by running the suite twice: once at
;; the base, once with the parcel. The base half of that answer is the same for
;; every stage sitting on the same base commit, and coder, cleaner, hardener
;; and QA each re-derive it. Measured on BL-1375's coder pass (2026-09-03):
;; `npm run test:properties` at 143 s and `npm test` at ~30 s, each run twice,
;; to write one evidence sentence.
;;
;; So the base half is recorded once, keyed by suite + base sha + a hash of
;; that suite's own config, and a stage with a fresh record runs the suite once
;; and diffs against it. Two rules bound the whole thing, and they are the
;; ticket's declared invariants:
;;
;;   1. A record can only ever excuse a red it ACTUALLY NAMES, at the same base
;;      sha and the same config hash. A red the record does not name is new,
;;      and the diff says so. The cache may shrink a run; it may never widen an
;;      excuse.
;;   2. Absent, unreadable or key-mismatched record falls back to today's two
;;      runs. No path here turns a missing baseline into a green.
;;
;; This namespace is PURE. It runs no suite, reads no file and asks git
;; nothing: the CLI beside it owns the base worktree, the config hashing and
;; the suite runs, and hands what it found to `decide`. Out of scope, per the
;; ticket: what counts as a pre-existing red (BL-1063) and making the suites
;; themselves faster (BL-1348/BL-1349). BL-1175's standing allowlist stays the
;; second, independent input it already is - this caches the OBSERVED set and
;; changes nothing about what the allowlist tolerates.

(ns suite-baseline-lib
  (:require [clojure.string :as str]))

;; The suites this caches, and the files whose change must invalidate a record.
;; Named rather than discovered: a suite whose config moved and was not listed
;; here would keep matching an old record, which is invariant 1's failure mode.
(def suites
  {"unit"
   {:command "npm test"
    :config-paths ["extension/vitest.config.mjs"
                   "extension/package.json"]}

   "properties"
   {:command "npm run test:properties"
    :config-paths ["extension/vitest.properties.config.mjs"
                   "extension/package.json"
                   ;; the standing allowlist decides which reds the suite
                   ;; tolerates, so a change to it changes the observable set.
                   "swarmforge/scripts/property_suite_standing_allowlist.tsv"]}})

(defn suite-names [] (vec (sort (keys suites))))
(defn suite [name] (get suites name))

(defn parse-failures
  "Pure: a suite run's output -> its failure set, or nil when the output
   cannot be read as a suite result at all.

   nil is not the empty set and the difference is the whole point. A command
   that could not run, or whose output this does not recognise, must NEVER
   read as \"no failures\": an empty observed set beside an empty recorded set
   would look like a clean cache hit and skip the base run, which is exactly
   the shape invariant 2 forbids. The caller refuses on nil."
  [{:keys [text exit]}]
  (let [reds (->> (str/split-lines (str text))
                  (keep #(second (re-matches #"^\s*(?:FAIL|×|✗|not ok \d+ -)\s+(\S.*?)\s*$" %)))
                  distinct
                  vec)]
    (cond
      (seq reds) reds
      ;; a clean exit with nothing named is a genuinely green suite
      (and (number? exit) (zero? exit)) []
      ;; a failing exit that named nothing is unreadable, not green
      :else nil)))

(defn record-entry
  "The record as it is stored: the key it was observed under, the failure set,
   and who observed it. The key travels WITH the set - a set filed without the
   sha and config hash it came from is a set nobody can safely reuse."
  [{:keys [key reds recorded-by at]}]
  {:key (select-keys key [:suite :base-sha :config-hash])
   :reds (vec reds)
   :recorded-by (or recorded-by "unknown")
   :at at})

(defn record-matches?
  "Whether a stored record may be read back for `key`. All three parts or
   none: a record with no key of its own matches nothing."
  [record key]
  (boolean
   (when-let [rk (:key record)]
     (and (= (:suite rk) (:suite key))
          (= (:base-sha rk) (:base-sha key))
          (= (:config-hash rk) (:config-hash key))))))

(defn latest-record
  "The last matching entry in a record file read in order. Later entries win,
   so a re-observation at the same key supersedes an earlier one without
   anyone having to rewrite the file."
  [records key]
  (last (filter #(record-matches? % key) records)))

(defn nearest-record
  "The record to REPORT ON: the matching one if there is one, else the newest
   entry filed for the same suite. The second is never usable - `decide`
   refuses it - but handing it over is what lets the refusal say WHY, which
   \"no baseline record\" cannot: a record filed at another base or another
   config hash is a different situation from no record at all, and an operator
   who cannot tell them apart cannot act on either."
  [records key]
  (or (last (filter #(record-matches? % key) records))
      (last (filter #(= (:suite (:key %)) (:suite key)) records))))

(defn- mismatch-reason [record key]
  (let [rk (:key record)]
    (cond
      (not= (:suite rk) (:suite key))
      (str "recorded for suite " (pr-str (:suite rk)) ", not " (pr-str (:suite key)))
      (not= (:base-sha rk) (:base-sha key))
      (str "recorded at base " (pr-str (:base-sha rk)) ", not " (pr-str (:base-sha key)))
      :else
      (str "recorded under suite config hash " (pr-str (:config-hash rk))
           ", not " (pr-str (:config-hash key))))))

(defn decide
  "Pure: what this stage must do, given the record it found (if any) and the
   failure set it observed WITH its parcel.

   {:second-run? :reason :new :vanished :excused :write-baseline? :recorded :observed :key}

   `:excused` is the ONLY thing a record ever buys, and it is never anything
   but the reds the record itself names (invariant 1). Every unusable-record
   path returns `:second-run? true` with `:excused []` (invariant 2) - and
   names nothing `new` either, because with no set to have been absent from
   there is no such claim to make; the second run decides."
  [{:keys [key record record-error observed]}]
  (let [observed (vec observed)
        usable? (and (nil? record-error) (some? record) (record-matches? record key))]
    (cond
      record-error
      {:second-run? true :reason (str "the baseline record is unreadable (" record-error ")")
       :new [] :vanished [] :excused [] :write-baseline? true
       :recorded nil :observed observed :key key}

      (nil? record)
      {:second-run? true :reason "no baseline record for this suite at this base"
       :new [] :vanished [] :excused [] :write-baseline? true
       :recorded nil :observed observed :key key}

      (not usable?)
      {:second-run? true :reason (mismatch-reason record key)
       :new [] :vanished [] :excused [] :write-baseline? true
       :recorded nil :observed observed :key key}

      :else
      (let [recorded (vec (:reds record))
            recorded-by (:recorded-by record)
            recorded-set (set recorded)
            observed-set (set observed)
            new-reds (vec (remove recorded-set observed))
            vanished (vec (remove observed-set recorded))
            same? (and (empty? new-reds) (empty? vanished))]
        {:second-run? (not same?)
         :reason (if same?
                   "the observed set matches the recorded baseline"
                   "the observed set differs from the recorded baseline")
         :new new-reds
         :vanished vanished
         ;; Only ever the reds the record names, and only when they were also
         ;; observed. A record never excuses a red that is not in front of us.
         :excused (vec (filter observed-set recorded))
         :write-baseline? false
         :recorded recorded
         :recorded-by recorded-by
         :observed observed
         :key key}))))

(defn evidence-line
  "The sentence a role puts in its evidence. It names the base sha, so a reader
   can tell WHICH base a pre-existing red was pre-existing at - which today's
   'identical failure set with and without this parcel' does not."
  [{:keys [key recorded recorded-by observed new vanished second-run? reason]}]
  (let [{:keys [suite base-sha]} key]
    (if second-run?
      (str/join
       " "
       (remove nil?
               [(str "suite " suite " at base " base-sha ":")
                (str reason ";")
                (when (seq new) (str "new: " (str/join ", " new) ";"))
                (when (seq vanished) (str "vanished: " (str/join ", " vanished) ";"))
                "running the base suite as well to settle it."]))
      (str "suite " suite " at base " base-sha
           " (baseline recorded by " (or (not-empty (str recorded-by)) "an earlier stage") "): "
           (count recorded) " recorded reds, "
           (count observed) " observed reds, same set"
           " - baseline reused, base run skipped."))))
