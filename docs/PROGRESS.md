# Progress board

Branch: `refactor/architecture-sweep`. Baseline: `main` @ 55236e2.

Status vocabulary: `research` → `planned` → `in progress` → `done` / `blocked`.

| # | Workstream | Status | Notes |
|---|-----------|--------|-------|
| 01 | Contracts | research | inline wire types still to be enumerated |
| 02 | Game module | research | 4.8k lines, gateway alone is 649 |
| 03 | Module hygiene | research | audit/files/profile-controller usage unknown |
| 04 | Data layer | research | — |
| 05 | Noise reduction | queued | runs last, touches every file |
| 06 | Multi-replica | research | design doc only, by decision |
| 07 | dunx framework | in progress | separate repo, prerelease target |
| 08 | dunx docs | in progress | separate repo |

## Decisions taken up front

- dunx changes land in `/home/petarzarkov/repos/dunx` and ship as a **prerelease**
  that firecracker then consumes. Not a local link.
- Firecracker executes, it does not just plan — except workstream 06.
- One branch, one commit per workstream, nothing pushed without a say-so.
- `.cursor/` deleted.
