# Original PromptPay payment image

The payment QR is the owner's original PNG, stored unchanged in PostgreSQL `payment_qr` rather than in the public source repository. Migration 013 is additive. Owner/manager can replace it; owner/manager/cashier can display it. Guest and kitchen sessions cannot read the bank image. Responses are not cached publicly. Backups include the private bank image.

The POS PromptPay choice and the order-detail payment form share `PromptPayQr`. Both show the current amount, the exact image and a full-size link. Static QR codes do not automatically contain the order amount: the payer must enter the displayed amount in their bank app and check the recipient. Fixed-amount codes show their embedded amount and warn on an order-amount mismatch. Selecting a different method resets the order-form verification checkbox.

Showing or scanning the image never marks an order as paid. The cashier must verify incoming funds and confirm payment through the existing manual process. No payment gateway, bank notification, slip verification or automatic transfer is added. The customer dining-first/counter-payment workflow remains unchanged.

To replace the image locally, start the app and run:

```powershell
node scripts/set-promptpay-image.mjs "C:\path\original-qr.png"
```

The helper uses the locally configured owner login and does not log credentials or recipient payload identifiers. Upload validates a PNG of at most 2 MiB/4 million pixels, decodes the QR, checks Thai currency/country/payment identifier and EMV CRC, and records an audit event. Pixel decoding is used only for validation; stored/served image bytes are the original file. Invalid uploads leave the previous image intact. These checks validate the image format, not ownership of the receiving account or actual settlement.
