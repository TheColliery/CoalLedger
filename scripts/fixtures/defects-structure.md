# Defects fixture

### Skipped level (h1 to h3)

# Second top-level title

Link to [a missing anchor](#no-such-heading) here.

Link to [a case mismatch](#Skipped-level-h1-to-h3) here.

Link to [a dead file](./no-such-file.md) here.

![dead image](./img/missing.png)

Cross-file bad: [missing target heading](./defects-target.md#not-there).

Good cross-file: [exists](./defects-target.md#existing-heading).

| a | b |
| --- | --- |
| 1 | 2 | 3 |

See [broken ref][no-def] for details.

Bare URL: https://example.com/dangling in prose.

[orphan-def]: https://example.com/orphan
