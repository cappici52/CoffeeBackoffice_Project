import { useState } from "react";
import { money, useResource } from "../lib";
import { Notice, QueryState } from "../ui";

export default function PromptPayQr({ amount }: { amount: number | string }) {
  const resource = useResource<{
    available: boolean;
    image_url?: string;
    fixed_amount_satang?: number | string | null;
  }>("/payment-qr");
  const [failed, setFailed] = useState(false);
  const qr = resource.data;
  return (
    <section className="promptpay-payment" aria-label="QR ชำระผ่าน PromptPay">
      <strong>ยอดชำระ {money(amount)}</strong>
      <QueryState {...resource} retry={resource.reload} />
      {qr?.available && qr.image_url ? (
        <>
          {failed ? (
            <Notice tone="warning">
              โหลดรูป QR ไม่สำเร็จ กรุณาเปิดรูปต้นฉบับหรือตรวจการเชื่อมต่อ
            </Notice>
          ) : (
            <img
              src={qr.image_url}
              alt="QR PromptPay ของร้านสำหรับชำระเงิน"
              className="promptpay-image"
              width={830}
              height={1209}
              onError={() => setFailed(true)}
            />
          )}
          <a href={qr.image_url} target="_blank" rel="noopener noreferrer">
            เปิดรูป QR ขนาดเต็ม
          </a>
          {qr.fixed_amount_satang == null ? (
            <p className="caption muted">
              QR นี้ไม่ระบุยอดอัตโนมัติ กรุณากรอก {money(amount)}{" "}
              ในแอปธนาคารและตรวจชื่อผู้รับก่อนโอน
            </p>
          ) : Number(qr.fixed_amount_satang) !== Number(amount) ? (
            <Notice tone="warning">
              QR นี้กำหนดยอด {money(qr.fixed_amount_satang)}{" "}
              ซึ่งไม่ตรงกับยอดออเดอร์ กรุณาใช้ช่องทางรับเงินที่ถูกต้องก่อนยืนยัน
            </Notice>
          ) : (
            <p className="caption muted">
              QR กำหนดยอด {money(amount)} กรุณาตรวจชื่อผู้รับก่อนโอน
            </p>
          )}
          <p className="caption muted">
            พนักงานต้องตรวจยอดเงินเข้าบัญชีก่อนยืนยันรับชำระ
            ระบบไม่ตรวจเงินเข้าอัตโนมัติ
          </p>
        </>
      ) : (
        qr && (
          <Notice>
            ยังไม่ได้ตั้งรูป QR PromptPay กรุณาใช้ QR
            ของร้านที่เคาน์เตอร์และตรวจเงินเข้าก่อนยืนยัน
          </Notice>
        )
      )}
    </section>
  );
}
