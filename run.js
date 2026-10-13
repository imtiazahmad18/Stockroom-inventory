#!/usr/bin/env node
// run.js — starts the backend API and frontend dev server together.
//
// Usage:
//   node run.js
//
// Ctrl+C stops both — including their child processes. "npm run dev"
// itself spawns node/vite as a grandchild, so killing just the npm
// process isn't enough (it can leave the real server running and the
// port held). Each service is spawned as the leader of its own process
// group (detached: true), and shutdown kills that whole group, with a
// SIGKILL fallback if anything ignores SIGTERM.

import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, 'backend');
const FRONTEND_DIR = path.join(__dirname, 'frontend');

const IS_WINDOWS = process.platform === 'win32';
const FORCE_KILL_DELAY_MS = 3000;

// backend/db.js uses node:sqlite, which only exists from Node 22.5 on.
const REQUIRED_NODE = [22, 5];

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const [reqMajor, reqMinor] = REQUIRED_NODE;
  const ok = major > reqMajor || (major === reqMajor && minor >= reqMinor);
  if (!ok) {
    console.error(
      `\x1b[31mThe backend needs Node >= ${reqMajor}.${reqMinor} (uses node:sqlite). ` +
      `You're running ${process.versions.node}.\x1b[0m\n` +
      `If you use nvm: nvm install ${reqMajor} && nvm use ${reqMajor}`
    );
    process.exit(1);
  }
}

const NPM_CMD = IS_WINDOWS ? 'npm.cmd' : 'npm';

const SERVICES = [
  { name: 'backend', color: 36, cwd: BACKEND_DIR, url: 'http://localhost:4000' },
  { name: 'frontend', color: 35, cwd: FRONTEND_DIR, url: 'http://localhost:5173' },
];

const children = [];
let shuttingDown = false;

function tag(name, color) {
  return `\x1b[${color}m[${name}]\x1b[0m`;
}

function pipeOutput(stream, name, color, out) {
  if (!stream) return;
  createInterface({ input: stream }).on('line', (line) => {
    out.write(`${tag(name, color)} ${line}\n`);
  });
}

// Kills a child AND every process it spawned (npm -> node/vite), not just
// the immediate child. On POSIX, the child was started as its own process
// group leader (detached: true), so signaling -pid hits the whole group.
// On Windows, process groups don't work the same way, so we ask the OS to
// kill the whole tree via taskkill instead.
function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS) {
    execFile('taskkill', ['/pid', String(child.pid), '/t', signal === 'SIGKILL' ? '/f' : '']
      .filter(Boolean));
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Group might already be gone, or we raced its exit — fine either way.
  }
}

function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) killTree(child, 'SIGTERM');

  // Exit as soon as everything's actually gone, instead of always waiting
  // out the full grace period — but force-kill anything still alive after
  // it, so this script never returns control with a service still running.
  const forceKillTimer = setTimeout(() => {
    for (const child of children) killTree(child, 'SIGKILL');
    process.exit(code);
  }, FORCE_KILL_DELAY_MS);

  const pollExited = setInterval(() => {
    if (children.every((child) => !isAlive(child))) {
      clearInterval(pollExited);
      clearTimeout(forceKillTimer);
      process.exit(code);
    }
  }, 100);
}

function start({ name, color, cwd }) {
  const child = spawn(NPM_CMD, ['run', 'dev'], {
    cwd,
    env: process.env,
    detached: !IS_WINDOWS, // own process group on POSIX so we can kill the whole tree
  });
  children.push(child);

  pipeOutput(child.stdout, name, color, process.stdout);
  pipeOutput(child.stderr, name, color, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`${tag(name, color)} exited (${signal || code}) — stopping the other process.`);
    shutdown(code ?? 1);
  });

  child.on('error', (err) => {
    console.error(`${tag(name, color)} failed to start: ${err.message}`);
    shutdown(1);
  });
}

checkNodeVersion();

console.log('Starting backend and frontend…');
for (const service of SERVICES) {
  console.log(`  ${tag(service.name, service.color)} ${service.url}`);
}
console.log('Press Ctrl+C to stop both.\n');

for (const service of SERVICES) start(service);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
