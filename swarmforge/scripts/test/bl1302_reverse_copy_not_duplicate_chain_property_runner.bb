#!/usr/bin/env bb
;; BL-1302 properties over duplicate_chain_guard_lib.bb's blocking decision.
;;
;; Invariant 1: only a parcel that could itself be forwarded can block a
;;   forward - a non-forwarding inbound never blocks.
;; Invariant 2: absence fails closed - a live parcel carrying no
;;   non-forwarding marker blocks exactly as it does today.
;;
;; Both are stated against an INDEPENDENT oracle, not against the
;; implementation's own spelling: `legacy-blocking-parcel` below reimplements
;; the pre-BL-1302 guard (roles-table order, new/ before in_process/, filename
;; order, stage-level self-exclusion) by a different route. The property is
;;
;;     guard(population) == legacy(population minus the exempt parcels)
;;
;; which pins both invariants at once. Invariant 1 is the "minus": an exempt
;; parcel is never the answer. Invariant 2 is the "legacy": on a population
;; where nothing carries the marker the two sets are identical, so behaviour
;; for every parcel shape that existed before this ticket is unchanged - and
;; a mutant that exempted on absence, or on any value other than the literal
;; "true", diverges from the oracle immediately.
;;
;; The generator works over REAL mailboxes on disk rather than a model of
;; them: the marker is a header line, and reading it is the thing under test.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "duplicate_chain_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))
(def reach (atom {}))
(defn- saw! [k] (swap! reach update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def stages ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"])
(def ticket "BL-901")

;; The marker values worth generating. Only the literal "true" may exempt;
;; every other shape - including a missing line - must block. Weighted so the
;; exempt and non-exempt shapes are BOTH common (see the reach floors).
(def marker-shapes [:true :true :true :absent :absent :false :garbage :empty])

(defn- write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str/join (for [s stages]
                    (str s "\t" s "-wt\t" root "/" s "\tswarmforge-" s "\t" s "\tclaude\ttask\n")))))

(defn- mailbox-dir-for [root role state]
  (handoff-lib/mailbox-dir (handoff-lib/load-role-info role root) state))

(defn- write-parcel! [root role state filename {:keys [type task marker]}]
  (let [dir (mailbox-dir-for root role state)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          (str "id: x\nfrom: specifier\nto: " role "\npriority: 20\ntype: " type "\n"
               (when (= type "git_handoff") (str "task: " task "\ncommit: a1b2c3d4e5\n"))
               (when (= type "note") "message: m\n")
               (case marker
                 :true "non-forwarding: true\n"
                 :false "non-forwarding: false\n"
                 :garbage "non-forwarding: TRUE\n"
                 :empty "non-forwarding: \n"
                 nil)
               "\nbody\n"))))

;; ── The independent oracle: the guard as it behaved before BL-1302 ───────
(defn- legacy-blocking-parcel
  "Pre-BL-1302 semantics, reimplemented rather than called: the first
   other-STAGE live git_handoff for the ticket, in roles-table order, new/
   before in_process/, filename order. `exempt?` is applied by the CALLER by
   simply not writing those parcels - see check-run."
  [root ticket-id sender]
  (first
    (for [role-info (handoff-lib/load-all-roles root)
          :when (not= (handoff-lib/seat-stage (:role role-info))
                      (handoff-lib/seat-stage sender))
          state [:new :in_process]
          file (handoff-lib/handoff-files (handoff-lib/mailbox-dir role-info state))
          :when (and (= "git_handoff" (handoff-lib/header-field file "type"))
                     (= ticket-id (pipeline-stage-lib/extract-ticket-id
                                    (handoff-lib/header-field file "task"))))]
      {:role (:role role-info) :file (fs/file-name file)})))

(defn- normalize [b] (when b {:role (:role b) :file (if (string? (:file b))
                                                      (:file b)
                                                      (fs/file-name (:file b)))}))

