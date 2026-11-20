import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 로컬과 Docker 모두 같은 출처의 /api 를 호스트에서 실행하는 상담 API로 전달합니다.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";
// Windows 에서 저장한 파일을 컨테이너가 알아채려면 폴링 감시가 필요합니다.
const usePolling = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
