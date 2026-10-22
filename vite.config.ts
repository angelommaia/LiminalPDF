import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    // O Rust gera milhares de arquivos em src-tauri/target, e no Windows alguns
    // ficam travados durante a compilação: vigiar essa pasta derruba o Vite.
    watch: {
      ignored: ["**/src-tauri/**", "**/release/**", "**/docs/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // pdf-lib só é carregado pela janela de montagem
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: "index.html",
        merge: "merge.html",
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist") && !id.includes("worker")) return "pdfjs";
          if (id.includes("node_modules/@cantoo/pdf-lib")) return "pdf-lib";
          return undefined;
        },
      },
    },
  },
});
