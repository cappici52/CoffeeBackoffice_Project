import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { money, mutate, useDebounced, useResource } from "../lib";
import {
  CheckField,
  Form,
  Input,
  Modal,
  Notice,
  Pager,
  QueryState,
  SearchBox,
  Select,
  Submit,
  Textarea,
  useConfirm,
  useToast,
} from "../ui";
import type { Catalog, Category, Ingredient, Product } from "../types";
type GroupDraft = {
  name: string;
  is_required: boolean;
  multi_select: boolean;
  options: {
    name: string;
    extra_price_satang: number;
    ingredient_id: string | null;
    ingredient_qty: number | null;
    replaces_ingredient_id: string | null;
  }[];
};
export default function Menu() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "products";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q);
  const resource = useResource<{ products: Product[]; total: number }>(
    "/products?page=" + page + "&q=" + encodeURIComponent(query),
  );
  const catalog = useResource<Catalog>("/catalog");
  const [editor, setEditor] = useState<Product | "new" | null>(null);
  const [category, setCategory] = useState<Category | "new" | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  function refresh() {
    resource.reload();
    catalog.reload();
  }
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setFailure("");
    try {
      await work();
      refresh();
      toast("บันทึกข้อมูลแล้ว");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={tab === "products" ? "selected" : ""}
            onClick={() => setParams({ tab: "products" })}
          >
            เมนู
          </button>
          <button
            className={tab === "categories" ? "selected" : ""}
            onClick={() => setParams({ tab: "categories" })}
          >
            หมวดหมู่
          </button>
        </div>
        <button
          className="primary"
          onClick={() =>
            tab === "products" ? setEditor("new") : setCategory("new")
          }
        >
          <Plus size={18} />
          {tab === "products" ? "เพิ่มเมนู" : "เพิ่มหมวดหมู่"}
        </button>
      </div>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {tab === "products" ? (
        <>
          <SearchBox
            value={q}
            onChange={(value) => {
              setQ(value);
              setParams({ tab, page: "1", q: value }, { replace: true });
            }}
          />
          <QueryState
            {...resource}
            retry={resource.reload}
            empty={!resource.data?.products.length}
          />
          {resource.data && (
            <div className="table-panel">
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">เมนูและราคา</caption>
                  <thead>
                    <tr>
                      <th scope="col">เมนู</th>
                      <th scope="col">หมวด</th>
                      <th scope="col">สถานี</th>
                      <th scope="col">เป้าหมาย</th>
                      <th scope="col" className="right">
                        ราคา
                      </th>
                      <th scope="col">เปิดขาย</th>
                      <th scope="col">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.products.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.name}</th>
                        <td>
                          {
                            catalog.data?.categories.find(
                              (c) => c.id === p.category_id,
                            )?.name
                          }
                        </td>
                        <td>{p.station === "bar" ? "บาร์" : "ครัว"}</td>
                        <td>{p.target_prep_seconds} วินาที</td>
                        <td className="right numeric">
                          {money(p.price_satang)}
                        </td>
                        <td>
                          <button
                            className={
                              "status-toggle " +
                              (p.is_available ? "available" : "")
                            }
                            disabled={busy}
                            aria-pressed={p.is_available}
                            onClick={() =>
                              void action(() =>
                                mutate("/products/" + p.id, "PATCH", {
                                  is_available: !p.is_available,
                                  expected_version: p.version,
                                }),
                              )
                            }
                          >
                            {p.is_available ? "เปิดขาย" : "ปิดขาย"}
                          </button>
                        </td>
                        <td>
                          <div className="row">
                            <button
                              className="ghost"
                              onClick={() => setEditor(p)}
                            >
                              แก้ไข
                            </button>
                            <button
                              className="icon danger-text"
                              aria-label={"เก็บเมนู " + p.name}
                              disabled={busy}
                              onClick={() =>
                                void (async () => {
                                  if (
                                    await confirm({
                                      title: "เก็บเมนู " + p.name + "?",
                                      description:
                                        "เมนูจะหายจากหน้าขาย ประวัติออเดอร์เดิมยังอยู่",
                                      label: "เก็บเมนู",
                                      danger: true,
                                    })
                                  )
                                    await action(() =>
                                      mutate("/products/" + p.id, "DELETE", {
                                        expected_version: p.version,
                                      }),
                                    );
                                })()
                              }
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                total={resource.data.total}
                onPage={(n) => setParams({ tab, page: String(n), q })}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <QueryState
            {...catalog}
            retry={catalog.reload}
            empty={!catalog.data?.categories.length}
          />
          <div className="table-panel">
            <div className="table-scroll">
              <table>
                <caption className="sr-only">หมวดหมู่เมนู</caption>
                <thead>
                  <tr>
                    <th scope="col">หมวดหมู่</th>
                    <th scope="col">ลำดับ</th>
                    <th scope="col">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.data?.categories
                    .slice((page - 1) * 25, page * 25)
                    .map((c) => (
                      <tr key={c.id}>
                        <th scope="row">{c.name}</th>
                        <td>{c.sort_order}</td>
                        <td>
                          <div className="row">
                            <button
                              className="ghost"
                              onClick={() => setCategory(c)}
                            >
                              แก้ไข
                            </button>
                            <button
                              className="ghost danger-text"
                              disabled={busy}
                              onClick={() =>
                                void (async () => {
                                  if (
                                    await confirm({
                                      title: "ลบหมวด " + c.name + "?",
                                      description:
                                        "ลบได้เฉพาะหมวดที่ไม่มีเมนูอ้างอิงอยู่",
                                      label: "ลบหมวดหมู่",
                                      danger: true,
                                    })
                                  )
                                    await action(() =>
                                      mutate("/categories/" + c.id, "DELETE"),
                                    );
                                })()
                              }
                            >
                              ลบ
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              total={catalog.data?.categories.length ?? 0}
              onPage={(n) => setParams({ tab, page: String(n) })}
            />
          </div>
        </>
      )}
      {editor && (
        <ProductEditor
          product={editor === "new" ? null : editor}
          categories={catalog.data?.categories ?? []}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            toast("บันทึกเมนูแล้ว");
          }}
        />
      )}
      {category && (
        <Modal
          title={category === "new" ? "เพิ่มหมวดหมู่" : "แก้ไขหมวดหมู่"}
          onClose={() => setCategory(null)}
        >
          <Form
            noValidate
            onSave={async (data) => {
              const body = {
                name: String(data.get("name")),
                sort_order: Number(data.get("sort_order")),
              };
              await mutate(
                category === "new"
                  ? "/categories"
                  : "/categories/" + category.id,
                category === "new" ? "POST" : "PATCH",
                body,
              );
              setCategory(null);
              refresh();
              toast("บันทึกหมวดหมู่แล้ว");
            }}
          >
            <Input
              label="ชื่อหมวดหมู่"
              name="name"
              required
              maxLength={120}
              defaultValue={category === "new" ? "" : category.name}
            />
            <Input
              label="ลำดับการแสดง"
              name="sort_order"
              type="number"
              required
              min={0}
              max={10000}
              defaultValue={category === "new" ? 0 : category.sort_order}
            />
            <Submit>บันทึกหมวดหมู่</Submit>
          </Form>
        </Modal>
      )}
    </>
  );
}
function ProductEditor({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<GroupDraft[]>(
    product?.option_groups.map((g) => ({
      name: g.name,
      is_required: g.is_required,
      multi_select: g.multi_select,
      options: g.options.map((o) => ({
        name: o.name,
        extra_price_satang: o.extra_price_satang,
        ingredient_id: o.ingredient_id,
        ingredient_qty:
          o.ingredient_qty === null ? null : Number(o.ingredient_qty),
        replaces_ingredient_id: o.replaces_ingredient_id,
      })),
    })) ?? [],
  );
  const ingredients = useResource<{ ingredients: Ingredient[] }>(
    "/ingredient-catalog",
  );
  function editGroup(index: number, update: Partial<GroupDraft>) {
    setGroups((gs) =>
      gs.map((g, i) => (i === index ? { ...g, ...update } : g)),
    );
  }
  function editOption(
    gi: number,
    oi: number,
    update: Partial<GroupDraft["options"][number]>,
  ) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i === gi
          ? {
              ...g,
              options: g.options.map((o, j) =>
                j === oi ? { ...o, ...update } : o,
              ),
            }
          : g,
      ),
    );
  }
  return (
    <Modal
      wide
      title={product ? "แก้ไข " + product.name : "เพิ่มเมนู"}
      onClose={onClose}
    >
      <Form
        noValidate
        onSave={async (data) => {
          if (!categories.length) throw new Error("กรุณาเพิ่มหมวดหมู่ก่อน");
          const body = {
            name: String(data.get("name")),
            category_id: String(data.get("category_id")),
            description: String(data.get("description")),
            price_satang: Math.round(Number(data.get("price")) * 100),
            image_url: String(data.get("image_url")),
            is_available: !!data.get("is_available"),
            station: String(data.get("station")),
            target_prep_seconds: Number(data.get("target_prep_seconds")),
            option_groups: groups,
            ...(product ? { expected_version: product.version } : {}),
          };
          await mutate(
            product ? "/products/" + product.id : "/products",
            product ? "PATCH" : "POST",
            body,
          );
          onSaved();
        }}
      >
        <div className="form-grid">
          <Input
            label="ชื่อเมนู"
            name="name"
            required
            maxLength={120}
            defaultValue={product?.name}
          />
          <Select
            label="หมวดหมู่"
            name="category_id"
            required
            defaultValue={product?.category_id ?? categories[0]?.id}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label="ราคา (บาท)"
            name="price"
            type="number"
            min={0}
            max={100000}
            step="0.01"
            required
            defaultValue={(product?.price_satang ?? 0) / 100}
          />
          <Select
            label="สถานี"
            name="station"
            defaultValue={product?.station ?? "bar"}
          >
            <option value="bar">บาร์</option>
            <option value="kitchen">ครัว</option>
          </Select>
          <Input
            label="เวลาเตรียมเป้าหมาย (วินาที)"
            name="target_prep_seconds"
            type="number"
            min={1}
            max={7200}
            required
            defaultValue={product?.target_prep_seconds ?? 180}
          />
          <Input
            label="ลิงก์รูปภาพ HTTPS (ไม่จำเป็น)"
            name="image_url"
            type="url"
            defaultValue={product?.image_url ?? ""}
          />
        </div>
        <Textarea
          className="resize-none"
          label="รายละเอียด"
          name="description"
          maxLength={1000}
          defaultValue={product?.description ?? ""}
        />
        <CheckField
          label="เปิดขายเมนูนี้"
          name="is_available"
          defaultChecked={product?.is_available ?? true}
        />
        <div className="section-head">
          <h3>ตัวเลือกเมนู</h3>
          <button
            type="button"
            onClick={() =>
              setGroups([
                ...groups,
                {
                  name: "",
                  is_required: false,
                  multi_select: false,
                  options: [
                    {
                      name: "",
                      extra_price_satang: 0,
                      ingredient_id: null,
                      ingredient_qty: null,
                      replaces_ingredient_id: null,
                    },
                  ],
                },
              ])
            }
          >
            เพิ่มกลุ่มตัวเลือก
          </button>
        </div>
        {groups.map((g, gi) => (
          <section className="editor-section" key={gi}>
            <div className="row between">
              <h4>กลุ่มที่ {gi + 1}</h4>
              <button
                type="button"
                className="ghost danger-text"
                onClick={() => setGroups(groups.filter((_, i) => i !== gi))}
              >
                ลบกลุ่ม
              </button>
            </div>
            <Input
              label="ชื่อกลุ่ม"
              name={"group" + gi}
              required
              maxLength={120}
              value={g.name}
              onChange={(e) => editGroup(gi, { name: e.target.value })}
            />
            <div className="row wrap">
              <CheckField
                label="จำเป็นต้องเลือก"
                checked={g.is_required}
                onChange={(e) =>
                  editGroup(gi, { is_required: e.target.checked })
                }
              />
              <CheckField
                label="เลือกหลายข้อได้"
                checked={g.multi_select}
                onChange={(e) =>
                  editGroup(gi, { multi_select: e.target.checked })
                }
              />
            </div>
            {g.options.map((o, oi) => (
              <div className="option-editor" key={oi}>
                <div className="form-grid">
                  <Input
                    label="ชื่อตัวเลือก"
                    name={`option-${gi}-${oi}`}
                    required
                    maxLength={120}
                    value={o.name}
                    onChange={(e) =>
                      editOption(gi, oi, { name: e.target.value })
                    }
                  />
                  <Input
                    label="ราคาเพิ่ม (บาท)"
                    type="number"
                    name={`extra-${gi}-${oi}`}
                    required
                    min={0}
                    max={100000}
                    step="0.01"
                    value={o.extra_price_satang / 100}
                    onChange={(e) =>
                      editOption(gi, oi, {
                        extra_price_satang: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      })
                    }
                  />
                  <Select
                    label="เพิ่ม / ทดแทนวัตถุดิบ"
                    value={o.ingredient_id ?? ""}
                    onChange={(e) =>
                      editOption(gi, oi, {
                        ingredient_id: e.target.value || null,
                        ingredient_qty: e.target.value ? 1 : null,
                        replaces_ingredient_id: null,
                      })
                    }
                  >
                    <option value="">ไม่ปรับสูตร</option>
                    {ingredients.data?.ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                  </Select>
                  {o.ingredient_id && (
                    <>
                      <Input
                        label="ปริมาณใหม่ (0 = เอาออก)"
                        name={`qty-${gi}-${oi}`}
                        type="number"
                        step="0.001"
                        min={0}
                        max={1000000}
                        required
                        value={o.ingredient_qty ?? 0}
                        onChange={(e) =>
                          editOption(gi, oi, {
                            ingredient_qty: Number(e.target.value),
                          })
                        }
                      />
                      <Select
                        label="แทนวัตถุดิบเดิม (ไม่เลือก = เพิ่ม)"
                        value={o.replaces_ingredient_id ?? ""}
                        onChange={(e) =>
                          editOption(gi, oi, {
                            replaces_ingredient_id: e.target.value || null,
                          })
                        }
                      >
                        <option value="">เพิ่มจากสูตรเดิม</option>
                        {ingredients.data?.ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </Select>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost danger-text"
                  disabled={g.options.length <= 1}
                  onClick={() =>
                    editGroup(gi, {
                      options: g.options.filter((_, j) => j !== oi),
                    })
                  }
                >
                  ลบตัวเลือก
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                editGroup(gi, {
                  options: [
                    ...g.options,
                    {
                      name: "",
                      extra_price_satang: 0,
                      ingredient_id: null,
                      ingredient_qty: null,
                      replaces_ingredient_id: null,
                    },
                  ],
                })
              }
            >
              เพิ่มตัวเลือก
            </button>
          </section>
        ))}
        <Notice>
          กำหนดสูตรวัตถุดิบในหน้า “สต็อกและสูตร” ก่อนเริ่มขายเมนูใหม่
        </Notice>
        <div className="actions">
          <Submit>บันทึกเมนู</Submit>
        </div>
      </Form>
    </Modal>
  );
}
