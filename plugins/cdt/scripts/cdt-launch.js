#!/usr/bin/env node
/*
 * cdt-launch.js - portable launcher for the cdt MCP server.
 *
 * Picks a Chromium executable at server-start time and then execs
 * chrome-devtools-mcp via npx with stdio inherited, so the MCP
 * JSON-RPC stream (stdin/stdout) flows straight through to the harness.
 *
 * Selection order:
 *   1. $CDT_EXECUTABLE_PATH (explicit override, must exist)
 *   2. Real Google Chrome (stock upstream behavior - no extra flags)
 *   3. Microsoft Edge  (--executablePath=<path>)
 *   4. Brave            (--executablePath=<path>)
 *   5. PATH lookup      (where/which, platform dependent)
 *
 * Why not a chrome.exe shim: the CDP pipe transport needs CRT fds 3/4 set
 * up by Node/libuv's direct spawn. Any NATIVE intermediate between
 * chrome-devtools-mcp and the browser breaks the mapping (proven across
 * shim v1-v9: Edge exits 13 in ~70ms even with handles forwarded).
 * This launcher is NOT such an intermediate - it sits ABOVE
 * chrome-devtools-mcp (harness -> launcher -> npx -> browser), and the
 * browser pipes are created by chrome-devtools-mcp's own Node process
 * directly to Edge. Node -> Node stdio inherit is harmless.
 *
 * Extra CLI args after the script path are forwarded to the server, e.g.
 *   "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/cdt-launch.js", "--headless"]
 *
 * Diagnostics go to stderr only - stdout is the MCP protocol channel.
 * Zero dependencies (Node builtins only).
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pinned to the vendored upstream release. Override for testing via:
//   CDT_PACKAGE=chrome-devtools-mcp@latest
const PACKAGE = process.env.CDT_PACKAGE || 'chrome-devtools-mcp@1.9.0';

function exists(p) {
  try {
    return Boolean(p) && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// First PATH hit for a binary name, or null. Never throws.
function which(bin) {
  try {
    const probe = process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`;
    const r = spawnSync(probe, { shell: true, encoding: 'utf8', windowsHide: true });
    const line = String(r.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return line || null;
  } catch {
    return null;
  }
}

// Ordered candidate list, most-preferred first. Existence is NOT checked here.
function candidates() {
  const forced = (process.env.CDT_EXECUTABLE_PATH || '').trim();
  if (forced) return [forced];

  const list = [];
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const lad = process.env.LocalAppData || path.join(os.homedir(), 'AppData', 'Local');
    // Real Chrome first (fixed paths, then PATH) -> stock behavior.
    // Then Edge, then Brave. Any Chrome anywhere beats Edge anywhere.
    const chromeFixed = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const edgeFixed = [
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(lad, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    const braveFixed = [
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(lad, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];
    list.push(...chromeFixed);
    const pathChrome = which('chrome.exe');
    if (pathChrome && !list.includes(pathChrome)) list.push(pathChrome);
    list.push(...edgeFixed);
    const pathEdge = which('msedge.exe');
    if (pathEdge && !list.includes(pathEdge)) list.push(pathEdge);
    list.push(...braveFixed);
    const pathBrave = which('brave.exe');
    if (pathBrave && !list.includes(pathBrave)) list.push(pathBrave);
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'chromium', 'chromium-browser']) {
      const hit = which(bin);
      if (hit && !list.includes(hit)) list.push(hit);
    }
  }
  return list;
}

// True only for real Google Chrome - the one case where we launch with
// byte-identical stock args. Everything else gets an explicit path
// (upstream ignores channel when executablePath is set).
function isStockChrome(p) {
  const n = String(p).replace(/\\/g, '/');
  return (
    /(^|\/)chrome\.exe$/i.test(n) ||
    /Google Chrome\.app\/Contents\/MacOS\/Google Chrome$/.test(n) ||
    /(^|\/)google-chrome(-stable)?$/.test(n)
  );
}

function resolve() {
  const cands = candidates();
  const exe = cands.find(exists) || null;
  const serverArgs = [PACKAGE];
  if (exe && !isStockChrome(exe)) {
    serverArgs.push(`--executablePath=${exe.replace(/\\/g, '/')}`);
  }
  return { exe, serverArgs };
}

// Locate npm's npx-cli.js so we can run it directly under node with
// shell:false. Spawning the npx.cmd shim needs shell:true on Windows,
// and cmd.exe then concatenates argv with bare spaces - any arg with a
// space (e.g. --executablePath=C:/Program Files .../msedge.exe) gets
// split, and the server sees a truncated path (proven in smoke test:
// "Browser was not found at the configured executablePath (C:/Program)").
// Direct node keeps argv exact and also silences the DEP0190 warning.
function findNpxCli() {
  const cands = [];
  try {
    cands.push(
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
    );
  } catch {
    /* ignore */
  }
  if (process.env.APPDATA) {
    cands.push(
      path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npx-cli.js')
    );
  }
  return cands.find(exists) || null;
}

// Quote one argv element for cmd.exe /d /s /c concatenation.
function quoteWinArg(a) {
  if (!/[\s\t\n\v"<>|&()^%!`]/.test(a)) return a;
  return '"' + String(a).replace(/(\\*)"/g, '$1$1\\"') + '"';
}

// Spawn npx with argv preserved exactly on every platform.
function spawnNpx(args) {
  const stdioOpts = { stdio: 'inherit', windowsHide: false };
  if (process.platform === 'win32') {
    const cli = findNpxCli();
    if (cli) {
      console.error(`[cdt-launch] npx via: ${cli}`);
      return spawn(process.execPath, [cli, ...args], { ...stdioOpts, shell: false });
    }
    // Fallback: pre-quote, since shell:true joins with bare spaces.
    const line = ['npx', ...args.map(quoteWinArg)].join(' ');
    return spawn(line, { ...stdioOpts, shell: true });
  }
  return spawn('npx', args, { ...stdioOpts, shell: false });
}

function main() {
  const fwd = process.argv.slice(2).filter((a) => a !== '--dry-run' && a !== '--print-args');
  const wantDryRun = process.argv.slice(2).some((a) => a === '--dry-run' || a === '--print-args');

  const { exe, serverArgs } = resolve();

  if (wantDryRun) {
    console.log(JSON.stringify({ package: PACKAGE, executable: exe, args: [...serverArgs, ...fwd], platform: process.platform }));
    process.exit(exe ? 0 : 1);
    return;
  }

  if (!exe) {
    console.error(
      '[cdt-launch] No Chrome/Edge/Brave executable found.\n' +
        '  Install Google Chrome (preferred), or set CDT_EXECUTABLE_PATH to a\n' +
        '  Chromium executable, e.g. "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".'
    );
    process.exit(1);
    return;
  }

  console.error(`[cdt-launch] browser: ${exe}`);
  const child = spawnNpx([...serverArgs, ...fwd]);
  child.on('error', (err) => {
    console.error(`[cdt-launch] failed to spawn npx: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(1);
      }
      return;
    }
    process.exit(typeof code === 'number' ? code : 1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { candidates, resolve, isStockChrome, PACKAGE };
