#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const PACKAGE_LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json');
const STAMP_DIR = path.join(ROOT_DIR, 'node_modules', '.cache', 'pocketdex');
const STAMP_PATH = path.join(STAMP_DIR, 'install-state.json');
const REQUIRED_NODE_MAJOR = 18;
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const VERSION = PACKAGE_JSON.version || '0.0.0';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[96m',
  blue: '\x1b[94m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  red: '\x1b[91m',
  magenta: '\x1b[95m',
  white: '\x1b[97m',
};

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

function section(label, text) {
  process.stdout.write(`${c(label, 'dim')}  ${text}`);
}

function isNodeScript(filePath) {
  return typeof filePath === 'string' && /\.(?:[cm]?js)$/i.test(filePath);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function bundledNpmCli() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function localCodexCli() {
  return path.join(ROOT_DIR, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
}

function normalizeRuntime(target, options = {}) {
  const runtime = typeof target === 'string'
    ? { command: target, prefixArgs: [], target, label: path.basename(target) || target }
    : { ...target };

  if (!runtime.target) runtime.target = runtime.command;
  if (!runtime.label) runtime.label = path.basename(runtime.target || runtime.command) || String(runtime.command);
  if (!Array.isArray(runtime.prefixArgs)) runtime.prefixArgs = [];

  if (isNodeScript(runtime.command)) {
    runtime.prefixArgs = [runtime.command].concat(runtime.prefixArgs);
    runtime.command = process.execPath;
  }

  if (options.env && options.env.CODEX_BIN) {
    runtime.envValue = options.env.CODEX_BIN;
  } else if (runtime.envValue == null) {
    runtime.envValue = runtime.target;
  }

  return runtime;
}

function resolveNpmRuntime() {
  const npmCli = bundledNpmCli();
  if (fs.existsSync(npmCli)) {
    return normalizeRuntime({
      command: process.execPath,
      prefixArgs: [npmCli],
      target: npmCli,
      label: 'npm',
    });
  }

  const npm = npmCommand();
  return normalizeRuntime({ command: npm, label: path.basename(npm) });
}

function hasRunnableCommand(target, args = ['--version']) {
  const runtime = normalizeRuntime(target);
  const result = spawnSync(runtime.command, runtime.prefixArgs.concat(args), {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  });
  return typeof result.status === 'number' && result.status === 0;
}

function localCodexBin() {
  return path.join(
    ROOT_DIR,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex'
  );
}

function runtimeCodexBin() {
  if (process.env.CODEX_BIN) return normalizeRuntime(process.env.CODEX_BIN);
  const localCli = localCodexCli();
  if (fs.existsSync(localCli)) {
    return normalizeRuntime({
      command: process.execPath,
      prefixArgs: [localCli],
      target: localCli,
      label: 'codex',
      envValue: localCli,
    });
  }
  const localBin = localCodexBin();
  if (fs.existsSync(localBin)) return normalizeRuntime(localBin);
  return normalizeRuntime(process.platform === 'win32' ? 'codex.cmd' : 'codex');
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function lockHash() {
  if (fs.existsSync(PACKAGE_LOCK_PATH)) return hashFile(PACKAGE_LOCK_PATH);
  return hashFile(PACKAGE_JSON_PATH);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeStamp() {
  ensureDir(STAMP_DIR);
  const payload = {
    version: VERSION,
    lockHash: lockHash(),
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STAMP_PATH, JSON.stringify(payload, null, 2));
}

function needsDependencyInstall() {
  if (process.env.POCKETDEX_FORCE_INSTALL === '1') return true;

  const nodeModulesDir = path.join(ROOT_DIR, 'node_modules');
  const expressPkg = path.join(nodeModulesDir, 'express', 'package.json');
  const codexPkg = path.join(nodeModulesDir, '@openai', 'codex', 'package.json');

  if (!fs.existsSync(nodeModulesDir)) return true;
  if (!fs.existsSync(expressPkg)) return true;
  if (!fs.existsSync(codexPkg)) return true;

  const stamp = safeReadJson(STAMP_PATH);
  if (!stamp || stamp.lockHash !== lockHash()) return true;

  return false;
}

function run(target, args, options = {}) {
  const runtime = normalizeRuntime(target, options);
  const env = { ...process.env, ...(options.env || {}) };
  if (options.env && Object.prototype.hasOwnProperty.call(options.env, 'CODEX_BIN')) {
    env.CODEX_BIN = runtime.envValue;
  }
  const result = spawnSync(runtime.command, runtime.prefixArgs.concat(args), {
    cwd: options.cwd || ROOT_DIR,
    stdio: options.stdio || 'inherit',
    env,
    shell: false,
    windowsHide: true,
  });
  if (typeof result.status === 'number') return result.status;
  return result.signal ? 1 : 0;
}

function ensureNodeVersion() {
  const versionText = process.versions.node || '0.0.0';
  const major = Number(versionText.split('.')[0] || '0');
  section('[1/4]', 'Node.js       ');
  if (major < REQUIRED_NODE_MAJOR) {
    log(`${c('[ TOO OLD ]', 'red')}  ${c(`v${versionText}`, 'dim')}`);
    log('');
    log(`  ${c('PocketDex requires Node.js 18 or newer.', 'red')}`);
    log(`  ${c('Install the latest LTS build from https://nodejs.org', 'white')}`);
    process.exit(1);
  }
  log(`${c('[ OK ]', 'green')}  ${c(`v${versionText}`, 'dim')}`);
}

function installDependencies() {
  section('[2/4]', 'Dependencies  ');

  const npm = resolveNpmRuntime();
  if (!hasRunnableCommand(npm)) {
    log(`${c('[ MISSING ]', 'red')}  ${c(npm.label, 'dim')}`);
    log('');
    log(`  ${c('PocketDex needs npm to install and update dependencies.', 'red')}`);
    log(`  ${c('Install the standard Node.js distribution from https://nodejs.org', 'white')}`);
    process.exit(1);
  }

  if (!needsDependencyInstall()) {
    log(`${c('[ OK ]', 'green')}  ${c('PocketDex + pinned Codex CLI already installed', 'dim')}`);
    return;
  }

  log(c('[ INSTALLING ]', 'yellow'));
  log('');
  log(`  ${c('Installing project dependencies (including local Codex CLI)...', 'dim')}`);
  let status;
  if (fs.existsSync(PACKAGE_LOCK_PATH)) {
    status = run(npm, ['ci', '--omit=dev']);
    if (status !== 0) {
      log('');
      log(`  ${c('npm ci failed — falling back to npm install --omit=dev', 'yellow')}`);
      status = run(npm, ['install', '--omit=dev']);
    }
  } else {
    status = run(npm, ['install', '--omit=dev']);
  }

  if (status !== 0) {
    log('');
    log(`  ${c('Failed to install PocketDex dependencies.', 'red')}`);
    process.exit(status || 1);
  }

  writeStamp();
  log('');
  log(`  ${c('✓ PocketDex dependencies installed.', 'green')}`);
}

function ensureCodexLogin(codexBin) {
  section('[3/4]', 'Codex login   ');
  const env = { CODEX_BIN: codexBin.envValue || codexBin.target || codexBin.command };

  if (run(codexBin, ['login', 'status'], { env }) === 0) {
    log(`${c('[ OK ]', 'green')}  ${c('already authenticated', 'dim')}`);
    return;
  }

  log(c('[ LOGIN REQUIRED ]', 'yellow'));
  log('');
  log(`  ${c('PocketDex will open the official Codex sign-in flow now.', 'white')}`);
  log(`  ${c('If browser login fails, it will automatically try device-code login.', 'dim')}`);
  log('');

  if (run(codexBin, ['login'], { env }) === 0) {
    log('');
    log(`  ${c('✓ Codex login complete.', 'green')}`);
    return;
  }

  log('');
  log(`  ${c('Standard login did not finish. Trying device-code login...', 'yellow')}`);
  log('');

  if (run(codexBin, ['login', '--device-auth'], { env }) === 0) {
    log('');
    log(`  ${c('✓ Codex device-code login complete.', 'green')}`);
    return;
  }

  log('');
  log(`  ${c('Codex login did not complete.', 'red')}`);
  log(`  ${c('You can retry later with:', 'white')} ${c(`${codexBin.label} login`, 'cyan')}`);
  log(`  ${c('or', 'dim')} ${c(`${codexBin.label} login --device-auth`, 'cyan')}`);
  process.exit(1);
}

function launchPocketDex(codexBin) {
  section('[4/4]', 'PocketDex     ');
  log(c('[ LAUNCHING ]', 'green'));
  log('');
  log(c('────────────────────────────────────────────────────────', 'dim'));
  log('');
  log(`  ${c('📱  Scan the QR code below with your phone to connect', 'cyan')}`);
  log(`  ${c('No global Codex install needed — PocketDex uses its bundled local CLI.', 'dim')}`);
  log('');
  log(`  ${c('Press Ctrl+C to stop PocketDex.', 'dim')}`);
  log('');
  log(c('────────────────────────────────────────────────────────', 'dim'));
  log('');

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      CODEX_BIN: codexBin.envValue || codexBin.target || codexBin.command,
    },
    shell: false,
    windowsHide: false,
  });

  let shuttingDown = false;
  function stopChild(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!child || child.killed) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    }
    try {
      child.kill(signal || 'SIGTERM');
    } catch (_) {}
  }

  const forwardShutdown = (signal) => {
    stopChild(signal);
  };

  process.on('SIGINT', forwardShutdown);
  process.on('SIGTERM', forwardShutdown);
  process.on('SIGHUP', forwardShutdown);
  process.on('exit', () => stopChild('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code == null ? 1 : code);
  });
}

function printBanner() {
  log('');
  log(c('  ╔══════════════════════════════════════════════════════════╗', 'cyan'));
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c('  ___           _        _   ___             ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |  _ \\ ___  __| | _____| ||   \\ _____  __ ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |  __//   \\/   ||/ / -_) __| |) / -_) \\/ /', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |_|   \\___/\\__,_|\\_/\\___|\\__|___/\\___|\\__/ ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(`v${VERSION}  ·  Mobile Remote Control for Codex CLI`, 'dim')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c('github.com/Mikeore/Pocketdex', 'dim')}                        ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(c('  ╚══════════════════════════════════════════════════════════╝', 'cyan'));
  log('');
  log(`  ${c('One-click bootstrap starting...', 'dim')}`);
  log('');
}

function main() {
  process.chdir(ROOT_DIR);
  printBanner();
  ensureNodeVersion();
  installDependencies();
  const codexBin = runtimeCodexBin();
  ensureCodexLogin(codexBin);
  launchPocketDex(codexBin);
}

main();
