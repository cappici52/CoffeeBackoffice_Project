CREATE TABLE menu_images (
  id uuid NOT NULL UNIQUE,
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
