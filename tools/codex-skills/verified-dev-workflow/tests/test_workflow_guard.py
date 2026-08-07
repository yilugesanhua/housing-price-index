from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "workflow_guard.py"


class WorkflowGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.evidence = self.root / "evidence"
        self.repo.mkdir()
        self.evidence.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "tests@example.invalid")
        self.git("config", "user.name", "Workflow Tests")
        (self.repo / "README.md").write_text("initial\n", encoding="utf-8")
        (self.repo / "user.txt").write_text("committed\n", encoding="utf-8")
        (self.repo / "secret.txt").write_text("secret placeholder\n", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "initial")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def git(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
        )

    def cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def write_result(self, path: Path, data: dict) -> None:
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def start_readonly(self, output: Path) -> subprocess.CompletedProcess[str]:
        return self.cli(
            "start",
            "--project",
            str(self.repo),
            "--goal",
            "Inspect without changes",
            "--task-type",
            "readonly",
            "--route",
            "readonly",
            "--success",
            "Repository status is unchanged",
            "--output",
            str(output),
        )

    def start_readme_change(
        self,
        output: Path,
        *extra: str,
    ) -> subprocess.CompletedProcess[str]:
        return self.cli(
            "start",
            "--project",
            str(self.repo),
            "--goal",
            "Update README only",
            "--task-type",
            "fix",
            "--route",
            "simple",
            "--allow",
            "README.md",
            *extra,
            "--success",
            "Only README.md is newly changed",
            "--output",
            str(output),
        )

    def scope(self, baseline: Path, output: Path) -> subprocess.CompletedProcess[str]:
        return self.cli(
            "scope-check",
            "--baseline",
            str(baseline),
            "--output",
            str(output),
        )

    def finish(
        self,
        baseline: Path,
        scope: Path,
        result: Path,
        output: Path,
    ) -> subprocess.CompletedProcess[str]:
        return self.cli(
            "finish",
            "--baseline",
            str(baseline),
            "--scope-report",
            str(scope),
            "--result",
            str(result),
            "--output",
            str(output),
        )

    def test_readonly_scenario_leaves_repository_unchanged(self) -> None:
        baseline = self.evidence / "readonly-start.json"
        scope = self.evidence / "readonly-scope.json"
        result = self.evidence / "readonly-result.json"
        delivery = self.evidence / "readonly-delivery.json"
        before = self.git("status", "--porcelain=v1", "-z").stdout

        self.assertEqual(self.start_readonly(baseline).returncode, 0)
        self.assertEqual(self.scope(baseline, scope).returncode, 0)
        after = self.git("status", "--porcelain=v1", "-z").stdout
        self.assertEqual(before, after)

        self.write_result(
            result,
            {
                "outcome": "complete",
                "summary": ["Inspected the repository without changing files"],
                "evidence": [
                    {
                        "stage": "analyzed",
                        "status": "passed",
                        "detail": "Scope report confirms no changes since baseline",
                    }
                ],
                "usage_steps": [],
                "remaining": ["No deployment or external operation was performed"],
                "rollback": [],
            },
        )
        self.assertEqual(self.finish(baseline, scope, result, delivery).returncode, 0)
        record = self.read_json(delivery)
        self.assertEqual(record["state_summary"]["files-changed"], ["not-claimed"])
        self.assertEqual(record["state_summary"]["deployed"], ["not-claimed"])

    def test_readme_change_preserves_preexisting_dirty_file(self) -> None:
        user_file = self.repo / "user.txt"
        user_file.write_text("committed\nuser work\n", encoding="utf-8")
        original_hash = hashlib.sha256(user_file.read_bytes()).hexdigest()
        baseline = self.evidence / "change-start.json"
        scope = self.evidence / "change-scope.json"
        result = self.evidence / "change-result.json"
        delivery = self.evidence / "change-delivery.json"

        self.assertEqual(self.start_readme_change(baseline).returncode, 0)
        (self.repo / "README.md").write_text("updated\n", encoding="utf-8")
        self.assertEqual(self.scope(baseline, scope).returncode, 0)
        report = self.read_json(scope)
        self.assertEqual(
            [item["path"] for item in report["categories"]["new_in_scope"]],
            ["README.md"],
        )
        self.assertEqual(hashlib.sha256(user_file.read_bytes()).hexdigest(), original_hash)

        self.write_result(
            result,
            {
                "outcome": "complete",
                "summary": ["Updated README.md only"],
                "evidence": [
                    {
                        "stage": "files-changed",
                        "status": "passed",
                        "detail": "Scope report lists only README.md as a new change",
                    }
                ],
                "usage_steps": ["Read the updated README.md"],
                "remaining": ["Not deployed and not released"],
                "rollback": [],
            },
        )
        self.assertEqual(self.finish(baseline, scope, result, delivery).returncode, 0)
        record = self.read_json(delivery)
        self.assertEqual(record["state_summary"]["files-changed"], ["passed"])
        self.assertEqual(record["state_summary"]["released"], ["not-claimed"])

    def test_readonly_change_fails_scope_check(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        self.assertEqual(self.start_readonly(baseline).returncode, 0)
        (self.repo / "README.md").write_text("changed\n", encoding="utf-8")
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        report = self.read_json(scope)
        self.assertIn("new-change-outside-allowed-scope", report["violations"])

    def test_out_of_scope_change_fails(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        self.assertEqual(self.start_readme_change(baseline).returncode, 0)
        (self.repo / "user.txt").write_text("unexpected\n", encoding="utf-8")
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        self.assertIn(
            "new-change-outside-allowed-scope",
            self.read_json(scope)["violations"],
        )

    def test_denied_path_overrides_allow_all(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        started = self.cli(
            "start",
            "--project",
            str(self.repo),
            "--goal",
            "Change allowed files except secret.txt",
            "--task-type",
            "fix",
            "--route",
            "simple",
            "--allow",
            ".",
            "--deny",
            "secret.txt",
            "--success",
            "Denied file is unchanged",
            "--output",
            str(baseline),
        )
        self.assertEqual(started.returncode, 0)
        (self.repo / "secret.txt").write_text("changed\n", encoding="utf-8")
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        report = self.read_json(scope)
        self.assertIn("denied-path-changed", report["violations"])
        self.assertEqual(report["categories"]["new_denied"][0]["path"], "secret.txt")

    def test_preexisting_dirty_file_changed_again_fails(self) -> None:
        user_file = self.repo / "user.txt"
        user_file.write_text("user work\n", encoding="utf-8")
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        self.assertEqual(self.start_readme_change(baseline).returncode, 0)
        user_file.write_text("user work\nagent overwrite\n", encoding="utf-8")
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        report = self.read_json(scope)
        self.assertIn("preexisting-user-change-modified", report["violations"])
        self.assertEqual(
            report["categories"]["preexisting_changed"][0]["path"], "user.txt"
        )

    def test_head_change_since_baseline_fails(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        self.assertEqual(self.start_readme_change(baseline).returncode, 0)
        (self.repo / "README.md").write_text("committed update\n", encoding="utf-8")
        self.git("add", "README.md")
        self.git("commit", "-q", "-m", "unexpected commit")
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        self.assertIn(
            "head-changed-since-baseline", self.read_json(scope)["violations"]
        )

    def test_finish_rejects_incomplete_external_evidence(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        result = self.evidence / "result.json"
        delivery = self.evidence / "delivery.json"
        self.assertEqual(self.start_readonly(baseline).returncode, 0)
        self.assertEqual(self.scope(baseline, scope).returncode, 0)
        self.write_result(
            result,
            {
                "outcome": "complete",
                "summary": ["Claimed a release"],
                "evidence": [
                    {
                        "stage": "released",
                        "status": "passed",
                        "detail": "Missing platform identity and timestamp",
                    }
                ],
                "usage_steps": [],
                "remaining": [],
                "rollback": [],
            },
        )
        finished = self.finish(baseline, scope, result, delivery)
        self.assertEqual(finished.returncode, 1)
        self.assertFalse(delivery.exists())

    def test_readonly_can_record_observed_external_state_with_evidence(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        result = self.evidence / "result.json"
        delivery = self.evidence / "delivery.json"
        self.assertEqual(self.start_readonly(baseline).returncode, 0)
        self.assertEqual(self.scope(baseline, scope).returncode, 0)
        self.write_result(
            result,
            {
                "outcome": "complete",
                "summary": ["Observed the current release state without changing it"],
                "evidence": [
                    {
                        "stage": "released",
                        "status": "passed",
                        "detail": "Read the current platform release record",
                        "source": "Read-only platform status page",
                        "checked_at": "2026-08-07T12:00:00+08:00",
                        "identity": "release-v1",
                    }
                ],
                "usage_steps": [],
                "remaining": ["No upload or release action was performed"],
                "rollback": [],
            },
        )
        self.assertEqual(self.finish(baseline, scope, result, delivery).returncode, 0)
        self.assertEqual(
            self.read_json(delivery)["state_summary"]["released"], ["passed"]
        )

    def test_finish_rejects_malformed_result(self) -> None:
        baseline = self.evidence / "start.json"
        scope = self.evidence / "scope.json"
        result = self.evidence / "result.json"
        delivery = self.evidence / "delivery.json"
        self.assertEqual(self.start_readonly(baseline).returncode, 0)
        self.assertEqual(self.scope(baseline, scope).returncode, 0)
        self.write_result(result, {"outcome": "complete", "summary": []})
        self.assertEqual(self.finish(baseline, scope, result, delivery).returncode, 1)
        self.assertFalse(delivery.exists())

    def test_output_inside_repository_is_rejected(self) -> None:
        output = self.repo / "start.json"
        started = self.start_readonly(output)
        self.assertEqual(started.returncode, 1)
        self.assertFalse(output.exists())

    def test_empty_or_absolute_scope_is_rejected(self) -> None:
        for index, invalid_scope in enumerate(("", "C:\\outside")):
            with self.subTest(scope=invalid_scope):
                baseline = self.evidence / f"invalid-scope-{index}.json"
                started = self.cli(
                    "start",
                    "--project",
                    str(self.repo),
                    "--goal",
                    "Reject invalid scope",
                    "--task-type",
                    "fix",
                    "--route",
                    "simple",
                    "--allow",
                    invalid_scope,
                    "--success",
                    "Invalid scope is rejected",
                    "--output",
                    str(baseline),
                )
                self.assertEqual(started.returncode, 1)
                self.assertFalse(baseline.exists())

    def test_non_git_project_is_marked_limited_and_cannot_pass_scope(self) -> None:
        project = self.root / "non-git"
        project.mkdir()
        baseline = self.evidence / "non-git-start.json"
        scope = self.evidence / "non-git-scope.json"
        started = self.cli(
            "start",
            "--project",
            str(project),
            "--goal",
            "Inspect a non-Git project",
            "--task-type",
            "readonly",
            "--route",
            "readonly",
            "--success",
            "Limitations are explicit",
            "--output",
            str(baseline),
        )
        self.assertEqual(started.returncode, 0)
        self.assertEqual(
            self.read_json(baseline)["repository"]["guard_level"], "limited"
        )
        self.assertEqual(self.scope(baseline, scope).returncode, 1)
        self.assertIn("git-guard-unavailable", self.read_json(scope)["violations"])

    def test_unwritable_output_shape_returns_error(self) -> None:
        output_directory = self.evidence / "already-a-directory"
        output_directory.mkdir()
        started = self.start_readonly(output_directory)
        self.assertEqual(started.returncode, 1)
        self.assertTrue(output_directory.is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
