import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function publicOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new Error("VITE_PUBLIC_SITE_URL must be an HTTPS origin without a path, query, or hash");
  return url.origin;
}

function validateContactUrl(value: string | undefined): void {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "mailto:") throw new Error("VITE_CONTACT_URL must use https: or mailto:");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteOrigin = publicOrigin(env.VITE_PUBLIC_SITE_URL);
  validateContactUrl(env.VITE_CONTACT_URL);
  return {
    plugins: [
      react(),
      {
        name: "public-site-metadata",
        transformIndexHtml(html) {
          if (!siteOrigin) return html;
          return html
            .replace('content="/" data-public-url', `content="${siteOrigin}/" data-public-url`)
            .replace('content="/share-card.png"', `content="${siteOrigin}/share-card.png"`)
            .replace('href="/" data-public-url', `href="${siteOrigin}/" data-public-url`);
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    build: {
      target: "es2020",
    },
  };
});
