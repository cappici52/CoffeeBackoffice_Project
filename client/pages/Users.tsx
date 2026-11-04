import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../App";
import { mutate, roleLabels, useResource } from "../lib";
import {
  CheckField,
  Form,
  Input,
  Modal,
  Notice,
  Pager,
  QueryState,
  Secret,
  Select,
  Submit,
  useConfirm,
  useToast,
} from "../ui";
import type { Role, User } from "../types";
import { useBranch } from '../branches';
export default function UserAdmin() {
  const branch=useBranch();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const resource = useResource<{ users: User[]; total: number }>(
    "/users?page=" + page,
  );
  const [editor, setEditor] = useState<User | "new" | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const roles: Role[] =
    user.role === "owner"
      ? ["owner", "manager", "cashier", "kitchen"]
      : ["cashier", "kitchen"];
  return (
    <>
      <div className="toolbar">
        <p className="muted">
          {user.role === "manager"
            ? "จัดการบัญชีแคชเชียร์และครัว / บาร์"
            : "จัดการบัญชีและสิทธิ์การใช้งาน"}
        </p>
        <button className="primary" disabled={branch.id==='all'} title={branch.id==='all'?'เลือกสาขาก่อนเพิ่มผู้ใช้งาน':undefined} onClick={() => setEditor("new")}>
          <Plus size={18} />
          เพิ่มผู้ใช้งาน
        </button>
      </div>
      <QueryState
        {...resource}
        retry={resource.reload}
        empty={!resource.data?.users.length}
      />
      {resource.data && (
        <div className="table-panel">
          <div className="table-scroll">
            <table>
              <caption className="sr-only">บัญชีผู้ใช้งาน</caption>
              <thead>
                <tr>
                  <th scope="col">ชื่อ</th>
                  <th scope="col">อีเมล</th>
                  <th scope="col">สิทธิ์</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.users.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">
                      {u.name}
                      {u.id === user.id && (
                        <small className="muted"> (คุณ)</small>
                      )}
                    </th>
                    <td>{u.email}</td>
                    <td>{roleLabels[u.role]}</td>
                    <td>{u.is_active ? "ใช้งานได้" : "ปิดบัญชี"}</td>
                    <td>
                      <button className="ghost" onClick={() => setEditor(u)}>
                        แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            total={resource.data.total}
            onPage={(n) => setParams({ page: String(n) })}
          />
        </div>
      )}
      {editor && (
        <Modal
          title={editor === "new" ? "เพิ่มผู้ใช้งาน" : "แก้ไข " + editor.name}
          onClose={() => setEditor(null)}
        >
          <Form
            noValidate
            onSave={async (data) => {
              const role = String(data.get("role")) as Role;
              const active = !!data.get("is_active");
              if (
                (editor === "new" && ["owner", "manager"].includes(role)) ||
                (editor !== "new" &&
                  (role !== editor.role || active !== editor.is_active))
              ) {
                if (
                  !(await confirm({
                    title: "ยืนยันสิทธิ์การใช้งาน?",
                    description:
                      editor === "new"
                        ? "บัญชีใหม่จะมีสิทธิ์ " + roleLabels[role]
                        : "การเปลี่ยนสิทธิ์หรือปิดบัญชีจะยกเลิกเซสชันที่ใช้งานอยู่ของบัญชีนั้น",
                    label: "ยืนยันสิทธิ์",
                    danger: !active,
                  }))
                )
                  throw new Error("ยังไม่ได้บันทึก กรุณาตรวจสอบสิทธิ์อีกครั้ง");
              }
              const body =
                editor === "new"
                  ? {
                      name: String(data.get("name")),
                      email: String(data.get("email")),
                      password: String(data.get("password")),
                      role,
                    }
                  : { name: String(data.get("name")), role, is_active: active };
              await mutate(
                editor === "new" ? "/users" : "/users/" + editor.id,
                editor === "new" ? "POST" : "PATCH",
                body,
              );
              setEditor(null);
              resource.reload();
              toast("บันทึกผู้ใช้งานแล้ว");
            }}
          >
            <Input
              label="ชื่อผู้ใช้งาน"
              name="name"
              required
              maxLength={100}
              defaultValue={editor === "new" ? "" : editor.name}
            />
            {editor === "new" ? (
              <>
                <Input
                  label="อีเมล"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                />
                <Secret
                  name="password"
                  label="รหัสผ่านเริ่มต้น"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <p className="caption muted">
                  อย่างน้อย 12 ตัวอักษร และไม่เกิน 72 UTF-8 bytes
                </p>
              </>
            ) : (
              <p className="muted">{editor.email}</p>
            )}
            <Select
              label="สิทธิ์"
              name="role"
              defaultValue={editor === "new" ? "cashier" : editor.role}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </Select>
            {editor !== "new" && (
              <CheckField
                label="เปิดใช้งานบัญชีนี้"
                name="is_active"
                defaultChecked={editor.is_active}
              />
            )}
            <Notice>
              ไม่มีการสมัครบัญชีสาธารณะ
              รหัสผ่านเปลี่ยนได้จากหน้าบัญชีของผู้ใช้งาน
            </Notice>
            <Submit>บันทึกผู้ใช้งาน</Submit>
          </Form>
        </Modal>
      )}
    </>
  );
}
