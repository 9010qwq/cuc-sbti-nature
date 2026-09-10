import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: "./",
  build: mode === "web" ? {
    outDir: "dist-web",
    target: "es2020",
    assetsInlineLimit: 0,
    cssCodeSplit: false,
  } : {
    target: "es2020",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    lib: {
      entry: "src/main.ts",
      name: "CUCSBTI",
      formats: ["iife"],
      fileName: () => "app.js",
    },
  },
}));
