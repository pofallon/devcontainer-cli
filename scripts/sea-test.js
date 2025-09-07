#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findBinary() {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? '.exe' : '';
  const p = path.join(__dirname, '..', 'dist', 'sea', `devcontainer.${platform}-${arch}${ext}`);
  if (!fs.existsSync(p)) {
    console.error('[sea-test] Binary not found at', p);
    process.exit(1);
  }
  return p;
}

function run(cmdArgs) {
  const bin = findBinary();
  const res = spawnSync(bin, cmdArgs, { stdio: 'pipe', encoding: 'utf8' });
  return res;
}

function assertOk(res, desc) {
  if (res.error) {
    console.error(`[sea-test] ${desc} spawn error:`, res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[sea-test] ${desc} exited with code ${res.status}`);
    console.error(res.stdout);
    console.error(res.stderr);
    process.exit(1);
  }
}

function smoke() {
  const version = run(['--version']);
  assertOk(version, '--version');
  if (!/devcontainer/i.test(version.stdout)) {
    console.error('[sea-test] Version output missing expected identifier');
    process.exit(1);
  }
  console.log('[sea-test] version ok');

  const help = run(['--help']);
  assertOk(help, '--help');
  if (!/Usage:/i.test(help.stdout)) {
    console.error('[sea-test] Help output missing Usage header');
    process.exit(1);
  }
  console.log('[sea-test] help ok');

  console.log('[sea-test] smoke tests passed');
}

smoke();
