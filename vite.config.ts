import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// base './' يخلّي التطبيق يشتغل على GitHub Pages داخل أي مسار
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 3000 },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
})
