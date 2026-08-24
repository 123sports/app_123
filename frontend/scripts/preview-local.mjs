import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4173";
const npmCommand = "npm";
const useShell = process.platform === "win32";
const useSupabase = process.argv.includes("--supabase");

function previewEnvironment() {
  const env = {
    ...process.env,
    VITE_ENABLE_LOCAL_MODE: useSupabase ? "false" : "true",
  };

  if (!useSupabase) {
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
      "MERCADO_PAGO_ACCESS_TOKEN",
      "MERCADO_PAGO_WEBHOOK_SECRET",
    ]) {
      delete env[key];
    }
    env.PAYMENT_PROVIDER = "local";
    env.VITE_PAYMENT_PROVIDER = "local";
    env.ALLOW_LOCAL_PAYMENT_SIMULATION = "true";
  }

  return env;
}

const previewEnv = previewEnvironment();

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
  env: previewEnv,
});

console.log("");
console.log(`${useSupabase ? "Supabase" : "Mock"} preview: http://${host}:${port}/`);
console.log("Press Ctrl+C to stop.");
console.log("");

const server = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...previewEnv,
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
