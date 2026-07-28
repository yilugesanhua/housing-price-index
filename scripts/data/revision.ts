import type { StandardRecord } from "./types";

export function hasRevisableRecordChange(previous: StandardRecord, current: StandardRecord): boolean {
  const { parser_version: _previousParserVersion, ...previousComparable } = previous;
  const { parser_version: _currentParserVersion, ...currentComparable } = current;
  return JSON.stringify(previousComparable) !== JSON.stringify(currentComparable);
}
