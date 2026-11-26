import {
  createInternalPackage,
  refuseFormalPackage,
  verifyInternalPackage,
} from "./lib/release-package"

function usage(): never {
  throw new Error("Usage: bun scripts/release-package.ts internal|release|verify")
}

function main(args: string[]): void {
  if (args.length !== 1) usage()
  const [command] = args
  if (command === "internal") {
    const result = createInternalPackage()
    console.log(`INTERNAL/HOLD package created: ${result.zipPath}`)
    console.log(`SHA-256: ${result.identity.archive.sha256}`)
    console.log(`Bytes: ${result.identity.archive.byteLength}`)
    return
  }
  if (command === "verify") {
    const identity = verifyInternalPackage()
    console.log(`Verified ${identity.package.status}: ${identity.archive.file}`)
    console.log(`SHA-256: ${identity.archive.sha256}`)
    console.log(`Files: ${Object.keys(identity.archive.files).length}`)
    return
  }
  if (command === "release") refuseFormalPackage()
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
