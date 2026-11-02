import { useState } from "react";
import { money } from "../lib";
import { Form, Input, Modal, Submit, Textarea } from "../ui";
import type { CartLine as Line } from "../types";
import { MenuPhoto } from "./MenuPhoto";

export function ItemEditor({
  line,
  onSave,
  onClose,
  submitLabel = "เพิ่ม / บันทึกเมนู",
}: {
  line: Line;
  onSave: (line: Line) => void;
  onClose: () => void;
  submitLabel?: string;
}) {
  const [selected, setSelected] = useState(line.option_ids);
  return (
    <Modal title={line.product.name} onClose={onClose}>
      <Form
        noValidate
        guard={false}
        onSave={async (data) => {
          for (const g of line.product.option_groups)
            if (
              g.is_required &&
              !g.options.some((o) => selected.includes(o.id))
            )
              throw new Error("กรุณาเลือก " + g.name);
          onSave({
            ...line,
            qty: Number(data.get("qty")),
            note: String(data.get("note")),
            option_ids: selected,
          });
        }}
      >
        <div className="menu-photo-preview">
          <MenuPhoto src={line.product.image_url} />
        </div>
        {line.product.description && (
          <p className="muted">{line.product.description}</p>
        )}
        {line.product.option_groups.map((g) => (
          <fieldset key={g.id} className="option-group">
            <legend>
              {g.name}
              {g.is_required ? " · จำเป็น" : ""}
            </legend>
            {g.options.map((o) => (
              <label className="option-row" key={o.id}>
                <input
                  name={"group-" + g.id}
                  type={g.multi_select ? "checkbox" : "radio"}
                  checked={selected.includes(o.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      g.multi_select
                        ? e.target.checked
                          ? [...ids, o.id]
                          : ids.filter((id) => id !== o.id)
                        : [
                            ...ids.filter(
                              (id) => !g.options.some((item) => item.id === id),
                            ),
                            o.id,
                          ],
                    )
                  }
                />
                <span>{o.name}</span>
                <span className="muted">
                  {o.extra_price_satang > 0
                    ? "+" + money(o.extra_price_satang)
                    : "ไม่เพิ่มราคา"}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <Input
          label="จำนวน"
          name="qty"
          type="number"
          min={1}
          max={99}
          required
          defaultValue={line.qty}
        />
        <Textarea
          className="resize-none"
          label="หมายเหตุสำหรับเมนูนี้"
          name="note"
          maxLength={1000}
          defaultValue={line.note}
          rows={2}
        />
        <div className="actions">
          <button type="button" onClick={onClose}>
            ย้อนกลับ
          </button>
          <Submit>{submitLabel}</Submit>
        </div>
      </Form>
    </Modal>
  );
}
