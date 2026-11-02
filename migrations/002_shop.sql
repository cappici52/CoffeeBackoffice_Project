CREATE TABLE categories (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE ingredients (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE, unit text NOT NULL,
 current_stock numeric(16,3) NOT NULL DEFAULT 0 CHECK(current_stock >= 0),
 reorder_point numeric(16,3) NOT NULL DEFAULT 0 CHECK(reorder_point >= 0),
 cost_satang numeric(16,4) NOT NULL DEFAULT 0 CHECK(cost_satang >= 0),
 is_active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1
);
CREATE TABLE products (
 id uuid PRIMARY KEY, category_id uuid NOT NULL REFERENCES categories(id),
 name text NOT NULL, description text NOT NULL DEFAULT '', price_satang integer NOT NULL CHECK(price_satang >= 0),
 image_url text NOT NULL DEFAULT '', is_available boolean NOT NULL DEFAULT true,
 is_archived boolean NOT NULL DEFAULT false, station text NOT NULL CHECK(station IN ('bar','kitchen')),
 target_prep_seconds integer NOT NULL DEFAULT 180 CHECK(target_prep_seconds > 0), version integer NOT NULL DEFAULT 1
);
CREATE INDEX products_category_idx ON products(category_id);
CREATE TABLE product_option_groups (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 name text NOT NULL, is_required boolean NOT NULL DEFAULT false, multi_select boolean NOT NULL DEFAULT false, sort_order integer NOT NULL
);
CREATE TABLE product_options (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
 name text NOT NULL, extra_price_satang integer NOT NULL DEFAULT 0 CHECK(extra_price_satang >= 0),
 ingredient_id uuid REFERENCES ingredients(id), ingredient_qty numeric(16,3) CHECK(ingredient_qty > 0),
 replaces_ingredient_id uuid REFERENCES ingredients(id), sort_order integer NOT NULL,
 CHECK((ingredient_id IS NULL AND ingredient_qty IS NULL AND replaces_ingredient_id IS NULL) OR (ingredient_id IS NOT NULL AND ingredient_qty IS NOT NULL))
);
CREATE TABLE recipes (
 product_id uuid PRIMARY KEY REFERENCES products(id), version integer NOT NULL DEFAULT 1
);
CREATE TABLE recipe_ingredients (
 product_id uuid NOT NULL REFERENCES recipes(product_id) ON DELETE CASCADE,
 ingredient_id uuid NOT NULL REFERENCES ingredients(id), qty numeric(16,3) NOT NULL CHECK(qty > 0),
 PRIMARY KEY(product_id, ingredient_id)
);
CREATE TABLE recipe_steps (
 product_id uuid NOT NULL REFERENCES recipes(product_id) ON DELETE CASCADE, step_no integer NOT NULL,
 instruction text NOT NULL, image_url text NOT NULL DEFAULT '', timer_seconds integer NOT NULL DEFAULT 0 CHECK(timer_seconds >= 0),
 PRIMARY KEY(product_id,step_no)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE, request_hash text NOT NULL,
 order_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 type text NOT NULL CHECK(type IN ('dine-in','takeaway')), table_no text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','completed','cancelled')),
 total_satang integer NOT NULL CHECK(total_satang >= 0), note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, cancelled_at timestamptz, cancel_reason text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX orders_created_idx ON orders(created_at);
CREATE INDEX orders_status_idx ON orders(status, created_at);
CREATE TABLE order_items (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES products(id), product_name text NOT NULL, qty integer NOT NULL CHECK(qty > 0),
 unit_price_satang integer NOT NULL CHECK(unit_price_satang >= 0), unit_cost_satang numeric(16,4) NOT NULL CHECK(unit_cost_satang >= 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','completed','cancelled')),
 station text NOT NULL CHECK(station IN ('bar','kitchen')), note text NOT NULL DEFAULT '',
 options jsonb NOT NULL DEFAULT '[]', ingredients jsonb NOT NULL DEFAULT '[]', steps jsonb NOT NULL DEFAULT '[]',
 target_prep_seconds integer NOT NULL, started_at timestamptz, completed_at timestamptz
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_status_idx ON order_items(status, station);
CREATE TABLE payments (
 order_id uuid PRIMARY KEY REFERENCES orders(id), method text NOT NULL CHECK(method IN ('cash','promptpay')),
 amount_satang integer NOT NULL CHECK(amount_satang >= 0), status text NOT NULL CHECK(status IN ('paid','refunded')),
 paid_at timestamptz NOT NULL DEFAULT now(), confirmed_by uuid NOT NULL REFERENCES users(id), refunded_at timestamptz
);
CREATE TABLE order_status_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id),
 from_status text, to_status text NOT NULL, changed_by uuid NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_movements (
 id uuid PRIMARY KEY, ingredient_id uuid NOT NULL REFERENCES ingredients(id),
 type text NOT NULL CHECK(type IN ('receipt','waste','sale','return')),
 qty numeric(16,3) NOT NULL CHECK(qty <> 0), balance_after numeric(16,3) NOT NULL CHECK(balance_after >= 0),
 reason text NOT NULL, ref_order_id uuid REFERENCES orders(id), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((type IN ('receipt','return') AND qty > 0) OR (type IN ('waste','sale') AND qty < 0))
);
CREATE INDEX stock_movements_ingredient_idx ON stock_movements(ingredient_id,created_at);
CREATE UNIQUE INDEX stock_sale_once ON stock_movements(ref_order_id, ingredient_id, type) WHERE ref_order_id IS NOT NULL;
CREATE TABLE day_closings (
 date date PRIMARY KEY, closed_by uuid NOT NULL REFERENCES users(id), closed_at timestamptz NOT NULL DEFAULT now(),
 summary jsonb NOT NULL, note text NOT NULL DEFAULT ''
);
CREATE TABLE sales_daily (
 date date NOT NULL, product_id uuid NOT NULL REFERENCES products(id), qty numeric(12,3) NOT NULL CHECK(qty >= 0),
 revenue_satang bigint NOT NULL CHECK(revenue_satang >= 0), source text NOT NULL CHECK(source IN ('actual','demo')),
 PRIMARY KEY(date,product_id,source)
);
CREATE TABLE forecasts (
 id uuid PRIMARY KEY, forecast_date date NOT NULL, product_id uuid NOT NULL REFERENCES products(id),
 predicted_qty numeric(12,3) NOT NULL CHECK(predicted_qty >= 0), lower_qty numeric(12,3) NOT NULL CHECK(lower_qty >= 0),
 upper_qty numeric(12,3) NOT NULL, model_version text NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(lower_qty <= predicted_qty AND predicted_qty <= upper_qty),
 UNIQUE(forecast_date,product_id)
);
CREATE INDEX forecasts_date_idx ON forecasts(forecast_date);
