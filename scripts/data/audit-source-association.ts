import type { StandardRecord } from "./types";

export type AuditedTableKind = {
  propertyType: "new" | "resale" | null;
  isCategoryTable: boolean;
  isAllowedTable: boolean;
  title: string;
};

export function auditSourceTableAssociation(
  record: Pick<StandardRecord, "property_type" | "size_band">,
  tableKind: AuditedTableKind,
  key: string,
): string[] {
  const errors: string[] = [];
  const title = tableKind.title.slice(0, 100);
  if (!tableKind.isAllowedTable) errors.push(`${key}: source is not one of the four allowed official table types: ${title}`);
  if (tableKind.propertyType === null) {
    errors.push(`${key}: source table type cannot be independently identified from title ${title}`);
  } else if (tableKind.propertyType !== record.property_type) {
    errors.push(`${key}: property_type=${record.property_type} does not match source table type ${tableKind.propertyType}`);
  }
  if (record.size_band === "all" && tableKind.isCategoryTable) errors.push(`${key}: all-size record unexpectedly points to a category/size-band table`);
  if (record.size_band !== "all" && !tableKind.isCategoryTable) errors.push(`${key}: size-band record unexpectedly points to an all-size table`);
  return errors;
}
