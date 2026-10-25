# The eleven example apps: test rerun of 25 October 2026

Rerun by the maintainers from **fresh clones** (`git clone --depth 1`) of each public repository, with `npm ci` where the project has dependencies, then the command its README gives: `npm test`, and `npm run recorrido` where the project has one. Node 24. This is a self-run record, not an external audit.

| Project | Commit tested | Tests | Pass | Fail | Walkthrough |
|---|---|---|---|---|---|
| queen | `1757756` | 45 | 45 | 0 | ok |
| permamuseum | `d57af8a` | 52 | 52 | 0 | ok |
| casa-firme | `5a95c91` | 24 | 24 | 0 | ok |
| ficha-contigo | `32e7314` | 13 | 13 | 0 | ok |
| catedra | `22d00e5` | 36 | 36 | 0 | ok |
| escribano | `16c0350` | 13 | 13 | 0 | ok |
| llavero | `b75c40e` | 14 | 14 | 0 | ok |
| farolero | `c42ab30` | 13 | 13 | 0 | ok |
| marea | `6e0f352` | 25 | 25 | 0 | ok |
| vela | `4a0b3a3` | 11 | 11 | 0 | ok |
| temis | `158e631` | 153 | 153 | 0 | none in the project |
| **Total** | | **399** | **399** | **0** | 10 of 10 that have one |

Notes:

- Ten of the eleven pin the Vespi kernel at version 0.1.6 (commit `39d4573`); TEMIS runs its own agreement layer and does not run the kernel. The pins are not moved by this rerun.
- Later commits to Farolero, Marea and TEMIS only change their README text.
- `src/` of the kernel is identical between commit `77bceb0` (the baseline named in `SUITE_RESULT_0.1.8.txt`) and the tag `v0.1.8-kernel`: `git diff 77bceb0 v0.1.8-kernel -- src` prints nothing.
