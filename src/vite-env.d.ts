/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_COMMIT_SHA__: string;

declare module "*.po" {
  export const messages: Record<string, string>;
}
