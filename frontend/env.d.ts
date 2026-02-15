/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_AUTH_ENABLED: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
