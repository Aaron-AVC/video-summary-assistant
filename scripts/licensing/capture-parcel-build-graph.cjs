// Read-only instrumentation of Plasmo 0.90.5's production Parcel.run result.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = process.cwd();
const local = createRequire(path.join(root, 'package.json'));
const { Parcel } = local('@plasmohq/parcel-core');
const run = Parcel.prototype.run;
const rel = file => path.relative(root, file).replaceAll('\\', '/');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileIdentity = file => {
  const bytes = fs.readFileSync(file);
  return { sha256: sha(bytes), byteLength: bytes.length };
};
const installed = file => {
  const relative = rel(file);
  const parts = relative.split('/');
  const last = parts.lastIndexOf('node_modules');
  if (last < 0 || relative.startsWith('../')) return null;
  const identity = parts.slice(0, last + (parts[last+1].startsWith('@') ? 3 : 2)).join('/') + '/package.json';
  const full = path.join(root, identity);
  const {name, version} = JSON.parse(fs.readFileSync(full, 'utf8'));
  return {identity, name, version, ...fileIdentity(full)};
};
Parcel.prototype.run = async function(...args) {
  const result = await run.apply(this, args);
  if (result.type !== 'buildSuccess') throw new Error('Expected production buildSuccess');
  const packages = new Map();
  const bundles = result.bundleGraph.getBundles({includeInline:true}).map(bundle => {
    const assets = [];
    bundle.traverseAssets(asset => {
      const pkg = installed(asset.filePath);
      if (pkg) packages.set(pkg.identity, pkg);
      const source = rel(asset.filePath);
      assets.push({ id:asset.id, type:asset.type, source, packageIdentity:pkg?.identity ?? null,
        diskFile:fs.existsSync(asset.filePath) && fs.statSync(asset.filePath).isFile() ? fileIdentity(asset.filePath) : null });
    });
    return {id:bundle.id, type:bundle.type, output:rel(bundle.filePath), behavior:bundle.bundleBehavior ?? null,
      diskFile:fs.existsSync(bundle.filePath) ? fileIdentity(bundle.filePath) : null,
      assets:assets.sort((a,b)=>a.source.localeCompare(b.source)||a.id.localeCompare(b.id))};
  }).sort((a,b)=>a.output.localeCompare(b.output)||a.id.localeCompare(b.id));
  const out = process.env.VSA_PR23_GRAPH_PATH;
  fs.writeFileSync(out, JSON.stringify({schema:'vsa-parcel-run-graph/v1', packageJson:fileIdentity(path.join(root,'package.json')), lock:fileIdentity(path.join(root,'bun.lock')), bundles, packages:[...packages.values()].sort((a,b)=>a.identity.localeCompare(b.identity))}, null, 2)+'\n', {flag:'wx'});
  return result;
};
