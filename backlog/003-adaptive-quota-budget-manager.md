# Adaptive Quota & Budget Manager

## Problem
AI providers expose a wide variety of quota models including rolling message windows, daily caps, requests-per-minute, tokens-per-minute, pay-as-you-go budgets and undocumented soft limits. Today SwarmForge has no unified way to reason about these constraints.

## Vision
Introduce a Quota Manager responsible for tracking model availability, quotas, budgets and cooldowns independently of the ModelFactory.

## Goals
- Provide a common quota abstraction across providers.
- Track remaining capacity, reset times and spend.
- Learn provider behaviour from telemetry (429s, reset headers, observed cooldowns).
- Expose availability to the scheduler.
- Recommend the best available model based on quality, cost and quota.

## Architecture
- ModelFactory: creates model clients.
- QuotaManager: owns quotas, budgets and cooldowns.
- Scheduler: asks QuotaManager for eligible models.

## Supported quota types
- Pay-as-you-go
- Daily quota
- Rolling window
- RPM/TPM
- Monthly subscription
- Budget limits
- Unknown/learned

## Future enhancements
- Forecast quota exhaustion.
- Dashboard showing remaining capacity.
- Automatic failover to alternative models.
- Cost-aware scheduling.
- Operator integration for proactive rebalancing.

## Acceptance criteria
- Providers declare quota capabilities.
- Scheduler never dispatches to unavailable models.
- Quotas update automatically from provider telemetry.
- New quota types can be added without scheduler changes.
