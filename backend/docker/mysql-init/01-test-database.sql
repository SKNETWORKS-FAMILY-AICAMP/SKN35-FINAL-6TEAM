-- 테스트 전용 DB. 개발 DB(buildwise)와 분리해 테스트가 개발 데이터를 지우지 않게 합니다.
-- MySQL 컨테이너를 처음 만들 때 한 번만 실행됩니다(볼륨을 지우면 다시 실행).
CREATE DATABASE IF NOT EXISTS buildwise_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON buildwise_test.* TO 'buildwise'@'%';
FLUSH PRIVILEGES;
