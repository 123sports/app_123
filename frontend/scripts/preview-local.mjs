import { spawn } from "node:child_process";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4173";
const npmCommand = "npm";
const useShell = process.platform === "win32";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

await run(npmCommand, ["run", "build"], {
  shell: useShell,
  env: {
    ...process.env,
    VITE_ENABLE_LOCAL_MODE: "true",
  },
});

console.log("");
console.log(`Local preview: http://${host}:${port}/`);
console.log("Press Ctrl+C to stop.");
console.log("");

const server = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    HOST: host,
    PORT: port,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.on("exit", (code, signal) => {
  if (signal) return;
  process.exit(code ?? 0);
});
