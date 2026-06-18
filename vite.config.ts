import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The Svelte SPA lives in web/ and builds to dist/, which the Worker serves as static assets.
export default defineConfig({
  root: "web",
  plugins: [svelte(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  // `dev:web` (Vite HMR) proxies API routes to a running `wrangler dev`.
  server: {
    proxy: {
      "/file-upload": "http://localhost:8787",
      "/openapi.json": "http://localhost:8787",
      "/docs": "http://localhost:8787",
    },
  },
});
