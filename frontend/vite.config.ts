import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  const previewAllowedHosts = (env.VITE_PREVIEW_ALLOWED_HOSTS || "newsradar.app")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      allowedHosts: previewAllowedHosts,
    },
  };
});
