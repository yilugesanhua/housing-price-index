/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTACT_URL?: string;
  readonly VITE_APP_ENV?: "internal" | "public";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
