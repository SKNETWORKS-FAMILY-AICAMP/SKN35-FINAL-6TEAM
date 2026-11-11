import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Docker 안에서는 compose.yaml 이 백엔드 주소를 http://backend:8000 으로 넣어 줍니다.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";
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
