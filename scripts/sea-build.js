#!/usr/bin/env node
// Build a standalone SEA (Single Executable Application) binary for the devcontainer CLI
// Embeds the node-pty native addon inside the bootstrap and extracts it at runtime.

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

const MIN_NODE_MAJOR = 20; // Node 20+ SEA considered stable enough

function fail(msg) {
  console.error(`[sea-build] ERROR: ${msg}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`[sea-build] $ ${cmd}`);
  childProcess.execSync(cmd, { stdio: 'inherit', env: process.env, ...opts });
}

function ensureNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_MAJOR) {
    fail(`Node ${MIN_NODE_MAJOR}+ required for SEA. Current: ${process.versions.node}`);
  }
}

function ensureDistBuilt() {
  const target = path.join(__dirname, '..', 'dist', 'spec-node', 'devContainersSpecCLI.js');
  if (!fs.existsSync(target)) {
    console.log('[sea-build] dist output missing – running production compile');
    run('yarn compile-prod');
  }
  if (!fs.existsSync(target)) {
    fail('dist build failed; file not found: ' + target);
  }
}

function embedNodePty() {
  // Locate the node-pty native addon
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
    path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Debug', 'pty.node')
  ];
  const found = candidates.find(f => fs.existsSync(f));
  if (!found) {
    fail('Could not locate node-pty native binary (pty.node). Ensure dependencies installed.');
  }
  const buf = fs.readFileSync(found);
  const b64 = buf.toString('base64');
  console.log(`[sea-build] Embedded node-pty binary: ${found} (${buf.length} bytes)`);
  return { base64: b64, size: buf.length };
}

function generateBootstrap(ptyInfo, cliRelative) {
  const outDir = path.join(__dirname, '..');
  const bootstrapPath = path.join(outDir, 'sea-bootstrap.mjs');
  const cliAbs = path.join(__dirname, '..', cliRelative.replace(/^\.\//, ''));
  if (!fs.existsSync(cliAbs)) {
    fail('CLI entry not found to inline: ' + cliAbs);
  }
  const cliCodeB64 = fs.readFileSync(cliAbs).toString('base64');

  let content = '';
  content += '#!/usr/bin/env node\n';
  content += '// Auto-generated SEA bootstrap. Do not edit manually.\n';
  content += 'const fs = require(\'fs\');\n';
  content += 'const os = require(\'os\');\n';
  content += 'const path = require(\'path\');\n';
  content += 'const Module = require(\'module\');\n';
  content += 'const vm = require(\'vm\');\n\n';
  content += 'process.env.__DEVCONTAINER_SEA = \"1\";\n\n';
  content += `const ptyBase64 = '${ptyInfo.base64}';\n`;
  content += `const ptySize = ${ptyInfo.size};\n\n`;
  content += 'function ensurePtyExtracted() {\n';
  content += '  try {\n';
  content += '    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), \'devcontainer-sea-\'));\n';
  content += '    const nmRoot = path.join(tmpRoot, \'node_modules\', \'node-pty\', \'build\', \'Release\');\n';
  content += '    fs.mkdirSync(nmRoot, { recursive: true });\n';
  content += '    const ptyDest = path.join(nmRoot, \'pty.node\');\n';
  content += '    fs.writeFileSync(ptyDest, Buffer.from(ptyBase64, \'base64\'), { mode: 0o755 });\n';
  content += '    const modulePaths = Module.globalPaths;\n';
  content += '    const injectPath = path.join(tmpRoot, "node_modules");\n';
  content += '    if (!modulePaths.includes(injectPath)) {\n';
  content += '      modulePaths.unshift(injectPath);\n';
  content += '    }\n';
  content += '    process.env.__DEVCONTAINER_PTY_PATH = ptyDest;\n';
  content += '    return ptyDest;\n';
  content += '  } catch (err) {\n';
  content += '    console.error(\'[SEA bootstrap] Failed to extract node-pty:\', err);\n';
  content += '    return null;\n';
  content += '  }\n';
  content += '}\n\n';
  content += 'ensurePtyExtracted();\n\n';
  content += '// Inline CLI bundle execution with CommonJS shim\n';
  content += `const cliCode = Buffer.from('${cliCodeB64}', 'base64').toString('utf8');\n`;
  content += 'const mainModule = { exports: {} };\n';
  content += 'const mainRequire = Module.createRequire(process.cwd() + \'/\');\n';
  // Replace backticks and ${ to avoid template interference inside runtime wrapper
  content += 'const sanitized = cliCode.replace(/`/g, "\\`") /* keep ${ sequences */;\n';
  content += 'const wrapped = \'(function (exports, require, module, __filename, __dirname) {\\n\' + sanitized + \'\\n})\';\n';
  content += 'try {\n';
  content += '  const fn = vm.runInThisContext(wrapped, { filename: \'devcontainers-cli-inline.js\' });\n';
  content += '  fn(mainModule.exports, mainRequire, mainModule, \'devcontainers-cli-inline.js\', process.cwd());\n';
  content += '} catch (e) {\n';
  content += '  console.error(\'[SEA bootstrap] Failed executing inlined CLI:\', e);\n';
  content += '  process.exitCode = 1;\n';
  content += '}\n';

  fs.writeFileSync(bootstrapPath, content);
  return bootstrapPath;
}

