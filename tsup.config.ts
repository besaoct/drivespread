import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/cli/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: true,
  shims: true,
});
