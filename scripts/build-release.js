'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const PACKAGE_LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const VERSION = PACKAGE_JSON.version || '0.0.0';

const COMMON_EXCLUDED_NAMES = new Set([
  '.git',
  'dist',
  'node_modules',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
]);

// Relative paths (from project root) to remove after copying, per mode.
// Use forward slashes; matched against path.relative(ROOT_DIR, fullPath).
const COMMON_EXCLUDED_SUBPATHS = new Set([
  'docs/superpowers', // internal AI planning docs — not for public consumption
]);

const MODES = {
  release: {
    folderName: `PocketDex_v${VERSION}_release`,
    description: `GitHub Releases bundle for PocketDex v${VERSION}`,
    extraExcludedNames: new Set(['.github', '.gitignore']),
    extraExcludedSubpaths: new Set(),
    installDependencies: true,
    writeInstallStamp: true,
    finalMessage: 'Upload the ZIP file to GitHub Releases for the easiest end-user install path.',
  },
  repo: {
    folderName: `PocketDex_v${VERSION}_repo`,
    description: `repository snapshot ZIP for PocketDex v${VERSION}`,
    extraExcludedNames: new Set(),
    extraExcludedSubpaths: new Set(),
    installDependencies: false,
    writeInstallStamp: false,
    finalMessage: 'This ZIP is a clean source snapshot without bundled node_modules.',
  },
};

function parseMode(argv) {
  const modeArg = argv.find((entry) => entry === '--release' || entry === '--repo' || entry.startsWith('--mode='));
  if (!modeArg) return 'release';
  if (modeArg === '--release') return 'release';
  if (modeArg === '--repo') return 'repo';
  const value = modeArg.slice('--mode='.length).trim();
  if (value === 'release' || value === 'repo') return value;
  throw new Error(`Unknown build mode: ${value}`);
}

const MODE = parseMode(process.argv.slice(2));
const CONFIG = MODES[MODE];
const STAGE_DIR = path.join(DIST_DIR, CONFIG.folderName);
const ZIP_PATH = path.join(DIST_DIR, `${CONFIG.folderName}.zip`);

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function lockHash() {
  const sourcePath = fs.existsSync(PACKAGE_LOCK_PATH) ? PACKAGE_LOCK_PATH : PACKAGE_JSON_PATH;
  const data = fs.readFileSync(sourcePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function bundledNpmCli() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function npmRuntime() {
  const cli = bundledNpmCli();
  if (fs.existsSync(cli)) {
    return { command: process.execPath, argsPrefix: [cli] };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    stdio: options.stdio || 'inherit',
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
}

function shouldExcludeName(name) {
  return COMMON_EXCLUDED_NAMES.has(name) || CONFIG.extraExcludedNames.has(name);
}

function shouldExcludeSubpath(relPath) {
  // Normalise to forward-slash for cross-platform matching
  const normalised = relPath.replace(/\\/g, '/');
  for (const excluded of [...COMMON_EXCLUDED_SUBPATHS, ...CONFIG.extraExcludedSubpaths]) {
    if (normalised === excluded || normalised.startsWith(excluded + '/')) return true;
  }
  return false;
}

function copyProjectSkeleton() {
  ensureDir(STAGE_DIR);
  for (const entry of fs.readdirSync(ROOT_DIR, { withFileTypes: true })) {
    if (shouldExcludeName(entry.name)) continue;
    const sourcePath = path.join(ROOT_DIR, entry.name);
    const targetPath = path.join(STAGE_DIR, entry.name);
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function pruneExcludedSubpaths() {
  const allExcluded = [...COMMON_EXCLUDED_SUBPATHS, ...CONFIG.extraExcludedSubpaths];
  if (allExcluded.length === 0) return;
  for (const subpath of allExcluded) {
    const fullPath = path.join(STAGE_DIR, ...subpath.split('/'));
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      log(`  Removed: ${subpath}`);
    }
  }
}

function installProductionDependencies() {
  const npm = npmRuntime();
  log('Installing production dependencies into release bundle...');
  run(npm.command, npm.argsPrefix.concat(['ci', '--omit=dev']), { cwd: STAGE_DIR });
}

function writeInstallStamp() {
  const stampDir = path.join(STAGE_DIR, 'node_modules', '.cache', 'pocketdex');
  const stampPath = path.join(stampDir, 'install-state.json');
  ensureDir(stampDir);
  fs.writeFileSync(stampPath, JSON.stringify({
    version: VERSION,
    lockHash: lockHash(),
    installedAt: new Date().toISOString(),
  }, null, 2));
}

function createZipArchive() {
  if (process.platform === 'win32') {
    const escapedStageDir = STAGE_DIR.replace(/'/g, "''");
    const escapedZipPath = ZIP_PATH.replace(/'/g, "''");
    const script = [
      '$ErrorActionPreference = "Stop"',
      `if (Test-Path -LiteralPath '${escapedZipPath}') { Remove-Item -LiteralPath '${escapedZipPath}' -Force }`,
      `Compress-Archive -LiteralPath '${escapedStageDir}' -DestinationPath '${escapedZipPath}' -Force`,
    ].join('; ');

    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    return;
  }

  try {
    run('zip', ['-qr', ZIP_PATH, CONFIG.folderName], { cwd: DIST_DIR });
  } catch (_) {
    run('tar', ['-a', '-cf', ZIP_PATH, CONFIG.folderName], { cwd: DIST_DIR });
  }
}

function main() {
  log('');
  log(`Preparing ${CONFIG.description}...`);
  removeIfExists(STAGE_DIR);
  removeIfExists(ZIP_PATH);
  ensureDir(DIST_DIR);

  log('Copying project files...');
  copyProjectSkeleton();

  log('Pruning internal-only paths...');
  pruneExcludedSubpaths();

  if (CONFIG.installDependencies) {
    installProductionDependencies();
  } else {
    log('Skipping dependency install for repository snapshot mode...');
  }

  if (CONFIG.writeInstallStamp) {
    writeInstallStamp();
  }

  log('Creating ZIP archive...');
  createZipArchive();

  log('');
  log(`Output folder: ${STAGE_DIR}`);
  log(`Output ZIP:    ${ZIP_PATH}`);
  log('');
  log(CONFIG.finalMessage);
}

main();
