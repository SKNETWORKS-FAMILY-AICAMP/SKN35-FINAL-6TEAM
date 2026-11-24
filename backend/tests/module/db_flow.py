"""실제 DB 입출력 연결. 생성하는 테스트 행은 commit 없이 rollback합니다."""

import json
import os
from uuid import uuid4

import pytest
from app.db.catalog import list_parts
from app.db.connection import get_connection
from app.domains.hardware.check_assembly import check_catalog_assembly
from mysql.connector import Error as MySQLError

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_MYSQL_TESTS") != "1", reason="실제 DB 연결은 --with-db에서만 실행"
)


@pytest.fixture
def db(flow):
    flow.begin(
        "기존 DB 연결 설정",
        "app.db.connection.get_connection",
        inputs={"설정 출처": "기존 .env/환경변수 (실제 값 미기록)"},
        mode="실제 개발 DB 연결",
        exclusions="설정 변경·서버 시작·스키마 생성 안 함. 접속 실패는 ERROR이며 검사 통과가 아님",
    )
    try:
        connection = get_connection()
    except MySQLError as error:
        raise RuntimeError(
            f"실제 DB 연결 실패 (MySQL 오류 {error.errno}). 기존 연결 설정·DNS·네트워크를 확인하세요. "
            "테스트 입력/PK 조회에는 도달하지 못했습니다."
        ) from None
    try:
        flow.equal("autocommit 비활성", False, connection.autocommit)
        yield connection
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def test_user_input_to_database_returns_pk_and_same_data(db, flow):
    name = "__module_flow_" + uuid4().hex
    flow.begin(
        "가상 사용자 입력",
        "DB 드라이버·users INSERT",
        inputs={"display_name": name},
        mode="실제 개발 DB / 미커밋 INSERT",
        exclusions="사용자 등록 API·로그인·기업 권한 검사는 아님. 자체 생성 사용자만 조회",
    )
    with db.cursor(dictionary=True) as cursor:
        cursor.execute("INSERT INTO users (display_name) VALUES (%s)", (name,))
        user_id = cursor.lastrowid
        flow.equal("발급 PK 타입", "int", type(user_id).__name__)
        flow.equal("발급 PK 양수", True, isinstance(user_id, int) and user_id > 0)
        flow.begin(
            "발급 user_id",
            "DB users PK 조회",
            inputs={"user_id": user_id},
            mode="실제 SELECT / 동일 트랜잭션",
            exclusions="기존 사용자 전체 목록·개인정보 조회하지 않음",
        )
        cursor.execute("SELECT user_id,display_name FROM users WHERE user_id=%s", (user_id,))
        flow.equal(
            "동일 PK·입력 정보 반환", {"user_id": user_id, "display_name": name}, cursor.fetchone()
        )
        db.rollback()
        flow.begin(
            "테스트 트랜잭션 rollback",
            "DB 사용자 잔존 조회",
            inputs={"user_id": user_id},
            mode="실제 rollback 후 SELECT",
            exclusions="AUTO_INCREMENT 번호는 회수되지 않을 수 있음",
        )
        cursor.execute("SELECT user_id FROM users WHERE user_id=%s", (user_id,))
        flow.equal("롤백 뒤 테스트 사용자 없음", None, cursor.fetchone())


