import { build } from "esbuild";

const options = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Some bundled dependencies are CommonJS and call require() for Node built-ins.
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  logLevel: "info",
} as const;

await build({ ...options, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
// The gateway, for Codeman's pod image (docker/pod/Dockerfile). It uses Node's modules only.
await build({ ...options, entryPoints: ["src/gateway/main.ts"], outfile: "dist/gateway.js" });
