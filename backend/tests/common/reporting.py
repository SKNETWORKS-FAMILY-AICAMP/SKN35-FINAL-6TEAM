"""네 종류 테스트가 함께 사용하는 XML 리포트 이름 규약."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

TEST_TYPES = {"unit", "module", "system", "acceptance"}
KOREA_TIMEZONE = timezone(timedelta(hours=9), name="KST")


@dataclass(frozen=True)
class ReportIdentity:
    file_name: str
    suite_title: str
    junit_prefix: str


def get_repository_branch_name(repository_root: Path) -> str:
    dot_git = repository_root / ".git"
    if dot_git.is_dir():
        git_directory = dot_git
    elif dot_git.is_file():
        git_directory_line = dot_git.read_text(encoding="utf-8").strip()
        match = re.fullmatch(r"gitdir:\s*(.+)", git_directory_line)
        if not match:
            raise RuntimeError(f"지원하지 않는 .git 파일 형식입니다: {dot_git}")
        git_directory = Path(match.group(1))
        if not git_directory.is_absolute():
            git_directory = repository_root / git_directory
        git_directory = git_directory.resolve()
    else:
        raise RuntimeError(f"Git 메타데이터를 찾을 수 없습니다: {dot_git}")

    head_path = git_directory / "HEAD"
    head_value = head_path.read_text(encoding="utf-8").strip()
    match = re.fullmatch(r"ref:\s+refs/heads/(.+)", head_value)
    if not match:
        raise RuntimeError(
            f"현재 브랜치를 확인할 수 없습니다. detached HEAD 상태인지 확인하세요: {head_path}"
        )
    return match.group(1)


def new_report_identity(
    *,
    test_type: str,
    branch_name: str,
    requirement_id: str,
    subject: str,
    sequence: str,
) -> ReportIdentity:
    if test_type not in TEST_TYPES:
        raise ValueError(f"지원하지 않는 테스트 종류입니다: {test_type}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", branch_name):
        raise ValueError(f"파일명에 사용할 수 없는 브랜치명입니다: {branch_name}")
    if not re.fullmatch(r"[A-Z][A-Z0-9-]*", requirement_id):
        raise ValueError(f"요구사항 ID 형식이 올바르지 않습니다: {requirement_id}")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", subject):
        raise ValueError(f"검증 대상 형식이 올바르지 않습니다: {subject}")
    if not re.fullmatch(r"\d{3}", sequence):
        raise ValueError(f"일련번호는 세 자리 숫자여야 합니다: {sequence}")

    report_date = datetime.now(UTC).astimezone(KOREA_TIMEZONE).strftime("%y%m%d")
    branch_slug = re.sub(r"[/_\\]+", "-", branch_name)

    return ReportIdentity(
        file_name=(
            f"{report_date}_{branch_slug}_{test_type}_{requirement_id}_{subject}_{sequence}.xml"
        ),
        suite_title=(
            f"{branch_name.upper()} | {test_type.upper()} | "
            f"{requirement_id} | {subject.upper()} | {sequence}"
        ),
        junit_prefix=f"{branch_slug}.{test_type}.{requirement_id}.{subject}.{sequence}",
    )
