import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

/**
 * Externals resolved from the web shell's frozen module table. Restated here
 * (instead of importing `packages/client/web/src/platform.ts`) so this plugin
 * builds both as a harness workspace member and from the independent checkout.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Browser client bundle: closure-factory artifact handed to window.__ModuleLoader__. */
const client: UserConfig = {
  name: 'dsh-swarm-panel/client',
  entry: { client: 'src/client/index.ts' },
  // Lands next to the node half (single lib/ artifact dir). clean stays off:
  // a default clean would wipe the node-half output emitted above.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // Anything NOT in the loader module table inlines (type-only @deepseek-ai
  // imports are erased before bundling, so only `react` stays external here).
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "dsh-swarm-panel", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([
  {
    /** Bundle the plugin root as a single Node ESM entry with `.js` extensions. */
    entry: 'src/index.ts',
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    splitting: false,
    clean: true,
  },
  client,
])