function generateSeaConfig(mainFile, blobPath) {
  // Node will output the preparation blob to blobPath when run with --experimental-sea-config
  const cfg = {
    main: './' + path.basename(mainFile),
    output: blobPath,
    disableExperimentalSEAWarning: true
  };
  const cfgPath = path.join(path.dirname(mainFile), 'sea-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return cfgPath;
}

function copyNodeBinary(destPath) {
  // Copy the current Node binary as the base executable we will inject into.
  fs.copyFileSync(process.execPath, destPath);
  fs.chmodSync(destPath, 0o755);
  console.log(`[sea-build] Copied base node binary -> ${destPath}`);
}

function detectSentinel() {
  // Stream the entire Node binary to locate the SEA fuse sentinel dynamically.
  const fd = fs.openSync(process.execPath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const chunkSize = 1024 * 1024; // 1MB
    const buf = Buffer.alloc(chunkSize);
    let bytesRead = 0;
    let residual = '';
    const regex = /NODE_SEA_FUSE_[0-9a-f]{32}(?::\d+)?/;
    while (bytesRead < stat.size) {
      const toRead = Math.min(chunkSize, stat.size - bytesRead);
      const n = fs.readSync(fd, buf, 0, toRead, bytesRead);
      if (n <= 0) {
        break;
      }
      bytesRead += n;
      // Use latin1 (binary) to avoid UTF-8 multi-byte splitting issues
      const slice = buf.subarray(0, n).toString('latin1');
      const combined = residual + slice;
      const match = combined.match(regex);
      if (match) {
        return match[0];
      }
      // Keep last 64 chars as residual to cover boundary conditions
      residual = combined.slice(-64);
    }
  } finally {
    fs.closeSync(fd);
  }
  fail('Could not detect SEA sentinel in current Node binary.');
}

function injectBlob(baseExe, blobPath) {
  const sentinel = detectSentinel();
  console.log('[sea-build] Detected sentinel:', sentinel);
  const postjectBin = path.join(__dirname, '..', 'node_modules', '.bin', 'postject');
  if (!fs.existsSync(postjectBin)) {
    fail('postject binary not found. Did you run yarn install?');
  }
  // Strip any trailing :number part for postject (expects raw fuse id)
  const fuseId = sentinel.split(':')[0];
  const cmd = `${JSON.stringify(postjectBin)} ${JSON.stringify(baseExe)} NODE_SEA_BLOB ${JSON.stringify(blobPath)} --sentinel-fuse ${fuseId}`;
  run(cmd);
  console.log('[sea-build] Injected SEA blob into executable');
}

function buildSEA() {
  ensureNodeVersion();
  ensureDistBuilt();
  const ptyInfo = embedNodePty();
  const platform = process.platform; // linux, darwin, win32
  const arch = process.arch; // x64, arm64, etc.
  const ext = platform === 'win32' ? '.exe' : '';
  const outDir = path.join(__dirname, '..', 'dist', 'sea');
  fs.mkdirSync(outDir, { recursive: true });
  const finalExeRel = path.join('dist', 'sea', `devcontainer.${platform}-${arch}${ext}`);
  // Ensure path starts with ./ so embedder treats it as relative user code, not a builtin
  const cliRelative = './dist/spec-node/devContainersSpecCLI.js';
  const bootstrap = generateBootstrap(ptyInfo, cliRelative);
  // We first write a preparation blob, then inject it into a copy of the Node executable.
  const blobRel = path.join('dist', 'sea', `devcontainer.${platform}-${arch}.blob`);
  const seaConfig = generateSeaConfig(bootstrap, blobRel);
  run(`node --experimental-sea-config ${path.basename(seaConfig)}`, { cwd: path.join(__dirname, '..') });
  const blobAbs = path.join(__dirname, '..', blobRel);
  if (!fs.existsSync(blobAbs)) {
    fail('SEA blob output missing: ' + blobAbs);
  }
  // Copy base node binary
  const finalExeAbs = path.join(__dirname, '..', finalExeRel);
  copyNodeBinary(finalExeAbs);
  injectBlob(finalExeAbs, blobAbs);
  // Final size
  const bytes = fs.statSync(finalExeAbs).size;
  console.log('[sea-build] Built executable:', finalExeAbs);
  console.log(`[sea-build] Executable size: ${(bytes/1024/1024).toFixed(2)} MB`);
}

buildSEA();
