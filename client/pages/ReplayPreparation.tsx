import { useState } from "react";
import { Input, Select } from "../ui";
import { number, money } from "../lib";
import { demoIngredients, demoRecipes, demoPreparation } from "../replay-demo";

export default function ReplayPreparation({ rows, from, horizon }: {
  rows: { date: string; product_id: string; product_name: string; predicted_qty: number }[];
  from: string; horizon: number;
}) {
  const products = rows.filter((p,i) => rows.findIndex(r => r.product_id === p.product_id) === i);
  const [days, setDays] = useState(1);
  const [mapping, setMapping] = useState(() => products.map(p => {
    const recipe = p.product_name.toLowerCase();
    return { product_id: p.product_id, recipe: demoRecipes[recipe] ? recipe : "", price: demoRecipes[recipe]?.price ?? 0 };
  }));
  const [stocks, setStocks] = useState<Record<string, number>>(() => Object.fromEntries(demoIngredients.map(i => [i.id, i.stock])));
  const plan = demoPreparation(rows, from, days, mapping, stocks);
  return <details className="section-details">
    <summary>แผนเตรียมวัตถุดิบ · สูตร ราคา และสต็อกสมมติ</summary>
    <p className="caption muted">สถานการณ์สาธิต ไม่ใช่สูตรของร้านต้นทาง และไม่มีการเปลี่ยนสต็อกร้าน · จำนวนพยากรณ์ × สูตรต่อหน่วย</p>
    <Select label="ช่วงเตรียมของ" value={days} onChange={e => setDays(Number(e.target.value))}>
      {[1,7,30].filter(d => d <= horizon).map(d => <option key={d} value={d}>{d} วัน{d === 30 ? " · ความต้องการรวม ไม่ใช่คำสั่งซื้อของสดครั้งเดียว" : ""}</option>)}
    </Select>
    <details className="section-details"><summary>แก้สมมติฐานสูตร ราคา และสต็อก</summary>
      {products.map(p => {
        const line = mapping.find(m => m.product_id === p.product_id)!;
        return <div className="form-grid" key={p.product_id}>
          <Select label={`สูตรสมมติ · ${p.product_name}`} value={line.recipe} onChange={e => setMapping(all => all.map(m => m.product_id === p.product_id ? { ...m, recipe: e.target.value, price: demoRecipes[e.target.value]?.price ?? 0 } : m))}>
            <option value="">ไม่จับคู่ · ไม่รวมคำนวณ</option>
            {Object.entries(demoRecipes).map(([id,r]) => <option key={id} value={id}>{r.label} · {Object.entries(r.ingredients).map(([id,q]) => `${demoIngredients.find(i => i.id === id)?.name} ${q}`).join(", ")}</option>)}
          </Select>
          <Input label={`ราคาสมมติ (บาท) · ${p.product_name}`} type="number" min="0" max="100000" step="0.01" value={line.price} onChange={e => setMapping(all => all.map(m => m.product_id === p.product_id ? { ...m, price: Math.min(100000, Math.max(0, Number(e.target.value))) } : m))} />
        </div>;
      })}
      <div className="form-grid">{demoIngredients.map(i => <Input key={i.id} label={`สต็อกสมมติ · ${i.name} (${i.unit})`} type="number" min="0" max="1000000" value={stocks[i.id]} onChange={e => setStocks(all => ({ ...all, [i.id]: Math.min(1000000, Math.max(0, Number(e.target.value))) }))} />)}</div>
    </details>
    <p>รายได้ประมาณการภายใต้ราคาสมมติ {money(plan.revenue * 100)} · รวมเฉพาะเมนูที่จับคู่ {number(plan.mappedUnits)} หน่วย</p>
    {!!plan.unmapped.length && <p role="status">ไม่รวม {plan.unmapped.length} เมนูที่ยังไม่จับคู่สูตร</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="แผนวัตถุดิบสมมติ"><table>
      <caption>ความต้องการ {days} วันจากผลพยากรณ์ · ส่วนขาด = ต้องใช้ − สต็อกสมมติ (ต่ำสุด 0)</caption>
      <thead><tr>{["วัตถุดิบ", "ต้องใช้", "สต็อกสมมติ", "ส่วนขาด"].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead>
      <tbody>{plan.ingredients.map(i => <tr key={i.id}><th scope="row">{i.name} ({i.unit})</th><td>{number(i.required)}</td><td>{number(i.stock)}</td><td>{number(i.shortage)}</td></tr>)}</tbody>
    </table></div>
    <p className="caption muted">ยังไม่รวมตัวเลือกเมนู ของเสีย อายุสินค้า และเวลาส่งของ · ไม่ใช่คำสั่งซื้ออัตโนมัติ</p>
  </details>;
}
