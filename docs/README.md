# Firecracker engineering docs

Working notes for the architecture sweep started 2026-08-20 on branch
`refactor/architecture-sweep`. Each workstream owns exactly one file under
`plans/` — that is deliberate, so eight agents can write at once without
fighting over a shared status file.

`PROGRESS.md` is the board. It is written by the integrator, not by the
workstreams.

## Plans

| # | Workstream | Repo | Doc |
|---|-----------|------|-----|
| 01 | Inline contracts → `@firecracker/contracts` | firecracker | [plans/01-contracts.md](plans/01-contracts.md) |
| 02 | Game module decomposition | firecracker | [plans/02-game-module.md](plans/02-game-module.md) |
| 03 | Module hygiene: static-class modules, infra teardown, dead modules | firecracker | [plans/03-module-hygiene.md](plans/03-module-hygiene.md) |
| 04 | Data layer: db type, BaseRepository, wallet move, migrations | firecracker | [plans/04-data-layer.md](plans/04-data-layer.md) |
| 05 | Logging and comment reduction | firecracker | [plans/05-noise-reduction.md](plans/05-noise-reduction.md) |
| 06 | Scaling past one replica | firecracker | [plans/06-multi-replica.md](plans/06-multi-replica.md) |
| 07 | dunx framework gaps | dunx | [plans/07-dunx-framework.md](plans/07-dunx-framework.md) |
| 08 | dunx docs rewrite + Asena survey | dunx | [plans/08-dunx-docs.md](plans/08-dunx-docs.md) |
