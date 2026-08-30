import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import nodeProcess from "node:process";
import { fileURLToPath } from "node:url";

import {
  EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH,
} from "./runner.mjs";

function fail(message) {
  nodeProcess.stderr.write(`External Attempt115 launcher failed closed: ${message}\n`);
  nodeProcess.exitCode = 1;
}

if (import.meta.main !== true) {
  fail("the fixed launcher cannot be imported");
} else if (nodeProcess.argv.length !== 2) {
  fail("the fixed launcher accepts no positional arguments");
} else {
  const launcherPath = realpathSync(fileURLToPath(import.meta.url));
  const projectRoot = realpathSync(resolve(dirname(launcherPath), "../.."));
  const runnerPath = realpathSync(resolve(projectRoot, EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH));
  const child = spawnSync(nodeProcess.execPath, [runnerPath], {
    cwd: projectRoot,
    env: {},
    stdio: "inherit",
  });
  if (child.error) {
    fail(child.error.message);
  } else if (child.signal !== null) {
    fail(`authoritative child ended by signal ${child.signal}`);
  } else {
    nodeProcess.exitCode = child.status ?? 1;
  }
}
