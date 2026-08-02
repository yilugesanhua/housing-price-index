import { describe, expect, it } from "vitest";
import { auditSourceTableAssociation, type AuditedTableKind } from "./audit-source-association";

function category(propertyType: "new" | "resale"): AuditedTableKind {
  return {
    propertyType,
    isCategoryTable: true,
    isAllowedTable: true,
    title: propertyType === "new" ? "新建商品住宅销售价格分类指数" : "二手住宅销售价格分类指数",
  };
}

describe("independent source-table association audit", () => {
  it("accepts a size-band record linked to the matching property table", () => {
    expect(auditSourceTableAssociation({ property_type: "new", size_band: "le90" }, category("new"), "record")).toEqual([]);
  });

  it("rejects a new-home size-band record linked to a resale category table", () => {
    expect(auditSourceTableAssociation({ property_type: "new", size_band: "90_144" }, category("resale"), "record")).toContain(
      "record: property_type=new does not match source table type resale",
    );
  });

  it("rejects a resale size-band record linked to a new-home category table", () => {
    expect(auditSourceTableAssociation({ property_type: "resale", size_band: "gt144" }, category("new"), "record")).toContain(
      "record: property_type=resale does not match source table type new",
    );
  });
});
