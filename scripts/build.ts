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
// The gateway, which a pod downloads alone and runs with Node's binary only (bootstrap.ts): one
// file that imports Node's own modules, nothing else.
await build({ ...options, entryPoints: ["src/gateway/main.ts"], outfile: `${out}/gateway.js` });
const imports = readFileSync(`${out}/gateway.js`, "utf8").matchAll(
  /\bfrom\s*"([^"]+)"|\b(?:import|require)\(\s*"([^"]+)"\s*\)/g,
);
const outside = [...imports]
  .map((match) => match[1] ?? match[2])
  .filter((name) => !name?.startsWith("node:"));
if (outside.length > 0) {
  throw new Error(
    `${out}/gateway.js imports more than Node's modules: ${[...new Set(outside)].join(", ")}.`,
  );
}

// The redirects read this variable: dist/ must not name it, and the e2e bundle must.
const variable = "CODEMAN_E2E";
const names = (file: string) => readFileSync(`${out}/${file}`, "utf8").includes(variable);
if (!e2e && (names("index.js") || names("gateway.js"))) {
  throw new Error(`dist/ holds the e2e build's redirects: it names ${variable}.`);
}
for (const file of e2e ? ["index.js", "gateway.js"] : []) {
  if (!names(file)) {
    throw new Error(
      `e2e/.build/${file} lacks the e2e build's redirects: it never names ${variable}.`,
    );
  }
}
