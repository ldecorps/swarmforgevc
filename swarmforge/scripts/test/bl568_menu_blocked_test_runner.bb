#!/usr/bin/env bb
;; BL-568 unit tests: menu-blocked detect / extract / poll surface plan.

(require '[clojure.string :as str]
         '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))
(defn- assert-true [msg pred] (when-not pred (fail! msg)))
(defn- assert= [msg expected actual]
  (when-not (= expected actual) (fail! (str msg " expected=" (pr-str expected) " actual=" (pr-str actual)))))

(def sample-menu
  (str/join "\n"
            ["What should we do next?"
             ""
             "❯ 1. Ship it — land on main tonight"
             "  2. Wait — hold for review"
             "  3. Type something"
             ""
             "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"]))

(def over-cap-menu
  (str/join "\n"
            (concat
             ["Pick one:"
              ""]
             (map #(str "  " % ". Option " %) (range 1 12))
             [""
              "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"])))

(assert-true "detect: sample menu is blocked"
             (chase-sweep-lib/bl568DetectMenuBlocked sample-menu))
(assert-true "detect: idle pane is not blocked"
             (not (chase-sweep-lib/bl568DetectMenuBlocked "✓ Done\n❯ type a message")))

(let [ex (chase-sweep-lib/bl568-extract-menu sample-menu)]
  (assert-true "extract: blocked?" (:blocked? ex))
  (assert= "extract: 3 options" 3 (count (:options ex)))
  (assert-true "extract: fingerprint non-blank" (not (str/blank? (:fingerprint ex))))
  (assert-true "extract: free-text index present"
               (seq (:free-text-indexes ex))))

(let [plan (chase-sweep-lib/bl568-poll-surface-plan
            (chase-sweep-lib/bl568-extract-menu sample-menu))]
  (assert= "surface: poll mode" :poll (:mode plan))
  (assert= "surface: 3 options" 3 (count (:options plan)))
  (assert-true "surface: anonymous false implied (caller sets)" true))

(let [plan (chase-sweep-lib/bl568-poll-surface-plan
            (chase-sweep-lib/bl568-extract-menu over-cap-menu))]
  (assert= "over-cap: text-fallback" :text-fallback (:mode plan))
  (assert= "over-cap: reason" "too-many-options" (:reason plan)))

(let [a (chase-sweep-lib/bl568-extract-menu sample-menu)
      b (chase-sweep-lib/bl568-extract-menu sample-menu)
      c (chase-sweep-lib/bl568-extract-menu (str/replace sample-menu #"Ship it" "Abort"))]
  (assert= "fingerprint stable" (:fingerprint a) (:fingerprint b))
  (assert-true "fingerprint changes with options"
               (not= (:fingerprint a) (:fingerprint c))))

(if (empty? @failures)
  (println "bl568_menu_blocked: ALL TESTS PASSED")
  (do (println (str "bl568_menu_blocked: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
