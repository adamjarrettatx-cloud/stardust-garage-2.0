import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.vitest.js', 'tests/artist-pay/*.spec.js'],
    // This suite uses node:test; run it through test:admission.
    exclude: ['tests/api/member/identity-token.test.js'],
  },
});
