;; BL-281: the SUP-### thread store's REAL fs adapters, extracted out of
;; support_thread.bb (BL-275) so a second caller - operator_runtime.bb's
;; Telegram forum-topic integration - can read/write the SAME thread files
;; without duplicating this logic or triggering support_thread.bb's own CLI
;; dispatch (that file's bottom-level (-main) call would exit on empty
;; *command-line-args* if merely load-file'd for its functions). Every
;; caller shares ONE unified thread store under .swarmforge/support/threads/
;; regardless of channel (RC via support_thread.bb, Telegram via
;; operator_runtime.bb) - the ticket's own "reuse BL-275's SUP-### store"
;; requirement. support_lib.bb (the pure decision logic) stays untouched;
;; this file is thin fs I/O only, no decisions.
(ns support-thread-store
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn threads-dir [state-dir]
  (fs/path state-dir "support" "threads"))

(defn thread-path [state-dir id]
  (fs/path (threads-dir state-dir) (str id ".json")))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn read-thread! [state-dir id]
  (let [p (thread-path state-dir id)]
    (when (fs/exists? p)
      (json/parse-string (slurp (str p)) true))))

(defn write-thread! [state-dir thread]
  (atomic-spit! (thread-path state-dir (:id thread)) (json/generate-string thread)))

(defn list-existing-ids! [state-dir]
  (let [dir (threads-dir state-dir)]
    (if (fs/exists? dir)
      (->> (fs/list-dir dir)
           (map fs/file-name)
           (keep #(second (re-matches #"(SUP-\d+)\.json" %))))
      [])))

;; Convenience: the {:read-thread! :write-thread! :list-existing-ids!} shape
;; support_lib.bb's adapter-injected functions expect, bound to one
;; state-dir - callers pass this straight through rather than re-wrapping
;; the three functions above by hand at every call site.
(defn adapters-for [state-dir]
  {:read-thread! (fn [id] (read-thread! state-dir id))
   :write-thread! (fn [thread] (write-thread! state-dir thread))
   :list-existing-ids! (fn [] (list-existing-ids! state-dir))})
