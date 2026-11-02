import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../App";
import {
  addDays,
  dateText,
  money,
  mutate,
  number,
  today,
  useResource,
} from "../lib";
import {
  Form,
  Input,
  Modal,
  Notice,
  QueryState,
  Submit,
  Textarea,
  useToast,
  usePagedRows,
} from "../ui";
import type { Report } from "../types";
export default function Reports() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? addDays(today(), -6);
  const to = params.get("to") ?? today();
  const resource = useResource<Report>(
    `/reports?date_from=${from}&date_to=${to}`,
  );
  const [close, setClose] = useState(false);
  const toast = useToast();
  const report = resource.data;
  const productRows = usePagedRows(report?.products ?? [], from + to);
  const owner = user.role === "owner";
  const profit =
    report?.products.reduce((s, p) => s + (p.profit_satang ?? 0), 0) ?? 0;
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {[
            [0, "วันนี้"],
            [6, "7 วัน"],
            [29, "30 วัน"],
          ].map(([days, label]) => (
            <button
              key={days}
              onClick={() =>
                setParams({
                  from: addDays(today(), -Number(days)),
                  to: today(),
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setClose(true)}>ปิดวันขาย</button>
      </div>
      <Form
        noValidate
        guard={false}
        className="range-form"
        onSave={async (data) => {
          setParams({
            from: String(data.get("from")),
            to: String(data.get("to")),
          });
        }}
      >
        <Input
          key={"from" + from}
          label="วันที่เริ่ม"
          name="from"
          type="date"
          required
          defaultValue={from}
        />
        <Input
          key={"to" + to}
          label="ถึงวันที่"
          name="to"
          type="date"
          required
          defaultValue={to}
        />
        <Submit>แสดงรายงาน</Submit>
      </Form>
      <QueryState {...resource} retry={resource.reload} />
      {report && (
        <>
          <div className="metrics">
            <div>
              <span>ยอดขายรับชำระ</span>
              <strong>{money(report.summary.revenue_satang)}</strong>
              <small>ไม่รวมรายการคืนเงิน</small>
            </div>
            <div>
              <span>จำนวนออเดอร์</span>
              <strong>{number(report.summary.orders)}</strong>
              <small>
                {dateText(from)} – {dateText(to)}
              </small>
            </div>
            <div>
              <span>เงินสด / PromptPay</span>
              <strong className="smaller">
                {money(report.summary.cash_satang)}
              </strong>
              <small>PromptPay {money(report.summary.promptpay_satang)}</small>
            </div>
            {owner && (
              <div>
                <span>กำไรขั้นต้นจากสูตร</span>
                <strong>{money(profit)}</strong>
                <small>ยังไม่หักค่าใช้จ่ายร้านและของเสีย</small>
              </div>
            )}
          </div>
          <p className="muted caption">
            คืนเงินในช่วงนี้ {report.refunds.count} รายการ ·{" "}
            {money(report.refunds.amount_satang)} · วันและเวลาอิงประเทศไทย
          </p>
          <div className="chart-pair">
            <section className="chart-panel">
              <h2>ยอดขายรายวัน</h2>
              {report.daily.length ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={report.daily.map((d) => ({
                        ...d,
                        revenue: Number(d.revenue_satang) / 100,
                      }))}
                    >
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => String(v).slice(5)}
                        stroke="var(--muted)"
                      />
                      <YAxis stroke="var(--muted)" width={50} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--surface)",
                          borderColor: "var(--border)",
                          color: "var(--text)",
                        }}
                        formatter={(v) => [money(Number(v) * 100), "ยอดขาย"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty">ยังไม่มียอดขายในช่วงนี้</div>
              )}
            </section>
            <section className="chart-panel">
              <h2>ช่วงเวลาขายดี</h2>
              {report.hourly.length ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.hourly}>
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={(v) => v + ":00"}
                        stroke="var(--muted)"
                      />
                      <YAxis
                        stroke="var(--muted)"
                        allowDecimals={false}
                        width={32}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--surface)",
                          borderColor: "var(--border)",
                        }}
                        formatter={(v) => [number(Number(v)), "ออเดอร์"]}
                      />
                      <Bar
                        dataKey="orders"
                        fill="var(--primary)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty">ยังไม่มีข้อมูลช่วงเวลาขาย</div>
              )}
            </section>
          </div>
          <div className="section-head">
            <h2>ยอดขายและเวลาเตรียมรายเมนู</h2>
          </div>
          <div className="table-panel">
            <div className="table-scroll">
              <table>
                <caption className="sr-only">
                  ยอดขายและเวลาเตรียมตามเมนู
                </caption>
                <thead>
                  <tr>
                    <th scope="col">เมนู</th>
                    <th scope="col">จำนวน</th>
                    <th scope="col">ยอดขาย</th>
                    {owner && (
                      <>
                        <th scope="col">ต้นทุน</th>
                        <th scope="col">กำไรขั้นต้น</th>
                      </>
                    )}
                    <th scope="col">เวลาเตรียมเฉลี่ย</th>
                  </tr>
                </thead>
                <tbody>
                  {productRows.items.map((p) => (
                    <tr key={p.product_id + p.product_name}>
                      <th scope="row">{p.product_name}</th>
                      <td>{number(p.qty)}</td>
                      <td>{money(p.revenue_satang)}</td>
                      {owner && (
                        <>
                          <td>{money(p.cost_satang)}</td>
                          <td>{money(p.profit_satang)}</td>
                        </>
                      )}
                      <td>
                        {p.avg_prep_seconds !== null
                          ? number(p.avg_prep_seconds, 0) + " วินาที"
                          : "ยังไม่มีข้อมูล"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.products.length && (
                <div className="empty">ยังไม่มีรายการขาย</div>
              )}
            </div>
            {productRows.controls}
          </div>
          <details className="section-details">
            <summary>
              ข้อมูลรายวันและสรุปปิดวัน ({report.closings.length})
            </summary>
            <div className="table-scroll">
              <table>
                <caption>ยอดขายจริงรายวัน</caption>
                <thead>
                  <tr>
                    <th scope="col">วัน</th>
                    <th scope="col">ออเดอร์</th>
                    <th scope="col">ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{dateText(d.date)}</th>
                      <td>{d.orders}</td>
                      <td>{money(d.revenue_satang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table>
                <caption>วันที่ปิดแล้ว</caption>
                <thead>
                  <tr>
                    <th scope="col">วันขาย</th>
                    <th scope="col">ปิดโดย</th>
                    <th scope="col">เวลา</th>
                    <th scope="col">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.closings.map((c) => (
                    <tr key={c.date}>
                      <th scope="row">{dateText(c.date)}</th>
                      <td>{c.closed_by_name}</td>
                      <td>{dateText(c.closed_at, true)}</td>
                      <td>{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {close && (
        <Modal title="ปิดวันขาย" onClose={() => setClose(false)}>
          <Form
            noValidate
            onSave={async (data) => {
              await mutate("/reports/close", "POST", {
                date: String(data.get("date")),
                note: String(data.get("note")),
              });
              setClose(false);
              resource.reload();
              toast("ปิดวันขายแล้ว");
            }}
          >
            <Notice tone="warning">
              ต้องส่งมอบหรือยกเลิกออเดอร์ค้างก่อน
              เมื่อปิดแล้วจะไม่สามารถรับชำระหรือคืนเงินสำหรับวันนั้นได้อีก
            </Notice>
            <Input
              label="วันขายที่ต้องการปิด"
              name="date"
              type="date"
              required
              max={today()}
              defaultValue={today()}
            />
            <Textarea
              className="resize-none"
              label="หมายเหตุ"
              name="note"
              maxLength={1000}
            />
            <Submit>ยืนยันปิดวันขาย</Submit>
          </Form>
        </Modal>
      )}
    </>
  );
}
