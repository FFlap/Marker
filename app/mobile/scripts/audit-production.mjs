import { spawnSync } from 'node:child_process';

const allowedAdvisories = new Set(['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']);

const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error('npm audit did not return valid JSON');
}

const advisories = Object.values(report.vulnerabilities ?? {}).flatMap((vulnerability) =>
  vulnerability.via
    .filter((via) => typeof via === 'object' && via !== null)
    .map((via) => ({
      name: vulnerability.name,
      severity: via.severity,
      id: new URL(via.url).pathname.split('/').at(-1),
    })),
);
const blocking = advisories.filter(
  ({ severity, id }) =>
    (severity === 'high' || severity === 'critical') && !allowedAdvisories.has(id),
);

if (blocking.length > 0) {
  for (const advisory of blocking) {
    console.error(
      `Blocking production advisory: ${advisory.id} (${advisory.severity}) in ${advisory.name}`,
    );
  }
  process.exitCode = 1;
} else if ((report.metadata?.vulnerabilities?.high ?? 0) > 0) {
  console.warn('Only the allowlisted Metro/image-size build-time advisories remain.');
} else {
  console.log('No high or critical production dependency advisories found.');
}
