import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = process.env.PORT || '31031';
const output = resolve(root, 'dist');
const work = resolve(root, 'deploy/.work');
const next = resolve(work, 'dist-next');
const previous = resolve(work, 'dist-previous');
const watchedFiles = new Set([
  '.env.local', 'index.html', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.build.json', 'vite.config.ts',
]);
const watchers = [];
const expectedExits = new WeakSet();
let server;
let building = false;
let queued = false;
let timer;
let stopping = false;

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun(code === 0 && !signal));
  });
}

async function checkServerSyntax() {
  for (const name of await readdir(resolve(root, 'server'))) {
    if (name.endsWith('.mjs') && !await run(process.execPath, ['--check', resolve(root, 'server', name)]))
      return false;
  }
  return true;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  expectedExits.add(child);
  await new Promise(done => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
    child.once('exit', () => { clearTimeout(timeout); done(); });
    child.kill('SIGTERM');
  });
  if (server === child) server = undefined;
}

function startServer() {
  if (stopping || !existsSync(output)) return;
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port, HOST: '127.0.0.1' },
  });
  const child = server;
  child.once('error', error => console.error('App start failed:', error.message));
  child.once('exit', (code, signal) => {
    if (server !== child || stopping || expectedExits.has(child)) return;
    server = undefined;
    console.error(`App exited (${code ?? signal}); retrying in 5 seconds.`);
    setTimeout(() => { if (!stopping && !building && !server) startServer(); }, 5_000);
  });
}

async function publish() {
  if (building || stopping) { queued = true; return; }
  building = true;
  console.log('Building WeEat hackathon app...');
  try {
    await rm(next, { recursive: true, force: true });
    const built = await run('npm', ['run', 'build', '--', '--outDir', next]);
    if (!built || !await checkServerSyntax()) {
      console.error('Build failed; keeping the last published app.');
      if (!server) startServer();
      return;
    }
    await rm(previous, { recursive: true, force: true });
    if (existsSync(output)) await rename(output, previous);
    try { await rename(next, output); }
    catch (error) {
      if (existsSync(previous)) await rename(previous, output);
      throw error;
    }
    await stopServer();
    startServer();
    console.log('Published WeEat hackathon app.');
  } catch (error) {
    console.error('Publish failed; keeping the last published app:', error);
    if (!server) startServer();
  } finally {
    building = false;
    if (queued && !stopping) { queued = false; schedule(); }
  }
}

function schedule() {
  if (stopping) return;
  clearTimeout(timer);
  timer = setTimeout(() => void publish(), 1_000);
}

function watchSources() {
  for (const directory of ['src', 'server', 'public']) {
    watchers.push(watch(resolve(root, directory), { recursive: true }, () => schedule()));
  }
  watchers.push(watch(root, (_, filename) => {
    if (filename && watchedFiles.has(String(filename))) schedule();
  }));
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  await stopServer();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await mkdir(work, { recursive: true });
if (!existsSync(output) && existsSync(previous)) await rename(previous, output);
watchSources();
await publish();
