import { useState } from "react";
import { useAuth } from "../App";
import { dateText, mutate, roleLabels, useResource } from "../lib";
import { Form, Notice, Pager, QueryState, Secret, Submit } from "../ui";
interface Audit {
  id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  created_at: string;
  details: object;
}
const actions: Record<string, string> = {
  "user.login": "เข้าสู่ระบบ",
  "user.created": "สร้างบัญชี",
  "user.updated": "แก้ไขบัญชีและสิทธิ์",
  "user.bootstrapped": "สร้างเจ้าของร้านเริ่มต้น",
  "user.password_changed": "เปลี่ยนรหัสผ่าน",
  "category.created": "เพิ่มหมวดหมู่",
  "category.updated": "แก้หมวดหมู่",
  "category.deleted": "ลบหมวดหมู่",
  "product.created": "เพิ่มเมนู",
  "product.updated": "แก้ไขเมนูและราคา",
  "product.archived": "เก็บเมนู",
  "recipe.updated": "แก้ไขสูตร",
  "ingredient.created": "เพิ่มวัตถุดิบ",
  "ingredient.updated": "แก้ไขวัตถุดิบ",
  "ingredient.archived": "เก็บวัตถุดิบ",
  "stock.receipt": "รับของเข้า",
  "stock.waste": "บันทึกของเสีย",
  "order.paid": "รับชำระ",
  "order.completed": "ส่งมอบออเดอร์",
  "order.cancelled": "ยกเลิกออเดอร์",
  "day.closed": "ปิดวันขาย",
  "forecast.generated": "สร้างผลพยากรณ์",
  "demo.seeded": "สร้างข้อมูลตัวอย่าง",
};
const entities: Record<string, string> = {
  user: "ผู้ใช้งาน",
  category: "หมวดหมู่",
  product: "เมนู / สูตร",
  ingredient: "วัตถุดิบ",
  order: "ออเดอร์",
  closing: "ปิดวันขาย",
  forecast: "พยากรณ์",
  demo: "ข้อมูลตัวอย่าง",
};
export default function Account() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const resource = useResource<{ logs: Audit[]; total: number }>(
    user.role === "owner" ? "/audit-logs?page=" + page : null,
  );
  return (
    <>
      <section className="account-panel">
        <h2>{user.name}</h2>
        <p className="muted">
          {user.email} · {roleLabels[user.role]}
        </p>
        <h3>เปลี่ยนรหัสผ่าน</h3>
        <Form
          noValidate
          onSave={async (data) => {
            if (data.get("new_password") !== data.get("confirm_password"))
              throw new Error("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
            await mutate("/auth/change-password", "POST", {
              current_password: String(data.get("current_password")),
              new_password: String(data.get("new_password")),
            });
            window.dispatchEvent(new Event("session-expired"));
          }}
        >
          <Secret
            label="รหัสผ่านปัจจุบัน"
            name="current_password"
            required
            autoComplete="current-password"
          />
          <Secret
            label="รหัสผ่านใหม่"
            name="new_password"
            required
            minLength={12}
            autoComplete="new-password"
          />
          <Secret
            label="ยืนยันรหัสผ่านใหม่"
            name="confirm_password"
            required
            minLength={12}
            autoComplete="new-password"
          />
          <Notice>
            อย่างน้อย 12 ตัวอักษร ไม่เกิน 72 UTF-8 bytes
            เมื่อเปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์
          </Notice>
          <Submit>เปลี่ยนรหัสผ่าน</Submit>
        </Form>
      </section>
      {user.role === "owner" && (
        <>
          <h2 className="section-title">ประวัติการจัดการระบบ</h2>
          <QueryState {...resource} retry={resource.reload} />
          {resource.data && (
            <div className="table-panel">
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">Audit logs</caption>
                  <thead>
                    <tr>
                      <th scope="col">เวลา</th>
                      <th scope="col">ผู้ใช้งาน</th>
                      <th scope="col">การกระทำ</th>
                      <th scope="col">ข้อมูล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.logs.map((log) => (
                      <tr key={log.id}>
                        <td>{dateText(log.created_at, true)}</td>
                        <td>{log.actor_name}</td>
                        <th scope="row">
                          {actions[log.action] ?? "จัดการข้อมูล"}
                        </th>
                        <td>{entities[log.entity_type] ?? "ข้อมูลระบบ"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} total={resource.data.total} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </>
  );
}
