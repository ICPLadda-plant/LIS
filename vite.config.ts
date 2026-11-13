import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";

export default defineConfig(({ mode }) => ({
  base: "/LIS/",

  server: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/uploads": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/LIS/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/LIS/, ""),
      },
      "/LIS/uploads": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/LIS/, ""),
      },
    },
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        auth: path.resolve(__dirname, "auth.html"),
      },
      output: {
        // Split heavy vendor libs into their own cacheable chunks so they
        // are not duplicated across route chunks and only fetched when used.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-qr": ["html5-qrcode", "qrcode", "react-barcode"],
          "vendor-msal": ["@azure/msal-browser", "@azure/msal-react"],
        },
      },
    },
  },

  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
}));
