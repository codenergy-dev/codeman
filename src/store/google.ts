import type { Fetch } from "../budget.ts";

/** Google's Security Token Service. See docs/web/google-cloud/method-token.md. */
const STS = "https://sts.googleapis.com/v1/token";
/** See docs/web/google-cloud/method-projects-serviceaccounts-generateaccesstoken.md. */
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1";
/** What the federated token may do: impersonate the service account, which IAM checks. */
const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
/** What the service account's token may do: Firestore only. */
const DATASTORE = "https://www.googleapis.com/auth/datastore";
/** A token is renewed this long before it expires. */
const MARGIN_MS = 5 * 60_000;

/** Where the jobs' identity comes from and whom it becomes; variables, not secrets. */
export interface GoogleIdentity {
  /** `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. */
  provider: string;
  /** The service account's email, which may use Firestore. */
  serviceAccount: string;
}

/** Why a value cannot name a Workload Identity provider or a service account; undefined if it can. */
export function identityProblem(identity: GoogleIdentity): string | undefined {
  if (
    !/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(
      identity.provider,
    )
  ) {
    return `"${identity.provider}" is not a Workload Identity provider: it has the form projects/<project number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>.`;
  }
  if (!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(identity.serviceAccount)) {
    return `"${identity.serviceAccount}" is not a service account's email, such as codeman@<project>.iam.gserviceaccount.com.`;
  }
  return undefined;
}

export interface TokenOptions {
  /** GitHub's OIDC token for the job, for an audience. */
  idToken: (audience: string) => Promise<string>;
  /** Keeps each token out of the logs. */
  mask: (secret: string) => void;
  fetch?: Fetch;
  now?: () => number;
}

/**
 * Access tokens for Firestore, as the service account, with no key stored anywhere (decision 3
 * of the backend plan): the job's OIDC token from GitHub is exchanged at Google's STS for a
 * federated token, which the provider's attribute condition admits only for the organization's
 * repositories; with it, IAM Credentials gives a token of the service account. A token is kept
 * until shortly before it expires. Tokens are masked, and never logged.
 */
export function serviceAccountTokens(
  identity: GoogleIdentity,
  options: TokenOptions,
): () => Promise<string> {
  const problem = identityProblem(identity);
  if (problem) throw new Error(problem);
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let current: { token: string; expires: number } | undefined;
  let pending: Promise<string> | undefined;
  const renew = async (): Promise<string> => {
    // The provider's default audience: its full name, with https.
    const idToken = await options.idToken(`https://iam.googleapis.com/${identity.provider}`);
    const federated = (await post(fetchFn, STS, "Google's STS", {
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${identity.provider}`,
      scope: CLOUD_PLATFORM,
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken: idToken,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    })) as { access_token?: unknown };
    if (typeof federated.access_token !== "string") {
      throw new Error("Google's STS answered without a token.");
    }
    options.mask(federated.access_token);
    const account = (await post(
      fetchFn,
      `${IAM_CREDENTIALS}/projects/-/serviceAccounts/${encodeURIComponent(identity.serviceAccount)}:generateAccessToken`,
      "IAM Credentials",
      { scope: [DATASTORE], lifetime: "3600s" },
      federated.access_token,
    )) as { accessToken?: unknown; expireTime?: unknown };
    const expires = typeof account.expireTime === "string" ? Date.parse(account.expireTime) : NaN;
    if (typeof account.accessToken !== "string" || Number.isNaN(expires)) {
      throw new Error("IAM Credentials answered without a token.");
    }
    options.mask(account.accessToken);
    current = { token: account.accessToken, expires };
    return account.accessToken;
  };
  return async () => {
    if (current && current.expires - MARGIN_MS > now()) return current.token;
    // Requests at once share one renewal.
    pending ??= renew().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

/** A JSON POST; a refusal says what the service said, which holds no token. */
async function post(
  fetchFn: Fetch,
  url: string,
  service: string,
  body: unknown,
  token?: string,
): Promise<unknown> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // STS takes no Authorization header; it may fail the request.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return response.json();
  const error = (await response.json().catch(() => undefined)) as
    | { error?: unknown; error_description?: unknown }
    | undefined;
  // STS answers OAuth's `error` and `error_description`; IAM Credentials, Google's error object.
  const detail =
    typeof error?.error === "object" && error.error !== null
      ? [
          (error.error as { status?: unknown }).status,
          (error.error as { message?: unknown }).message,
        ]
      : [error?.error, error?.error_description];
  const text = detail
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(": ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  throw new Error(
    `${service} refused the request with ${response.status}${text ? `: ${text}` : "."}`,
  );
}
