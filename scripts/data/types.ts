import { CITY_NAMES, type CityId, type PropertyType, type SizeBand } from "../../packages/core/src/index";

export const TARGET_CITIES: Record<CityId, string> = CITY_NAMES;

export interface SourceBatch {
  source_batch_id: string;
  source_type: "official-html" | "official-derived-bootstrap";
  source_url: string;
  fetched_at: string;
  raw_content_sha256: string;
  raw_archive_uri: string;
  parser_version: string;
  schema_version: string;
  verification_status: "unverified" | "sampled" | "verified";
  verification_method: string;
  http_status: number;
  final_url: string;
  redirect_chain: string[];
  stat_month: string;
  release_date: string;
}

export interface StandardRecord {
  stat_month: string;
  release_date: string;
  city_id: CityId;
  city_name: string;
  property_type: PropertyType;
  size_band: SizeBand;
  mom_index: number | null;
  yoy_index: number | null;
  ytd_avg_index: number | null;
  ytd_period_start: string | null;
  ytd_period_end: string | null;
  ytd_comparison_base: string | null;
  mom_change: number | null;
  yoy_change: number | null;
  mom_missing_reason: string | null;
  yoy_missing_reason: string | null;
  ytd_missing_reason: string | null;
  source_url: string;
  source_type: SourceBatch["source_type"];
  source_batch_id: string;
  source_record_locator: string;
  fetched_at: string;
  methodology_version: string;
  parser_version: string;
}

export interface ParsedBatch {
  source_batch: SourceBatch;
  records: StandardRecord[];
}
