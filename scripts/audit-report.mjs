export function isAuditCommandFailure(status, report) {
  if (status === 0) return false;
  if (status === null) return true;
  return !(
    report &&
    typeof report === "object" &&
    report.vulnerabilities &&
    typeof report.vulnerabilities === "object" &&
    report.metadata?.vulnerabilities &&
    typeof report.metadata.vulnerabilities === "object"
  );
}
