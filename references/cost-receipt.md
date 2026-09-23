# Cost receipt

Printed at the end of every run and frozen in `runs.receipt`. Reprint with `gtm receipt <run-id>`.

```
COST RECEIPT  run=<id>
rows in: N   accepted: A   credits: C (~$U)   marginal credits/accepted: C/A
| leg | provider/tool | reached | calls | cached | hits | misses | errors | accepted | credits | credits/accepted | label |
```

Rules:
- **Marginal, never amortized.** Only this run's non-cached receipts count. Cached calls cost 0.
- **accepted** counts rows whose `valid` email came from that leg. `hits` may be higher (a hit with a domain mismatch or an unknown status is not accepted).
- **NEVER REACHED**: no row was still pending when this leg ran. Normal for late legs on easy files.
- **CUT CANDIDATE**: credits > 0 and accepted = 0. Drop it (`--legs`) or move it later.
- **cached**: every call served from cache.
- A `--max-credits` abort is not spend: rows past the abort carry `not_reached` / `budget_abort`.

Report to the user as: rows in / accepted / credits / marginal credits per accepted, then what changed after the pilot. Quote credits and USD from the receipt, never recompute in prose.
