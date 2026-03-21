/**
 * codex-process.js
 *
 * Spawns and monitors `codex app-server`.
 * Default transport is stdio JSONL; WebSocket remains available as an
 * opt-in compatibility / debug transport.
 */

const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { normalizeTransportName } = require('./codex-protocol');

const _DEFAULT_BIN = process.platform === 'win32' ? 'codex.cmd' : 'codex';
const READY_TIMEOUT_MS = parseInt(process.env.POCKETDEX_CODEX_READY_TIMEOUT_MS || '15000', 10);
const READY_RETRY_INTERVAL_MS = 200;

function isNodeScript(filePath) {
  return typeof filePath === 'string' && /\.(?:[cm]?js)$/i.test(filePath);
}

function localCodexCli() {
  return path.resolve(__dirname, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
}

function resolveCodexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;

  const localCli = localCodexCli();
  if (fs.existsSync(localCli)) return localCli;

  const localBin = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex'
  );

  if (fs.existsSync(localBin)) return localBin;
  return _DEFAULT_BIN;
}

function formatForCmd(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForPortOpen(port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for Codex app-server on port ${port}`));
          return;
        }
        setTimeout(tryConnect, READY_RETRY_INTERVAL_MS);
      });
    };

    tryConnect();
  });
}

class CodexProcess extends EventEmitter {
  constructor(options = {}) {
    super();
    this.transport = normalizeTransportName(
      options.transport || process.env.POCKETDEX_CODEX_TRANSPORT || 'stdio'
    );
    this.port = this.transport === 'ws' ? options.port : null;
    this.proc = null;
    this._killed = false;
    this._killTimer = null;
  }

  getConnectionOptions() {
    return {
      transport: this.transport,
      port: this.port,
      proc: this.proc,
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      const args = ['app-server', '--session-source', 'pocketdex'];
      if (this.transport === 'ws') {
        args.push('--listen', `ws://127.0.0.1:${this.port}`);
      } else {
        args.push('--listen', 'stdio://');
      }

      const codexBin = resolveCodexBin();
      const spawnConfig = {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      };

      let spawnCommand = codexBin;
      let spawnArgs = args.slice();
      if (isNodeScript(codexBin)) {
        spawnCommand = process.execPath;
        spawnArgs = [codexBin].concat(spawnArgs);
      }

      console.log(`[codex] spawning (${this.transport}): ${spawnCommand} ${spawnArgs.join(' ')}`);

      if (process.platform === 'win32' && !isNodeScript(codexBin)) {
        const commandLine = [codexBin].concat(args).map(formatForCmd).join(' ');
        this.proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], spawnConfig);
      } else {
        this.proc = spawn(spawnCommand, spawnArgs, spawnConfig);
      }

      let settled = false;
      const resolveOnce = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const rejectOnce = (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const handleEarlyExit = (code, signal) => {
        rejectOnce(new Error(`codex exited early (code=${code}, signal=${signal})`));
        if (!this._killed) {
          console.log(`[codex] exited unexpectedly (code=${code}, signal=${signal})`);
          this.emit('exit', code, signal);
        }
      };

      const markReady = () => {
        if (this.proc) {
          this.proc.off('exit', handleEarlyExit);
        }
        resolveOnce();
      };

      this.proc.on('error', (err) => {
        rejectOnce(new Error(
          `Failed to spawn '${codexBin}': ${err.message}. Is Codex CLI installed? ` +
          `Set CODEX_BIN env var to the full path if needed.`
        ));
        this.emit('error', err);
      });

      this.proc.on('exit', handleEarlyExit);

      if (this.proc.stderr) {
        this.proc.stderr.on('data', (d) => {
          process.stderr.write(`[codex] ${d}`);
        });
      }

      if (this.transport === 'ws' && this.proc.stdout) {
        this.proc.stdout.on('data', (d) => {
          process.stdout.write(`[codex] ${d}`);
        });
      }

      this.proc.once('spawn', () => {
        if (this.transport === 'ws') {
          waitForPortOpen(this.port, READY_TIMEOUT_MS).then(markReady).catch(rejectOnce);
          return;
        }

        setTimeout(markReady, 50);
      });
    });
  }

  stop() {
    if (this.proc && !this._killed) {
      this._killed = true;
      const pid = this.proc.pid;
      if (process.platform === 'win32' && pid) {
        spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        this.proc.kill('SIGTERM');
      }
      if (this._killTimer) clearTimeout(this._killTimer);
      this._killTimer = setTimeout(() => {
        if (!this.proc || this.proc.killed) {
          this._killTimer = null;
          return;
        }
        if (process.platform === 'win32' && this.proc.pid) {
          spawnSync('taskkill', ['/pid', String(this.proc.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          this.proc.kill('SIGKILL');
        }
        this._killTimer = null;
      }, 3000);
      this.proc.once('exit', () => {
        if (this._killTimer) {
          clearTimeout(this._killTimer);
          this._killTimer = null;
        }
        this.proc = null;
      });
    }
  }
}

module.exports = { CodexProcess, getFreePort, resolveCodexBin };
