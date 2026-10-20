import { readFileSync } from "node:fs";
import { build } from "esbuild";

// `--e2e` (`npm run build:e2e`) writes the e2e suite's bundles, which redirect services to its
// fakes (src/e2e.ts), to e2e/.build/. The published dist/ is built without them.
const e2e = process.argv.includes("--e2e");
const out = e2e ? "e2e/.build" : "dist";

const options = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Some bundled dependencies are CommonJS and call require() for Node built-ins.
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  define: { __CODEMAN_E2E__: String(e2e) },
  logLevel: "info",
} as const;

await build({ ...options, entryPoints: ["src/index.ts"], outfile: `${out}/index.js` });
// The gateway, for Codeman's pod image (docker/pod/Dockerfile). It uses Node's modules only.
await build({ ...options, entryPoints: ["src/gateway/main.ts"], outfile: `${out}/gateway.js` });

// The redirects read this variable: dist/ must not name it, and the e2e bundle must.
const variable = "CODEMAN_E2E";
const names = (file: string) => readFileSync(`${out}/${file}`, "utf8").includes(variable);
if (!e2e && (names("index.js") || names("gateway.js"))) {
  throw new Error(`dist/ holds the e2e build's redirects: it names ${variable}.`);
}
if (e2e && !names("index.js")) {
  throw new Error(
    `e2e/.build/index.js lacks the e2e build's redirects: it never names ${variable}.`,
  );
}
