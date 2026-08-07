#!/usr/bin/env python3
"""Record, check, and summarize a bounded development task.

This utility is intentionally read-only with respect to the target project. It
only writes the explicitly requested evidence output file.
"""

from __future__ import annotations

import argparse
import copy
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Iterable


SCHEMA_VERSION = 1
MAX_JSON_BYTES = 5 * 1024 * 1024
TASK_TYPES = ("readonly", "develop", "fix", "data", "install", "release")
ROUTES = ("readonly", "simple", "full")
OUTCOMES = ("complete", "partial", "blocked")
EVIDENCE_STATUSES = ("passed", "failed", "not-run", "unavailable")
EVIDENCE_STAGES = (
    "analyzed",
    "plan-ready",
    "files-changed",
    "lint",
    "typecheck",
    "unit-tests",
    "data-validation",
    "build",
    "local-runtime",
    "devtools",
    "android-device",
    "iphone-device",
    "deployed",
    "uploaded",
    "reviewed",
    "released",
    "online-readback",
    "automation-enabled",
)
EXTERNAL_STAGES = {
    "deployed",
    "uploaded",
    "reviewed",
    "released",
    "online-readback",
    "automation-enabled",
}
READONLY_FORBIDDEN_STAGES = {"files-changed"}


class WorkflowError(Exception):
    """Raised for a user-correctable workflow error."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_hash(data: dict[str, Any], omitted_key: str) -> str:
    payload = copy.deepcopy(data)
    payload.pop(omitted_key, None)
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise WorkflowError(f"Cannot read {label} file {path}: {exc}") from exc
    if size > MAX_JSON_BYTES:
        raise WorkflowError(
            f"{label} file is too large ({size} bytes; limit {MAX_JSON_BYTES})"
        )
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowError(f"Invalid {label} file {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise WorkflowError(f"{label} file must contain a JSON object: {path}")
    return data


def write_json(data: dict[str, Any], output: Path) -> None:
    output = output.resolve(strict=False)
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
        try:
            with temporary.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temporary, output)
        finally:
            if temporary.exists():
                try:
                    temporary.unlink()
                except OSError:
                    pass
    except (OSError, TypeError) as exc:
        raise WorkflowError(f"Cannot write output file {output}: {exc}") from exc
    print(f"Success! Data written to: {output}")


def is_within(path: Path, root: Path) -> bool:
    path_value = os.path.normcase(str(path.resolve(strict=False)))
    root_value = os.path.normcase(str(root.resolve(strict=False)))
    try:
        return os.path.commonpath([path_value, root_value]) == root_value
    except ValueError:
        return False


def require_external_output(output: Path, protected_root: Path) -> None:
    if is_within(output, protected_root):
        raise WorkflowError(
            "Evidence output must be outside the project/repository: "
            f"{output.resolve(strict=False)}"
        )


def git_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment["LC_ALL"] = "C"
    return environment


def run_git(
    cwd: Path,
    arguments: list[str],
    *,
    check: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            ["git", *arguments],
            cwd=cwd,
            env=git_environment(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as exc:
        raise WorkflowError(f"Cannot run Git: {exc}") from exc
    if check and result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise WorkflowError(
            f"Git command failed ({' '.join(arguments)}): {detail or result.returncode}"
        )
    return result


def decode_git(value: bytes) -> str:
    return value.decode("utf-8", errors="replace").replace("\\", "/")


def discover_git_root(project: Path) -> Path | None:
    if shutil.which("git") is None:
        return None
    result = run_git(project, ["rev-parse", "--show-toplevel"], check=False)
    if result.returncode != 0:
        return None
    value = result.stdout.decode("utf-8", errors="replace").strip()
    return Path(value).resolve() if value else None


def current_head(repo: Path) -> str | None:
    result = run_git(repo, ["rev-parse", "--verify", "HEAD"], check=False)
    if result.returncode != 0:
        return None
    value = result.stdout.decode("ascii", errors="replace").strip()
    return value or None


def current_branch(repo: Path) -> str | None:
    result = run_git(repo, ["branch", "--show-current"], check=False)
    if result.returncode != 0:
        return None
    value = result.stdout.decode("utf-8", errors="replace").strip()
    return value or None


def parse_status(repo: Path) -> list[dict[str, Any]]:
    raw = run_git(
        repo,
        ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    ).stdout
    records = raw.split(b"\0")
    entries: list[dict[str, Any]] = []
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if record.startswith(b"1 "):
            fields = record.split(b" ", 8)
            if len(fields) != 9:
                raise WorkflowError("Unexpected Git status ordinary record")
            entries.append(
                {
                    "path": decode_git(fields[8]),
                    "status": decode_git(fields[1]),
                    "kind": "ordinary",
                    "submodule": decode_git(fields[2]),
                    "original_path": None,
                }
            )
        elif record.startswith(b"2 "):
            fields = record.split(b" ", 9)
            if len(fields) != 10 or index >= len(records):
                raise WorkflowError("Unexpected Git status rename/copy record")
            original = records[index]
            index += 1
            entries.append(
                {
                    "path": decode_git(fields[9]),
                    "status": decode_git(fields[1]),
                    "kind": "rename-copy",
                    "submodule": decode_git(fields[2]),
                    "original_path": decode_git(original),
                }
            )
        elif record.startswith(b"u "):
            fields = record.split(b" ", 10)
            if len(fields) != 11:
                raise WorkflowError("Unexpected Git status unmerged record")
            entries.append(
                {
                    "path": decode_git(fields[10]),
                    "status": decode_git(fields[1]),
                    "kind": "unmerged",
                    "submodule": decode_git(fields[2]),
                    "original_path": None,
                }
            )
        elif record.startswith(b"? "):
            entries.append(
                {
                    "path": decode_git(record[2:]),
                    "status": "??",
                    "kind": "untracked",
                    "submodule": None,
                    "original_path": None,
                }
            )
        else:
            raise WorkflowError(
                "Unexpected Git status record: "
                + record[:80].decode("utf-8", errors="replace")
            )
    return sorted(entries, key=lambda item: item["path"].casefold())


def chunked(values: list[str], size: int) -> Iterable[list[str]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def read_index_entries(repo: Path, paths: list[str]) -> dict[str, str | None]:
    result: dict[str, str | None] = {path: None for path in paths}
    tracked = sorted(set(paths), key=str.casefold)
    for group in chunked(tracked, 100):
        raw = run_git(repo, ["ls-files", "--stage", "-z", "--", *group]).stdout
        for record in raw.split(b"\0"):
            if not record or b"\t" not in record:
                continue
            metadata, raw_path = record.split(b"\t", 1)
            path = decode_git(raw_path)
            result[path] = metadata.decode("ascii", errors="replace")
    return result


def fingerprint_path(path: Path) -> dict[str, Any]:
    try:
        if path.is_symlink():
            target = os.readlink(path)
            encoded = target.encode("utf-8", errors="surrogatepass")
            return {
                "kind": "symlink",
                "size": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
            }
        if not path.exists():
            return {"kind": "missing", "size": None, "sha256": None}
        if path.is_dir():
            return {"kind": "directory", "size": None, "sha256": None}
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            while True:
                block = handle.read(1024 * 1024)
                if not block:
                    break
                digest.update(block)
                size += len(block)
        return {"kind": "file", "size": size, "sha256": digest.hexdigest()}
    except OSError as exc:
        return {
            "kind": "unavailable",
            "size": None,
            "sha256": None,
            "error": type(exc).__name__,
        }


def snapshot_status(repo: Path) -> list[dict[str, Any]]:
    entries = parse_status(repo)
    index_entries = read_index_entries(repo, [entry["path"] for entry in entries])
    for entry in entries:
        entry["fingerprint"] = fingerprint_path(repo / PurePosixPath(entry["path"]))
        entry["index_entry"] = index_entries.get(entry["path"])
    return entries


def normalize_rule(value: str) -> str:
    candidate = value.strip().replace("\\", "/")
    if not candidate:
        raise WorkflowError("Scope path cannot be empty")
    if candidate.startswith("/") or (
        len(candidate) >= 2 and candidate[1] == ":"
    ):
        raise WorkflowError(f"Scope path must be repository-relative: {value}")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    candidate = candidate.rstrip("/") or "."
    pure = PurePosixPath(candidate)
    if pure.is_absolute() or ".." in pure.parts:
        raise WorkflowError(f"Scope path must stay inside the repository: {value}")
    return candidate


def matches_rule(path: str, rule: str) -> bool:
    normalized_path = path.replace("\\", "/").casefold()
    normalized_rule = rule.replace("\\", "/").casefold()
    if normalized_rule == ".":
        return True
    if any(character in normalized_rule for character in "*?["):
        return fnmatch.fnmatchcase(normalized_path, normalized_rule)
    return normalized_path == normalized_rule or normalized_path.startswith(
        normalized_rule + "/"
    )


def path_classification(path: str, allowed: list[str], denied: list[str]) -> str:
    if any(matches_rule(path, rule) for rule in denied):
        return "denied"
    if any(matches_rule(path, rule) for rule in allowed):
        return "allowed"
    return "outside"


def status_identity(entry: dict[str, Any] | None) -> dict[str, Any] | None:
    if entry is None:
        return None
    return {
        "status": entry.get("status"),
        "kind": entry.get("kind"),
        "submodule": entry.get("submodule"),
        "original_path": entry.get("original_path"),
    }


def validate_baseline(data: dict[str, Any]) -> None:
    if data.get("schema_version") != SCHEMA_VERSION or data.get("command") != "start":
        raise WorkflowError("Unsupported or invalid baseline schema")
    expected = data.get("baseline_id")
    if not isinstance(expected, str) or canonical_hash(data, "baseline_id") != expected:
        raise WorkflowError("Baseline integrity check failed")
    if not isinstance(data.get("task"), dict) or not isinstance(
        data.get("repository"), dict
    ):
        raise WorkflowError("Baseline is missing task or repository data")


def validate_scope_report(data: dict[str, Any]) -> None:
    if data.get("schema_version") != SCHEMA_VERSION or data.get("command") != "scope-check":
        raise WorkflowError("Unsupported or invalid scope report schema")
    expected = data.get("scope_report_id")
    if not isinstance(expected, str) or canonical_hash(data, "scope_report_id") != expected:
        raise WorkflowError("Scope report integrity check failed")


def command_start(args: argparse.Namespace) -> dict[str, Any]:
    project = Path(args.project).resolve()
    if not project.is_dir():
        raise WorkflowError(f"Project directory does not exist: {project}")
    goal = args.goal.strip()
    success_criteria = [value.strip() for value in args.success]
    if not goal:
        raise WorkflowError("Goal cannot be empty")
    if any(not value for value in success_criteria):
        raise WorkflowError("Success criteria cannot be empty")
    if args.route == "readonly" and args.task_type != "readonly":
        raise WorkflowError("The readonly route requires task-type readonly")
    if args.task_type == "readonly" and args.route != "readonly":
        raise WorkflowError("Task-type readonly requires the readonly route")
    if args.task_type in {"data", "install", "release"} and args.route != "full":
        raise WorkflowError(f"Task-type {args.task_type} requires the full route")
    if args.route == "readonly" and args.allow:
        raise WorkflowError("Readonly tasks must not define writable --allow paths")
    if args.route != "readonly" and not args.allow:
        raise WorkflowError("Non-readonly tasks require at least one --allow path")

    allowed = [normalize_rule(value) for value in args.allow]
    denied = [normalize_rule(value) for value in args.deny]
    if any(
        rule.casefold() == ".git" or rule.casefold().startswith(".git/")
        for rule in allowed
    ):
        raise WorkflowError("The .git directory cannot be an allowed scope")
    repo = discover_git_root(project)
    protected_root = repo or project
    require_external_output(Path(args.output), protected_root)

    if repo is None:
        repository: dict[str, Any] = {
            "is_git": False,
            "guard_level": "limited",
            "project_root": str(project),
            "repo_root": None,
            "branch": None,
            "head": None,
            "initial_changes": [],
            "limitations": [
                "Git repository was not available; whole-project change detection is not provable."
            ],
        }
    else:
        repository = {
            "is_git": True,
            "guard_level": "full",
            "project_root": str(project),
            "repo_root": str(repo),
            "branch": current_branch(repo),
            "head": current_head(repo),
            "initial_changes": snapshot_status(repo),
            "limitations": [],
        }

    baseline: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "command": "start",
        "created_at": utc_now(),
        "task": {
            "goal": goal,
            "task_type": args.task_type,
            "route": args.route,
            "allowed": allowed,
            "denied": denied,
            "success_criteria": success_criteria,
        },
        "repository": repository,
    }
    baseline["baseline_id"] = canonical_hash(baseline, "baseline_id")
    return baseline


def command_scope_check(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    baseline_path = Path(args.baseline).resolve()
    baseline = read_json(baseline_path, "baseline")
    validate_baseline(baseline)
    repository = baseline["repository"]
    project = Path(repository["project_root"])
    protected_root = Path(repository["repo_root"] or repository["project_root"])
    output = Path(args.output).resolve(strict=False)
    if output == baseline_path:
        raise WorkflowError("Scope output cannot overwrite the baseline")
    require_external_output(output, protected_root)

    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "command": "scope-check",
        "created_at": utc_now(),
        "baseline_id": baseline["baseline_id"],
        "project_root": str(project),
        "repo_root": repository.get("repo_root"),
        "guard_level": repository.get("guard_level", "limited"),
        "passed": False,
        "identity": {},
        "categories": {
            "preexisting_unchanged": [],
            "preexisting_changed": [],
            "new_in_scope": [],
            "new_out_of_scope": [],
            "new_denied": [],
            "unassessable": [],
        },
        "violations": [],
        "limitations": list(repository.get("limitations", [])),
    }

    if not repository.get("is_git"):
        report["violations"].append("git-guard-unavailable")
        report["scope_report_id"] = canonical_hash(report, "scope_report_id")
        return report, False

    repo = Path(repository["repo_root"])
    discovered = discover_git_root(project)
    if discovered is None or os.path.normcase(str(discovered)) != os.path.normcase(
        str(repo.resolve())
    ):
        report["violations"].append("repository-identity-changed")
        report["identity"] = {
            "baseline_head": repository.get("head"),
            "current_head": None,
        }
        report["scope_report_id"] = canonical_hash(report, "scope_report_id")
        return report, False

    current_head_value = current_head(repo)
    report["identity"] = {
        "baseline_head": repository.get("head"),
        "current_head": current_head_value,
        "baseline_branch": repository.get("branch"),
        "current_branch": current_branch(repo),
    }
    if current_head_value != repository.get("head"):
        report["violations"].append("head-changed-since-baseline")

    current_entries = snapshot_status(repo)
    baseline_entries = {
        entry["path"]: entry for entry in repository.get("initial_changes", [])
    }
    current_by_path = {entry["path"]: entry for entry in current_entries}
    current_index = read_index_entries(repo, list(baseline_entries))

    for path, initial in sorted(
        baseline_entries.items(), key=lambda item: item[0].casefold()
    ):
        current = current_by_path.get(path)
        fingerprint = fingerprint_path(repo / PurePosixPath(path))
        initial_fingerprint = initial.get("fingerprint")
        unassessable = (
            not isinstance(initial_fingerprint, dict)
            or initial_fingerprint.get("kind") in {"unavailable", "directory"}
            or fingerprint.get("kind") in {"unavailable", "directory"}
        )
        changed = (
            status_identity(current) != status_identity(initial)
            or fingerprint != initial_fingerprint
            or current_index.get(path) != initial.get("index_entry")
        )
        item = {
            "path": path,
            "initial_status": initial.get("status"),
            "current_status": current.get("status") if current else None,
        }
        if unassessable:
            report["categories"]["unassessable"].append(item)
        elif changed:
            report["categories"]["preexisting_changed"].append(item)
        else:
            report["categories"]["preexisting_unchanged"].append(item)

    allowed = baseline["task"].get("allowed", [])
    denied = baseline["task"].get("denied", [])
    route = baseline["task"].get("route")
    for path, current in sorted(
        current_by_path.items(), key=lambda item: item[0].casefold()
    ):
        if path in baseline_entries:
            continue
        item = {"path": path, "status": current.get("status")}
        classification = path_classification(path, allowed, denied)
        if classification == "denied":
            report["categories"]["new_denied"].append(item)
        elif route == "readonly" or classification == "outside":
            report["categories"]["new_out_of_scope"].append(item)
        else:
            report["categories"]["new_in_scope"].append(item)

    if report["categories"]["preexisting_changed"]:
        report["violations"].append("preexisting-user-change-modified")
    if report["categories"]["new_out_of_scope"]:
        report["violations"].append("new-change-outside-allowed-scope")
    if report["categories"]["new_denied"]:
        report["violations"].append("denied-path-changed")
    if report["categories"]["unassessable"]:
        report["violations"].append("change-could-not-be-safely-assessed")

    report["passed"] = not report["violations"]
    report["scope_report_id"] = canonical_hash(report, "scope_report_id")
    return report, bool(report["passed"])


def require_string_list(data: dict[str, Any], key: str, *, nonempty: bool) -> list[str]:
    value = data.get(key)
    if not isinstance(value, list) or (nonempty and not value):
        qualifier = "a non-empty" if nonempty else "a"
        raise WorkflowError(f"Result field {key} must be {qualifier} list")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise WorkflowError(f"Result field {key} must contain non-empty strings")
    return [item.strip() for item in value]


def validate_result(data: dict[str, Any], route: str) -> dict[str, Any]:
    outcome = data.get("outcome")
    if outcome not in OUTCOMES:
        raise WorkflowError(f"Result outcome must be one of: {', '.join(OUTCOMES)}")
    summary = require_string_list(data, "summary", nonempty=True)
    usage_steps = require_string_list(data, "usage_steps", nonempty=False)
    remaining = require_string_list(data, "remaining", nonempty=False)
    rollback = require_string_list(data, "rollback", nonempty=False)
    evidence = data.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise WorkflowError("Result evidence must be a non-empty list")

    normalized_evidence: list[dict[str, Any]] = []
    for index, item in enumerate(evidence, start=1):
        if not isinstance(item, dict):
            raise WorkflowError(f"Evidence item {index} must be an object")
        stage = item.get("stage")
        status = item.get("status")
        detail = item.get("detail")
        if stage not in EVIDENCE_STAGES:
            raise WorkflowError(f"Evidence item {index} has unknown stage: {stage}")
        if status not in EVIDENCE_STATUSES:
            raise WorkflowError(f"Evidence item {index} has unknown status: {status}")
        if not isinstance(detail, str) or not detail.strip():
            raise WorkflowError(f"Evidence item {index} requires a non-empty detail")
        normalized = {"stage": stage, "status": status, "detail": detail.strip()}
        for optional in ("source", "checked_at", "identity"):
            if optional in item:
                value = item[optional]
                if not isinstance(value, str) or not value.strip():
                    raise WorkflowError(
                        f"Evidence item {index} field {optional} must be a non-empty string"
                    )
                normalized[optional] = value.strip()
        if stage in EXTERNAL_STAGES and status == "passed":
            missing = [
                key
                for key in ("source", "checked_at", "identity")
                if key not in normalized
            ]
            if missing:
                raise WorkflowError(
                    f"Passed external evidence {stage} requires: {', '.join(missing)}"
                )
        if (
            route == "readonly"
            and stage in READONLY_FORBIDDEN_STAGES
            and status == "passed"
        ):
            raise WorkflowError(f"Readonly result cannot claim passed stage: {stage}")
        normalized_evidence.append(normalized)

    return {
        "outcome": outcome,
        "summary": summary,
        "evidence": normalized_evidence,
        "usage_steps": usage_steps,
        "remaining": remaining,
        "rollback": rollback,
    }


def command_finish(args: argparse.Namespace) -> dict[str, Any]:
    baseline_path = Path(args.baseline).resolve()
    scope_path = Path(args.scope_report).resolve()
    result_path = Path(args.result).resolve()
    output = Path(args.output).resolve(strict=False)
    if output in {baseline_path, scope_path, result_path}:
        raise WorkflowError("Finish output cannot overwrite an input file")

    baseline = read_json(baseline_path, "baseline")
    validate_baseline(baseline)
    scope = read_json(scope_path, "scope report")
    validate_scope_report(scope)
    if scope.get("baseline_id") != baseline.get("baseline_id"):
        raise WorkflowError("Scope report belongs to a different baseline")
    protected_root = Path(
        baseline["repository"].get("repo_root")
        or baseline["repository"]["project_root"]
    )
    require_external_output(output, protected_root)

    raw_result = read_json(result_path, "result")
    result = validate_result(raw_result, baseline["task"]["route"])
    if result["outcome"] == "complete" and not scope.get("passed"):
        raise WorkflowError("A failed scope check cannot produce outcome complete")
    if result["outcome"] == "complete" and any(
        item["status"] == "failed" for item in result["evidence"]
    ):
        raise WorkflowError("Failed evidence cannot produce outcome complete")
    if any(
        item["stage"] == "files-changed" and item["status"] == "passed"
        for item in result["evidence"]
    ) and not scope.get("categories", {}).get("new_in_scope"):
        raise WorkflowError(
            "files-changed cannot pass when the scope report has no new in-scope changes"
        )

    state_summary: dict[str, list[str]] = {
        stage: ["not-claimed"] for stage in EVIDENCE_STAGES
    }
    for item in result["evidence"]:
        stage = item["stage"]
        if state_summary[stage] == ["not-claimed"]:
            state_summary[stage] = []
        state_summary[stage].append(item["status"])

    return {
        "schema_version": SCHEMA_VERSION,
        "command": "finish",
        "created_at": utc_now(),
        "outcome": result["outcome"],
        "task": baseline["task"],
        "repository": {
            "project_root": baseline["repository"]["project_root"],
            "repo_root": baseline["repository"].get("repo_root"),
            "branch": baseline["repository"].get("branch"),
            "head": baseline["repository"].get("head"),
            "guard_level": baseline["repository"].get("guard_level"),
        },
        "scope": {
            "passed": scope.get("passed"),
            "violations": scope.get("violations", []),
            "categories": scope.get("categories", {}),
            "scope_report_id": scope.get("scope_report_id"),
        },
        "summary": result["summary"],
        "evidence": result["evidence"],
        "state_summary": state_summary,
        "usage_steps": result["usage_steps"],
        "remaining": result["remaining"],
        "rollback": result["rollback"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Guard task scope and produce evidence-backed delivery records"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Record the task and initial state")
    start.add_argument("--project", required=True, help="Project directory")
    start.add_argument("--goal", required=True, help="Requested outcome")
    start.add_argument("--task-type", required=True, choices=TASK_TYPES)
    start.add_argument("--route", required=True, choices=ROUTES)
    start.add_argument(
        "--allow", action="append", default=[], help="Allowed repository-relative path"
    )
    start.add_argument(
        "--deny", action="append", default=[], help="Denied repository-relative path"
    )
    start.add_argument(
        "--success",
        action="append",
        required=True,
        help="Verifiable success criterion; repeat as needed",
    )
    start.add_argument("--output", required=True, help="Output JSON file outside project")

    scope = subparsers.add_parser(
        "scope-check", help="Compare current changes with the start baseline"
    )
    scope.add_argument("--baseline", required=True, help="Start baseline JSON")
    scope.add_argument("--output", required=True, help="Output JSON file outside project")

    finish = subparsers.add_parser(
        "finish", help="Generate the evidence-backed delivery record"
    )
    finish.add_argument("--baseline", required=True, help="Start baseline JSON")
    finish.add_argument("--scope-report", required=True, help="Scope report JSON")
    finish.add_argument("--result", required=True, help="Explicit result input JSON")
    finish.add_argument("--output", required=True, help="Output JSON file outside project")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "start":
            data = command_start(args)
            write_json(data, Path(args.output))
            return 0
        if args.command == "scope-check":
            data, passed = command_scope_check(args)
            write_json(data, Path(args.output))
            return 0 if passed else 1
        if args.command == "finish":
            data = command_finish(args)
            write_json(data, Path(args.output))
            return 0
        raise WorkflowError(f"Unknown command: {args.command}")
    except WorkflowError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # Keep CLI failures concise for unattended use.
        print(f"Unexpected error ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
