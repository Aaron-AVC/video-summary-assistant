import {
  createInternalPackage,
  createReleaseCandidatePackage,
  verifyInternalPackage,
  verifyReleaseCandidatePackage,
} from "./lib/release-package"

function usage(): never {
  throw new Error("Usage: bun scripts/release-package.ts internal|release|verify [internal|candidate]")
}

function main(args: string[]): void {
  const [command] = args
  if (command === "internal") {
    if (args.length !== 1) usage()
    const result = createInternalPackage()
    console.log(`INTERNAL_VALIDATION_ONLY package created: ${result.zipPath}`)
    console.log(`SHA-256: ${result.identity.archive.sha256}`)
    console.log(`Bytes: ${result.identity.archive.byteLength}`)
    return
  }
  if (command === "verify") {
    if (args.length > 2) usage()
    const target = args[1] ?? "internal"
    if (target !== "internal" && target !== "candidate") usage()
    const identity = target === "candidate"
      ? verifyReleaseCandidatePackage()
      : verifyInternalPackage()
    console.log(`Verified ${identity.package.status}: ${identity.archive.file}`)
    console.log(`SHA-256: ${identity.archive.sha256}`)
    console.log(`Files: ${Object.keys(identity.archive.files).length}`)
    return
  }
  if (command === "release") {
    if (args.length !== 1) usage()
    const result = createReleaseCandidatePackage()
    console.log(`PR6_REVIEW_REQUIRED local candidate created: ${result.zipPath}`)
    console.log(`SHA-256: ${result.identity.archive.sha256}`)
    console.log(`Bytes: ${result.identity.archive.byteLength}`)
    console.log("publicationAuthorized=false")
    return
  }
  usage()
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
