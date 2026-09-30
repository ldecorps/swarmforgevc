#!/usr/bin/env bb
;; BL-1838 property test (coder-authored, one declared invariant):
;;
;;   "A local-model seat's qwen context budget equals the window its model
;;   is served with, or the swarm's configured context length when Ollama
;;   reports none; never a value only the operator's ~/.qwen/settings.json
;;   holds."
;;
;; resolve-window's SIGNATURE already proves the "never a value only
;; ~/.qwen holds" half structurally - it takes only served-window and
;; context-length-str, so it has no way to reach into ~/.qwen even if it
;; wanted to. What this property exercises generatively is the PRECEDENCE
;; half: served-window wins whenever known (whatever context-length says),
;; context-length is used only when served-window is unknown, and the
;; result is nil - never a fabricated number - when neither resolves.
;;
;; Four categories, chosen by construction each iteration (never independent
;; coin flips - BL-654 failure shape (a): served-known ALSO varies its
;; context-length arm on every draw, so "served wins over EVERY kind of
;; context-length" is what gets proven, not just "served wins once".
;;
;; Non-vacuity proven at authoring: swap resolve-window's `or` for
;; `(or (parse-context-length ...) served-window)` (context-length would
;; wrongly win) - fails category 1 immediately; return a hardcoded number
;; when both are nil - fails category 4.
(ns bl1838-qwen-provider-window-property-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "local_model_qwen_provider_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1838)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def categories [:served-known :context-only-parseable :context-only-garbage :neither])

;; A random positive int in [lo, hi) via the shared rng - never 0 (0 would
;; be falsy-adjacent in other languages, never here since Clojure only
;; treats nil/false as falsy, but a real served window is never 0 anyway).
(defn rand-int-range [lo hi] (+ lo (rng (- hi lo))))

(defn rand-context-length-str []
  ;; A parseable context length: sometimes padded with whitespace (the CLI
  ;; always passes a literal string, and parse-context-length trims).
  (let [n (rand-int-range 1024 200000)]
    (if (zero? (rng 2)) (str n) (str "  " n "  "))))

(defn rand-garbage-str []
  (nth ["" "not-a-number" "32k" "-" "NaN" "  "] (rng 6)))

(dotimes [i runs]
  (let [category (nth categories (mod i (count categories)))]
    (bump! category)
    (case category
      :served-known
      (let [served (rand-int-range 1024 200000)
            ;; served must win regardless of what context-length says -
            ;; vary it across EVERY other category's own shape, not just one.
            context-length (case (rng 3)
                              0 (rand-context-length-str)
                              1 (rand-garbage-str)
                              2 nil)
            result (local-model-qwen-provider-lib/resolve-window served context-length)]
        (check! (str "served-known: served=" served " context-length=" (pr-str context-length)
                      " -> expected " served ", got " result)
                (= served result)))

      :context-only-parseable
      (let [context-length (rand-context-length-str)
            expected (local-model-qwen-provider-lib/parse-context-length context-length)
            result (local-model-qwen-provider-lib/resolve-window nil context-length)]
        (check! "context-only-parseable: parse-context-length itself returned nil for a constructed numeral - generator bug"
                (some? expected))
        (check! (str "context-only-parseable: context-length=" (pr-str context-length)
                      " -> expected " expected ", got " result)
                (= expected result)))

      :context-only-garbage
      (let [context-length (rand-garbage-str)
            result (local-model-qwen-provider-lib/resolve-window nil context-length)]
        (check! (str "context-only-garbage: context-length=" (pr-str context-length)
                      " -> expected nil (never fabricate a window), got " result)
                (nil? result)))

      :neither
      (let [context-length (nth [nil "" "  "] (rng 3))
            result (local-model-qwen-provider-lib/resolve-window nil context-length)]
        (check! (str "neither: context-length=" (pr-str context-length)
                      " -> expected nil (never a value only ~/.qwen would hold), got " result)
                (nil? result))))))

(doseq [c categories]
  (check! (str "generator never reached category " c)
          (pos? (get @reached c 0))))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "served-known=" (get @reached :served-known 0)
         "context-only-parseable=" (get @reached :context-only-parseable 0)
         "context-only-garbage=" (get @reached :context-only-garbage 0)
         "neither=" (get @reached :neither 0))
