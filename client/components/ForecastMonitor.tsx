import type { Forecasts } from "../types";
import { number } from "../lib";
import { Notice } from "../ui";
export default function ForecastMonitor({
  data,
  source,
}: {
  data: Forecasts;
  source: string;
}) {
  const tracked = data.evaluation.by_horizon?.find(
    (r) => r.source === source && r.horizon === 30,
  );
  return (
    <section className="section-details">
      <h2>ติดตามผลหลังออกพยากรณ์</h2>
      <p className="caption muted">
        รุ่น {data.evaluation.pipeline ?? "legacy"} · ตามช่วงวันที่ เมนู
        และแหล่งข้อมูลที่เลือก
        คำนวณจากรอบที่ออกก่อนวันเป้าหมายและยอดปิดวันที่คุณภาพผ่าน
      </p>
      {!tracked?.samples ? (
        <Notice>
          รอผลปิดวันที่ตรงกับรอบพยากรณ์รุ่นนี้
          คะแนนจะคำนวณใหม่เมื่อเปิดหรือรีเฟรชหน้า ไม่ยืมคะแนนของรุ่นเดิมมาแสดง
        </Notice>
      ) : (
        <>
          <p>
            เทียบแล้ว {tracked.samples} คู่เมนู–วัน · MAE{" "}
            {tracked.mae == null ? "—" : number(tracked.mae)} หน่วย
          </p>
          {tracked.baseline.samples >= 14 &&
            tracked.paired_model.mae! > tracked.baseline.mae! && (
              <Notice tone="warning">
                รุ่นนี้คลาดเคลื่อนมากกว่าวิธีใช้ยอดสัปดาห์ก่อนบนคู่เดียวกัน
                ควรตรวจข้อมูลและทบทวนวิธีที่ใช้ก่อนอาศัยผลเตรียมสินค้า
              </Notice>
            )}
          <p>
            ช่วงคาดการณ์ครอบคลุมยอดที่เกิดขึ้นจริง{" "}
            {tracked.interval?.coverage == null
              ? "ยังไม่มีคู่ที่วัดได้"
              : number(tracked.interval.coverage) + "%"}{" "}
            · {tracked.interval?.samples ?? 0} คู่ที่มีช่วงค่า · เป้าหมายรายเมนู
            80%
          </p>
          {(tracked.interval?.samples ?? 0) >= 20 &&
            tracked.interval!.coverage! < 80 && (
              <Notice tone="warning">
                ช่วงคาดการณ์ครอบคลุมน้อยกว่าเป้าหมายจากข้อมูลที่วัดได้
                ควรทบทวนความคลาดเคลื่อนและคุณภาพข้อมูล
              </Notice>
            )}
        </>
      )}
      <details>
        <summary>ผลแยกระบบเดิมและระบบใหม่</summary>
        <p className="caption muted">
          แยกรุ่นและที่มาของข้อมูล ช่วงเวลาและคู่ทดสอบอาจต่างกัน
          จึงไม่ใช้ตารางนี้จัดอันดับความแม่นยำโดยตรง
        </p>
        <ul>
          {data.evaluation.by_pipeline
            ?.filter((r) => r.source === source && r.samples > 0)
            .map((r) => (
              <li key={r.pipeline}>
                {r.pipeline} · {r.samples} คู่ · MAE{" "}
                {r.mae == null ? "—" : number(r.mae)} · WAPE{" "}
                {r.wape == null ? "—" : number(r.wape) + "%"}
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
