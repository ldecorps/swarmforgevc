# BL-662: paused pager shows server failure reasons

On non-OK responses, the paused pager Mini App reads the JSON body first and prefers `reason`, matching the epic reorder screen (BL-572). Fallback remains `failText (HTTP <status>)` when the body has no reason or fails to parse.

Covered for both Expedite and Approve actions.
