import { defineConfig } from 'vitest/config'

/**
 * Plugin-local vitest config: include the key-gated e2e file (it self-skips
 * without DEEPSEEK_API_KEY) and keep this package off the harness coverage gate.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.e2e.ts'],
    exclude: ['tests/host/**'],
  },
})
