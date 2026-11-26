"""Record the single captured build and classify the source it consumed."""

import csv
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tarfile
import os
from base64 import b64encode

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/licensing/evidence/R002-B"
HISTORY = EVIDENCE.parent / "R002-PR23"
BUILD = EVIDENCE / "build"
ARTIFACT = ROOT / "build/chrome-mv3-prod"
BASE = "f6d7b3068b893ce11637ea84598b26a5975e6838"
SOURCE = "7eda9fdbe0cd414c16a755f0b5da390c0fd37a57"
COMPONENT = "react-remove-scroll-bar"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def identity(value):
    data = value if isinstance(value, bytes) else value.read_bytes()
    return dict(sha256=hashlib.sha256(data).hexdigest(), byteLength=len(data))


def save(path, value):
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f"Refusing to overwrite previously captured evidence: {path}")
        return
    with path.open("xb") as output:
        output.write(data)


graph = json.loads((BUILD / "parcel-graph.json").read_bytes())
previous = json.loads((HISTORY / "build-identity.json").read_bytes())
artifacts = {p.relative_to(ARTIFACT).as_posix(): identity(p) for p in sorted(ARTIFACT.rglob("*")) if p.is_file()}
icon_source = ROOT / "assets/icon.png"
svg = ROOT / "assets/icon-source.svg"
manifest = json.loads((BUILD / "manifest.json").read_bytes())
generated = {}
for size, output in sorted(manifest["icons"].items(), key=lambda item: int(item[0])):
    source = f".plasmo/gen-assets/icon{size}.plasmo.png"
    bundle = next(b for b in graph["bundles"] if b["output"] == f"build/chrome-mv3-prod/{output}")
    member = next(a for a in bundle["assets"] if a["source"] == source)
    dims = struct.unpack(">II", (ARTIFACT / output).read_bytes()[16:24])
    if (dims != (int(size), int(size)) or member["diskFile"] != identity(ROOT / source)
            or bundle["diskFile"] != artifacts[output] or previous["artifact"].get(output) == artifacts[output]):
        raise ValueError(f"Unexpected icon derivation evidence: {size}")
    pixel_script = """const s=require('sharp'); const c=require('node:crypto');
const [n,source,output]=process.argv.slice(1); (async()=>{
const d=await s('assets/icon.png').toBuffer();
const a=await s(d).resize(+n,+n).ensureAlpha().raw().toBuffer();
const b=await s(source).ensureAlpha().raw().toBuffer();
const f=await s(output).ensureAlpha().raw().toBuffer();
if(!a.equals(b)||!b.equals(f)) throw Error('icon pixel derivation mismatch');
console.log(c.createHash('sha256').update(f).digest('hex'));})();"""
    pixels = subprocess.check_output(["node", "-e", pixel_script, size, source, str(ARTIFACT / output)],
                                     cwd=ROOT, text=True).strip()
    generated[size] = dict(source=source, output=output, width=dims[0], height=dims[1], rgbaSha256=pixels)

if manifest["action"].get("default_icon", manifest["icons"]) != manifest["icons"]:
    raise ValueError("Action icon references differ from audited manifest icons")

for path in ("manifest.json", "package.json", "bun.lock"):
    evidence = artifacts[path] if path == "manifest.json" else graph["packageJson" if path == "package.json" else "lock"]
    live = BUILD / path if path == "manifest.json" else ROOT / path
    if identity(live) != evidence:
        raise ValueError(f"Missing build binding on {path}")

with (EVIDENCE.parent / "source-inventory-8ee1c311.tsv").open(encoding="utf-8", newline="") as infile:
    old_inventory = {row["path"]: row for row in csv.DictReader(infile, delimiter="\t")}

outputs_by_source = {}
for bundle in graph["bundles"]:
    for asset in bundle["assets"]:
        if not asset["packageIdentity"] and asset["source"].startswith("src/"):
            outputs_by_source.setdefault(asset["source"], set()).add(bundle["output"].removeprefix("build/chrome-mv3-prod/"))
for path in ("background.ts", "options.tsx", "sidepanel.tsx", "popup.tsx", "README.md", "README.zh-CN.md",
             "assets/icon-source.svg", "assets/icon.png", "licenses/YouTube-Summarizer-MIT.txt"):
    outputs_by_source.setdefault(path, set())

