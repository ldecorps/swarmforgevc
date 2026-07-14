#!/usr/bin/env bb
;; BL-367: thin CLI wrapper so swarmforge.sh (zsh) can call the pure
;; resolve-socket-path decision. Prints the resolved socket path to stdout
;; and exits 0, or prints a clear diagnostic to stderr and exits 1 - never
;; a blind bind past the OS's own unix-socket path limit.
;;
;; Usage: resolve_swarm_socket.bb <working-dir> <hash>

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_socket_lib.bb")))

(defn -main [working-dir hash]
  (let [result (swarm-socket-lib/resolve-socket-path
                {:working-dir working-dir
                 :hash hash
                 :xdg-runtime-dir (System/getenv "XDG_RUNTIME_DIR")})]
    (if (:error result)
      (do
        (binding [*out* *err*]
          (println (str "resolve_swarm_socket.bb: " (:message result))))
        (System/exit 1))
      (println (:path result)))))

(apply -main *command-line-args*)
