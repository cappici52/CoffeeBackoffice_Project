import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from '../App';
import {
  dateText,
  money,
  mutate,
  number,
  useDebounced,
  useResource,
} from "../lib";
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
import type {
  Catalog,
  Ingredient,
  Recipe,
  RecipeIngredient,
  Step,
} from "../types";
interface Movement {
  id: string;
  name: string;
  unit: string;
  type: string;
  qty: string;
  balance_after: string;
  reason: string;
  created_by_name: string;
  created_at: string;
}
const movementLabels: Record<string, string> = {
  receipt: "รับเข้า",
  waste: "ของเสีย",
  sale: "ขาย",
  return: "คืนสต็อก",
};
export default function Inventory() {
  const owner=useAuth().user.role==='owner';
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "ingredients";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const low = params.get("low") === "true";
  const query = useDebounced(q);
  const resource = useResource<{ ingredients: Ingredient[]; total: number }>(
    tab === "ingredients"
      ? `/ingredients?page=${page}&q=${encodeURIComponent(query)}&low=${low}`
      : null,
  );
  const all = useResource<{ ingredients: Ingredient[] }>("/ingredient-catalog");
  const movements = useResource<{ movements: Movement[]; total: number }>(
    tab === "movements" ? "/stock-movements?page=" + page : null,
  );
  const [editor, setEditor] = useState<Ingredient | "new" | null>(null);
  const [move, setMove] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  function refresh() {
    resource.reload();
    movements.reload();
    all.reload();
  }
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["ingredients", "วัตถุดิบ"],
            ["recipes", "สูตรการทำ"],
            ["movements", "เคลื่อนไหวสต็อก"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? "selected" : ""}
              onClick={() => setParams({ tab: value! })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => setMove(true)}>รับเข้า / ของเสีย</button>
          {tab === "ingredients" && owner && (
            <button className="primary" onClick={() => setEditor("new")}>
              <Plus size={18} />
              เพิ่มวัตถุดิบ
            </button>
          )}
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {tab === "ingredients" && (
        <>
          <div className="toolbar">
            <SearchBox
              value={q}
              onChange={(value) => {
                setQ(value);
                setParams(
                  { tab, q: value, page: "1", low: String(low) },
                  { replace: true },
                );
              }}
            />
            <CheckField
              label="เฉพาะสต็อกต่ำ"
              checked={low}
              onChange={(e) =>
                setParams({ tab, q, page: "1", low: String(e.target.checked) })
              }
            />
          </div>
          <QueryState
            {...resource}
            retry={resource.reload}
            empty={!resource.data?.ingredients.length}
          />
          {resource.data && (
            <div className="table-panel">
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">สต็อกวัตถุดิบ</caption>
                  <thead>
                    <tr>
                      <th scope="col">วัตถุดิบ</th>
                      <th scope="col" className="right">
                        คงเหลือ
                      </th>
                      <th scope="col" className="right">
                        จุดสั่งซื้อ
                      </th>
                      <th scope="col" className="right">
                        ต้นทุน / หน่วย
                      </th>
                      <th scope="col">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.ingredients.map((i) => (
                      <tr key={i.id}>
                        <th scope="row">
                          {i.name}
                          {Number(i.current_stock) <=
                            Number(i.reorder_point) && (
                            <span className="low-stock">สต็อกต่ำ</span>
                          )}
                        </th>
                        <td className="right numeric">
                          {number(i.current_stock, 3)} {i.unit}
                        </td>
                        <td className="right numeric">
                          {number(i.reorder_point, 3)} {i.unit}
                        </td>
                        <td className="right numeric">
                          {money(i.cost_satang)}
                        </td>
                        <td>
                          <div className="row">
                            <button
                              className="ghost"
                              onClick={() => setEditor(i)}
                            >
                              แก้ไข
                            </button>
                            <button
                              disabled={busy||!owner}
                              className="ghost danger-text"
                              onClick={() =>
                                void (async () => {
                                  if (
                                    !(await confirm({
                                      title: "ลบวัตถุดิบ " + i.name + "?",
                                      description:
                                        "ลบได้เฉพาะยอดเป็นศูนย์และไม่มีสูตรหรือตัวเลือกอ้างอิง ประวัติสต็อกจะยังอยู่",
                                      label: "ลบวัตถุดิบ",
                                      danger: true,
                                    }))
                                  )
                                    return;
                                  setBusy(true);
                                  setError("");
                                  try {
                                    await mutate(
                                      "/ingredients/" + i.id,
                                      "DELETE",
                                    );
                                    refresh();
                                    toast("เก็บวัตถุดิบแล้ว");
                                  } catch (e) {
                                    setError(
                                      e instanceof Error
                                        ? e.message
                                        : "ลบไม่สำเร็จ",
                                    );
                                  } finally {
                                    setBusy(false);
                                  }
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
                total={resource.data.total}
                onPage={(n) =>
                  setParams({ tab, q, low: String(low), page: String(n) })
                }
              />
            </div>
          )}
        </>
      )}
      {tab === "recipes" && (
        <RecipeEditor ingredients={all.data?.ingredients ?? []} />
      )}{" "}
      {tab === "movements" && (
        <>
          <QueryState
            {...movements}
            retry={movements.reload}
            empty={!movements.data?.movements.length}
          />
          {movements.data && (
            <div className="table-panel">
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    ประวัติการเคลื่อนไหวสต็อก
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">เวลา</th>
                      <th scope="col">วัตถุดิบ</th>
                      <th scope="col">ประเภท</th>
                      <th scope="col">จำนวน</th>
                      <th scope="col">คงเหลือหลังรายการ</th>
                      <th scope="col">เหตุผล / ผู้บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.data.movements.map((m) => (
                      <tr key={m.id}>
                        <td>{dateText(m.created_at, true)}</td>
                        <th scope="row">{m.name}</th>
                        <td>{movementLabels[m.type]}</td>
                        <td className="numeric">
                          {Number(m.qty) > 0 ? "+" : ""}
                          {number(m.qty, 3)} {m.unit}
                        </td>
                        <td className="numeric">
                          {number(m.balance_after, 3)}
                        </td>
                        <td>
                          {m.reason}
                          <small className="muted block">
                            {m.created_by_name}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                total={movements.data.total}
                onPage={(n) => setParams({ tab, page: String(n) })}
              />
            </div>
          )}
        </>
      )}
      {editor && (
        <Modal
          title={editor === "new" ? "เพิ่มวัตถุดิบ" : "แก้ไข " + editor.name}
          onClose={() => setEditor(null)}
        >
          <Form
            noValidate
            onSave={async (data) => {
              const body = {
                name: String(data.get("name")),
                reorder_point: Number(data.get("reorder_point")),
                cost_satang: Number(data.get("cost")) * 100,
                ...(editor === "new"
                  ? { unit: String(data.get("unit")) }
                  : { expected_version: editor.version }),
              };
              await mutate(
                editor === "new" ? "/ingredients" : "/ingredients/" + editor.id,
                editor === "new" ? "POST" : "PATCH",
                body,
              );
              setEditor(null);
              refresh();
              toast("บันทึกวัตถุดิบแล้ว");
            }}
          >
            <Input
              label="ชื่อวัตถุดิบ"
              name="name"
              readOnly={!owner}
              required
              maxLength={120}
              defaultValue={editor === "new" ? "" : editor.name}
            />
            {editor === "new" ? (
              <Select label="หน่วย" name="unit">
                {["g", "ml", "ชิ้น", "ถุง", "ขวด"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            ) : (
              <p>หน่วย: {editor.unit} (ใช้หน่วยเดียวกับสูตร)</p>
            )}
            <Input
              label="จุดสั่งซื้อ"
              name="reorder_point"
              type="number"
              step="0.001"
              min={0}
              max={100000000}
              required
              defaultValue={editor === "new" ? 0 : editor.reorder_point}
            />
            <Input
              label="ต้นทุนต่อ 1 หน่วย (บาท)"
              name="cost"
              readOnly={!owner}
              type="number"
              step="0.000001"
              min={0}
              max={1000000}
              required
              defaultValue={
                editor === "new" ? 0 : Number(editor.cost_satang) / 100
              }
            />
            <Submit>บันทึกวัตถุดิบ</Submit>
          </Form>
        </Modal>
      )}
      {move && (
        <Modal title="บันทึกรับเข้า / ของเสีย" onClose={() => setMove(false)}>
          <Form
            noValidate
            onSave={async (data) => {
              await mutate("/stock-movements", "POST", {
                ingredient_id: String(data.get("ingredient_id")),
                type: String(data.get("type")),
                qty: Number(data.get("qty")),
                reason: String(data.get("reason")),
              });
              setMove(false);
              refresh();
              toast("บันทึกสต็อกแล้ว");
            }}
          >
            <Select label="วัตถุดิบ" name="ingredient_id" required>
              <option value="">เลือกวัตถุดิบ</option>
              {all.data?.ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </Select>
            <Select label="ประเภทรายการ" name="type">
              <option value="receipt">รับของเข้า</option>
              <option value="waste">ของเสีย / เสียหาย</option>
            </Select>
            <Input
              label="จำนวน (หน่วยตามวัตถุดิบ)"
              name="qty"
              type="number"
              min={0.001}
              max={1000000}
              step="0.001"
              required
            />
            <Input label="เหตุผล" name="reason" required maxLength={120} />
            <Submit>บันทึกรายการ</Submit>
          </Form>
        </Modal>
      )}
    </>
  );
}
function RecipeEditor({ ingredients }: { ingredients: Ingredient[] }) {
  const catalog = useResource<Catalog>("/catalog");
  const [product, setProduct] = useState("");
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();
  const resource = useResource<{ recipe: Recipe | null }>(
    product ? "/recipes/" + product : null,
  );
  return (
    <div className="recipe-workspace">
      <Select
        label="เลือกเมนูเพื่อจัดการสูตร"
        value={product}
        onChange={(e) => {
          const next = e.target.value;
          void (async () => {
            if (
              dirty &&
              !(await confirm({
                title: "เปลี่ยนเมนูโดยไม่บันทึก?",
                description: "การแก้ไขสูตรนี้จะหายไป",
                label: "เปลี่ยนเมนู",
                danger: true,
              }))
            )
              return;
            setProduct(next);
            setDirty(false);
          })();
        }}
      >
        <option value="">เลือกเมนู</option>
        {catalog.data?.products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {!product && (
        <div className="empty">เลือกเมนูเพื่อกำหนดวัตถุดิบและขั้นตอน</div>
      )}
      {product && <QueryState {...resource} retry={resource.reload} />}
      {resource.data && (
        <RecipeForm
          key={product + "-" + (resource.data.recipe?.version ?? 0)}
          product={product}
          recipe={resource.data.recipe}
          ingredients={ingredients}
          onSaved={resource.reload}
          onDirtyChange={setDirty}
        />
      )}
    </div>
  );
}
function RecipeForm({
  product,
  recipe,
  ingredients,
  onSaved,
  onDirtyChange,
}: {
  product: string;
  recipe: Recipe | null;
  ingredients: Ingredient[];
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const canEdit=useAuth().user.role==='owner';
  const [items, setItems] = useState<RecipeIngredient[]>(
    recipe?.ingredients ?? [],
  );
  const [steps, setSteps] = useState<Step[]>(recipe?.steps ?? []);
  const toast = useToast();
  const cost = items.reduce(
    (sum, item) =>
      sum +
      Number(
        ingredients.find((i) => i.id === item.ingredient_id)?.cost_satang ?? 0,
      ) *
        Number(item.qty),
    0,
  );
  return (
    <Form
      noValidate
      onDirtyChange={onDirtyChange}
      onSave={async () => {
        await mutate("/recipes/" + product, "PUT", {
          expected_version: recipe?.version ?? 0,
          ingredients: items.map((i) => ({
            ingredient_id: i.ingredient_id,
            qty: Number(i.qty),
          })),
          steps: steps.map((s) => ({
            instruction: s.instruction,
            image_url: s.image_url,
            timer_seconds: s.timer_seconds,
          })),
        });
        onSaved();
        toast("บันทึกสูตรแล้ว");
      }}
    >
      <fieldset className="recipe-fields" disabled={!canEdit}><legend className="sr-only">สูตรกลาง</legend><div className="section-head">
        <h2>วัตถุดิบต่อ 1 หน่วยขาย</h2>
        <button
          type="button"
          onClick={() => setItems([...items, { ingredient_id: "", qty: 1 }])}
        >
          เพิ่มวัตถุดิบ
        </button>
      </div>
      {items.map((item, index) => (
        <div className="recipe-row" key={index}>
          <Select
            label="วัตถุดิบ"
            name={"ingredient" + index}
            required
            value={item.ingredient_id}
            onChange={(e) =>
              setItems(
                items.map((i, n) =>
                  n === index ? { ...i, ingredient_id: e.target.value } : i,
                ),
              )
            }
          >
            <option value="">เลือกวัตถุดิบ</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
          </Select>
          <Input
            label="ปริมาณ"
            name={"qty" + index}
            type="number"
            min={0.001}
            max={1000000}
            step="0.001"
            required
            value={item.qty}
            onChange={(e) =>
              setItems(
                items.map((i, n) =>
                  n === index ? { ...i, qty: e.target.value } : i,
                ),
              )
            }
          />
          <button
            type="button"
            className="ghost danger-text"
            onClick={() => setItems(items.filter((_, n) => n !== index))}
          >
            นำออก
          </button>
        </div>
      ))}
      {!items.length && (
        <Notice>
          ยังไม่มีวัตถุดิบ สูตรว่างจะไม่ตัดสต็อก กรุณาตรวจให้ถูกต้องก่อนขาย
        </Notice>
      )}
      <p className="muted">
        ต้นทุนสูตรพื้นฐานต่อหน่วย: <strong>{money(cost)}</strong>
      </p>
      <div className="section-head">
        <h2>ขั้นตอนการทำ</h2>
        <button
          type="button"
          onClick={() =>
            setSteps([
              ...steps,
              { instruction: "", image_url: "", timer_seconds: 0 },
            ])
          }
        >
          เพิ่มขั้นตอน
        </button>
      </div>
      {steps.map((step, index) => (
        <section className="editor-section" key={index}>
          <div className="row between">
            <h3>ขั้นตอน {index + 1}</h3>
            <button
              type="button"
              className="ghost danger-text"
              onClick={() => setSteps(steps.filter((_, n) => n !== index))}
            >
              ลบขั้นตอน
            </button>
          </div>
          <Textarea
            className="resize-none"
            label="คำแนะนำ"
            name={"step" + index}
            maxLength={1000}
            required
            value={step.instruction}
            onChange={(e) =>
              setSteps(
                steps.map((s, n) =>
                  n === index ? { ...s, instruction: e.target.value } : s,
                ),
              )
            }
          />
          <div className="form-grid">
            <Input
              label="เวลาขั้นตอน (วินาที)"
              name={"timer" + index}
              type="number"
              min={0}
              max={7200}
              required
              value={step.timer_seconds}
              onChange={(e) =>
                setSteps(
                  steps.map((s, n) =>
                    n === index
                      ? { ...s, timer_seconds: Number(e.target.value) }
                      : s,
                  ),
                )
              }
            />
            <Input
              label="รูปภาพ HTTPS (ไม่จำเป็น)"
              name={"image" + index}
              type="url"
              value={step.image_url}
              onChange={(e) =>
                setSteps(
                  steps.map((s, n) =>
                    n === index ? { ...s, image_url: e.target.value } : s,
                  ),
                )
              }
            />
          </div>
        </section>
      ))}
      <Notice>
        การแก้สูตรมีผลกับออเดอร์ใหม่เท่านั้น ออเดอร์ที่สร้างแล้วเก็บสูตร ณ
        เวลาสั่งไว้
      </Notice>
      </fieldset>{canEdit?<Submit>บันทึกสูตร</Submit>:<Notice>สูตรกลางแก้ไขได้โดยเจ้าของร้านเท่านั้น</Notice>}
    </Form>
  );
}
