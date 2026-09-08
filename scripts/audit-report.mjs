export function isAuditCommandFailure(status, report) {
  if (status === null) return true;
  return !(
    report &&
    typeof report === "object" &&
    !Array.isArray(report) &&
    report.vulnerabilities &&
    typeof report.vulnerabilities === "object" &&
    !Array.isArray(report.vulnerabilities) &&
    report.metadata?.vulnerabilities &&
    typeof report.metadata.vulnerabilities === "object" &&
    !Array.isArray(report.metadata.vulnerabilities)
  );
}
