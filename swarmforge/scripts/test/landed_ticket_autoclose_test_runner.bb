#!/usr/bin/env bb
;; Hotfix 2026-09-09: unit tests for landed_ticket_autoclose_lib.bb plus a
;; wiring check that handoffd.bb's landed-but-open sweep actually calls it.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "landed_ticket_autoclose_lib.bb")))

(def failures (atom 0))
(defn assert= [label expected actual]
  (if (= expected actual)
    (println (str "PASS " label))
    (do (println (str "FAIL " label))
        (println (str "  expected: " (pr-str expected)))
        (println (str "  actual:   " (pr-str actual)))
        (swap! failures inc))))

;; ── land record parsing ─────────────────────────────────────────────────────
(assert= "parse: valid rows in order, blank + corrupt lines skipped"
         [{:ticket "BL-1278" :commit "67200bad87"} {:ticket "BL-1376" :commit "049161fc03"}]
         (landed-ticket-autoclose-lib/parse-land-approval-lines
          (str "{\"at\":\"t\",\"ticket\":\"BL-1278\",\"commit\":\"67200bad87\",\"source\":\"67200bad87\"}\n"
               "\n"
               "not json at all\n"
               "{\"ticket\":\"BL-1376\",\"commit\":\"049161fc03\"}\n")))

(assert= "parse: empty text -> no rows" [] (landed-ticket-autoclose-lib/parse-land-approval-lines ""))

(let [root (str (fs/create-temp-dir))
      dir (fs/path root ".swarmforge" "land-approvals")]
  (fs/create-dirs dir)
  (spit (str (fs/path dir "2026-09.jsonl")) "{\"ticket\":\"BL-2\",\"commit\":\"bbbbbbbbbb\"}\n")
  (spit (str (fs/path dir "2026-08.jsonl")) "{\"ticket\":\"BL-1\",\"commit\":\"aaaaaaaaaa\"}\n")
  (assert= "read rows: month files in name order, oldest first"
           [{:ticket "BL-1" :commit "aaaaaaaaaa"} {:ticket "BL-2" :commit "bbbbbbbbbb"}]
           (landed-ticket-autoclose-lib/read-land-approval-rows root)))

(assert= "read rows: missing store -> []"
         [] (landed-ticket-autoclose-lib/read-land-approval-rows (str (fs/create-temp-dir))))

