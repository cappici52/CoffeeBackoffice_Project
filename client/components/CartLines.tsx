import { Minus, Plus } from "lucide-react";
import type { CartLine } from "../types";
import { money } from "../lib";
import { linePrice } from "../menu";
export function CartLines({
  lines,
  locked,
  onChange,
  onEdit,
}: {
  lines: CartLine[];
  locked: boolean;
  onChange: (lines: CartLine[]) => void;
  onEdit: (line: CartLine) => void;
}) {
  return (
    <div className="cart-lines">
      {!lines.length && (
        <div className="empty">
          <p>ยังไม่มีเมนูในออเดอร์</p>
          <span className="caption">เลือกเมนูเพื่อเริ่มสั่ง</span>
        </div>
      )}
      {lines.map((line) => (
        <div className="cart-line" key={line.key}>
          <div className="row between">
            <strong>{line.product.name}</strong>
            <span className="numeric">{money(linePrice(line) * line.qty)}</span>
          </div>
          <button
            className="text-button"
            type="button"
            disabled={locked}
            onClick={() => onEdit(line)}
          >
            {line.product.option_groups
              .flatMap((g) => g.options)
              .filter((o) => line.option_ids.includes(o.id))
              .map((o) => o.name)
              .join(" / ") || "เพิ่มหมายเหตุ"}
            {line.note && " · " + line.note}
          </button>
          <div className="row between">
            <button
              type="button"
              className="ghost danger-text"
              disabled={locked}
              onClick={() => onChange(lines.filter((i) => i.key !== line.key))}
            >
              นำออก
            </button>
            <div className="quantity">
              <button
                type="button"
                aria-label={"ลดจำนวน " + line.product.name}
                disabled={locked || line.qty <= 1}
                onClick={() =>
                  onChange(
                    lines.map((i) =>
                      i.key === line.key ? { ...i, qty: i.qty - 1 } : i,
                    ),
                  )
                }
              >
                <Minus size={16} />
              </button>
              <span>{line.qty}</span>
              <button
                type="button"
                aria-label={"เพิ่มจำนวน " + line.product.name}
                disabled={locked || line.qty >= 99}
                onClick={() =>
                  onChange(
                    lines.map((i) =>
                      i.key === line.key ? { ...i, qty: i.qty + 1 } : i,
                    ),
                  )
                }
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
