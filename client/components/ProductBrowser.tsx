import { useState } from "react";
import type { MenuCatalog, MenuProduct } from "../types";
import { money } from "../lib";
import { QueryState, SearchBox } from "../ui";
import { MenuPhoto } from "./MenuPhoto";

export function ProductBrowser({
  catalog,
  loading,
  error,
  reload,
  locked,
  onChoose,
}: {
  catalog: MenuCatalog | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  locked: boolean;
  onChoose: (product: MenuProduct) => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(24);
  const filtered =
    catalog?.products.filter(
      (p) =>
        (category === "all" || p.category_id === category) &&
        p.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
    ) ?? [];
  return (
    <section className="catalog-panel">
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(value) => {
            setQ(value);
            setLimit(24);
          }}
        />
        <button className="ghost" onClick={reload}>
          โหลดเมนูใหม่
        </button>
      </div>
      <div className="tabs" aria-label="หมวดเมนู">
        <button
          className={category === "all" ? "selected" : ""}
          onClick={() => {
            setCategory("all");
            setLimit(24);
          }}
        >
          ทั้งหมด
        </button>
        {catalog?.categories.map((c) => (
          <button
            key={c.id}
            className={category === c.id ? "selected" : ""}
            onClick={() => {
              setCategory(c.id);
              setLimit(24);
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <QueryState loading={loading} error={error} retry={reload} />
      <div className="product-grid">
        {filtered.slice(0, limit).map((p) => (
          <button
            key={p.id}
            className="product-tile"
            disabled={!p.is_available || locked}
            onClick={() => onChoose(p)}
          >
            <MenuPhoto src={p.image_url} />
            <strong>{p.name}</strong>
            <span className="product-price">
              {p.is_available ? money(p.price_satang) : "ปิดขายชั่วคราว"}
            </span>
          </button>
        ))}
      </div>
      {catalog && !filtered.length && (
        <div className="empty">
          {q ? "ไม่พบเมนูที่ค้นหา" : "ยังไม่มีเมนูที่เปิดขายในหมวดนี้"}
        </div>
      )}
      {filtered.length > limit && (
        <button className="load-more" onClick={() => setLimit((n) => n + 24)}>
          แสดงเมนูเพิ่มเติม
        </button>
      )}
    </section>
  );
}
