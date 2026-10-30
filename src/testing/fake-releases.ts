import type { BootstrapArtifacts } from "../gateway/bootstrap.ts";

/** The commit a test's gateway is from. */
export const TEST_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** What a test's pod downloads: Node.js, and the gateway at `TEST_COMMIT`. */
export const TEST_BOOTSTRAP: BootstrapArtifacts = {
  node: {
    url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz",
    sha256: "b".repeat(64),
  },
  gateway: {
    url: `https://raw.githubusercontent.com/codenergy-dev/codeman/${TEST_COMMIT}/dist/gateway.js`,
    sha256: "a".repeat(64),
  },
};
