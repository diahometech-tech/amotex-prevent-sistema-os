import { defineConfig } from 'vitest/config';

// Testes das regras puras (sem servidor nem banco). Rodar: npm test
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
