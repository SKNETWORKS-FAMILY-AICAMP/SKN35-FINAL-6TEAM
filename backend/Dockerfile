# BUILDWISE 백엔드 개발용 이미지
# 소스 코드는 compose.yaml 에서 폴더째 연결(bind mount)합니다. 이미지에는 Python 과 의존성만 들어갑니다.
FROM python:3.14.10-slim-trixie

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /workspace/backend

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen

EXPOSE 8000
CMD ["sh", "/workspace/backend/docker/start.sh"]