(defn- gen-population
  "0-6 parcels scattered over the roles, each with its own state, marker shape,
   type and ticket. Filenames are drawn from a small pool so ties inside one
   mailbox happen often enough to exercise the filename ordering."
  [s]
  (let [[n s0] (gen-int s 7)]
    (loop [i 0 s s0 acc []]
      (if (= i n)
        [acc s]
        (let [[role s1] (gen-pick s stages)
              [state s2] (gen-pick s1 [:new :in_process])
              [marker s3] (gen-pick s2 marker-shapes)
              [type s4] (gen-pick s3 ["git_handoff" "git_handoff" "git_handoff" "note"])
              [tk s5] (gen-pick s4 [ticket ticket ticket "BL-902"])
              [fname s6] (gen-int s5 5)]
          (recur (inc i) s6
                 (conj acc {:role role :state state :marker marker :type type :task tk
                            :file (format "%02d_p%d.handoff" (* 10 fname) i)})))))))

(defn- exempt? [{:keys [type marker task]}]
  (and (= "git_handoff" type) (= :true marker) (= ticket task)))

(defn- check-run [i s]
  (let [[pop s'] (gen-population s)
        [sender s''] (gen-pick s' stages)
        root (str (fs/create-temp-dir {:prefix "bl1302-prop-"}))
        legacy-root (str (fs/create-temp-dir {:prefix "bl1302-prop-legacy-"}))]
    (try
      (write-roles! root)
      (write-roles! legacy-root)
      (doseq [p pop]
        (write-parcel! root (:role p) (:state p) (:file p) p)
        ;; The oracle's tree omits exactly the parcels invariant 1 exempts.
        (when-not (exempt? p)
          (write-parcel! legacy-root (:role p) (:state p) (:file p) p)))
      (let [got (normalize (duplicate-chain-guard-lib/blocking-parcel root ticket sender))
            want (normalize (legacy-blocking-parcel legacy-root ticket sender))
            others (remove #(= (:role %) sender) pop)
            live (filter #(and (= "git_handoff" (:type %)) (= ticket (:task %))) others)]
        ;; Reach bookkeeping - what states did this run actually visit?
        (when (seq (filter exempt? others)) (saw! :some-exempt))
        (when (and (seq live) (every? exempt? live)) (saw! :all-live-exempt))
        (when (and (seq (filter exempt? others))
                   (seq (remove exempt? live)))
          (saw! :exempt-hides-a-real-blocker))
        (when (seq (filter #(and (= "git_handoff" (:type %)) (= ticket (:task %))
                                 (contains? #{:absent :false :garbage :empty} (:marker %)))
                           others))
          (saw! :non-true-marker-present))
        (when (nil? want) (saw! :unblocked))
        (when (some? want) (saw! :blocked))

        (when (not= got want)
          (swap! failures conj
                 (str "FAIL run " i ": guard disagrees with legacy-minus-exempt oracle\n"
                      "  sender=" sender "\n  got=" (pr-str got) "\n  want=" (pr-str want)
                      "\n  population=" (pr-str pop))))
        ;; Invariant 1 restated directly, so a wrong oracle cannot hide it:
        ;; whatever is returned must be a parcel that could itself be forwarded.
        (when-let [f (:file got)]
          (let [p (first (filter #(and (= f (:file %)) (= (:role %) (:role got))) pop))]
            (when (and p (exempt? p))
              (swap! failures conj
                     (str "FAIL run " i " invariant 1: a non-forwarding parcel was named as the blocker\n"
                          "  got=" (pr-str got)))))))
      (finally
        (fs/delete-tree root)
        (fs/delete-tree legacy-root)))
    s''))

(loop [i 0 s 20260831]
  (when (< i runs)
    (recur (inc i) (check-run i s))))

;; ── Reach floors: the generator must LAND in the interesting states ──────
;; Without these the property passes vacuously on populations that never
;; contain a marker at all - the exact shape BL-654 warns about.
(def floors {:some-exempt (quot runs 4)
             :all-live-exempt (quot runs 20)
             :exempt-hides-a-real-blocker (quot runs 20)
             :non-true-marker-present (quot runs 4)
             :blocked (quot runs 4)
             :unblocked (quot runs 4)})

(doseq [[k floor] floors]
  (let [n (get @reach k 0)]
    (if (>= n floor)
      (println (format "REACH %-30s %5d  (floor %d)" (name k) n floor))
      (swap! failures conj
             (format "FAIL reach: %s hit %d times, floor %d - the property would pass vacuously"
                     (name k) n floor)))))

(if (empty? @failures)
  (do (println (str "ALL PASS (" runs " runs)")) (System/exit 0))
  (do (doseq [f (take 5 @failures)] (println f))
      (println "FAILURES:" (count @failures))
      (System/exit 1)))
