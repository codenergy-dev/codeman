/**
 * Summarizes the reports of scan.sh: for each scanner and image, the distinct findings (one per
 * vulnerability and package) by severity, split between OS packages and language packages, how
 * many have a fixed version, and the critical and high ones in OS packages.
 *
 * Usage: node experiments/multi-service-pods/bootstrap/summarize.ts <reports-directory>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Finding {
  id: string;
  pkg: string;
  version: string;
  severity: string;
  fixed: boolean;
  os: boolean;
  title: string;
}

/** The fields read from Trivy's JSON report. */
interface TrivyReport {
  Results?: {
    Class: string;
    Vulnerabilities?: {
      VulnerabilityID: string;
      PkgName: string;
      InstalledVersion: string;
      Severity: string;
      FixedVersion?: string;
      Title?: string;
    }[];
  }[];
}

/** The fields read from Grype's JSON report. */
interface GrypeReport {
  matches?: {
    vulnerability: { id: string; severity: string; fix?: { state: string }; description?: string };
    artifact: { name: string; version: string; type: string };
  }[];
}

/** Trivy's JSON: Results[].Vulnerabilities[], each result an `os-pkgs` or `lang-pkgs` class. */
function trivy(report: TrivyReport): Finding[] {
  return (report.Results ?? []).flatMap((result) =>
    (result.Vulnerabilities ?? []).map((v) => ({
      id: v.VulnerabilityID,
      pkg: v.PkgName,
      version: v.InstalledVersion,
      severity: String(v.Severity).toLowerCase(),
      fixed: Boolean(v.FixedVersion),
      os: result.Class === "os-pkgs",
      title: v.Title ?? "",
    })),
  );
}

/** Grype's JSON: matches[], each an artifact of a type (`deb` for Ubuntu's packages). */
function grype(report: GrypeReport): Finding[] {
  return (report.matches ?? []).map((m) => ({
    id: m.vulnerability.id,
    pkg: m.artifact.name,
    version: m.artifact.version,
    severity: String(m.vulnerability.severity).toLowerCase(),
    fixed: m.vulnerability.fix?.state === "fixed",
    os: ["deb", "rpm", "apk"].includes(m.artifact.type),
    title: (m.vulnerability.description ?? "").slice(0, 100),
  }));
}

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: node summarize.ts <reports-directory>");
  process.exit(2);
}
const severities = ["critical", "high", "medium", "low", "negligible", "unknown"];
for (const file of readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const text = readFileSync(join(directory, file), "utf8");
  // A scan that failed or still runs leaves an empty report.
  if (text.trim() === "") {
    console.log(`\n## ${file}: empty`);
    continue;
  }
  const report = JSON.parse(text);
  const all = file.startsWith("trivy-") ? trivy(report) : grype(report);
  // One finding per vulnerability and package: a scanner may report a package at several paths.
  const findings = [...new Map(all.map((f) => [`${f.id} ${f.pkg} ${f.version}`, f])).values()];
  console.log(`\n## ${file}: ${findings.length} findings`);
  for (const os of [true, false]) {
    const part = findings.filter((f) => f.os === os);
    const counts = severities
      .map((s) => [s, part.filter((f) => f.severity === s).length] as const)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${s} ${n}`);
    const fixed = part.filter((f) => f.fixed).length;
    console.log(`${os ? "OS" : "language"}: ${part.length} (${counts.join(", ")}); fixed ${fixed}`);
  }
  for (const f of findings.filter((f) => f.os && ["critical", "high"].includes(f.severity))) {
    console.log(
      `  ${f.severity} ${f.id} ${f.pkg} ${f.version}${f.fixed ? " (fixed)" : ""} ${f.title}`,
    );
  }
}
