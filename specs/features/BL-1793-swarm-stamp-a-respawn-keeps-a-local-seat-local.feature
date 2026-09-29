# mutation-stamp: sha256=eaf3b63065542637d1318e5a3b1bd1f2f30bc329582754183a8bf5b3c80b5a70
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-29T10:08:34.020687901Z","feature_name":"BL-1793 swarm stamp - a respawn keeps a local seat local (hotfix cb8d502fec)","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1793-swarm-stamp-a-respawn-keeps-a-local-seat-local.feature","background_hash":"b3107546042ebfbe2d9d2a0481bce074816056b48bd85897ffc8796bae814c05","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a respawned seat whose window line names no cloud host keeps its own endpoint","scenario_hash":"fc31e1d1d2c3a91385f97e0fe4bf40dbd3418630b6ff66787bf8f82e5e1a20d7","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-29T10:08:34.020687901Z"},{"index":1,"name":"a respawned seat whose window line names a cloud host is still remapped to that host","scenario_hash":"88688aad0a2d23b467452a035be7101d29b9bd89361c5d46bf461d2f0de77d6f","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-09-29T10:08:34.020687901Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1793 swarm stamp - a respawn keeps a local seat local (hotfix cb8d502fec)

  Review-only certification (BL-848) of operator hotfix cb8d502fec, live
  on main since 2026-09-28. Every generated launch script carries dormant
  SWARMFORGE_USE-guarded blocks naming the Cerebras, Perplexity and b.ai
  hosts, whatever the pack. provider_compat_lib matched those blocks as if
  the seat targeted the hosts, so a respawn by swarm ensure, handoffd or
  babysitterd rewired a local-Ollama seat to a cloud provider. The hotfix
  strips the guarded blocks before matching. These scenarios drive the
  real launch-script generator and the real respawn environment builder;
  they change nothing in what landed.

  Background:
    Given the respawning process holds a key for every cloud provider and sets no SWARMFORGE_USE flag

  # BL-1793 swarm-stamp-a-respawn-keeps-a-local-seat-local-01
  Scenario Outline: a respawned seat whose window line names no cloud host keeps its own endpoint
    Given a launch script generated for a "<seat>" window line that names no cloud host
    When the respawn environment for that seat is computed
    Then it sets no SWARMFORGE_USE flag and no OpenAI base

    Examples:
      | seat               |
      | local Ollama aider |
      | Claude             |

  # BL-1793 swarm-stamp-a-respawn-keeps-a-local-seat-local-02
  Scenario Outline: a respawned seat whose window line names a cloud host is still remapped to that host
    Given a launch script generated for an aider window line whose OpenAI base is "<host>"
    When the respawn environment for that seat is computed
    Then the seat is remapped to "<host>" under the "<flag>" flag

    Examples:
      | host                                                                   | flag                      |
      | https://api.cerebras.ai/v1                                             | SWARMFORGE_USE_CEREBRAS   |
      | https://api.perplexity.ai                                              | SWARMFORGE_USE_PERPLEXITY |
      | https://api.b.ai/v1                                                    | SWARMFORGE_USE_BAI        |
      | https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 | SWARMFORGE_USE_QWEN       |
