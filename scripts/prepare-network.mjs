import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const privateIPv4 = (address) => {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
};

export function selectLanAddress(interfaces, requested) {
  const local = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter(
        (e) =>
          !e.internal &&
          (e.family === "IPv4" || e.family === 4) &&
          privateIPv4(e.address),
      )
      .map((e) => ({ name, address: e.address })),
  );
  if (requested) {
    if (!isIPv4(requested) || !local.some((e) => e.address === requested))
      throw new Error(
        "IP ที่ระบุต้องเป็น IPv4 ภายในที่คอมเครื่องนี้กำลังใช้อยู่",
      );
    return requested;
  }
  const candidates = local.filter(
    (e) =>
      !/vpn|tailscale|zerotier|virtual|vethernet|wsl|docker|loopback|\btun\d|\butun\d|\btap\b/i.test(
        e.name,
      ),
  );
  const addresses = [...new Set(candidates.map((e) => e.address))];
  if (addresses.length === 1) return addresses[0];
  if (!addresses.length)
    throw new Error(
      "ไม่พบ IPv4 ของ Wi-Fi/LAN กรุณาเชื่อมฮอตสปอตหรือ Wi-Fi ก่อน",
    );
  throw new Error(
    "พบหลายเครือข่าย กรุณาเลือกด้วย --ip <IP>: " +
      candidates.map((e) => `${e.name} ${e.address}`).join(", "),
  );
}

export function replacePublicOrigin(source, origin) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let found = false;
  const lines = source.split(/\r?\n/).map((line) => {
    if (/^\s*(?:export\s+)?PUBLIC_ORIGIN\s*=/.test(line)) {
      found = true;
      return "PUBLIC_ORIGIN=" + origin;
    }
    return line;
  });
  if (!found) {
    if (lines.at(-1) === "") lines.pop();
    lines.push("PUBLIC_ORIGIN=" + origin, "");
  }
  return lines.join(newline);
}

export function requestedIp(args) {
  if (!args.length) return undefined;
  if (args.length !== 2 || args[0] !== "--ip" || !args[1])
    throw new Error("ใช้ --ip <IPv4 ของคอม> หรือไม่ระบุเพื่อเลือกอัตโนมัติ");
  return args[1];
}

export async function prepareNetwork({
  ip,
  interfaces = networkInterfaces(),
  envFile = resolve(".env"),
  port = process.env.PORT ?? 3001,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  if (nodeEnv === "production")
    throw new Error(
      "คำสั่ง LAN ใช้กับเครื่อง local เท่านั้น ไม่แก้ production URL",
    );
  if (
    !Number.isInteger(Number(port)) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("PORT ไม่ถูกต้อง");
  const address = selectLanAddress(interfaces, ip);
  const origin = `http://${address}:${Number(port)}`;
  const previous = await readFile(envFile, "utf8");
  const next = replacePublicOrigin(previous, origin);
  if (next !== previous) {
    const temporary = envFile + ".network-" + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, next, { flag: "wx", mode: 0o600 });
      await rename(temporary, envFile);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  process.env.PUBLIC_ORIGIN = origin;
  console.log(
    `ลิงก์ลูกค้า/QR: ${origin}\nถ้า IP เปลี่ยน ให้โหลดหน้าโต๊ะ / QR ใหม่และใช้ QR รอบนี้ มือถือทุกเครื่องต้องอยู่ Wi-Fi/ฮอตสปอตเดียวกัน`,
  );
  return origin;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await import("dotenv/config");
    await prepareNetwork({ ip: requestedIp(process.argv.slice(2)) });
    console.log(
      "ตั้งค่าแล้ว: หาก API เปิดอยู่ให้หยุดและเปิดใหม่เพื่อใช้ลิงก์นี้",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "ตั้งค่าเครือข่ายไม่สำเร็จ",
    );
    process.exitCode = 1;
  }
}
