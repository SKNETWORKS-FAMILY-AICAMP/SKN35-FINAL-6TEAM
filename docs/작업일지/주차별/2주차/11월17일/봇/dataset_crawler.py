#!/usr/bin/env python3
"""승인된 공개 데이터셋을 출처별로 탐색하고 수집하는 보수적 수집 도구.

기본 동작은 탐색/계획만 합니다. 실제 다운로드에는 --execute와
출처·라이선스 승인 정보가 모두 필요합니다.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

USER_AGENT = "BUILDWISE-DatasetCollector/0.1 (research; contact: project owner)"
MAX_RESPONSE_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_FILE_BYTES = 250 * 1024 * 1024
SAFE_EXTENSIONS = {".csv", ".tsv", ".json", ".jsonl", ".parquet", ".md", ".txt", ".pdf", ".html", ".htm", ".zip", ".gz", ".yaml", ".yml"}
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


class CollectorError(Exception):
    """사용자가 조치할 수 있는 수집 오류."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned[:120] or "source"


def is_public_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True


def request_bytes(url: str, *, allowed_hosts: set[str], max_bytes: int) -> tuple[bytes, dict[str, str], str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as exc:
        wait = exc.headers.get("Retry-After", "")
        raise CollectorError(f"HTTP {exc.code} ({exc.reason}); Retry-After={wait or '없음'}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise CollectorError(f"연결 실패: {exc}") from exc

    with response:
        final_url = response.geturl()
        host = (urllib.parse.urlparse(final_url).hostname or "").lower()
        if host not in allowed_hosts or not is_public_host(host):
            raise CollectorError(f"허용하지 않은 리디렉션 호스트: {host or '알 수 없음'}")
        length = response.headers.get("Content-Length")
        if length and int(length) > max_bytes:
            raise CollectorError(f"파일 크기 {length}바이트가 허용 한도 {max_bytes}바이트를 초과")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(min(1024 * 1024, max_bytes + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise CollectorError(f"응답이 허용 한도 {max_bytes}바이트를 초과")
            chunks.append(chunk)
        headers = {k.lower(): v for k, v in response.headers.items()}
        return b"".join(chunks), headers, final_url


def request_json(url: str, host: str) -> Any:
    raw, _, _ = request_bytes(url, allowed_hosts={host}, max_bytes=MAX_RESPONSE_BYTES)
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"JSON 응답을 읽을 수 없음: {url}") from exc


def download_to(url: str, *, allowed_hosts: set[str], max_bytes: int, destination: Path) -> tuple[int, dict[str, str], str]:
    """응답 전체를 메모리에 올리지 않고 한도 내에서 임시 파일로 스트리밍."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as exc:
        wait = exc.headers.get("Retry-After", "")
        raise CollectorError(f"HTTP {exc.code} ({exc.reason}); Retry-After={wait or '없음'}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise CollectorError(f"연결 실패: {exc}") from exc
    with response:
        final_url = response.geturl()
        host = (urllib.parse.urlparse(final_url).hostname or "").lower()
        if host not in allowed_hosts or not is_public_host(host):
            raise CollectorError(f"허용하지 않은 리디렉션 호스트: {host or '알 수 없음'}")
        length = response.headers.get("Content-Length")
        if length and int(length) > max_bytes:
            raise CollectorError(f"파일 크기 {length}바이트가 허용 한도 {max_bytes}바이트를 초과")
        destination.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        try:
            with destination.open("wb") as f:
                while True:
                    chunk = response.read(min(1024 * 1024, max_bytes + 1 - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise CollectorError(f"응답이 허용 한도 {max_bytes}바이트를 초과")
                    f.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return total, {k.lower(): v for k, v in response.headers.items()}, final_url


def discover_huggingface(query: str, limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"search": query, "limit": limit, "sort": "downloads", "direction": -1})
    url = f"https://huggingface.co/api/datasets?{params}"
    results = request_json(url, "huggingface.co")
    rows = []
    for item in results if isinstance(results, list) else []:
        repo_id = item.get("id") or item.get("modelId")
        if not repo_id:
            continue
        tags = item.get("tags") or []
        license_tag = next((tag.split(":", 1)[1] for tag in tags if tag.startswith("license:")), "")
        rows.append({
            "platform": "huggingface",
            "source_id": repo_id,
            "title": repo_id,
            "url": f"https://huggingface.co/datasets/{repo_id}",
            "description": "",
            "license": license_tag,
            "updated_at": item.get("lastModified", ""),
            "downloads": item.get("downloads", ""),
            "review_status": "미검토",
        })
    return rows


def discover_github(query: str, limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"q": query, "per_page": min(limit, 100), "sort": "updated"})
    url = f"https://api.github.com/search/repositories?{params}"
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            payload = json.loads(response.read(MAX_RESPONSE_BYTES + 1).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        wait = exc.headers.get("Retry-After", "")
        raise CollectorError(f"GitHub API HTTP {exc.code}; Retry-After={wait or '없음'}") from exc
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"GitHub API 요청 실패: {exc}") from exc
    rows = []
    for item in payload.get("items", []):
        rows.append({
            "platform": "github",
            "source_id": item.get("full_name", ""),
            "title": item.get("name", ""),
            "url": item.get("html_url", ""),
            "description": item.get("description") or "",
            "license": (item.get("license") or {}).get("spdx_id", ""),
            "updated_at": item.get("pushed_at", ""),
            "downloads": "",
            "review_status": "미검토",
        })
    return rows


def discover_kaggle(query: str, limit: int) -> list[dict[str, Any]]:
    executable = shutil.which("kaggle")
    if not executable:
        raise CollectorError("Kaggle 탐색은 공식 kaggle CLI 설치와 사용자 인증이 필요함")
    command = [executable, "datasets", "list", "--search", query, "--csv"]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CollectorError(f"Kaggle CLI 실행 실패: {exc}") from exc
    if result.returncode != 0:
        # CLI stderr에는 인증 관련 정보가 섞일 수 있으므로 그대로 저장/출력하지 않음.
        raise CollectorError("Kaggle CLI가 검색에 실패함. 인증 상태와 CLI 버전을 확인")
    rows = []
    for item in csv.DictReader(result.stdout.splitlines()):
        handle = item.get("ref") or item.get("datasetRef") or item.get("dataset") or ""
        if not handle:
            continue
        rows.append({
            "platform": "kaggle",
            "source_id": handle,
            "title": item.get("title", "") or handle,
            "url": f"https://www.kaggle.com/datasets/{handle}",
            "description": item.get("description", "") or "",
            "license": item.get("licenseName", "") or item.get("license", ""),
            "updated_at": item.get("lastUpdated", "") or "",
            "downloads": item.get("downloadCount", "") or "",
            "review_status": "미검토",
        })
        if len(rows) >= limit:
            break
    return rows


DISCOVERERS = {
    "huggingface": discover_huggingface,
    "github": discover_github,
    "kaggle": discover_kaggle,
}


def discover(args: argparse.Namespace) -> int:
    topics = read_json(args.topics)
    platforms = args.platforms or list(DISCOVERERS)
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    errors: list[dict[str, str]] = []
    for topic in topics.get("topics", []):
        category = topic["category"]
        for query in topic.get("queries", []):
            for platform in platforms:
                try:
                    found = DISCOVERERS[platform](query, args.limit)
                    for row in found:
                        key = (platform, row["source_id"])
                        if key in seen:
                            continue
                        seen.add(key)
                        row["category"] = category
                        row["query"] = query
                        rows.append(row)
                except CollectorError as exc:
                    errors.append({"category": category, "platform": platform, "query": query, "error": str(exc)})
                time.sleep(args.delay)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    columns = ["category", "platform", "source_id", "title", "url", "license", "updated_at", "downloads", "review_status", "query", "description"]
    with args.output.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    error_path = args.output.with_name(args.output.stem + "_errors.json")
    write_json(error_path, {"checked_at": now_iso(), "errors": errors})
    print(f"후보 {len(rows)}건 저장: {args.output}")
    print(f"오류/건너뜀 {len(errors)}건 기록: {error_path}")
    print("탐색 결과는 후보 목록일 뿐이며, 라이선스와 데이터 품질 검토 전에는 수집하지 않습니다.")
    return 0


def validate_approval(source: dict[str, Any]) -> None:
    approval = source.get("approval") or {}
    license_info = source.get("license_review") or {}
    if approval.get("status") != "approved" or not approval.get("reviewed_on"):
        raise CollectorError("출처 승인 상태/검토일이 없어 수집 불가")
    if license_info.get("status") != "approved" or not license_info.get("id") or not license_info.get("reviewed_on"):
        raise CollectorError("라이선스 사용 조건 승인 정보가 없어 수집 불가")
    if not source.get("source_id") or not source.get("category"):
        raise CollectorError("source_id/category 필수")
    if source.get("platform") == "direct" and not source.get("snapshot"):
        raise CollectorError("직접 문서는 덮어쓰기 방지를 위해 snapshot(문서 버전 또는 확인일)이 필요함")


def validate_relative_file(value: str) -> str:
    if "\\" in value:
        raise CollectorError(f"파일 경로에는 POSIX 구분자(/)만 허용: {value}")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise CollectorError(f"안전하지 않은 파일 경로: {value}")
    if Path(path.name).suffix.lower() not in SAFE_EXTENSIONS:
        raise CollectorError(f"허용되지 않은 파일 확장자: {value}")
    return path.as_posix()


def host_set(values: list[str]) -> set[str]:
    return {v.lower().strip() for v in values if v.strip()}


def robots_allowed(url: str, delay: float) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    robots_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "/robots.txt", "", "", ""))
    try:
        raw, _, _ = request_bytes(robots_url, allowed_hosts={parsed.hostname.lower()}, max_bytes=1024 * 1024)
        from urllib.robotparser import RobotFileParser

        parser = RobotFileParser()
        parser.parse(raw.decode("utf-8", errors="replace").splitlines())
        time.sleep(max(0.0, delay))
        return parser.can_fetch(USER_AGENT, url)
    except CollectorError:
        # 정책 파일을 확인할 수 없으면 직접 페이지 수집을 보류.
        return False


def get_file_url(source: dict[str, Any], relative_path: str) -> tuple[str, set[str]]:
    platform = source["platform"]
    locator = source["locator"]
    revision = source.get("revision", "")
    if platform == "huggingface":
        if not COMMIT_RE.fullmatch(revision):
            raise CollectorError("Hugging Face revision은 고정된 40자리 커밋 SHA여야 함")
        repo = locator.get("repo_id", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise CollectorError("Hugging Face repo_id 형식은 owner/dataset이어야 함")
        quoted = urllib.parse.quote(relative_path, safe="/")
        return f"https://huggingface.co/datasets/{repo}/resolve/{revision}/{quoted}", {"huggingface.co", "cdn-lfs.huggingface.co", "cas-bridge.xethub.hf.co"}
    if platform == "github":
        if not COMMIT_RE.fullmatch(revision):
            raise CollectorError("GitHub revision은 브랜치가 아닌 고정된 40자리 커밋 SHA여야 함")
        repo = locator.get("repo", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise CollectorError("GitHub repo 형식은 owner/repo이어야 함")
        quoted = urllib.parse.quote(relative_path, safe="/")
        return f"https://raw.githubusercontent.com/{repo}/{revision}/{quoted}", {"raw.githubusercontent.com", "github.com"}
    if platform == "direct":
        files = source.get("files", [])
        item = next((f for f in files if f.get("path") == relative_path), None)
        if not item or not item.get("url"):
            raise CollectorError(f"직접 URL이 등록되지 않음: {relative_path}")
        allowed = host_set(source.get("allowed_hosts", []))
        parsed = urllib.parse.urlparse(item["url"])
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or host not in allowed or not is_public_host(host):
            raise CollectorError("직접 URL이 HTTPS/허용 호스트 목록과 일치하지 않음")
        if not robots_allowed(item["url"], float(source.get("delay_seconds", 2.0))):
            raise CollectorError("robots.txt에서 허용되지 않거나 정책을 확인할 수 없음")
        return item["url"], allowed
    raise CollectorError(f"다운로드 플랫폼 미지원: {platform}")


def kaggle_file_size(handle: str, file_name: str) -> int | None:
    executable = shutil.which("kaggle")
    if not executable:
        raise CollectorError("Kaggle 수집에는 kaggle CLI 설치와 사용자 인증이 필요함")
    result = subprocess.run([executable, "datasets", "files", handle, "--csv"], capture_output=True, text=True, timeout=90, check=False)
    if result.returncode != 0:
        raise CollectorError("Kaggle 파일 목록 조회 실패. 인증/데이터 접근 권한 확인 필요")
    for row in csv.DictReader(result.stdout.splitlines()):
        name = row.get("name") or row.get("fileName") or ""
        if name == file_name:
            raw_size = row.get("size") or row.get("totalBytes") or ""
            try:
                return int(raw_size)
            except ValueError:
                return None
    raise CollectorError(f"Kaggle 데이터셋에서 승인한 파일을 찾지 못함: {file_name}")


def kaggle_versioned_handle(locator: dict[str, Any]) -> str:
    handle = locator.get("handle", "").strip("/")
    version = locator.get("version")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", handle):
        raise CollectorError("Kaggle handle 형식은 owner/dataset-name이어야 함")
    if version is None:
        raise CollectorError("재현 가능한 Kaggle 수집을 위해 locator.version을 지정해야 함")
    if not str(version).isdigit():
        raise CollectorError("Kaggle locator.version은 숫자 버전이어야 함")
    return f"{handle}/{version}"


def download_kaggle(source: dict[str, Any], file_name: str, dest: Path, max_bytes: int) -> tuple[int, str]:
    handle = kaggle_versioned_handle(source["locator"])
    size = kaggle_file_size(handle, file_name)
    if size is None:
        raise CollectorError("Kaggle 원본 파일 크기를 확인할 수 없어 수집 보류")
    if size > max_bytes:
        raise CollectorError(f"Kaggle 파일이 허용 크기 초과: {size} > {max_bytes}")
    executable = shutil.which("kaggle")
    assert executable
    with tempfile.TemporaryDirectory(prefix="buildwise-kaggle-") as temp_name:
        temp = Path(temp_name)
        command = [executable, "datasets", "download", handle, "--file", file_name, "--path", str(temp), "--quiet"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
        if result.returncode != 0:
            raise CollectorError("Kaggle 파일 다운로드 실패. 인증/접근 조건을 확인")
        archives = list(temp.glob("*.zip"))
        if len(archives) != 1:
            raise CollectorError("Kaggle CLI 결과에서 단일 ZIP 파일을 확인하지 못함")
        archive = archives[0]
        if archive.stat().st_size > max_bytes:
            raise CollectorError("Kaggle 다운로드 ZIP이 설정된 크기 제한을 초과")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(archive, dest)
    return dest.stat().st_size, "application/zip"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_one(
    source: dict[str, Any],
    base_dir: Path,
    execute: bool,
    delay: float,
    known_hashes: dict[str, str],
) -> list[dict[str, Any]]:
    validate_approval(source)
    platform = source.get("platform", "")
    files = source.get("files") or []
    if not files:
        raise CollectorError("수집할 개별 파일 목록이 비어 있음")
    locator = source.get("locator") or {}
    snapshot = source.get("revision") or locator.get("version") or source.get("snapshot") or "unpinned"
    source_dir = base_dir / safe_name(f"{source['source_id']}_{str(snapshot)[:16]}")
    output = []
    for item in files:
        rel = validate_relative_file(item.get("path", ""))
        max_bytes = min(int(item.get("max_bytes", DEFAULT_MAX_FILE_BYTES)), DEFAULT_MAX_FILE_BYTES)
        output_name = safe_name(rel.replace("/", "__"))
        if platform == "kaggle":
            output_name = safe_name(Path(output_name).stem + ".zip")
        dest = source_dir / output_name
        if not execute:
            output.append({"source_id": source["source_id"], "file": rel, "status": "계획만 표시", "destination": str(dest)})
            continue
        if platform == "kaggle":
            size, content_type = download_kaggle(source, rel, dest, max_bytes)
            final_url = source.get("url", "")
        else:
            url, allowed = get_file_url(source, rel)
            temp_path = dest.with_suffix(dest.suffix + ".part")
            size, headers, final_url = download_to(url, allowed_hosts=allowed, max_bytes=max_bytes, destination=temp_path)
            temp_path.replace(dest)
            content_type = headers.get("content-type", "")
            time.sleep(max(delay, float(source.get("delay_seconds", delay))))
        digest = sha256_file(dest)
        if digest in known_hashes:
            duplicate_of = known_hashes[digest]
            dest.unlink(missing_ok=True)
            output.append({"source_id": source["source_id"], "file": rel, "status": "중복 건너뜀", "duplicate_of": duplicate_of, "sha256": digest})
            continue
        known_hashes[digest] = str(dest)
        sidecar = {
            "source_id": source["source_id"],
            "category": source["category"],
            "source_url": final_url,
            "platform": platform,
            "snapshot": snapshot,
            "relative_path": rel,
            "collected_at": now_iso(),
            "size_bytes": size,
            "sha256": digest,
            "content_type": content_type,
            "license": source["license_review"],
            "approval": source["approval"],
            "notes": source.get("notes", ""),
        }
        write_json(dest.with_suffix(dest.suffix + ".metadata.json"), sidecar)
        output.append({"source_id": source["source_id"], "file": rel, "status": "수집 완료", "destination": str(dest), "size_bytes": size, "sha256": digest})
    return output


def collect(args: argparse.Namespace) -> int:
    manifest = read_json(args.manifest)
    sources = manifest.get("sources", [])
    if not sources:
        raise CollectorError("manifest의 sources가 비어 있음")
    all_results: list[dict[str, Any]] = []
    known_hashes: dict[str, str] = {}
    if args.output_dir.exists():
        for sidecar_path in args.output_dir.rglob("*.metadata.json"):
            try:
                metadata = read_json(sidecar_path)
            except (OSError, json.JSONDecodeError):
                continue
            digest = metadata.get("sha256")
            if digest:
                known_hashes.setdefault(digest, str(sidecar_path.with_suffix("")))
    for source in sources:
        try:
            all_results.extend(collect_one(source, args.output_dir, args.execute, args.delay, known_hashes))
        except (CollectorError, KeyError, TypeError, ValueError) as exc:
            all_results.append({"source_id": source.get("source_id", "알 수 없음"), "status": "보류/실패", "error": str(exc)})
    log_path = args.output_dir / "collection_log.json"
    write_json(log_path, {"created_at": now_iso(), "executed": args.execute, "results": all_results})
    print(f"수집 계획/결과 {len(all_results)}건 기록: {log_path}")
    if not args.execute:
        print("계획만 출력했습니다. 실제 파일 저장에는 --execute가 필요하며 출처·라이선스 승인도 필수입니다.")
    return 1 if any(row.get("status") == "보류/실패" for row in all_results) else 0


def import_parts_command(args: argparse.Namespace) -> int:
    try:
        from import_pc_parts import ImportErrorDetail, run_import
        result = run_import(download=args.download)
    except (ImportError, ImportErrorDetail, OSError, ValueError) as exc:
        raise CollectorError(f"부품 데이터 변환 실패: {exc}") from exc
    print(f"parts 미리보기 {result['normalized_parts_count']:,}행 생성")
    return 0


def prepare_benchmarks_command(args: argparse.Namespace) -> int:
    try:
        from prepare_benchmarks import run
        manifest = run(args)
    except (OSError, ValueError, csv.Error) as exc:
        raise CollectorError(f"벤치마크 정규화 실패: {exc}") from exc
    print(f"전체 성능 측정 {manifest['output_rows']['benchmark_runs_all']:,}건 변환")
    print(f"참조 전용 GPU 모델 {manifest['reference_gpu_parts_added']:,}개 추가: {manifest['outputs']['parts_with_benchmark_references']}")
    print(f"부품 연결 확인 후 적재 후보 {manifest['output_rows']['benchmark_runs_load_ready']:,}건: {manifest['outputs']['benchmark_runs_load_ready']}")
    print(f"미매칭 하드웨어 {manifest['output_rows']['unmatched_hardware']:,}건: {manifest['outputs']['unmatched_hardware']}")
    print(f"결과: {args.output_dir}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="공개 성능 평가 데이터 후보 탐색 및 승인 기반 수집")
    sub = parser.add_subparsers(dest="command", required=True)
    discover_parser = sub.add_parser("discover", help="Hugging Face, GitHub, Kaggle에서 후보 메타데이터 탐색")
    discover_parser.add_argument("--topics", type=Path, default=Path(__file__).with_name("topics.json"))
    discover_parser.add_argument("--output", type=Path, default=Path("output/candidates.csv"))
    discover_parser.add_argument("--limit", type=int, default=10)
    discover_parser.add_argument("--delay", type=float, default=1.0)
    discover_parser.add_argument("--platforms", nargs="+", choices=sorted(DISCOVERERS))
    discover_parser.set_defaults(func=discover)

    collect_parser = sub.add_parser("collect", help="검토·승인한 manifest의 파일만 계획/수집")
    collect_parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("approved_sources.json"))
    collect_parser.add_argument("--output-dir", type=Path, default=Path("output/raw"))
    collect_parser.add_argument("--delay", type=float, default=2.0)
    collect_parser.add_argument("--execute", action="store_true", help="승인 검사를 통과한 경우 실제 다운로드")
    collect_parser.set_defaults(func=collect)

    parts_parser = sub.add_parser("import-parts", help="고정 커밋 PC 부품 CSV를 parts 미리보기로 변환")
    parts_parser.add_argument("--download", action="store_true", help="고정 커밋의 부품 CSV 8종을 내려받고 SHA를 확인")
    parts_parser.set_defaults(func=import_parts_command)

    benchmark_parser = sub.add_parser("prepare-benchmarks", help="기존 벤치마크 원자료를 ERD 미리보기로 변환")
    benchmark_parser.add_argument("--parts-file", type=Path, default=Path(__file__).with_name("output") / "normalized" / "pc-part-dataset_c52a04ca" / "parts_import_preview.csv")
    benchmark_parser.add_argument("--output-dir", type=Path, default=Path(__file__).with_name("output") / "normalized" / "benchmarks")
    benchmark_parser.add_argument("--sources", nargs="+", choices=["opengpu", "blender", "llmspeed"], default=["opengpu", "blender", "llmspeed"])
    benchmark_parser.add_argument("--limit", type=int, default=1000, help="출처별 최대 행 수; 0은 전체 처리")
    benchmark_parser.add_argument("--all", action="store_true", help="선택한 원자료의 전체 행 처리 (Blender 대용량)")
    benchmark_parser.set_defaults(func=prepare_benchmarks_command)

    args = parser.parse_args()
    try:
        if args.command == "discover" and args.limit < 1:
            raise CollectorError("--limit은 1 이상이어야 함")
        if args.command == "discover" and args.delay < 0:
            raise CollectorError("--delay는 0 이상이어야 함")
        if args.command == "collect" and args.delay < 0:
            raise CollectorError("--delay는 0 이상이어야 함")
        if args.command == "prepare-benchmarks" and args.limit < 0:
            raise CollectorError("--limit은 0 이상이어야 함")
        if args.command == "prepare-benchmarks" and args.limit == 0:
            args.all = True
        return args.func(args)
    except (CollectorError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
