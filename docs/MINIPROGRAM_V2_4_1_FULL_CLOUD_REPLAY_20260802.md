# v2.4.1 12-Month Full Cloud Replay - 2026-08-02

Status: `cloud_retry_pending`

This record is evidence for the current full-cloud monthly-update rehearsal only. It does not prove WeChat Developer Tools compilation, Android or iPhone device acceptance, WeChat review, formal publication, or that production automatic release is enabled.

## Scope and Safety Boundary

- Candidate code: pending commit containing the coverage-padding repair described below.
- Replay workflow: `.github/workflows/full-auto-update-replay.yml`.
- Cloud storage boundary: `housing-data/rehearsals/<github-run-id>/full-auto-update-year/` only.
- Production `housing-data/current.json` and production release prefixes: untouched.
- `AUTOMATIC_RELEASE_ENABLED`: remains `false`.
- The replay must stop at the first failed month. A repair requires a new 12-month sequence beginning at run 1.

## Attempt 1 - Failed Before Month 1

- GitHub Actions run: `30751211902`, `main@7f9135c3574f20aca0eb1a23519f155ad9afdaee`.
- Result: failed during construction of the first simulated target (`2025-07`); `completed_replay_count=0`.
- Failure: `snapshot source coverage cannot start after the client window`.
- Production safety evidence from the uploaded report: `production_pointer_untouched=true`, `production_release_prefix_untouched=true`.

### Root Cause and Repair

The first historical 120-month client window begins at `2015-08`, while the first official source month is `2016-01`. The replay correctly uses null-only pre-coverage padding, but the remote-package and client validators incorrectly required `sourceCoverageStart <= coverageStart`.

The repair changes the rule to the following fail-closed contract:

1. `coverageStart` must equal the first client-window month.
2. `sourceCoverageStart` may precede the client window, or fall inside it, but may not be later than the final client-window month.
3. When `sourceCoverageStart` falls after `coverageStart`, every preceding four-value series tuple must be `[null, null, null, null]` and its corresponding `releaseDates` value must be empty.
4. Any value, non-empty release date, missing month, or source start after the window fails before activation.

The same rule is enforced in the remote-package builder, the complete snapshot validator, and the mini-program remote bootstrap validator. Positive and negative regression tests were added for the padding boundary.

## Repair Verification Before Cloud Retry

- Targeted remote-data and data-runtime tests: 85 passed, 0 failed.
- `npm.cmd run check`: passed; 290 mini-program tests, 44 data tests, 17 Web tests, 3 release-readiness tests, 70,560-record validation, and production build all passed.
- `npm.cmd run test:e2e`: 40 passed.
- Source-directory files `apps/miniprogram/utils/data-integrity.js` and `apps/miniprogram/utils/data-runtime.js` were synchronized to `70城小程序技术验证/` and their SHA-256 values matched exactly.
- Local isolated restart: 12/12 sequential monthly replays passed from `2025-06 -> 2025-07` through `2026-05 -> 2026-06`; total internal pipeline duration was `89,772 ms`.
- The local report confirms `production_pointer_untouched=true`, `production_release_prefix_untouched=true`, and `automatic_release_enabled=false`.

The local result is preflight evidence only. The next step is a new current-commit GitHub cloud replay from run 1, followed by inspection of its uploaded report and issue list.
