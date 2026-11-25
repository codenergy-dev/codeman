---
title: "Index of /dist/v24.22.1/"
url: https://nodejs.org/dist/v24.22.1/
created_at: 2026-10-30T16:27:43-03:00
updated_at: 2026-10-30T16:27:43-03:00
tool: docs/web/tools/nodejs-org.md
---

# Index of /dist/v24.22.1/

How nodejs.org's download server answered on 2026-10-30T16:27:43-03:00, in Codeman's words: requests as a client that follows no redirect makes them, HTTP/1.0 through `openssl s_client` ([the download server](../tools/nodejs-org.md#the-download-server)). The server is Cloudflare's CDN, so its answers may change.

## The files serve without a redirect

- **The tarball and `SHASUMS256.txt`** answer `200` at their own URLs, with a `Content-Length` and no `Location`: a client that follows no redirect gets the file. The status line says `HTTP/1.1` to an HTTP/1.0 request.
- **`/download/release/v24.22.1/`** serves the same tarball, `200`, with the same size.
- **Only the directory without its trailing slash** redirects (`301`, to the URL with it).
- **A full GET** of the tarball through `openssl s_client` gave a file whose SHA-256 matched `SHASUMS256.txt` (Codeman's bootstrap, `src/gateway/bootstrap.ts`, the same day).

The answers' headers:

```text
HEAD /dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz
HTTP/1.1 200 OK
Content-Type: application/gzip
Content-Length: 58290700
Cache-Control: public, immutable, max-age=31536000, s-maxage=31536000

HEAD /dist/v24.22.1/SHASUMS256.txt
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Length: 3171
Cache-Control: public, max-age=3600, s-maxage=14400

HEAD /download/release/v24.22.1/node-v24.22.1-linux-x64.tar.gz
HTTP/1.1 200 OK
Content-Type: application/gzip
Content-Length: 58290700
Cache-Control: public, immutable, max-age=31536000, s-maxage=31536000

HEAD /dist/v24.22.1
HTTP/1.1 301 Moved Permanently
Content-Length: 0
Location: https://nodejs.org/dist/v24.22.1/
```

## Digests

The lines of `SHASUMS256.txt` for the linux tarballs:

```text
33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3  node-v24.22.1-linux-arm64.tar.gz
eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c  node-v24.22.1-linux-x64.tar.gz
```

The listing also offers `SHASUMS256.txt.asc` and `SHASUMS256.txt.sig`, the file's signatures.
