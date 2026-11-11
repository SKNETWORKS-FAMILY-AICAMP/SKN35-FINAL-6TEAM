"""도메인 오류. API 계층(app/main.py)이 HTTP 상태 코드로 바꿉니다."""


class NotFoundError(LookupError):
    """→ 404. 다른 기업의 데이터를 요청한 경우도 '없음'으로 답합니다."""


class ConflictError(Exception):
    """→ 409. 현재 상태와 맞지 않는 요청(예: 오래된 견적으로 주문)."""


class InvalidInputError(ValueError):
    """→ 422. 형식은 맞지만 값이 허용되지 않는 요청."""