def test_user_pk_to_consultation_preserves_fk_and_requirements(db, flow):
    name = "__module_consult_" + uuid4().hex
    payload = {"budget_krw": 500000, "purpose": "module-fixture"}
    with db.cursor(dictionary=True) as cursor:
        cursor.execute("INSERT INTO users (display_name) VALUES (%s)", (name,))
        user_id = cursor.lastrowid
        flow.begin(
            "사용자 PK·상담 설정",
            "DB consultations INSERT",
            inputs={"user_id": user_id, "purpose": "module-fixture", "requirements": payload},
            mode="실제 DB FK/JSON 저장 / 미커밋 테스트 행",
            exclusions="상담 API·에이전트 실행·영구 저장을 검증한 것이 아님",
        )
        cursor.execute(
            "INSERT INTO consultations (user_id,purpose,requirements) VALUES (%s,%s,%s)",
            (user_id, "module-fixture", json.dumps(payload)),
        )
        consultation_id = cursor.lastrowid
        flow.equal("상담 PK 양수", True, isinstance(consultation_id, int) and consultation_id > 0)
        flow.begin(
            "consultation_id·user_id",
            "DB 상담·사용자 JOIN 조회",
            inputs={"consultation_id": consultation_id, "user_id": user_id},
            mode="실제 FK/JOIN 조회",
            exclusions="계정 인증·서버 소유권 권한 검사와 구분",
        )
        cursor.execute(
            "SELECT c.consultation_id,c.user_id,c.purpose,c.requirements,u.display_name "
            "FROM consultations c JOIN users u ON u.user_id=c.user_id "
            "WHERE c.consultation_id=%s AND c.user_id=%s",
            (consultation_id, user_id),
        )
        row = cursor.fetchone()
        flow.equal("조회 행 존재", True, row is not None)
        for key, value in {
            "user_id": user_id,
            "consultation_id": consultation_id,
            "display_name": name,
            "purpose": "module-fixture",
        }.items():
            flow.equal(key, value, row[key])
        actual = row["requirements"]
        flow.equal(
            "저장 설정 JSON",
            payload,
            json.loads(actual) if isinstance(actual, (str, bytes)) else actual,
        )
        db.rollback()
        flow.begin(
            "테스트 트랜잭션 rollback",
            "사용자·상담 PK 잔존 조회",
            inputs={"user_id": user_id, "consultation_id": consultation_id},
            mode="실제 rollback 후 SELECT",
            exclusions="AUTO_INCREMENT 번호 회수는 보장하지 않음",
        )
        for table, key, pk in [
            ("consultations", "consultation_id", consultation_id),
            ("users", "user_id", user_id),
        ]:
            # 식별자는 위 고정 목록뿐이며 입력값은 항상 바인딩합니다.
            cursor.execute(f"SELECT {key} FROM {table} WHERE {key}=%s", (pk,))
            flow.equal(f"롤백 후 {table} 테스트 행 없음", None, cursor.fetchone())


def test_part_pk_to_catalog_returns_database_fields(db, flow):
    with db.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT part_id,category,brand,name,current_price,currency "
            "FROM parts ORDER BY part_id LIMIT 1"
        )
        expected = cursor.fetchone()
    if expected is None:
        pytest.fail("실제 카탈로그가 비어 있습니다. 조회 연결을 검증할 수 없습니다.")
    part_id = expected["part_id"]
    flow.begin(
        "부품 PK 선택",
        "app.db.catalog.list_parts",
        inputs={"part_ids": [part_id], "category": expected["category"]},
        mode="실제 조회 모듈 + 실제 개발 DB / SELECT만 수행",
        exclusions="상품 조회 경로이며 판매 재고·가격의 최신성 보장·기업 권한은 별도",
    )
    rows = list_parts(db, part_ids=[part_id], category=expected["category"])
    flow.equal("해당 PK 반환 건수", 1, len(rows))
    for key, value in expected.items():
        flow.equal(key, value, rows[0][key])
    flow.equal("specs JSON 구조", "dict", type(rows[0]["specs"]).__name__)


def test_absent_part_pk_to_lookup_and_validator_returns_expected_error(db, flow):
    with db.cursor() as cursor:
        cursor.execute("SELECT COALESCE(MAX(part_id),0) FROM parts")
        absent_id = int(cursor.fetchone()[0]) + 1
    if absent_id > 2**64 - 1:
        pytest.fail("테스트용 부재 PK를 생성할 수 없습니다.")
    flow.begin(
        "DB 최대 PK 이후의 부재 ID",
        "app.db.catalog.list_parts",
        inputs={"part_ids": [absent_id]},
        mode="실제 조회 모듈 + 실제 DB / SELECT만 수행",
        exclusions="접속·타임아웃 오류는 기대 오류가 아님. 테스트 중 해당 ID 동시 삽입 금지",
    )
    rows = list_parts(db, part_ids=[absent_id])
    flow.equal("실제 DB에서 부재 확인", [], rows)
    flow.begin(
        "없는 상품 PK·수량",
        "check_catalog_assembly",
        inputs={"selection": {absent_id: 1}},
        mode="실제 검증 서비스 + 실제 DB",
        exclusions="없는 상품을 삽입하지 않으며 네트워크/권한 오류는 누락 ID 통과로 취급하지 않음",
    )
    with pytest.raises(ValueError, match="DB에 없는 부품 ID") as caught:
        check_catalog_assembly(db, selection={absent_id: 1})
    flow.equal("누락 ID 오류 원문", f"DB에 없는 부품 ID: [{absent_id}]", str(caught.value))
