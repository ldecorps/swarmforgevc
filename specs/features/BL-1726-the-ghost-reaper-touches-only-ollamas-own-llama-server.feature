Feature: BL-1726 The ghost reaper touches only ollama's own llama-server

  BL-1705 taught the orphan janitor to reap ollama's ghost model runners:
  a runner whose parent is no longer a live ollama serve is reaped at any
  age. Its runner shape matches any llama-server on any path, so a
  llama.cpp server started by hand outside the swarm, whose parent is a
  shell, would be killed at the next sweep. Ollama's own worker is easy to
  tell apart: its executable sits inside the ollama installation and its
  --model is an ollama model blob. This feature is that only a runner
  carrying both marks, or an ollama runner, can be reaped.

  # BL-1726 only-ollamas-own-worker-is-reaped-01
  Scenario Outline: a runner-shaped process whose parent is not a live ollama serve is reaped only when it is ollama's own worker
    When the janitor classifies an old process whose parent is not a live ollama serve and whose command line is "<command line>"
    Then it is <verdict>

    Examples:
      | command line                                                                                        | verdict |
      | /mnt/d/dev/ollama/lib/ollama/llama-server --model /home/u/.ollama/models/blobs/sha256-64b5 --port 40483 | reaped  |
      | /usr/local/bin/ollama runner --model /home/u/.ollama/models/blobs/sha256-64b5                        | reaped  |
      | /home/u/llama.cpp/build/bin/llama-server -m /home/u/models/qwen3-27b.gguf --port 8080               | kept    |
      | llama-server --model /home/u/.ollama/models/blobs/sha256-64b5 --port 8081                            | kept    |
      | /usr/lib/ollama/llama-server --model /data/models/local.gguf --port 8082                             | kept    |
