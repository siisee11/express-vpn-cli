#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageJson = require("../package.json");

const DEFAULT_MACOS_CTL =
  "/Applications/ExpressVPN.app/Contents/MacOS/expressvpnctl";

function usage() {
  return `evpn ${packageJson.version}

Unofficial CLI wrapper for the local ExpressVPN desktop client.

Usage:
  evpn login
  evpn status
  evpn connect [region]
  evpn disconnect
  evpn regions [filter]
  evpn background <enable|disable>

Commands:
  login                  Prompt for an activation code and log in.
  login --file <path>    Log in with a file accepted by expressvpnctl.
  logout                 Log out this computer.
  status                 Show the current VPN status.
  connect [region]       Connect to smart location or an exact region slug.
  disconnect             Disconnect from the VPN.
  regions [filter]       List available region slugs, optionally filtered.
  get <type>             Read a value from the ExpressVPN daemon.
  set <type> <value>     Set a daemon value.
  background <mode>      Enable or disable background activation.
  monitor <type>         Monitor daemon value changes.
  speedtest [...args]    Run ExpressVPN speedtest.
  where                  Print the expressvpnctl path in use.
  raw [...args]          Pass arguments directly to expressvpnctl.

Options:
  --ctl <path>           Use a specific expressvpnctl binary.
  -h, --help             Show this help.
  -v, --version          Show the evpn package version.

Examples:
  evpn login
  evpn regions japan
  evpn connect japan-tokyo
  evpn background enable
`;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(command) {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  return "";
}

function parseGlobalArgs(argv) {
  const rest = [];
  let ctl = process.env.EXPRESSVPNCTL || "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--ctl") {
      const value = argv[i + 1];
      if (!value) {
        fail("Missing value for --ctl.");
      }
      ctl = value;
      i += 1;
      continue;
    }

    rest.push(arg);
  }

  return { ctl, argv: rest };
}

function findController(explicitPath) {
  if (explicitPath) {
    if (!isExecutable(explicitPath)) {
      fail(`expressvpnctl is not executable: ${explicitPath}`);
    }
    return explicitPath;
  }

  if (process.platform === "darwin" && isExecutable(DEFAULT_MACOS_CTL)) {
    return DEFAULT_MACOS_CTL;
  }

  const fromPath = which("expressvpnctl");
  if (fromPath && isExecutable(fromPath)) {
    return fromPath;
  }

  fail(
    [
      "Could not find expressvpnctl.",
      "",
      "Install the ExpressVPN desktop app, or pass the binary explicitly:",
      "  evpn --ctl /path/to/expressvpnctl status",
      "",
      "On macOS the expected path is:",
      `  ${DEFAULT_MACOS_CTL}`,
    ].join("\n")
  );
}

function runCtl(ctl, args, options = {}) {
  const result = spawnSync(ctl, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
  });

  if (result.error) {
    throw result.error;
  }

  if (options.capture) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.status !== 0) {
      const error = new Error(`expressvpnctl exited with status ${result.status || 1}.`);
      error.status = result.status || 1;
      throw error;
    }

    return result.stdout || "";
  }

  return result.status || 0;
}

function exitCtl(ctl, args) {
  process.exit(runCtl(ctl, args));
}

function commandOption(args, longName, shortName) {
  const longIndex = args.indexOf(longName);
  const shortIndex = shortName ? args.indexOf(shortName) : -1;
  const index = longIndex >= 0 ? longIndex : shortIndex;

  if (index < 0) {
    return { value: "", rest: args };
  }

  const value = args[index + 1];
  if (!value) {
    fail(`Missing value for ${args[index]}.`);
  }

  const rest = args.slice(0, index).concat(args.slice(index + 2));
  return { value, rest };
}

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        data += chunk;
      });
      stdin.on("end", () => {
        resolve(data.trim());
      });
      stdin.on("error", reject);
      return;
    }

    let input = "";
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }
      stdin.pause();
    }

    function onData(chunk) {
      const value = String(chunk);

      if (value === "\u0003") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Cancelled."));
        return;
      }

      if (value === "\r" || value === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(input.trim());
        return;
      }

      if (value === "\u007f" || value === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      for (const char of value) {
        if (char >= " ") {
          input += char;
          stdout.write("*");
        }
      }
    }

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function login(ctl, args) {
  const fileOption = commandOption(args, "--file", "-f");
  if (fileOption.value) {
    process.exit(runCtl(ctl, ["login", fileOption.value]));
    return;
  }

  if (fileOption.rest.length > 0) {
    fail("Unexpected login arguments. Use `evpn login` or `evpn login --file <path>`.");
  }

  let activationCode = "";
  try {
    activationCode = await readSecret("ExpressVPN activation code: ");
  } catch (error) {
    fail(error.message);
  }

  if (!activationCode) {
    fail("Activation code cannot be empty.");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evpn-"));
  const tmpFile = path.join(tmpDir, "login.txt");

  try {
    fs.writeFileSync(tmpFile, `${activationCode}\n`, { mode: 0o600 });
    runCtl(ctl, ["login", tmpFile]);
  } finally {
    fs.rmSync(tmpFile, { force: true });
    fs.rmdirSync(tmpDir);
  }
}

function listRegions(ctl, args) {
  const wantsJson = args.includes("--json");
  const filter = args.filter((arg) => arg !== "--json").join(" ").trim().toLowerCase();
  const output = runCtl(ctl, ["get", "regions"], { capture: true });
  let regions = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (filter) {
    regions = regions.filter((region) => region.toLowerCase().includes(filter));
  }

  if (wantsJson) {
    console.log(JSON.stringify(regions, null, 2));
    return;
  }

  console.log(regions.join("\n"));
}

function connect(ctl, args) {
  const region = args.join(" ").trim();
  if (region) {
    process.exit(runCtl(ctl, ["connect", region]));
    return;
  }

  process.exit(runCtl(ctl, ["connect"]));
}

async function main() {
  const parsed = parseGlobalArgs(process.argv.slice(2));
  const args = parsed.argv;

  if (args.length === 0 || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    console.log(usage());
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    console.log(packageJson.version);
    return;
  }

  const ctl = findController(parsed.ctl);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "login":
      await login(ctl, commandArgs);
      break;
    case "logout":
      exitCtl(ctl, ["logout"]);
      break;
    case "status":
      exitCtl(ctl, ["status"]);
      break;
    case "connect":
      connect(ctl, commandArgs);
      break;
    case "disconnect":
      exitCtl(ctl, ["disconnect"]);
      break;
    case "regions":
      listRegions(ctl, commandArgs);
      break;
    case "get":
    case "set":
    case "monitor":
    case "speedtest":
    case "background":
      exitCtl(ctl, [command, ...commandArgs]);
      break;
    case "where":
      console.log(ctl);
      break;
    case "raw":
      exitCtl(ctl, commandArgs);
      break;
    default:
      fail(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error) => {
  if (error.status) {
    process.exit(error.status);
  }
  fail(error.stack || error.message);
});
