# BL-146 Verification Failure — Architecture Diagram Documentation Bug

**Date:** 2026-07-07  
**Task:** BL-146-daemon-sweep-integration-failure  
**Commit:** 6ba9e9a65e  

## 1. Failing Command

```bash
npm test                     # full test suite passes
npm run compile             # TypeScript compiles cleanly
# Manual review of docs/diagrams/architecture.mmd
```

## 2. Commit Hash Tested

```
6ba9e9a65e6a3d3fd683b2b985d8337bbedffd0a
```

## 3. First Error Excerpt

The architecture diagram (`docs/diagrams/architecture.mmd`) contains undefined references to a component called `CHASER`:

**Line 63:**
```mermaid
  PANEL --> CHASER
```

**Line 65:**
```mermaid
  CHASER --> MSGBUS
```

Both of these reference a component `CHASER` which is NOT defined anywhere in the diagram. The component definition was on line 21 in the previous version but was removed by the documenter's commit, yet these two references were not removed along with it.

## 4. Failure Class

**behavior** — The documented architecture does not match the actual implementation. The diagram is broken/malformed because it references an undefined component.

## 5. Expected vs Observed

**Expected:** The architecture diagram should show the daemon (handoffd.bb) owning the chase/watchdog duties, with ChaseMonitor removed from the extension host. All components referenced in the diagram should be defined.

**Observed:** The diagram references `CHASER` on lines 63 and 65 but this component is not defined. The commit removed the CHASER definition and some (but not all) of its references, leaving the diagram in a broken state.

## Root Cause Analysis

The documenter's commit (6ba9e9a65e) shows that it correctly removed:
- Line 21: `CHASER["ChaseMonitor.ts + inboxChaser.ts\n+ watchdog/liveness.ts + paneActivity.ts"]` definition
- Line 73: `CHASER -->|reads/writes| HANDOFFS` connection
- Line 91: `CHASER` from the `class` declaration

However, two references remain:
- Line 63: `PANEL --> CHASER`
- Line 65: `CHASER --> MSGBUS`

These two lines should have also been removed to complete the refactoring. The BL-146 acceptance criteria states: "docs/diagrams architecture diagram updated: chaser moves from extension host to daemon" — this was incomplete.

## How to Verify

Open `docs/diagrams/architecture.mmd` and search for `CHASER`. The two remaining references on lines 63 and 65 should be removed.
