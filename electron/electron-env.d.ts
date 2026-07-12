declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: "true";
    DIST_ELECTRON: string;
    DIST: string;
    /** /dist/ or /public/ */
    PUBLIC: string;
  }
}

declare module "ass-parser" {
  const parse: (input: string) => unknown;
  export default parse;
}

declare module "ass-stringify" {
  const stringify: (sections: readonly unknown[]) => string;
  export default stringify;
}
