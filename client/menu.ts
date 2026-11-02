import type { CartLine, MenuProduct } from "./types";
// getRandomValues works on LAN HTTP too; randomUUID requires a secure context.
export function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const linePrice = (line: CartLine) =>
  line.product.price_satang +
  line.product.option_groups
    .flatMap((g) => g.options)
    .filter((o) => line.option_ids.includes(o.id))
    .reduce((s, o) => s + o.extra_price_satang, 0);
export function makeCartLine(product: MenuProduct): CartLine {
  return {
    key: randomId(),
    product,
    qty: 1,
    option_ids: product.option_groups
      .filter((g) => g.is_required)
      .map((g) => g.options[0]!.id),
    note: "",
  };
}
export function tableLabel(name: string) {
  return name.startsWith("โต๊ะ") ? name : "โต๊ะ " + name;
}
