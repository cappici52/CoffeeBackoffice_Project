import { useCallback, useEffect, useRef, useState } from "react";
export const money = (satang: number | string | null | undefined) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(satang ?? 0) / 100);
export const number = (n: number | string | null | undefined, digits = 2) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: digits }).format(
    Number(n ?? 0),
  );
export const dateText = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(iso.length === 10 ? iso + "T05:00:00Z" : iso));
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
export const orderNo = (n: number | string) => "#" + String(n).padStart(4, "0");
export const statusLabels = {
  pending: "รอทำ",
  preparing: "กำลังทำ",
  ready: "รอเสิร์ฟ",
  completed: "ส่งมอบแล้ว",
  cancelled: "ยกเลิก",
};
export const roleLabels = {
  owner: "เจ้าของร้าน",
  manager: "ผู้จัดการ",
  cashier: "แคชเชียร์",
  kitchen: "ครัว / บาร์",
};
const errors: Record<string, string> = {
  FORECAST_SOURCE_CONFLICT:
    "ข้อมูลตัวอย่างใช้ได้เฉพาะโหมดทดลอง กรุณาเลือกชุดข้อมูลหรือโหมดให้ตรงกัน",
  INVALID_IMAGE:
    "กรุณาเลือกรูป JPG, PNG หรือ WebP ที่เปิดได้ ขนาดไม่เกิน 5 MB และ 25 ล้านพิกเซล (ไม่รองรับภาพเคลื่อนไหว)",
  IMAGE_TOO_LARGE: "รูปนี้มีขนาดใหญ่เกินไป กรุณาลดขนาดรูปแล้วลองอีกครั้ง",
  BODY_TOO_LARGE: "ไฟล์หรือข้อมูลมีขนาดใหญ่เกินไป กรุณาใช้รูปไม่เกิน 5 MB",
  UNAUTHENTICATED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  INVALID_CREDENTIALS: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้",
  ORIGIN_FORBIDDEN: "ที่อยู่เว็บไม่ตรงกับการตั้งค่าระบบ กรุณาตรวจ APP_ORIGIN",
  VALIDATION_ERROR: "กรุณาตรวจสอบข้อมูลให้ครบและถูกต้อง",
  VERSION_CONFLICT:
    "ข้อมูลถูกแก้ไขแล้ว กรุณาปิดฟอร์มและโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง",
  ALREADY_EXISTS: "มีข้อมูลนี้อยู่แล้ว กรุณาใช้ชื่อหรืออีเมลอื่น",
  REFERENCE_IN_USE_OR_MISSING:
    "ข้อมูลถูกใช้งานอยู่ หรือข้อมูลอ้างอิงไม่ถูกต้อง",
  INSUFFICIENT_STOCK: "วัตถุดิบไม่เพียงพอ กรุณาตรวจสต็อกก่อนยืนยันออเดอร์",
  INVALID_OPTIONS: "ตัวเลือกเมนูไม่ครบหรือถูกเปลี่ยนแปลง กรุณาเลือกเมนูใหม่",
  PRODUCT_UNAVAILABLE: "เมนูนี้ปิดขายแล้ว กรุณาโหลดเมนูล่าสุด",
  RECIPE_REQUIRED: "เมนูนี้ยังไม่มีสูตร กรุณากำหนดสูตรก่อนขาย",
  INVALID_SUBSTITUTION: "วัตถุดิบทดแทนไม่ตรงกับสูตร กรุณาตรวจตัวเลือกเมนู",
  INVALID_ORDER_TRANSITION: "สถานะออเดอร์เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด",
  PAYMENT_CONFLICT: "ออเดอร์นี้บันทึกวิธีรับเงินไว้แล้ว กรุณาตรวจรายละเอียด",
  ORDER_CONFIRMATION_REQUIRED: "กรุณายืนยันออเดอร์ก่อนเริ่มทำ",
  PAYMENT_REQUIRED: "กรุณารับชำระก่อนเริ่มทำ",
  REFUND_REQUIRES_MANAGER: "การคืนเงินต้องให้เจ้าของร้านหรือผู้จัดการยืนยัน",
  REFUND_CONFIRMATION_REQUIRED: "กรุณายืนยันว่าได้คืนเงินให้ลูกค้าแล้ว",
  DAY_ALREADY_CLOSED: "ปิดวันขายนี้แล้ว ไม่สามารถแก้ไขรายการเงินของวันนี้ได้",
  OPEN_ORDERS_EXIST: "ยังมีออเดอร์ค้างอยู่ กรุณาจัดการให้เสร็จก่อนปิดวัน",
  CANNOT_REMOVE_OWN_ACCESS: "ไม่สามารถลดสิทธิ์หรือปิดบัญชีตัวเองได้",
  LAST_OWNER_REQUIRED: "ต้องมีเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งบัญชี",
  INGREDIENT_HAS_STOCK: "วัตถุดิบนี้ยังมีสต็อก กรุณาจัดการยอดก่อนลบ",
  INGREDIENT_IN_USE: "วัตถุดิบนี้ยังถูกใช้ในสูตรหรือตัวเลือกเมนู",
  FORECAST_SERVICE_UNAVAILABLE:
    "บริการพยากรณ์ยังไม่พร้อม กรุณาเปิดบริการแล้วลองอีกครั้ง",
  FORECAST_INVALID_RESPONSE: "ข้อมูลจากบริการพยากรณ์ไม่ครบหรือไม่ถูกต้อง",
  FORECAST_INSUFFICIENT_HISTORY:
    "บางเมนูไม่มีประวัติที่ใช้ได้ หรือข้อมูลเก่าเกิน 6 วัน กรุณาตรวจชุดข้อมูล คุณภาพข้อมูล และการปิดวัน",
  INVALID_FORECAST_CUTOFF: "วันตัดข้อมูลต้องก่อนวันนี้",
  FORECAST_HORIZON_CONFLICT: "ช่วงวันที่ไม่ตรงกับระยะพยากรณ์",
  NO_FORECAST_PRODUCTS: "ยังไม่มีเมนูสำหรับพยากรณ์",
  TOO_MANY_ATTEMPTS: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที",
  TABLE_UNAVAILABLE:
    "โต๊ะนี้ยังไม่เปิดรับออเดอร์ หรือ QR เปลี่ยนแล้ว กรุณาติดต่อพนักงาน",
  MENU_PRICE_CHANGED:
    "ราคาเมนูเปลี่ยนแล้ว กรุณาล้างตะกร้า โหลดเมนูใหม่ และตรวจราคาก่อนสั่งอีกครั้ง",
  TABLE_ORDER_LIMIT:
    "มีคำสั่งซื้อรอชำระหลายรายการ กรุณาติดต่อพนักงานก่อนสั่งเพิ่ม",
  TOO_MANY_REQUESTS: "มีการใช้งานมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง",
  ORDER_NOT_FOUND: "ยังไม่พบออเดอร์นี้ กรุณาตรวจลิงก์หรือสอบถามพนักงาน",
  IDEMPOTENCY_CONFLICT:
    "รายการนี้เคยส่งแล้วด้วยข้อมูลต่างกัน กรุณาตรวจออเดอร์ก่อนสร้างใหม่",
};
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      errors[code] ?? "ไม่สามารถทำรายการได้ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง",
    );
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    const timeout =
      path === "/forecasts/generate" || path === "/forecasts/backtest"
        ? 70_000
        : 25_000;
    const response = await fetch("/api" + path, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "UNKNOWN" }));
      if (response.status === 401 && !path.startsWith("/auth/"))
        window.dispatchEvent(new Event("session-expired"));
      throw new HttpError(response.status, body.error);
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("การเชื่อมต่อขัดข้อง กรุณาตรวจเครือข่ายแล้วลองอีกครั้ง");
  }
}
export const mutate = <T>(path: string, method: string, body?: object) =>
  api<T>(path, { method, body: body ? JSON.stringify(body) : undefined });
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const previous = useRef(path);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setData(null);
      return;
    }
    const controller = new AbortController();
    if (previous.current !== path) {
      setData(null);
      previous.current = path;
    }
    setLoading(true);
    setError(null);
    void api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, reload };
}
export function useDebounced(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
