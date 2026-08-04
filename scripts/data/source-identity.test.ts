import { describe, expect, it } from "vitest";
import { sourceDatasetVersion } from "./source-identity";
import type { ParsedBatch, StandardRecord } from "./types";

function record(overrides: Partial<StandardRecord> = {}): StandardRecord {
  return {
    stat_month: "2026-07",
    release_date: "2026-08-17",
    city_id: "beijing",
    city_name: "北京",
    property_type: "new",
    size_band: "all",
    mom_index: 100.1,
    yoy_index: 99.5,
    ytd_avg_index: 98.8,
    ytd_period_start: "2026-01",
    ytd_period_end: "2026-07",
    ytd_comparison_base: "2025-01..2025-07=100",
    mom_change: 0.1,
    yoy_change: -0.5,
    mom_missing_reason: null,
    yoy_missing_reason: null,
    ytd_missing_reason: null,
    source_url: "https://www.stats.gov.cn/source",
    source_type: "official-html",
    source_batch_id: "official-html-2026-07-source",
    source_record_locator: "table[0] row[1]",
    fetched_at: "2026-08-17T01:00:00.000Z",
    methodology_version: "nbs-house-price-index-2015-base",
    parser_version: "parser-v1",
    ...overrides,
  };
}

function batch(value = record()): ParsedBatch {
  return {
    source_batch: {
      source_batch_id: value.source_batch_id,
      source_type: "official-html",
      source_url: value.source_url,
      fetched_at: value.fetched_at,
      raw_content_sha256: "a".repeat(64),
      raw_archive_uri: "data/raw/source.html",
      parser_version: value.parser_version,
      schema_version: "1.3.0",
      verification_status: "verified",
      verification_method: "audit-v1",
      audited_records_sha256: "b".repeat(64),
      http_status: 200,
      final_url: value.source_url,
      redirect_chain: [],
      stat_month: value.stat_month,
      release_date: value.release_date,
    },
    records: [value],
  };
}

describe("sourceDatasetVersion", () => {
  it("ignores fetch, parser, audit, and archive metadata", () => {
    const original = batch();
    const rebuilt = structuredClone(original);
    rebuilt.source_batch.fetched_at = "2026-08-18T02:00:00.000Z";
    rebuilt.source_batch.parser_version = "parser-v2";
    rebuilt.source_batch.verification_method = "audit-v2";
    rebuilt.source_batch.audited_records_sha256 = "c".repeat(64);
    rebuilt.source_batch.raw_archive_uri = "moved/source.html.gz";
    rebuilt.records[0].fetched_at = rebuilt.source_batch.fetched_at;
    rebuilt.records[0].parser_version = rebuilt.source_batch.parser_version;

    expect(sourceDatasetVersion("2026-07", [rebuilt], []))
      .toBe(sourceDatasetVersion("2026-07", [original], []));
  });

  it("changes when business values, official source bytes, or locators change", () => {
    const original = batch();
    const version = sourceDatasetVersion("2026-07", [original], []);
    const changedValue = batch(record({ mom_index: 100.2, mom_change: 0.2 }));
    const changedBytes = structuredClone(original);
    changedBytes.source_batch.raw_content_sha256 = "d".repeat(64);
    const changedLocator = batch(record({ source_record_locator: "table[1] row[1]" }));

    expect(sourceDatasetVersion("2026-07", [changedValue], [])).not.toBe(version);
    expect(sourceDatasetVersion("2026-07", [changedBytes], [])).not.toBe(version);
    expect(sourceDatasetVersion("2026-07", [changedLocator], [])).not.toBe(version);
  });

  it("binds the business meaning and chain of the revision ledger", () => {
    const source = batch();
    const previous = record({ mom_index: 100, mom_change: 0 });
    const revision = {
      revision_id: "revision-one",
      record_key: "2026-07|beijing|new|all",
      previous_value: previous,
      revised_value: source.records[0],
      source_batch_id: source.source_batch.source_batch_id,
      reason: "official source correction",
      supersedes_revision_id: null,
    };

    expect(sourceDatasetVersion("2026-07", [source], [revision]))
      .not.toBe(sourceDatasetVersion("2026-07", [source], []));
    expect(() => sourceDatasetVersion("2026-07", [source], [{
      ...revision,
      revision_id: "revision-two",
      supersedes_revision_id: "missing-revision",
    }])).toThrow(/supersedes an unknown revision/);
  });
});
