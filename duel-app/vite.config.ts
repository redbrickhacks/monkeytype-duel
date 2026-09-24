import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "client",
  publicDir: "public",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), "client/index.html"),
        admin: resolve(process.cwd(), "client/admin.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