upstream_migrations = {
    "src/features/platform/youtube/youtube-adapter.ts": "Platform adapter refactor; inherited expression established by PR-1.",
    "src/features/platform/youtube/youtube-url.ts": "Added in the platform adapter refactor alongside deletion of runtime/page-detection; treat extraction lineage conservatively.",
    "src/sidepanel/components/ask-tab.tsx": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/components/overview-tab.tsx": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/components/settings-tab.tsx": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/components/sidepanel-shell.tsx": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/components/transcript-tab.tsx": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/lib/load-current-transcript.ts": "Extracted during sidepanel/index.tsx workflow restructuring.",
    "src/sidepanel/lib/sidepanel-ux.ts": "Treat implementation moved during sidepanel restructuring as mixed.",
    "src/sidepanel/analysis/analysis-controller.ts": "Analysis execution refactor; preserve upstream MIT conservatively.",
    "src/sidepanel/ask/ask-controller.ts": "Ask workflow refactor; preserve upstream MIT conservatively.",
    "src/sidepanel/history/history-controller.ts": "History restoration refactor; preserve upstream MIT conservatively.",
    "src/sidepanel/lib/sidepanel-pure-helpers.ts": "Side Panel extraction; preserve inherited expression conservatively.",
    "src/sidepanel/navigation/timestamp-navigation.ts": "Navigation extracted from existing Side Panel; preserve upstream MIT conservatively.",
    "src/sidepanel/transcript/transcript-acquisition.ts": "Transcript workflow extraction; preserve upstream MIT conservatively.",
    "src/sidepanel/transcript/transcript-controller.ts": "Existing transcript lifecycle extraction.",
    "src/sidepanel/transcript/transcript-finalization.ts": "Existing transcript finalization extraction.",
    "src/sidepanel/workspace/workspace-controller.ts": "Workspace runtime refactor; preserve upstream MIT conservatively.",
    "src/sidepanel/workspace/workspace-state.ts": "Workspace runtime refactor; preserve upstream MIT conservatively.",
}
template_names = {"empty.tsx", "field.tsx", "input-group.tsx"}
rights = []
for path, outputs in sorted(outputs_by_source.items()):
    old = old_inventory.get(path, {})
    history_format = "%H%x09%an%x09%aI%x09%T%x09%P%x09%s"
    # For the replaced PNG, record the introduction of the current artwork,
    # not the earlier commit that introduced the pathname and inherited image.
    first = (git("show", "-s", f"--format={history_format}", SOURCE) if path == "assets/icon.png"
             else git("log", "--follow", "--diff-filter=A", f"--format={history_format}", SOURCE, "--", path)
             ).decode().splitlines()
    fields = first[-1].split("\t", 5) if first else ["", "", "", "", "", ""]
    first_commit, author, authored_at, commit_tree, parent_shas, first_subject = (fields + [""] * 6)[:6]
    upstream_path = old.get("upstream_path") or None
    upstream_blob = old.get("upstream_blob") or None
    if path.startswith("assets/icon"):
        disposition, why = "PROJECT_ADDITION_HISTORY", "New geometric artwork in R002-B; project license and rights holder decision pending."
        upstream_path = upstream_blob = None
    elif path == "licenses/YouTube-Summarizer-MIT.txt":
        disposition, why = "THIRD_PARTY", "Preserved fixed upstream MIT text."
    elif path.startswith("src/components/ui/") and Path(path).name in template_names:
        disposition, why = "THIRD_PARTY_MIXED", "shadcn template lineage with upstream extension adaptations; retain both full MIT notices."
    elif old.get("target_class") in ("same_path_equal", "same_path_changed"):
        current_blob = git("rev-parse", f"{SOURCE}:{path}").decode().strip()
        disposition = "UPSTREAM_MIT_ORIGINAL" if current_blob == upstream_blob else "UPSTREAM_MIT_MIXED"
        why = "Compared the source commit blob with the PR-1 fixed upstream blob."
    elif path in upstream_migrations:
        disposition, why = "UPSTREAM_MIT_MIXED", upstream_migrations[path]
    elif path.startswith("src/features/platform/bilibili/"):
        disposition, why = "PROJECT_HISTORY_ARCHITECTURE_REFERENCE", (
            "Added in the project Bilibili adapter history. The inherited PR-1 bounded screen found no exact file "
            "match across 30 platform/content files or selected shared six-line sequence; architecture-only reference "
            "status remains, not a complete rewritten-expression audit."
        )
    elif first_commit and not first_commit.startswith("db4da466"):
        disposition, why = "PROJECT_ADDITION_HISTORY", "Documented post-import development commit; confirm contributor rights and provenance before applying project terms."
    else:
        disposition, why = "RIGHTS_CONFIRMATION_REQUIRED", "No sufficient documented introduction for an ownership classification."
    rights.append(dict(path=path, disposition=disposition, outputs=sorted(outputs),
                       introductionCommit=dict(sha=first_commit, author=author, authoredAt=authored_at,
                                               tree=commit_tree, parents=parent_shas.split() if parent_shas else [],
                                               subject=first_subject),
                       upstreamPath=upstream_path, upstreamBlob=upstream_blob, rationale=why))
save(EVIDENCE / "source-rights-v3.json", dict(schema="vsa-source-rights/v3", sourceCommit=SOURCE, paths=rights,
     inheritedReview="docs/licensing/provenance-review.md#architecture-references-only"))

