import { expect, test } from "vitest";
import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  selectLanAddress,
  replacePublicOrigin,
  prepareNetwork,
  requestedIp,
} from "../scripts/prepare-network.mjs";

const entry = (address, internal = false) => ({
  address,
  internal,
  family: "IPv4",
});
test("hotspot IPv4 is selected while loopback, IPv6 and virtual adapters are ignored", () => {
  expect(
    selectLanAddress({
      "Wi-Fi": [entry("10.75.121.79")],
      Loopback: [entry("127.0.0.1", true)],
      "vEthernet (WSL)": [entry("172.24.16.1")],
      Ethernet: [{ address: "fe80::1", family: "IPv6", internal: false }],
    }),
  ).toBe("10.75.121.79");
});
test("disconnected and ambiguous networks require correction instead of publishing a guessed QR", () => {
  expect(() => selectLanAddress({ Ethernet: [entry("169.254.1.5")] })).toThrow(
    "ไม่พบ",
  );
  expect(() =>
    selectLanAddress({
      "Wi-Fi": [entry("10.1.0.2")],
      Ethernet: [entry("192.168.1.2")],
    }),
  ).toThrow("--ip");
});
test("an explicit override must be an assigned local IPv4 and CLI arguments are checked", () => {
  const interfaces = {
    "Wi-Fi": [entry("10.1.0.2")],
    Ethernet: [entry("192.168.1.2")],
  };
  expect(selectLanAddress(interfaces, "10.1.0.2")).toBe("10.1.0.2");
  for (const invalid of ["8.8.8.8", "10.1.0.99", "10.1.0.2/path", "::1"])
    expect(() => selectLanAddress(interfaces, invalid)).toThrow();
  expect(requestedIp(["--ip", "10.1.0.2"])).toBe("10.1.0.2");
  expect(() => requestedIp(["--ip"])).toThrow();
});
test("changing QR origin preserves credentials, comments, staff origin and CRLF formatting", () => {
  const source =
    "# PUBLIC_ORIGIN=example\r\nAPP_ORIGIN=http://localhost:3001\r\nDATABASE_URL=private-value\r\nPUBLIC_ORIGIN=http://192.168.1.2:3001\r\n";
  const expected = source.replace(
    "PUBLIC_ORIGIN=http://192.168.1.2:3001",
    "PUBLIC_ORIGIN=http://10.1.0.2:3001",
  );
  expect(replacePublicOrigin(source, "http://10.1.0.2:3001")).toBe(expected);
  expect(replacePublicOrigin(expected, "http://10.1.0.2:3001")).toBe(expected);
});
test("origin is appended when absent and all active duplicate definitions are updated", () => {
  expect(
    replacePublicOrigin(
      "APP_ORIGIN=http://localhost:3001",
      "http://10.1.0.2:3001",
    ),
  ).toBe(
    "APP_ORIGIN=http://localhost:3001\nPUBLIC_ORIGIN=http://10.1.0.2:3001\n",
  );
  expect(
    replacePublicOrigin(
      "PUBLIC_ORIGIN=old\nexport PUBLIC_ORIGIN=older\n",
      "http://10.1.0.2:3001",
    ),
  ).toBe(
    "PUBLIC_ORIGIN=http://10.1.0.2:3001\nPUBLIC_ORIGIN=http://10.1.0.2:3001\n",
  );
});
test("prepare writes only a temporary config and refuses production before changing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coffee-network-"));
  const file = join(directory, ".env");
  const savedOrigin = process.env.PUBLIC_ORIGIN;
  try {
    await writeFile(
      file,
      "APP_ORIGIN=http://localhost:3001\nDATABASE_URL=untouched\n",
    );
    const options = {
      interfaces: { "Wi-Fi": [entry("10.1.0.2")] },
      envFile: file,
      port: 3001,
      nodeEnv: "development",
    };
    await expect(
      prepareNetwork({ ...options, nodeEnv: "production" }),
    ).rejects.toThrow("production");
    expect(await readFile(file, "utf8")).not.toContain("PUBLIC_ORIGIN");
    await expect(prepareNetwork({ ...options, port: 70000 })).rejects.toThrow(
      "PORT",
    );
    expect(await prepareNetwork(options)).toBe("http://10.1.0.2:3001");
    expect(await readFile(file, "utf8")).toBe(
      "APP_ORIGIN=http://localhost:3001\nDATABASE_URL=untouched\nPUBLIC_ORIGIN=http://10.1.0.2:3001\n",
    );
  } finally {
    if (savedOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = savedOrigin;
    await rm(file);
    // Only this freshly generated, now empty directory is removed (no recursion).
    await rmdir(directory);
  }
});
