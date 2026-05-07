import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const apiPort = Number(process.env.PORT || 3000);
const webPort = Number(process.env.VITE_PORT || 5173);

const commonEnv = { ...process.env, QUIET_DEV: "true" };

const api = spawn(process.execPath, ["server.js"], {
  cwd: rootDir,
  env: commonEnv,
  stdio: "ignore",
});

const web = spawn(process.execPath, [viteBin, "--host", "0.0.0.0", "--clearScreen", "false", "--logLevel", "silent"], {
  cwd: rootDir,
  env: commonEnv,
  stdio: "ignore",
});

const stopChildren = (signal = "SIGTERM") => {
  if (!api.killed) api.kill(signal);
  if (!web.killed) web.kill(signal);
};

api.on("exit", (code) => {
  if (code !== 0) process.exitCode = code || 1;
  stopChildren();
});

web.on("exit", (code) => {
  if (code !== 0) process.exitCode = code || 1;
  stopChildren();
});

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  process.exit(0);
});

console.log(`Web: http://localhost:${webPort}`);
console.log(`API: http://localhost:${apiPort}`);
