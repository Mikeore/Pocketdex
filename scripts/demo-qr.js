'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const REQUIRED_NODE_MAJOR = 18;
const STEP_DELAY_MS = 320;

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[96m',
  blue: '\x1b[94m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  red: '\x1b[91m',
  white: '\x1b[97m',
};

function c(text, tone) {
  return `${COLORS[tone] || ''}${text}${COLORS.reset}`;
}

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

function section(label, text) {
  process.stdout.write(`${c(label, 'dim')}  ${text}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function bundledNpmCli() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function npmRuntime() {
  const cli = bundledNpmCli();
  if (fs.existsSync(cli)) {
    return { command: process.execPath, args: [cli] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] };
}

function ensureNodeVersion() {
  const versionText = process.versions.node || '0.0.0';
  const major = Number(versionText.split('.')[0] || '0');
  section('[1/4]', 'Node.js       ');
  if (major < REQUIRED_NODE_MAJOR) {
    log(`${c('[ TOO OLD ]', 'red')}  ${c(`v${versionText}`, 'dim')}`);
    log('');
    log(`  ${c('PocketDex demo requires Node.js 18 or newer.', 'red')}`);
    log(`  ${c('Install the latest LTS build from https://nodejs.org', 'white')}`);
    process.exit(1);
  }
  log(`${c('[ OK ]', 'green')}  ${c(`v${versionText}`, 'dim')}`);
}

function ensureQRCodeDependency() {
  section('[2/4]', 'Dependencies  ');
  const modulePath = path.join(ROOT_DIR, 'node_modules', 'qrcode', 'package.json');
  if (fs.existsSync(modulePath)) {
    log(`${c('[ OK ]', 'green')}  ${c('PocketDex + pinned Codex CLI already installed', 'dim')}`);
    return;
  }

  log(c('[ INSTALLING ]', 'yellow'));
  log('');
  log(`  ${c('Installing the QR dependency for demo mode...', 'dim')}`);
  const npm = npmRuntime();
  const result = spawnSync(npm.command, npm.args.concat(['install', '--no-save', 'qrcode']), {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env },
    shell: false,
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || !fs.existsSync(modulePath)) {
    log('');
    log(`  ${c('Failed to install the QR dependency for demo mode.', 'red')}`);
    process.exit(result.status || 1);
  }

  log('');
  log(`  ${c('✓ Demo QR dependency installed.', 'green')}`);
}

function printDemoLoginStep() {
  section('[3/4]', 'Codex login   ');
  log(`${c('[ OK ]', 'green')}  ${c('already authenticated (demo capture mode)', 'dim')}`);
}

function printBanner(version) {
  log('');
  log(c('  ╔══════════════════════════════════════════════════════════╗', 'cyan'));
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c('  ___           _        _   ___             ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |  _ \\ ___  __| | _____| ||   \\ _____  __ ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |  __//   \\/   ||/ / -_) __| |) / -_) \\/ /', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(' |_|   \\___/\\__,_|\\_/\\___|\\__|___/\\___|\\__/ ', 'blue')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c(`v${version}  ·  Mobile Remote Control for Codex CLI`, 'dim')}    ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}    ${c('github.com/Mikeore/Pocketdex', 'dim')}                        ${c('║', 'cyan')}`);
  log(`${c('  ║', 'cyan')}                                                          ${c('║', 'cyan')}`);
  log(c('  ╚══════════════════════════════════════════════════════════╝', 'cyan'));
  log('');
  log(`  ${c('One-click bootstrap starting...', 'dim')}`);
  log('');
}

function printLaunchBox() {
  log(c('────────────────────────────────────────────────────────', 'dim'));
  log('');
  log(`  ${c('📱  Scan the QR code below with your phone to connect', 'cyan')}`);
  log(`  ${c('No global Codex install needed — PocketDex uses its bundled local CLI.', 'dim')}`);
  log(`  ${c('Demo capture mode: the QR below opens your GitHub showcase link.', 'yellow')}`);
  log(`  ${c('Press Ctrl+C to stop PocketDex.', 'dim')}`);
  log('');
  log(c('────────────────────────────────────────────────────────', 'dim'));
  log('');
}

async function renderQRCode() {
  const QRCode = require('qrcode');
  const qrUrl = process.env.POCKETDEX_DEMO_QR_URL || 'https://github.com/Mikeore/PocketDex';
  const openUrl = process.env.POCKETDEX_DEMO_OPEN_URL || qrUrl;
  const qrString = await QRCode.toString(qrUrl, { type: 'terminal', small: true });

  log('\n' + '═'.repeat(60));
  log('  PocketDex is ready!');
  log('═'.repeat(60));
  log(qrString);
  log('  Scan the QR code or open:\n');
  log(`  ${openUrl}\n`);
  if (openUrl !== qrUrl) {
    log(`  ${c('Demo QR target:', 'dim')} ${qrUrl}\n`);
  }
  log('═'.repeat(60) + '\n');
}

function keepAlive() {
  const timer = setInterval(() => {}, 1 << 30);
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
    process.stdin.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) return;
      if (chunk[0] === 3) process.kill(process.pid, 'SIGINT');
    });
  }
  process.stdin.resume();
  process.on('SIGINT', () => {
    clearInterval(timer);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    log('');
    process.exit(0);
  });
}

async function main() {
  const version = readVersion();
  printBanner(version);
  ensureNodeVersion();
  await sleep(STEP_DELAY_MS);
  ensureQRCodeDependency();
  await sleep(STEP_DELAY_MS);
  printDemoLoginStep();
  await sleep(STEP_DELAY_MS);
  section('[4/4]', 'PocketDex     ');
  log(c('[ LAUNCHING ]', 'green'));
  log('');
  printLaunchBox();
  await renderQRCode();
  keepAlive();
}

main().catch((error) => {
  console.error('[pocketdex-demo] Failed to render demo QR:', error && error.message ? error.message : error);
  process.exit(1);
});
