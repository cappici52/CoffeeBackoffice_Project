import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import { App } from "./App";
import "./styles.css";
import "./table-ordering.css";
function AppError() {
  return (
    <main className="startup">
      <section className="account-panel">
        <h1>เปิดหน้านี้ไม่สำเร็จ</h1>
        <p className="muted">
          กรุณาลองโหลดหน้าเดิมอีกครั้ง หากยังใช้งานไม่ได้ ให้ติดต่อพนักงาน
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          ลองโหลดอีกครั้ง
        </button>
      </section>
    </main>
  );
}
const router = createBrowserRouter([
  { path: "*", element: <App />, errorElement: <AppError /> },
]);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