publications = {}
manifest_by_version = {}
for version in ("2.3.7", "2.3.8"):
    raw = EVIDENCE / "raw" / f"scroll-{version}.tgz"
    registry = json.loads((EVIDENCE / "raw" / f"scroll-{version}.json").read_bytes())
    data = raw.read_bytes()
    integrity = "sha512-" + b64encode(hashlib.sha512(data).digest()).decode()
    if registry["dist"]["integrity"] != integrity:
        raise ValueError(f"Registry integrity mismatch: {version}")
    with tarfile.open(raw) as archive:
        entries = {m.name: identity(archive.extractfile(m).read()) for m in archive if m.isfile()}
        package = archive.extractfile("package/package.json").read()
    manifest_by_version[version] = json.loads(package)
    legal = [path for path in entries if re.search(r"/(?:LICENSE|NOTICE)(?:\.[^/]*)?$", path, re.I)]
    if legal or len(entries) != 27:
        raise ValueError(f"Unexpected tarball legal inventory: {version}")
    if version == "2.3.7" and package != (ROOT / f"node_modules/{COMPONENT}/package.json").read_bytes():
        raise ValueError("Installed target manifest differs from the exact npm tarball")
    publications[version] = dict(version=version, gitHead=registry["gitHead"], url=registry["dist"]["tarball"],
                                 integrity=integrity, tarball=identity(data), legalFiles=legal, entries=entries)

old_entries, new_entries = (publications[v]["entries"] for v in ("2.3.8", "2.3.7"))
if {k for k in old_entries.keys() | new_entries.keys() if old_entries.get(k) != new_entries.get(k)} != {"package/package.json"}:
    raise ValueError("Unexpected executable/type delta between releases")
comparison = json.loads((EVIDENCE / "raw/upstream-compare.json").read_bytes())
if comparison["base_commit"]["sha"] != publications["2.3.7"]["gitHead"] or [
    (f["filename"], f["status"]) for f in comparison["files"]
] != [("LICENSE", "added")]:
    raise ValueError("Unexpected official upstream release-to-license change")
license_path = ROOT / "licenses/third-party/r002-b-materials/react-remove-scroll-bar-MIT.txt"
license_bytes = license_path.read_bytes()
if license_bytes != (EVIDENCE / "raw/scroll-license.raw").read_bytes():
    raise ValueError("Preserved upstream legal text differs")
if hashlib.sha1(f"blob {len(license_bytes)}\0".encode() + license_bytes).hexdigest() != "7c08c3990396ecefd90f99ff5d9a34f26f5b5616":
    raise ValueError("Preserved upstream legal text does not match the fixed Git blob")
save(EVIDENCE / "scroll-bar-publications.json", dict(publications=publications,
     incomingRange="^2.3.7", parent="react-remove-scroll@2.7.2",
     licenseCommit="8ca9ba5ea52de03308fe8ced94f7b159a44d28ff", licenseMaterial=identity(license_bytes),
     sourceTreeAtBothCommits="a860502e80cf620578d6517606da4ff12e8937d4",
     copyright=next(line for line in license_bytes.decode().splitlines() if line.startswith("Copyright")),
     dependencyConstraints={v: p["dependencies"] for v, p in manifest_by_version.items()},
     peerConstraints={v: p["peerDependencies"] for v, p in manifest_by_version.items()}))

save(BUILD / "build-identity-v3.json", dict(
    schema="vsa-r002-b-production-evidence/v3", sourceCommit=SOURCE, sourceTree=git("show", "-s", "--format=%T", SOURCE).decode().strip(),
    base=BASE, exitCode=0, command="node --require ./scripts/licensing/capture-parcel-build-graph.cjs ./node_modules/plasmo/bin/index.mjs build",
    environment=dict(NODE_ENV="production", PARCEL_WORKERS="2", target="chrome-mv3"),
    bun=os.environ["VSA_CAPTURE_BUN_VERSION"],
    node=subprocess.check_output(["node", "--version"], cwd=ROOT, text=True).strip(),
    packageJson=graph["packageJson"], lock=graph["lock"],
    ledgerSha256=identity(ROOT / "docs/licensing/third-party-license-ledger.json")["sha256"],
    captureSha256=identity(ROOT / "scripts/licensing/capture-parcel-build-graph.cjs")["sha256"],
    gitInputs={p: {**identity(ROOT / p), "gitBlobSha256": identity(git("show", f"{SOURCE}:{p}"))["sha256"]}
               for p in ("package.json", "bun.lock", "assets/icon.png", "assets/icon-source.svg")},
    evidenceFiles={p: identity(BUILD / p) for p in ("production-build.txt", "parcel-graph.json", "manifest.json")},
    artifact=artifacts, outputChecks={"icon": {"generated": generated,
        "source": identity(icon_source), "editableSvg": identity(svg)}},
    toolchain={name: {"version": json.loads((ROOT / "node_modules" / name / "package.json").read_bytes())["version"],
                      **identity(ROOT / "node_modules" / name / "package.json")}
               for name in ("plasmo", "@parcel/core", "@plasmohq/parcel-core", "sharp")},
    inputEvidence={p: identity(EVIDENCE / p) for p in (
        "source-rights-v3.json", "scroll-bar-publications.json", "shadcn-review.md",
        "raw/scroll-2.3.7.tgz", "raw/scroll-2.3.8.tgz", "raw/upstream-compare.json",
        "raw/upstream-pr76.json", "raw/scroll-2.3.7.json", "raw/scroll-2.3.8.json",
    )},
    byteIdenticalNonIconOutputs=[p for p in artifacts if artifacts[p] == previous["artifact"].get(p)],
))
