# Physical printer acceptance — awaiting hardware

Status: **NOT RUN on physical hardware**. The user has no receipt printer. Browser print preview tests do not establish real-device compatibility.

1. Connect the printer and install its vendor driver. Record make/model, firmware, driver version, OS, paper width and connection type.
2. Sign in as owner/manager/cashier. Open `/printer-test` from a receipt, or directly.
3. Select 58 or 80 mm. In the browser print dialog choose the same driver paper size, scale 100%, disable headers/footers and inspect margins before printing. The browser's paper selection controls receipt layout, not the physical driver's roll size or automatic cutting.
4. Print the clearly labeled calibration page. This creates no order/payment. Check Thai vowels/tone marks, English digits, baht symbol, two-column alignment, clipping, darkness and paper feed/cut.
5. Print a receipt from an isolated test order, once and again. Verify order number, totals, payment state and that printing does not create another sale or stock movement.
6. Test a long menu/options/note and 58/80 mm layouts, printer offline, out of paper and recovery. A failed print must not trigger another payment.

Private evidence template (copy to `.local/acceptance/`):

- Date / build / participant code:
- Make / model / firmware / driver:
- OS / browser / connection:
- Paper 58 or 80 mm / scale / margins:
- Thai glyphs: Not run
- Left/right clipping: Not run
- Long lines/options: Not run
- Amounts/order number: Not run
- Duplicate-print stock/payment stability: Not run
- Offline/paper recovery: Not run
- Feed/cut: Not run
- Photo/evidence path (redact private information):
- Problems and corrective/retest result:

Browser-verified scope: dedicated calibration page, 58mm layout in print media and role-controlled access. No ESC/POS, cash-drawer, silent-print or cutter integration is claimed. Those depend on the selected hardware/integration path.
