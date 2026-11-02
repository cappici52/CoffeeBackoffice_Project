import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { Copy, Plus, Printer, RefreshCw } from "lucide-react";
import { mutate, useResource } from "../lib";
import { tableLabel } from "../menu";
import {
  CheckField,
  Form,
  Input,
  Modal,
  Notice,
  Pager,
  QueryState,
  Submit,
  useConfirm,
  useToast,
} from "../ui";
import type { DiningTable } from "../types";

export default function Tables() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const resource = useResource<{
    tables: DiningTable[];
    total: number;
    public_origin: string;
  }>("/tables?page=" + page);
  const [editor, setEditor] = useState<DiningTable | "new" | null>(null);
  const [qr, setQr] = useState<DiningTable | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  async function rotate(table: DiningTable) {
    if (
      !(await confirm({
        title: "เปลี่ยน QR ของ" + tableLabel(table.name) + "?",
        description:
          "QR เดิมจะใช้สั่งเพิ่มไม่ได้ ต้องพิมพ์และเปลี่ยนป้ายใหม่ ลิงก์ติดตามออเดอร์ที่สั่งแล้วจะยังใช้ได้",
        label: "เปลี่ยน QR",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setFailure("");
    try {
      await mutate("/tables/" + table.id + "/rotate", "POST", {
        expected_version: table.version,
      });
      resource.reload();
      toast("เปลี่ยน QR แล้ว กรุณาพิมพ์ป้ายใหม่");
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "เปลี่ยน QR ไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }
  const origin = resource.data?.public_origin;
  const loopback = origin
    ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
    : false;
  return (
    <>
      <div className="toolbar">
        <div>
          <h2>QR สั่งอาหารประจำโต๊ะ</h2>
          <p className="muted">
            ลูกค้าเลือกเมนูและติดตามออเดอร์ของตัวเอง
            พนักงานยืนยันก่อนส่งเข้าบาร์ ลูกค้าชำระหลังทานเสร็จ
          </p>
        </div>
        <button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} />
          เพิ่มโต๊ะ
        </button>
      </div>
      {origin && (
        <Notice tone={loopback ? "warning" : "info"}>
          ที่อยู่สำหรับลูกค้า: <strong>{origin}</strong>
          {loopback
            ? " · localhost เปิดได้เฉพาะเครื่องนี้ ตั้ง PUBLIC_ORIGIN เป็น IP เครื่องร้านหรือโดเมนที่ลูกค้าเข้าถึงได้ก่อนพิมพ์"
            : " · หากใช้ IP ภายใน โทรศัพท์ต้องอยู่ Wi-Fi เดียวกับเครื่องร้าน"}
        </Notice>
      )}
      {failure && <Notice tone="danger">{failure}</Notice>}
      <QueryState
        {...resource}
        retry={resource.reload}
        empty={!resource.data?.tables.length}
      />
      {resource.data && (
        <div className="table-panel">
          <div className="table-scroll">
            <table>
              <caption className="sr-only">โต๊ะและ QR สำหรับสั่งอาหาร</caption>
              <thead>
                <tr>
                  <th scope="col">โต๊ะ</th>
                  <th scope="col">รับออเดอร์</th>
                  <th scope="col">QR สำหรับลูกค้า</th>
                  <th scope="col">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.tables.map((table) => (
                  <tr key={table.id}>
                    <th scope="row">{tableLabel(table.name)}</th>
                    <td>
                      <span
                        className={
                          "badge " + (table.is_active ? "ready" : "cancelled")
                        }
                      >
                        {table.is_active ? "เปิดรับ" : "ปิดรับ"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => setQr(table)}
                        disabled={!table.is_active}
                      >
                        ดู / พิมพ์ QR
                      </button>
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="ghost"
                          onClick={() => setEditor(table)}
                        >
                          แก้ไข
                        </button>
                        <button
                          className="ghost danger-text"
                          disabled={busy}
                          onClick={() => void rotate(table)}
                        >
                          <RefreshCw size={16} />
                          เปลี่ยน QR
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
            onPage={(n) => setParams({ page: String(n) })}
          />
        </div>
      )}
      {editor && (
        <Modal
          title={
            editor === "new" ? "เพิ่มโต๊ะ" : "แก้ไข" + tableLabel(editor.name)
          }
          onClose={() => setEditor(null)}
        >
          <Form
            noValidate
            onSave={async (data) => {
              if (
                editor !== "new" &&
                editor.is_active !== !!data.get("is_active") &&
                !(await confirm({
                  title: "เปลี่ยนการรับออเดอร์ของโต๊ะนี้?",
                  description:
                    "เมื่อปิดรับ QR จะส่งออเดอร์ใหม่ไม่ได้ ออเดอร์ที่ส่งแล้วและลิงก์ติดตามยังใช้งานได้",
                  label: "ยืนยันเปลี่ยนสถานะ",
                }))
              )
                throw new Error("ยังไม่ได้บันทึกการเปลี่ยนแปลง");
              await mutate(
                editor === "new" ? "/tables" : "/tables/" + editor.id,
                editor === "new" ? "POST" : "PATCH",
                {
                  name: String(data.get("name")),
                  ...(editor === "new"
                    ? {}
                    : {
                        is_active: !!data.get("is_active"),
                        expected_version: editor.version,
                      }),
                },
              );
              setEditor(null);
              resource.reload();
              toast("บันทึกโต๊ะแล้ว");
            }}
          >
            <Input
              label="หมายเลข / ชื่อโต๊ะ"
              name="name"
              required
              maxLength={30}
              placeholder="เช่น 1 หรือ A1"
              defaultValue={editor === "new" ? "" : editor.name}
            />
            {editor !== "new" && (
              <CheckField
                label="เปิดรับออเดอร์ผ่าน QR"
                name="is_active"
                defaultChecked={editor.is_active}
              />
            )}
            <Submit>บันทึกโต๊ะ</Submit>
          </Form>
        </Modal>
      )}
      {qr && <TableQr table={qr} onClose={() => setQr(null)} />}
    </>
  );
}
function TableQr({
  table,
  onClose,
}: {
  table: DiningTable;
  onClose: () => void;
}) {
  const [image, setImage] = useState("");
  const [failure, setFailure] = useState("");
  const toast = useToast();
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(table.menu_url, {
      width: 640,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#171A1C", light: "#FFFFFF" },
    })
      .then((data) => {
        if (active) setImage(data);
      })
      .catch(() => {
        if (active)
          setFailure("สร้างภาพ QR ไม่สำเร็จ กรุณาปิดแล้วเปิดอีกครั้ง");
      });
    return () => {
      active = false;
    };
  }, [table.menu_url]);
  return (
    <Modal title={"QR " + tableLabel(table.name)} onClose={onClose}>
      <section className="qr-sheet">
        <p className="qr-brand">Coffee Backoffice</p>
        <h2>{tableLabel(table.name)}</h2>
        <p>สแกนเพื่อดูเมนูและสั่งอาหาร</p>
        {image ? (
          <img
            className="qr-image"
            src={image}
            alt={"QR สำหรับ" + tableLabel(table.name)}
            width={280}
            height={280}
          />
        ) : (
          <div className="loading">กำลังสร้าง QR…</div>
        )}
        <p>สั่งแล้วติดตามสถานะได้บนโทรศัพท์</p>
        <small>{new URL(table.menu_url).host}</small>
      </section>
      {failure && <Notice tone="danger">{failure}</Notice>}
      <div className="qr-actions no-print">
        <a
          className="button"
          href={table.menu_url}
          target="_blank"
          rel="noreferrer"
        >
          เปิดเมนูลูกค้า
        </a>
        <button
          onClick={() =>
            void (async () => {
              if (!navigator.clipboard)
                throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(table.menu_url);
              toast("คัดลอกลิงก์เมนูแล้ว");
            })().catch(() =>
              setFailure(
                "คัดลอกไม่ได้ กรุณาเปิดเมนูลูกค้าแล้วคัดลอกที่อยู่จากเบราว์เซอร์",
              ),
            )
          }
        >
          <Copy size={16} />
          คัดลอกลิงก์
        </button>
        {image && (
          <a
            className="button"
            href={image}
            download={"table-" + table.name + ".png"}
          >
            ดาวน์โหลด QR
          </a>
        )}
        <button
          className="primary"
          disabled={!image}
          onClick={() => window.print()}
        >
          <Printer size={16} />
          พิมพ์ป้ายโต๊ะ
        </button>
      </div>
    </Modal>
  );
}
