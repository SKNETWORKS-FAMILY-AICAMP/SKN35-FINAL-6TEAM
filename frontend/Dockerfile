# BUILDWISE 프론트엔드 개발용 이미지
# 소스는 compose.yaml 에서 연결하고, node_modules 는 컨테이너 볼륨에 둡니다(Windows 용 파일과 섞이지 않게).
FROM node:24.22.2-trixie-slim

WORKDIR /workspace/frontend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && sha256sum package-lock.json | cut -d' ' -f1 > node_modules/.lock-hash

EXPOSE 5173
CMD ["sh", "/workspace/frontend/docker/start.sh"]
