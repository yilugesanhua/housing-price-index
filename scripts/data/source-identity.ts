import { createHash } from "node:crypto";
import { recordKey } from "./official-parser";
import type { ParsedBatch, StandardRecord } from "./types";

interface RevisionRecord {
  revision_id: string;
  release_type?: "historical_correction";
  reason_type?: "official_revision" | "parser_error" | "transform_error" | "mapping_error";
  record_key: string;
  previous_value: StandardRecord;
  revised_value: StandardRecord;
  source_batch_id: string;
  reason: string;
  supersedes_revision_id: string | null;
}

const LEGACY_SOURCE_VERSION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "2026-06-ac103a1b1b18": "2026-06-4fd1d1a8ff12",
});

function sourceRecord(record: StandardRecord) {
  return {
    stat_month: record.stat_month,
    release_date: record.release_date,
    city_id: record.city_id,
    city_name: record.city_name,
    property_type: record.property_type,
    size_band: record.size_band,
    mom_index: record.mom_index,
    yoy_index: record.yoy_index,
    ytd_avg_index: record.ytd_avg_index,
    ytd_period_start: record.ytd_period_start,
    ytd_period_end: record.ytd_period_end,
    ytd_comparison_base: record.ytd_comparison_base,
    mom_change: record.mom_change,
    yoy_change: record.yoy_change,
    mom_missing_reason: record.mom_missing_reason,
    yoy_missing_reason: record.yoy_missing_reason,
    ytd_missing_reason: record.ytd_missing_reason,
    source_url: record.source_url,
    source_type: record.source_type,
    source_batch_id: record.source_batch_id,
    source_record_locator: record.source_record_locator,
    methodology_version: record.methodology_version,
  };
}

export function sourceDatasetVersion(
  latestMonth: string,
  batches: ParsedBatch[],
  revisions: RevisionRecord[],
): string {
  const revisionPositions = new Map(revisions.map((revision, index) => [revision.revision_id, index]));
  const canonical = {
    records: batches
      .flatMap((batch) => batch.records)
      .sort((left, right) => recordKey(left).localeCompare(recordKey(right)))
      .map(sourceRecord),
    sources: batches
      .map(({ source_batch: source }) => ({
        source_batch_id: source.source_batch_id,
        source_type: source.source_type,
        source_url: source.source_url,
        final_url: source.final_url,
        stat_month: source.stat_month,
        release_date: source.release_date,
        raw_content_sha256: source.raw_content_sha256,
      }))
      .sort((left, right) => left.source_batch_id.localeCompare(right.source_batch_id)),
    revisions: revisions.map((revision) => {
      const supersedesRevisionPosition = revision.supersedes_revision_id === null
        ? null
        : revisionPositions.get(revision.supersedes_revision_id);
      if (revision.supersedes_revision_id !== null && supersedesRevisionPosition === undefined) {
        throw new Error(`revision ${revision.revision_id} supersedes an unknown revision`);
      }
      return {
        record_key: revision.record_key,
        previous_value: sourceRecord(revision.previous_value),
        revised_value: sourceRecord(revision.revised_value),
        source_batch_id: revision.source_batch_id,
        reason: revision.reason,
        supersedes_revision_position: supersedesRevisionPosition,
        ...(revision.release_type === undefined ? {} : { release_type: revision.release_type }),
        ...(revision.reason_type === undefined ? {} : { reason_type: revision.reason_type }),
      };
    }),
  };
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
  const canonicalVersion = `${latestMonth}-${hash}`;
  return LEGACY_SOURCE_VERSION_ALIASES[canonicalVersion] ?? canonicalVersion;
}
