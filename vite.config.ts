import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve("client"),
  build: {
    outDir: path.resolve("dist/client"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4177",
    },
  },
});
