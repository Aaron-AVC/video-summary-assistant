import {
  projectRightsConstants,
  recordProjectRightsEvidence,
  verifyProjectRightsQualification,
} from "./project-rights"

function main(args: string[]): void {
  if (args.length !== 1 || !["record", "verify"].includes(args[0]!)) {
    throw new Error("Usage: bun scripts/licensing/r002-pr5-record.ts record|verify")
  }
  const result = args[0] === "record"
    ? recordProjectRightsEvidence()
    : { qualification: verifyProjectRightsQualification(), counts: undefined, outputs: undefined }
  console.log(`Decision: ${projectRightsConstants.decision}`)
  console.log(`Status: ${result.qualification.status}`)
  console.log(`Decision SHA-256: ${result.qualification.decisionSha256}`)
  console.log(`Current scope SHA-256: ${result.qualification.currentScopeSha256}`)
  console.log(`Current ledger SHA-256: ${result.qualification.currentLedgerSha256}`)
  console.log(`Notice manifest SHA-256: ${result.qualification.noticeManifestSha256}`)
  if (result.counts) {
    console.log(`Scope: ${result.counts.total} total; ${result.counts.included} included; ${result.counts.unknown} unknown; ${result.counts.excluded} excluded; ${result.counts.unknownNpm} unknown npm included in notices`)
    console.log(`Current evidence files recorded: ${result.outputs?.size ?? 0}`)
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