;; ── store index ─────────────────────────────────────────────────────────────
(let [rows [{:ticket "BL-1" :commit "1111111111aaaa"}
            {:ticket "BL-2" :commit "2222222222"}
            {:ticket "BL-1" :commit "3333333333"}   ; later land of BL-1 wins
            {:ticket "BL-9" :commit "9999999999"}   ; not active
            {:ticket "BL-4" :commit ""}]            ; blank commit ignored
      asked (atom [])
      ancestor? (fn [c] (swap! asked conj c) (not= c "2222222222"))]
  (assert= "index: last row per active ticket, ancestor required, short sha"
           {"BL-1" "3333333333"}
           (landed-ticket-autoclose-lib/index-store-approvals rows #{"BL-1" "BL-2" "BL-4"} ancestor?))
  (assert= "index: ancestry asked once per active ticket, never for inactive/blank rows"
           #{"3333333333" "2222222222"} (set @asked)))

;; ── candidates + cooldown ───────────────────────────────────────────────────
(assert= "candidates: approved + active + not closed, sorted"
         [{:id "BL-1" :approval-commit "aaaa"} {:id "BL-3" :approval-commit "cccc"}]
         (landed-ticket-autoclose-lib/auto-close-candidates
          #{"BL-3" "BL-1" "BL-2" "BL-5"} {"BL-1" "aaaa" "BL-2" "bbbb" "BL-3" "cccc"} #{"BL-2"}))

(assert= "attempt-due?: no record -> due" true
         (landed-ticket-autoclose-lib/attempt-due? {} "BL-1" 1000 100))
(assert= "attempt-due?: recent attempt -> not due" false
         (landed-ticket-autoclose-lib/attempt-due? {:BL-1 900} "BL-1" 1000 500))
(assert= "attempt-due?: old attempt -> due" true
         (landed-ticket-autoclose-lib/attempt-due? {:BL-1 100} "BL-1" 1000 500))

(assert= "coordinator note names id + sha and fits the 80-char cap"
         true
         (let [m (landed-ticket-autoclose-lib/coordinator-note-message "BL-1278" "67200bad87")]
           (and (str/includes? m "BL-1278") (str/includes? m "67200bad87") (<= (count m) 80))))

(assert= "draft lines address the coordinator"
         ["type: note" "to: coordinator" "priority: 00"]
         (take 3 (landed-ticket-autoclose-lib/coordinator-draft-lines "BL-1278" "67200bad87")))

;; ── attempts file round trip ────────────────────────────────────────────────
(let [dir (str (fs/create-temp-dir))]
  (landed-ticket-autoclose-lib/write-attempt! dir "BL-1278" 1234)
  (assert= "attempts round-trip" {:BL-1278 1234} (landed-ticket-autoclose-lib/read-attempts dir))
  (assert= "attempts: missing file -> {}" {} (landed-ticket-autoclose-lib/read-attempts (str (fs/create-temp-dir)))))

;; ── one attempt through fakes ───────────────────────────────────────────────
(defn run-attempt [close-result & {:keys [attempts now]}]
  (let [calls (atom [])
        r (landed-ticket-autoclose-lib/attempt-auto-close!
           {:item {:id "BL-1278" :approval-commit "67200bad87"}
            :now-ms (or now 100000) :attempts (or attempts {}) :cooldown-ms 1000
            :close! (fn [_] (swap! calls conj :close) close-result)
            :notify! (fn [_] (swap! calls conj :notify))
            :log! (fn [tag & _] (swap! calls conj tag))
            :record-attempt! (fn [_] (swap! calls conj :record))})]
    [r @calls]))

(assert= "closed: attempt recorded, close ran, logged, coordinator notified"
         [{:outcome :closed :id "BL-1278"} [:record :close "landed-auto-close" :notify]]
         (run-attempt {:ok? true :detail "Closed"}))

(assert= "refused: attempt recorded, logged refused, NO notify"
         [{:outcome :refused :id "BL-1278" :detail "CLOSE BLOCKED"} [:record :close "landed-auto-close-refused"]]
         (run-attempt {:ok? false :detail "CLOSE BLOCKED"}))

(assert= "cooldown: nothing runs inside the cooldown"
         [{:outcome :skipped-cooldown :id "BL-1278"} []]
         (run-attempt {:ok? true} :attempts {:BL-1278 99500} :now 100000))

(assert= "error in close!: recorded + logged error, not thrown"
         [:record :close "landed-auto-close-error"]
         (second (let [calls (atom [])]
                   [(landed-ticket-autoclose-lib/attempt-auto-close!
                     {:item {:id "BL-1278" :approval-commit "67200bad87"}
                      :now-ms 5 :attempts {} :cooldown-ms 1
                      :close! (fn [_] (swap! calls conj :close) (throw (ex-info "boom" {})))
                      :notify! (fn [_] (swap! calls conj :notify))
                      :log! (fn [tag & _] (swap! calls conj tag))
                      :record-attempt! (fn [_] (swap! calls conj :record))})
                    @calls])))

;; ── wiring: handoffd's landed-but-open sweep uses this lib ─────────────────
(let [src (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoffd.bb")))
      block-start (str/index-of src "(defn landed-commit-on-origin-main?")
      sweep-start (str/index-of src "(defn landed-but-open-sweep!")
      sweep-end (when sweep-start (or (str/index-of src "(defn " (inc sweep-start)) (count src)))
      ;; the hotfix block: helpers + auto-close-landed-tickets! + the sweep itself
      block-src (when (and block-start sweep-end) (subs src block-start sweep-end))
      sweep-src (when (and sweep-start sweep-end) (subs src sweep-start sweep-end))]
  (assert= "handoffd loads landed_ticket_autoclose_lib.bb" true
           (str/includes? src "landed_ticket_autoclose_lib.bb"))
  (assert= "landed-but-open-sweep! runs the auto-close before the legacy QA nudge" true
           (boolean (and sweep-src (str/includes? sweep-src "auto-close-landed-tickets!"))))
  (assert= "the auto-close goes through the lib's single attempt entry point" true
           (boolean (and block-src (str/includes? block-src "landed-ticket-autoclose-lib/attempt-auto-close!"))))
  (assert= "the land-approvals store is merged into the approvals" true
           (boolean (and block-src (str/includes? block-src "index-store-approvals"))))
  (assert= "the real close! adapter runs close_ticket.sh (guarded commit path)" true
           (boolean (and block-src (str/includes? block-src "close_ticket.sh")))))

(when (pos? @failures)
  (println (str @failures " FAILED"))
  (System/exit 1))
(println "all landed_ticket_autoclose tests passed")
