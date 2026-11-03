import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  ChartNoAxesCombined,
  ClipboardList,
  Coffee,
  LogOut,
  Package,
  ShoppingBag,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  QrCode,
} from "lucide-react";
import { api, dateText, mutate, roleLabels, useResource } from "./lib";
import {
  ConfirmProvider,
  Form,
  Input,
  Notice,
  Secret,
  Spinner,
  Submit,
  ToastProvider,
  useConfirm,
} from "./ui";
import type { Role, User } from "./types";
const Pos = lazy(() => import("./pages/Pos"));
const Orders = lazy(() => import("./pages/Orders"));
const Kds = lazy(() => import("./pages/Kds"));
const Menu = lazy(() => import("./pages/Menu"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Reports = lazy(() => import("./pages/Reports"));
const Forecast = lazy(() => import("./pages/Forecast"));
const HistoricalReplay = lazy(() => import("./pages/HistoricalReplay"));
const UserAdmin = lazy(() => import("./pages/Users"));
const Account = lazy(() => import("./pages/Account"));
const Receipt = lazy(() => import("./pages/Receipt"));
const Tables = lazy(() => import("./pages/Tables"));
const Customer = lazy(() => import("./pages/Customer"));
const AuthContext = createContext<{ user: User; refresh: () => Promise<void> }>(
  { user: null as unknown as User, refresh: async () => {} },
);
export const useAuth = () => useContext(AuthContext);
const LiveContext = createContext({ connected: false, revision: 0, offset: 0 });
export const useLive = () => useContext(LiveContext);
function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const stream = new EventSource("/api/events");
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        revision: string;
        server_time: string;
      };
      setRevision(Number(data.revision));
      setOffset(Date.parse(data.server_time) - Date.now());
    };
    stream.addEventListener("session-expired", () =>
      window.dispatchEvent(new Event("session-expired")),
    );
    return () => stream.close();
  }, []);
  return (
    <LiveContext value={{ connected, revision, offset }}>
      {children}
    </LiveContext>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  useEffect(() => {
    document.title = "เข้าสู่ระบบ · Coffee Backoffice";
  }, []);
  return (
    <main className="login">
      <div className="login-brand">
        <Coffee size={34} />
        <span>
          Coffee
          <br />
          <strong>Backoffice</strong>
        </span>
      </div>
      <section className="login-panel">
        <h1>เข้าสู่ระบบ</h1>
        <p className="muted">จัดการหน้าร้านและหลังบ้านในที่เดียว</p>
        <Form
          noValidate
          guard={false}
          onSave={async (data) => {
            const result = await mutate<{ user: User }>("/auth/login", "POST", {
              email: String(data.get("email")).trim(),
              password: String(data.get("password")),
            });
            onLogin(result.user);
          }}
        >
          <Input
            label="อีเมล"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="username"
            autoFocus
          />
          <Secret name="password" required autoComplete="current-password" />
          <Submit>เข้าสู่ระบบ</Submit>
        </Form>
        <p className="caption muted">ใช้บัญชีที่เจ้าของร้านสร้างให้</p>
      </section>
      <span className="login-foot">Coffee Backoffice · ระบบจัดการร้านกาแฟ</span>
    </main>
  );
}
const navigation = [
  {
    to: "/tables",
    label: "โต๊ะ / QR",
    icon: QrCode,
    roles: ["owner", "manager"],
  },
  {
    to: "/pos",
    label: "ขายหน้าร้าน",
    icon: ShoppingBag,
    roles: ["owner", "manager", "cashier"],
  },
  {
    to: "/orders",
    label: "ออเดอร์",
    icon: ClipboardList,
    roles: ["owner", "manager", "cashier"],
  },
  {
    to: "/kds",
    label: "หน้าจอบาร์",
    icon: Coffee,
    roles: ["owner", "manager", "cashier", "kitchen"],
  },
  { to: "/menu", label: "เมนู", icon: BookOpen, roles: ["owner", "manager"] },
  {
    to: "/inventory",
    label: "สต็อกและสูตร",
    icon: Package,
    roles: ["owner", "manager"],
  },
  {
    to: "/reports",
    label: "รายงาน",
    icon: BarChart3,
    roles: ["owner", "manager"],
  },
  {
    to: "/forecast",
    label: "พยากรณ์",
    icon: ChartNoAxesCombined,
    roles: ["owner", "manager"],
  },
  {
    to: "/users",
    label: "ผู้ใช้งาน",
    icon: Users,
    roles: ["owner", "manager"],
  },
];
function Only({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!roles.includes(user.role))
    return (
      <div className="empty">
        <h2>ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <Link to={user.role === "kitchen" ? "/kds" : "/pos"}>กลับหน้าหลัก</Link>
      </div>
    );
  return children;
}
function Shell({ logout }: { logout: () => Promise<void> }) {
  const [failure, setFailure] = useState("");
  const { user } = useAuth();
  const live = useLive();
  const shopContext = useResource<{ contains_simulation: boolean }>(
    "/shop-context",
  );
  const queue = useResource<{ unpaid: number; qr_unpaid: number }>(
    user.role === "kitchen" ? null : "/orders/summary",
  );
  useEffect(queue.reload, [queue.reload, live.revision]);
  useEffect(shopContext.reload, [shopContext.reload, live.revision]);
  const location = useLocation();
  const confirm = useConfirm();
  const heading =
    navigation.find((n) => location.pathname.startsWith(n.to))?.label ??
    (location.pathname.startsWith("/receipt") ? "ใบเสร็จ" : "บัญชีของฉัน");
  useEffect(() => {
    document.title = heading + " · Coffee Backoffice";
  }, [heading]);
  return (
    <div className="app-shell">
      <a className="skip" href="#content">
        ข้ามไปเนื้อหา
      </a>
      <aside className="sidebar">
        <Link className="brand" to={user.role === "kitchen" ? "/kds" : "/pos"}>
          Coffee<span>Backoffice</span>
        </Link>
        <nav aria-label="เมนูหลัก">
          {navigation
            .filter((n) => n.roles.includes(user.role))
            .map((n) => (
              <NavLink key={n.to} to={n.to}>
                <n.icon size={20} />
                <span>{n.label}</span>
                {n.to === "/orders" && !!queue.data?.unpaid && (
                  <span
                    className="nav-count"
                    aria-label={"รอรับชำระ " + queue.data.unpaid + " ออเดอร์"}
                  >
                    {queue.data.unpaid}
                  </span>
                )}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/account" className="user-link">
            <UserRound size={19} />
            <span>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </span>
          </Link>
          <button
            className="ghost logout"
            onClick={() =>
              void (async () => {
                if (
                  await confirm({
                    title: "ออกจากระบบ?",
                    description: "หากมีงานที่ยังไม่บันทึก กรุณาบันทึกก่อนออก",
                    label: "ออกจากระบบ",
                  })
                )
                  await logout();
              })().catch((error) =>
                setFailure(
                  error instanceof Error
                    ? error.message
                    : "ออกจากระบบไม่สำเร็จ",
                ),
              )
            }
          >
            <LogOut size={17} />
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <h1>{heading}</h1>
          <time className="header-date">
            {dateText(new Date().toISOString())}
          </time>
          <span
            className={"connection " + (live.connected ? "online" : "offline")}
            role="status"
          >
            {live.connected ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>
              {live.connected
                ? "เชื่อมต่อแล้ว"
                : "ขาดการเชื่อมต่อ · กำลังลองใหม่"}
            </span>
          </span>
        </header>
        <main id="content" className="page">
          {shopContext.data?.contains_simulation && (
            <Notice tone="warning">
              <details>
                <summary>ข้อมูลร้านมีรายการจำลอง</summary>
                <p>
                  ฐานข้อมูลนี้มีรายการจำลองการขาย
                  รายงานยอดขายและสต็อกรวมรายการจำลองด้วย
                  รายการเหล่านี้ไม่ใช่การขายหรือรับเงินจริง
                </p>
              </details>
            </Notice>
          )}
          {failure && <Notice tone="danger">{failure}</Notice>}
          <Suspense
            fallback={
              <div className="loading">
                <Spinner /> กำลังเปิดหน้า…
              </div>
            }
          >
            <Routes>
              <Route
                path="/tables"
                element={
                  <Only roles={["owner", "manager"]}>
                    <Tables />
                  </Only>
                }
              />
              <Route
                path="/"
                element={
                  <Navigate
                    to={user.role === "kitchen" ? "/kds" : "/pos"}
                    replace
                  />
                }
              />
              <Route
                path="/pos"
                element={
                  <Only roles={["owner", "manager", "cashier"]}>
                    <Pos />
                  </Only>
                }
              />
              <Route
                path="/orders"
                element={
                  <Only roles={["owner", "manager", "cashier"]}>
                    <Orders />
                  </Only>
                }
              />
              <Route path="/kds" element={<Kds />} />
              <Route
                path="/menu"
                element={
                  <Only roles={["owner", "manager"]}>
                    <Menu />
                  </Only>
                }
              />
              <Route
                path="/inventory"
                element={
                  <Only roles={["owner", "manager"]}>
                    <Inventory />
                  </Only>
                }
              />
              <Route
                path="/reports"
                element={
                  <Only roles={["owner", "manager"]}>
                    <Reports />
                  </Only>
                }
              />
              <Route
                path="/forecast"
                element={
                  <Only roles={["owner", "manager"]}>
                    <Forecast />
                  </Only>
                }
              />
              <Route
                path="/forecast/replay"
                element={
                  <Only roles={["owner", "manager"]}>
                    <HistoricalReplay />
                  </Only>
                }
              />
              <Route
                path="/users"
                element={
                  <Only roles={["owner", "manager"]}>
                    <UserAdmin />
                  </Only>
                }
              />
              <Route path="/account" element={<Account />} />
              <Route
                path="/receipt/:id"
                element={
                  <Only roles={["owner", "manager", "cashier"]}>
                    <Receipt />
                  </Only>
                }
              />
              <Route
                path="*"
                element={
                  <div className="empty">
                    ไม่พบหน้านี้ <Link to="/">กลับหน้าหลัก</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
function Session() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function refresh() {
    const data = await api<{ user: User }>("/auth/me");
    setUser(data.user);
  }
  useEffect(() => {
    void refresh()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (loading)
    return (
      <div className="loading startup">
        <Spinner /> กำลังตรวจสอบบัญชี…
      </div>
    );
  if (error)
    return (
      <div className="startup">
        <Notice tone="danger">
          {error}
          <button onClick={() => window.location.reload()}>ลองอีกครั้ง</button>
        </Notice>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(value) => {
          setUser(value);
          if (value.role === "kitchen") navigate("/kds");
        }}
      />
    );
  return (
    <AuthContext value={{ user, refresh }}>
      <LiveProvider>
        <Shell
          logout={async () => {
            await mutate("/auth/logout", "POST");
            setUser(null);
            navigate("/");
          }}
        />
      </LiveProvider>
    </AuthContext>
  );
}
export function App() {
  const location = useLocation();
  const customer = /^\/(table|track)(\/|$)/.test(location.pathname);
  return (
    <ConfirmProvider>
      <ToastProvider>
        {customer ? (
          <Suspense
            fallback={
              <div className="startup loading">
                <Spinner /> กำลังเปิดเมนู…
              </div>
            }
          >
            <Customer />
          </Suspense>
        ) : (
          <Session />
        )}
      </ToastProvider>
    </ConfirmProvider>
  );
}
