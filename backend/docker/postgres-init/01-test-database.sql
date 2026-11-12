-- 테스트 전용 DB. 개발 DB(buildwise)와 분리해 테스트가 개발 데이터를 지우지 않게 합니다.
-- PostgreSQL 컨테이너가 빈 데이터 폴더로 처음 켜질 때 한 번만 실행됩니다(볼륨을 지우면 다시 실행).
-- pgvector 확장(vector)은 Alembic 첫 마이그레이션이 각 DB 에 켭니다.
CREATE DATABASE buildwise_test OWNER buildwise;
