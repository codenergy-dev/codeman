---
title: Ubuntu archive
url: http://archive.ubuntu.com/ubuntu/dists/
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-20T11:30:00-03:00
---

# Ubuntu archive

How to record which package installs which file on a release of Ubuntu, from the archive's indexes.

- **Source.** Each release has a `Contents-<arch>.gz` index that maps every file path to the packages that install it: `http://archive.ubuntu.com/ubuntu/dists/<codename>/Contents-amd64.gz` for x64, and `http://ports.ubuntu.com/ubuntu-ports/dists/<codename>/Contents-arm64.gz` for arm64. Paths have no leading `/`.
- **Package files.** A file that a package installs, such as `/etc/sudoers`, is in the package's `.deb`. `dists/<suite>/main/binary-<arch>/Packages.gz` gives each package's `Filename` and `SHA256`; download it from the archive's root, check the SHA-256, and extract it with `ar x` and `tar`, in a scratch directory. The title is the file's path and the package's file name, such as "/etc/sudoers in sudo_1.9.15p5-3ubuntu5.24.04.4_amd64.deb".
- **Source packages.** A package's source, to read how a program behaves, is in `dists/<suite>/main/source/Sources.gz`: its `Directory` and `Checksums-Sha256` give the `.orig.tar.*` and `.debian.tar.*` files. Download them from the archive's root, check each SHA-256, extract them in a scratch directory, and list `debian/patches/series` to see which files Ubuntu changes. The title is the source package's file name, such as "open-iscsi_2.1.9-3ubuntu5.5 source package", and the `url` its `.dsc`.
- **Check.** The release's `Release` file, in the same directory, lists each index with its SHA-256. Compare it with the download before reading the index.
- **License.** The index is data generated from the packages, with no license of its own. Record only the lines the repository relies on, in your own words, without `license`.
- **Title.** The index's path under the archive, such as "dists/noble/Contents-amd64.gz".
- **Size.** An index is about 50 MB. Keep it in a scratch directory, never in the repository.

```sh
curl -fsS -o Contents-amd64.gz http://archive.ubuntu.com/ubuntu/dists/noble/Contents-amd64.gz
curl -fsS http://archive.ubuntu.com/ubuntu/dists/noble/Release | grep 'Contents-amd64.gz$'
shasum -a 256 Contents-amd64.gz
gzip -dc Contents-amd64.gz | grep -E '^usr/s?bin/(sudo|git)[[:space:]]'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
