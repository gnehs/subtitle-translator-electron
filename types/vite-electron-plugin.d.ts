declare module "vite-electron-plugin" {
  import type { Plugin } from "vite";

  interface ElectronBuildPlugin {
    name?: string;
    [key: string]: unknown;
  }

  interface ElectronPluginConfiguration {
    include?: string[];
    transformOptions?: {
      sourcemap?: boolean;
    };
    plugins?: ElectronBuildPlugin[];
  }

  export default function electron(
    configuration: ElectronPluginConfiguration
  ): Plugin[];
}

declare module "vite-electron-plugin/plugin" {
  interface ElectronBuildPlugin {
    name?: string;
    [key: string]: unknown;
  }

  export function customStart(callback: () => void): ElectronBuildPlugin;
  export function loadViteEnv(): ElectronBuildPlugin;
}
