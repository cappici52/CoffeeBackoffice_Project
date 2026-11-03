import { spawnSync } from "node:child_process";

export function stopSimulationService(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  // Windows venv launchers may have a child Python interpreter. Stop only this
  // process tree, never a name-wide Python/Node kill or an unrelated service.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else child.kill();
}
