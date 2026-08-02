# v2.4.1 12-Month Full Cloud Replay - 2026-08-02

Status: `passed_limited`

This record is evidence for the current full-cloud monthly-update rehearsal only. It does not prove WeChat Developer Tools compilation, Android or iPhone device acceptance, WeChat review, formal publication, or that production automatic release is enabled.

## Scope and Safety Boundary

- Candidate code: `main@53ac616` (`fix: validate pre-source replay padding`).
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

The local result is preflight evidence only. The following current-commit GitHub cloud replay is the separate cloud evidence.

## Attempt 2 - Current-Commit Cloud Replay Passed

- GitHub Actions run: [`30752209300`](https://github.com/yilugesanhua/housing-price-index/actions/runs/30752209300), `main@53ac616`.
- Workflow result: `success`; replay report result: `passed`; completed at `2026-08-02T15:14:35Z`.
- Scope: twelve sequential ordinary-month replays from baseline `2025-06` through target `2026-06`. Every round passed; the workflow wrote only `housing-data/rehearsals/30752209300/full-auto-update-year/`.
- Safety result: `production_pointer_untouched=true`, `production_release_prefix_untouched=true`, and `automatic_release_enabled=false`.
- Data result for every round: the official-page source was detected, 560 target-month records were parsed, `official-html-v7-product-housing-only` and `full-record-audit-v5` matched the full 126-batch / 70,560-record audit, and no historical record changed.
- Candidate result for every round: the package contained 70 city shards; both a missing official record and a shape-valid altered official value were rejected before upload or pointer activation.
- Remote/client result for every round: 72 data objects plus one control object were hash-read back from isolated COS before guarded pointer switching; the simulated mini-program activated the complete 70-city package, used remote data, retained 70 local city histories, and made zero additional downloads when switching cities.

### Per-Round Timing

All durations below are measured inside the isolated cloud rehearsal. They are not a promise for a future live statistical release; the release-day scheduling model continues to use a five-minute polling interval, a normal expectation of 10 to 25 minutes after the official page, a 30-minute internal target, a 45-minute warning target, and failure behavior of retaining the previous month.

| Round | Target month | Source + parse | Fail-closed gates | Package | Corruption rejection | Isolated upload/readback/switch | Client activation | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2025-07 | 525 ms | 620 ms | 1,155 ms | 1,957 ms | 340,585 ms | 1,138 ms | 345,990 ms |
| 2 | 2025-08 | 343 ms | 565 ms | 1,089 ms | 2,450 ms | 232,364 ms | 802 ms | 237,622 ms |
| 3 | 2025-09 | 344 ms | 580 ms | 1,092 ms | 1,821 ms | 174,662 ms | 773 ms | 179,281 ms |
| 4 | 2025-10 | 342 ms | 573 ms | 1,091 ms | 1,793 ms | 225,909 ms | 784 ms | 230,500 ms |
| 5 | 2025-11 | 350 ms | 581 ms | 1,105 ms | 2,849 ms | 198,612 ms | 847 ms | 204,353 ms |
| 6 | 2025-12 | 354 ms | 598 ms | 1,098 ms | 1,886 ms | 201,219 ms | 833 ms | 205,997 ms |
| 7 | 2026-01 | 288 ms | 591 ms | 1,098 ms | 2,154 ms | 251,851 ms | 857 ms | 256,849 ms |
| 8 | 2026-02 | 364 ms | 626 ms | 1,123 ms | 2,894 ms | 208,825 ms | 845 ms | 214,684 ms |
| 9 | 2026-03 | 353 ms | 637 ms | 1,131 ms | 1,947 ms | 182,651 ms | 866 ms | 187,596 ms |
| 10 | 2026-04 | 364 ms | 638 ms | 1,174 ms | 2,870 ms | 196,763 ms | 865 ms | 202,683 ms |
| 11 | 2026-05 | 373 ms | 631 ms | 1,147 ms | 1,944 ms | 209,215 ms | 841 ms | 214,160 ms |
| 12 | 2026-06 | 353 ms | 625 ms | 1,108 ms | 1,920 ms | 202,898 ms | 856 ms | 207,768 ms |

Total isolated cloud duration was `2,687,483 ms` (44 minutes 47.483 seconds). The mean per-round duration was 223.957 seconds; the slowest round was 345.990 seconds. The isolated upload/readback/switch stage dominated the run at 2,625,554 ms in total.

### Issues and Limits

- No new failed or blocking issue was found in this attempt.
- `REPLAY-PADDING-2025-07` through `REPLAY-PADDING-2025-11` are five informational records, not failures: the first five sliding 120-month client windows precede the official `2016-01` source coverage by five down to one month. Each is required to be null-only padding with empty release dates; every in-coverage value and target-month 560 records matched the verified archive exactly.
- `REPLAY-001` through `REPLAY-009` in the artifact issue list are fixed findings from earlier attempts. They are retained for traceability and were not reopened by this run.
- This is a real isolated cloud rehearsal, not a production write, cloud-function deployment, WeChat Developer Tools compilation, Android/iPhone device acceptance, WeChat review, or formal publication. It therefore strengthens R02 only for the ordinary-month cloud replay scope; historical-revision fault replay and the external-platform evidence remain open.
