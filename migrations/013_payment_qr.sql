CREATE TABLE payment_qr (
 id text PRIMARY KEY CHECK(id='promptpay'),
 image bytea NOT NULL CHECK(octet_length(image) BETWEEN 1 AND 2097152),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 fixed_amount_satang bigint CHECK(fixed_amount_satang BETWEEN 1 AND 10000000),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
