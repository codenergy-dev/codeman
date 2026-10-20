import { readFileSync } from "node:fs";
import type { FakeModule } from "./http.ts";

/**
 * Starts one fake by name, as a service of the e2e suite's Compose file runs it:
 * `node e2e/fakes/main.ts <name>`, or the name in `FAKE`. The environment sets the rest:
 *
 * - `PORT`, 8080 by default (0 picks a free one), and `HOST`, `0.0.0.0` by default;
 * - `FAKE_TLS_KEY` and `FAKE_TLS_CERT`, PEM files, to serve HTTPS;
 * - `FAKE_CONTROL_TOKEN`, which the control API under `/_fake/` then requires;
 * - each fake's own variables, which its `fromEnv` reads.
 */

/** The fakes by name: one line each, which loads the fake's module only when it runs. */
const FAKES: Record<string, () => Promise<FakeModule>> = {
  google: () => import("./google/google.ts"),
  npm: () => import("./npm/npm.ts"),
};

const env = process.env;
const name = process.argv[2] ?? env.FAKE ?? "";
const load = FAKES[name];
if (!load) {
  throw new Error(`No fake "${name}"; the fakes are ${Object.keys(FAKES).join(", ")}.`);
}
const port = Number(env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`PORT must be a port number, not "${env.PORT}".`);
}
if (!env.FAKE_TLS_KEY !== !env.FAKE_TLS_CERT) {
  throw new Error("FAKE_TLS_KEY and FAKE_TLS_CERT go together.");
}
const fake = await (await load()).fromEnv(env);
const origin = await fake.listen({
  host: env.HOST ?? "0.0.0.0",
  port,
  tls:
    env.FAKE_TLS_KEY && env.FAKE_TLS_CERT
      ? { key: readFileSync(env.FAKE_TLS_KEY), cert: readFileSync(env.FAKE_TLS_CERT) }
      : undefined,
  controlToken: env.FAKE_CONTROL_TOKEN || undefined,
});
console.log(`The ${name} fake listens on ${origin}.`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    fake.close().then(() => process.exit(0));
  });
}
