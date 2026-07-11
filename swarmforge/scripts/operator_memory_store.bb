;; BL-282: the long-term memory store's REAL fs adapter - mirrors
;; support_thread_store.bb exactly (same atomic-spit!-JSON shape), but for
;; a SIBLING, runtime-owned path (.swarmforge/support/memory/facts.json)
;; distinct from the per-subject thread files. Thin fs I/O only, no
;; decisions - operator_memory_lib.bb owns those.
(ns operator-memory-store
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn memory-file [state-dir]
  (fs/path state-dir "support" "memory" "facts.json"))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn read-store! [state-dir]
  (let [p (memory-file state-dir)]
    (if (fs/exists? p)
      (try (json/parse-string (slurp (str p)) true) (catch Exception _ {:facts []}))
      {:facts []})))

(defn write-store! [state-dir store]
  (atomic-spit! (memory-file state-dir) (json/generate-string store)))

;; Convenience: the {:read-store! :write-store!} shape operator_memory_lib.bb's
;; distill-facts! expects, bound to one state-dir.
(defn adapters-for [state-dir]
  {:read-store! (fn [] (read-store! state-dir))
   :write-store! (fn [store] (write-store! state-dir store))})
