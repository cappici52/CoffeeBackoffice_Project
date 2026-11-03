import {
  Form,
  Input,
  Select,
  Submit,
  Textarea,
  Notice,
  QueryState,
  useToast,
} from "../ui";
import { addDays, dateText, mutate, today, useResource } from "../lib";

export type ForecastDataset = {
  cohort: string;
  window_days: number;
  excluded: {
    unclosed: number;
    mixed_source: number;
    flagged: number;
    other_cohort: number;
  };
  products: { id: string; name: string }[];
  readiness: {
    product_id: string;
    observations: number;
    latest_date: string | null;
    ready: boolean;
    model_ready?: boolean;
    limited_history?: boolean;
  }[];
  flags: {
    date: string;
    product_id: string;
    product_name: string;
    kind: string;
    note: string;
  }[];
};
export const cohortLabel = (cohort: string) =>
  cohort === "genuine"
    ? "ยอดปกติที่ไม่ติดป้ายจำลอง"
    : cohort === "simulation"
      ? "ยอดจำลองผ่านแอป"
      : cohort === "demo"
        ? "ข้อมูลตัวอย่าง"
        : cohort === "legacy"
          ? "ระบบเดิม"
          : "เลือกอัตโนมัติ";
export default function ForecastData({
  cohort,
  mode,
  product,
  onCohort,
  onSaved,
}: {
  cohort: string;
  mode: string;
  product: string;
  onCohort: (value: string) => void;
  onSaved: () => void;
}) {
  const resource = useResource<ForecastDataset>(
    `/forecasts/data?cohort=${cohort}&data_mode=${mode}${product ? "&product_id=" + product : ""}`,
  );
  const data = resource.data,
    toast = useToast();
  return (
    <details className="section-details">
      <summary>ชุดข้อมูลและคุณภาพประวัติ</summary>
      <Select
        label="ชุดข้อมูลฝึก"
        value={cohort}
        onChange={(e) => onCohort(e.target.value)}
      >
        <option value="auto">
          อัตโนมัติ: ใช้ยอดปกติก่อน หากไม่พร้อมจึงใช้ชุดจำลอง
        </option>
        <option value="genuine">ออเดอร์ที่ไม่ติดป้ายจำลองเท่านั้น</option>
        <option value="simulation">ยอดจำลองผ่านแอปเท่านั้น</option>
        {mode === "mixed" && (
          <option value="demo">ข้อมูลตัวอย่างเท่านั้น</option>
        )}
      </Select>
      <QueryState {...resource} retry={resource.reload} />
      {data && (
        <>
          <p className="caption muted">
            ชุดที่เลือกใช้: {cohortLabel(data.cohort)} · ย้อนหลังสูงสุด{" "}
            {data.window_days} วัน · ไม่ผสมยอดจริงกับยอดจำลอง
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="เลื่อนตารางคุณภาพข้อมูลฝึก"
          >
            <table>
              <caption>ความพร้อมของชุดข้อมูลที่เลือก</caption>
              <thead>
                <tr>
                  <th scope="col">เมนู</th>
                  <th scope="col">วันใช้ได้</th>
                  <th scope="col">ล่าสุด</th>
                  <th scope="col">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {data.readiness.map((r) => (
                  <tr key={r.product_id}>
                    <th scope="row">
                      {data.products.find((p) => p.id === r.product_id)?.name}
                    </th>
                    <td>{r.observations}</td>
                    <td>
                      {r.latest_date ? dateText(r.latest_date) : "ไม่มีข้อมูล"}
                    </td>
                    <td>
                      {r.ready
                        ? r.model_ready
                          ? "พร้อมเลือกโมเดล"
                          : "ประวัติน้อย · ใช้พื้นฐาน"
                        : "ไม่มีข้อมูลล่าสุดสำหรับพยากรณ์"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption muted">
            กันออก: ยังไม่ปิดวัน {data.excluded.unclosed} · ที่มาปนกัน{" "}
            {data.excluded.mixed_source} · ระบุปัญหา {data.excluded.flagged}{" "}
            คู่เมนู–วัน วันที่ไม่ทราบยอดไม่ถูกเติมเป็นศูนย์
          </p>
          <details>
            <summary>บันทึกวันที่ร้านหยุด สินค้าหมด หรือข้อมูลไม่ครบ</summary>
            <p className="caption muted">
              บันทึกเหตุการณ์ที่เกิดขึ้นจริงเพื่อกันวันนั้นออกจากการฝึกและวัดผล
              ยอดขายเดิมยังอยู่ครบ หากระบุร้านหยุดในวันอนาคต
              เมนูนั้นจะพยากรณ์เป็น 0 ในรอบที่สร้างใหม่
            </p>
            <Form
              noValidate
              onSave={async (fd) => {
                await mutate("/forecasts/quality", "PUT", {
                  date: String(fd.get("date")),
                  product_id: String(fd.get("product_id")),
                  kind: String(fd.get("kind")),
                  note: String(fd.get("note")),
                });
                resource.reload();
                onSaved();
                toast("บันทึกคุณภาพข้อมูลแล้ว");
              }}
            >
              <Input
                label="วันที่เกิดเหตุการณ์"
                name="date"
                type="date"
                defaultValue={addDays(today(), -1)}
                max={addDays(today(), 30)}
                required
              />
              <Select
                key={product + data.products.map((p) => p.id).join("")}
                label="เมนูที่ได้รับผล"
                name="product_id"
                defaultValue={product || data.products[0]?.id}
                required
              >
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select label="คุณภาพของวัน" name="kind" defaultValue="stockout">
                <option value="stockout">
                  สินค้าหมด / ขายได้ไม่เต็มความต้องการ
                </option>
                <option value="closed">ร้านหยุด / ไม่เปิดขายเมนูนี้</option>
                <option value="incomplete">บันทึกข้อมูลไม่ครบ</option>
                <option value="outlier">ยอดผิดปกติ</option>
                <option value="unknown">ยังไม่ทราบคุณภาพ</option>
                <option value="normal">กลับมาใช้วันตามปกติ</option>
              </Select>
              <Textarea
                className="resize-none"
                label="เหตุผลหรือรายละเอียด"
                name="note"
                required
                maxLength={1000}
              />
              <Submit>บันทึกคุณภาพข้อมูล</Submit>
            </Form>
            <ul>
              {data.flags.slice(0, 20).map((f) => (
                <li key={f.date + f.product_id}>
                  {dateText(f.date)} · {f.product_name} ·{" "}
                  {f.kind === "stockout"
                    ? "สินค้าหมด"
                    : f.kind === "closed"
                      ? "หยุดขาย"
                      : f.kind === "incomplete"
                        ? "ข้อมูลไม่ครบ"
                        : f.kind === "outlier"
                          ? "ยอดผิดปกติ"
                          : f.kind === "unknown"
                            ? "ยังไม่ทราบคุณภาพ"
                            : "ปกติ"}{" "}
                  · {f.note}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </details>
  );
}
