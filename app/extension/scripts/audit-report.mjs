export function isAuditCommandFailure(status, report) {
  if (status === 0 || status === null) return false;
  return !(
    report &&
    typeof report === "object" &&
    report.vulnerabilities &&
    typeof report.vulnerabilities === "object" &&
    report.metadata?.vulnerabilities &&
    typeof report.metadata.vulnerabilities === "object"
  );
}
