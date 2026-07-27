import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "apps", "web");
const runtimeDir = join(root, ".dev-server");
const stateFile = join(runtimeDir, "state.json");
const logFile = join(runtimeDir, "vite.log");
const viteCli = join(root, "node_modules", "vite", "bin", "vite.js");
const host = "127.0.0.1";
const port = 5173;
const url = `http://${host}:${port}/`;

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function removeState() {
  rmSync(stateFile, { force: true });
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probe() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const body = await response.text();
    return {
      reachable: response.ok,
      expectedApp: response.ok && body.includes("data-boot-state"),
      status: response.status,
    };
  } catch {
    return { reachable: false, expectedApp: false, status: null };
  }
}

async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe()).expectedApp) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

async function start() {
  const current = await probe();
  if (current.expectedApp) {
    console.log(`开发服务器已运行：${url}`);
    return;
  }
  if (current.reachable) {
    throw new Error(`端口 ${port} 已被其他 HTTP 服务占用，请先释放该端口。`);
  }
  if (!existsSync(viteCli)) {
    throw new Error("未找到 Vite，请先运行 npm ci 或 npm install。");
  }

  const previous = readState();
  if (previous && isProcessRunning(previous.pid)) process.kill(previous.pid);
  removeState();
  mkdirSync(runtimeDir, { recursive: true });

  const logFd = openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [viteCli, "preview", "--host", host, "--port", String(port), "--strictPort"],
    {
      cwd: webRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  closeSync(logFd);

  writeFileSync(
    stateFile,
    `${JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), url }, null, 2)}\n`,
  );

  if (!(await waitForServer())) {
    if (isProcessRunning(child.pid)) process.kill(child.pid);
    removeState();
    throw new Error(`开发服务器未能通过健康检查，请查看 ${logFile}`);
  }
  console.log(`开发服务器已在后台启动：${url}`);
  console.log(`进程 PID：${child.pid}`);
}

async function stop() {
  const state = readState();
  if (!state || !isProcessRunning(state.pid)) {
    removeState();
    console.log("后台开发服务器未运行。");
    return;
  }
  process.kill(state.pid);
  removeState();
  console.log(`后台开发服务器已停止（PID ${state.pid}）。`);
}

async function status() {
  const state = readState();
  const result = await probe();
  if (result.expectedApp) {
    const pidText = state && isProcessRunning(state.pid) ? `，PID ${state.pid}` : "";
    console.log(`开发服务器运行正常：${url}${pidText}`);
    return;
  }
  if (result.reachable) {
    console.log(`端口 ${port} 可访问，但不是本项目页面（HTTP ${result.status}）。`);
    process.exitCode = 1;
    return;
  }
  console.log(`开发服务器未运行：${url}`);
  process.exitCode = 1;
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else if (command === "status") await status();
else throw new Error("用法：node scripts/dev-server-manager.mjs <start|stop|status>");
