import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include:['tests/**/*.test.ts'], environment:'node', pool:'threads', fileParallelism:false, testTimeout:20_000, hookTimeout:20_000 } });
