import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type FormEvent,
} from "react";
import { useBlocker } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { number } from "./lib";
const FormContext = createContext<{
  errors: Record<string, string>;
  busy: boolean;
}>({ errors: {}, busy: false });
export function Spinner() {
  return <LoaderCircle className="spinner" aria-hidden="true" size={20} />;
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "danger" | "warning" | "success";
}) {
  return (
    <div
      className={"notice " + tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function QueryState({
  loading,
  error,
  retry,
  empty,
}: {
  loading: boolean;
  error: string | null;
  retry: () => void;
  empty?: boolean;
}) {
  if (error)
    return (
      <Notice tone="danger">
        {error}
        <button className="ghost" onClick={retry}>
          ลองอีกครั้ง
        </button>
      </Notice>
    );
  if (loading)
    return (
      <div className="loading" role="status">
        <Spinner /> กำลังโหลดข้อมูล…
      </div>
    );
  if (empty) return <div className="empty">ยังไม่มีรายการในส่วนนี้</div>;
  return null;
}
export function Field({
  label,
  error,
  children,
  id,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      <span className="field-help" id={id + "-error"}>
        {error ?? ""}
      </span>
    </div>
  );
}
export function Input({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  const { errors } = useContext(FormContext);
  const error = props.name ? errors[props.name] : undefined;
  return (
    <Field id={id} label={label} error={error}>
      <input
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={id + "-error"}
      />
    </Field>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  const { errors } = useContext(FormContext);
  const error = props.name ? errors[props.name] : undefined;
  return (
    <Field id={id} label={label} error={error}>
      <select
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={id + "-error"}
      >
        {children}
      </select>
    </Field>
  );
}
export function Textarea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  const { errors } = useContext(FormContext);
  const error = props.name ? errors[props.name] : undefined;
  return (
    <Field id={id} label={label} error={error}>
      <textarea
        className="resize-none"
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={id + "-error"}
        onInput={(e) => {
          e.currentTarget.style.height = "auto";
          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
        }}
      />
    </Field>
  );
}
export function Secret({
  label = "รหัสผ่าน",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const { errors } = useContext(FormContext);
  const error = props.name ? errors[props.name] : undefined;
  return (
    <Field id={id} label={label} error={error}>
      <div className="secret">
        <input
          {...props}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={!!error}
          aria-describedby={id + "-error"}
        />
        <button
          type="button"
          className="icon"
          aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          aria-pressed={visible}
          data-preserve-dirty
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </Field>
  );
}
export function CheckField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="check">
      <input {...props} type="checkbox" />
      {label}
    </label>
  );
}
export function Submit({ children }: { children: ReactNode }) {
  const { busy } = useContext(FormContext);
  return (
    <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
      {busy && <Spinner />}
      <span>{children}</span>
    </button>
  );
}
function UnsavedGuard() {
  const blocker = useBlocker(true);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  return blocker.state === "blocked" ? (
    <Modal title="ออกจากฟอร์มนี้?" onClose={() => blocker.reset()}>
      <p>ข้อมูลที่ยังไม่บันทึกจะหายไป</p>
      <div className="actions">
        <button onClick={() => blocker.reset()}>แก้ไขต่อ</button>
        <button className="danger" onClick={() => blocker.proceed()}>
          ออกโดยไม่บันทึก
        </button>
      </div>
    </Modal>
  ) : null;
}
export function Form({
  children,
  onSave,
  guard = true,
  className = "",
  onDirtyChange,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<void>;
  guard?: boolean;
  className?: string;
  onDirtyChange?: (dirty: boolean) => void;
  noValidate?: true;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const next: Record<string, string> = {};
    for (const el of Array.from(form.elements)) {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        if (!el.validity.valid)
          next[el.name] = el.validity.valueMissing
            ? "กรุณากรอกข้อมูลนี้"
            : el.validity.typeMismatch
              ? "รูปแบบข้อมูลไม่ถูกต้อง"
              : "กรุณาตรวจสอบค่าหรือความยาวข้อมูล";
      }
    }
    setErrors(next);
    if (Object.keys(next).length) {
      form
        .querySelector<HTMLElement>(
          `[name="${CSS.escape(Object.keys(next)[0]!)}"]`,
        )
        ?.focus();
      return;
    }
    const values = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
    setBusy(true);
    setFailure("");
    try {
      await onSave(values);
      setDirty(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormContext value={{ errors, busy }}>
      <form
        noValidate
        data-dirty={dirty}
        data-busy={busy}
        className={className}
        onSubmit={submit}
        onChange={() => setDirty(true)}
        onClick={(event) => {
          const button = (event.target as HTMLElement).closest("button");
          if (
            button?.type === "button" &&
            !button.hasAttribute("data-preserve-dirty")
          )
            setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing)
            e.preventDefault();
        }}
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        <fieldset disabled={busy}>{children}</fieldset>
      </form>
      {guard && dirty && !busy && <UnsavedGuard />}
    </FormContext>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = useConfirm();
  async function close() {
    if (ref.current?.querySelector('form[data-busy="true"]')) return;
    if (
      ref.current?.querySelector('form[data-dirty="true"]') &&
      !(await confirm({
        title: "ทิ้งข้อมูลที่ยังไม่บันทึก?",
        description: "การแก้ไขในฟอร์มนี้จะหายไป",
        label: "ทิ้งการแก้ไข",
        danger: true,
      }))
    )
      return;
    onClose();
  }
  useEffect(() => {
    const dialog = ref.current;
    const focus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      focus?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon"
          aria-label="ปิดหน้าต่าง"
          autoFocus
          onClick={() => void close()}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
interface Confirmation {
  title: string;
  description: string;
  label?: string;
  danger?: boolean;
}
const ConfirmContext = createContext<
  (options: Confirmation) => Promise<boolean>
>(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (Confirmation & { resolve: (value: boolean) => void }) | null
  >(null);
  function finish(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }
  return (
    <ConfirmContext
      value={(options) =>
        new Promise((resolve) => setPending({ ...options, resolve }))
      }
    >
      {children}
      {pending && (
        <Modal title={pending.title} onClose={() => finish(false)}>
          <p>{pending.description}</p>
          <div className="actions">
            <button onClick={() => finish(false)}>ย้อนกลับ</button>
            <button
              className={pending.danger ? "danger" : "primary"}
              onClick={() => finish(true)}
            >
              {pending.label ?? "ยืนยัน"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext>
  );
}
const ToastContext = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return (
    <ToastContext value={(text) => setToast(text)}>
      {children}
      <div
        className={"toast " + (!toast ? "hidden" : "")}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <Check size={18} />
            {toast}
            <button
              className="icon"
              aria-label="ปิดข้อความ"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </ToastContext>
  );
}
export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="search">
      <Search size={20} />
      <input
        ref={ref}
        aria-label="ค้นหา"
        placeholder="ค้นหา…"
        value={draft}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          onChange(e.currentTarget.value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!composing) onChange(e.target.value);
        }}
      />
      {draft && (
        <button
          className="icon"
          aria-label="ล้างคำค้นหา"
          onClick={() => {
            setDraft("");
            onChange("");
            ref.current?.focus();
          }}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
export function Pager({
  page,
  total,
  onPage,
  pageSize = 25,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
}) {
  const max = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > max) onPage(max);
  }, [page, max, onPage]);
  return (
    <nav className="pager" aria-label="แบ่งหน้า">
      <span>
        {total
          ? `${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))}`
          : "0"}{" "}
        จาก {number(total)} รายการ
      </span>
      <button
        className="icon"
        disabled={page <= 1}
        aria-label="หน้าก่อน"
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <span aria-current="page">
        {page} / {max}
      </span>
      <button
        className="icon"
        disabled={page >= max}
        aria-label="หน้าถัดไป"
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
export function usePagedRows<T>(rows: T[], resetKey = "") {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  return {
    items: rows.slice((page - 1) * 25, page * 25),
    controls: <Pager page={page} total={rows.length} onPage={setPage} />,
  };
}
