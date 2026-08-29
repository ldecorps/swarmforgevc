# BL-581 — Coordinator Wrong Commit

## Date
2026-08-29

## Issue
Coordinator sent parcel with commit `c9ecc7ecb5` for task `BL-581-documenter-owns-diagram-currency`, but:
1. That commit is about spy-grid launcher (unrelated to BL-581)
2. BL-581 is still in status `todo`, assigned to `specifier` — no coder work has been done yet
3. The cleaner cannot process a ticket that hasn't gone through the coder

## Context
- BL-581 is a feature ticket (type: feature) about documenter owning diagram currency
- The ticket was recently promoted to active (commit `71aa46143`)
- Status is still `todo`, assigned to specifier
- No coder commit exists for BL-581

## Root Cause
Coordinator dispatch error: 
1. Referenced the wrong commit hash (`c9ecc7ecb5` = spy-grid, not BL-581 work)
2. Sent parcel to cleaner before the ticket went through the coder
3. Same wrong commit was also sent for BL-1194-missing-property-tests (copy-paste error)

## Remediation
- Coordinator should not have sent BL-581 to cleaner yet (ticket still assigned to specifier)
- Coordinator should re-dispatch to the correct role (specifier or coder) with the correct commit once work is done
- Cleaner cannot proceed with this parcel

## Blame
- Role: coordinator
- Class: dispatch-error (wrong commit hash + wrong role dispatch)
