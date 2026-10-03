Feature: BL-1938 A local seat's tuning report pairs each request with its own model's load

  BL-1851's tuning report labels each request with how Ollama served the
  model: the layers on the GPU and the KV cache type of the load before
  the request. It takes the latest load of ANY model. One Ollama server can
  serve several models (BL-1861 keeps it running for a task outside the
  swarm), so the load just before a request can be another model's, and
  the request would print that model's layers as its own. Each request
  record names its model tag, and each load in the Ollama log names its
  model blob, which the tag's manifest identifies. This report pairs a
  request only with a load of its own model, and says unknown when it
  cannot.

  Background:
    Given a tuning-report fixture whose Ollama models directory maps the tag "ista-iq3s-coder:latest" to one model blob and "qwen3-14b:latest" to another

  # BL-1938 another-models-later-load-never-relabels-a-request-01
  Scenario: another model's later load does not relabel a request
    Given the Ollama log loaded "ista-iq3s-coder:latest" with 65 of 65 layers on the GPU and a q8_0 KV cache, then "qwen3-14b:latest" with 41 of 41 and an f16 KV cache
    And the seat "coder@iq3" made 3 requests to "ista-iq3s-coder:latest" after the last load in the log
    When the tuning report runs for "coder@iq3" over the fixture
    Then its 3 requests are served as "65/65 layers, q8_0 KV"

  # BL-1938 a-request-with-no-load-of-its-own-model-is-unknown-02
  Scenario: a request whose model has no load in the log is served as unknown
    Given the Ollama log loaded only "qwen3-14b:latest", with 41 of 41 layers on the GPU and an f16 KV cache
    And the seat "coder@iq3" made 2 requests to "ista-iq3s-coder:latest" after the last load in the log
    When the tuning report runs for "coder@iq3" over the fixture
    Then its 2 requests are served as "unknown serving"
