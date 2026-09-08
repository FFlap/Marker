import { spawnSync } from "node:child_process";
import { isAuditCommandFailure } from "./audit-report.mjs";

const allowedAdvisories = new Set([
  // Metro/Clerk image-size build dependency; owner: Marker maintainers; review by 2026-10-01.
  "GHSA-5p2g-fcmc-qvqq",
  // Metro/Clerk image-size build dependency; owner: Marker maintainers; review by 2026-10-01.
  "GHSA-w3rx-r6r6-pgpr",
]);

const result = spawnSync(
  "npm",
  ["audit", "--omit=dev", "--audit-level=high", "--json"],
  { cwd: process.cwd(), encoding: "utf8" },
);

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error("npm audit did not return valid JSON");
}

if (isAuditCommandFailure(result.status, report)) {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error("npm audit failed before returning a vulnerability report");
}

const advisories = Object.values(report.vulnerabilities ?? {}).flatMap(
  (vulnerability) => {
    const name =
      typeof vulnerability?.name === "string"
        ? vulnerability.name
        : "unknown package";
    if (!Array.isArray(vulnerability?.via))
      return [{ name, severity: "critical", id: "missing-advisory-data" }];
    const direct = vulnerability.via.filter(
      (via) => typeof via === "object" && via !== null,
    );
    if (!direct.length) return [];
    return direct.map((via) => {
      if (typeof via.url !== "string")
        return { name, severity: "critical", id: "missing-advisory-url" };
      try {
        return {
          name,
          severity: via.severity,
          id: new URL(via.url).pathname.split("/").at(-1),
        };
      } catch {
        return { name, severity: "critical", id: "invalid-advisory-url" };
      }
    });
  },
);
const blocking = advisories.filter(
  ({ severity, id }) =>
    (severity === "high" || severity === "critical") &&
    !allowedAdvisories.has(id),
);

if (blocking.length > 0) {
  for (const advisory of blocking) {
    console.error(
      `Blocking production advisory: ${advisory.id} (${advisory.severity}) in ${advisory.name}`,
    );
  }
  process.exitCode = 1;
} else if (
  (report.metadata?.vulnerabilities?.high ?? 0) > 0 ||
  (report.metadata?.vulnerabilities?.critical ?? 0) > 0
) {
  console.warn(
    "Only the allowlisted image-size advisories inherited through Metro/Clerk build dependencies remain.",
  );
} else {
  console.log("No high or critical production dependency advisories found.");
}
