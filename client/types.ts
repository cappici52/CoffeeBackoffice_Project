export type Decimal = number | string;
export type Role = "owner" | "manager" | "cashier" | "kitchen";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
}
export interface Category {
  id: string;
  name: string;
  sort_order: number;
}
export interface Option {
  id: string;
  name: string;
  extra_price_satang: number;
  ingredient_id: string | null;
  ingredient_qty: Decimal | null;
  replaces_ingredient_id: string | null;
}
export interface OptionGroup {
  id: string;
  name: string;
  is_required: boolean;
  multi_select: boolean;
  options: Option[];
}
export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price_satang: number;
  image_url: string;
  is_available: boolean;
  target_prep_seconds: number;
  station: "bar" | "kitchen";
  version: number;
  option_groups: OptionGroup[];
}
export interface Catalog {
  products: Product[];
  categories: Category[];
}
export type MenuProduct = Pick<
  Product,
  | "id"
  | "category_id"
  | "name"
  | "description"
  | "price_satang"
  | "image_url"
  | "is_available"
> & {
  option_groups: (Pick<
    OptionGroup,
    "id" | "name" | "is_required" | "multi_select"
  > & { options: Pick<Option, "id" | "name" | "extra_price_satang">[] })[];
};
export interface MenuCatalog {
  products: MenuProduct[];
  categories: Category[];
}
export interface CartLine {
  key: string;
  product: MenuProduct;
  qty: number;
  option_ids: string[];
  note: string;
}
export interface DiningTable {
  id: string;
  name: string;
  qr_token: string;
  menu_url: string;
  is_active: boolean;
  version: number;
}
export interface GuestOrder {
  confirmed_at: string | null;
  order_no: Decimal;
  table_no: string;
  status: OrderStatus;
  note: string;
  total_satang: number;
  created_at: string;
  completed_at: string | null;
  cancel_reason: string | null;
  payment_status: "paid" | "refunded" | null;
  server_time: string;
  items: {
    id: string;
    product_name: string;
    qty: number;
    unit_price_satang: number;
    status: OrderStatus;
    note: string;
    options: { name: string; group_name: string; extra_price_satang: number }[];
    started_at: string | null;
    completed_at: string | null;
  }[];
}
export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  current_stock: Decimal;
  reorder_point: Decimal;
  cost_satang: Decimal;
  version: number;
}
export interface RecipeIngredient {
  ingredient_id: string;
  qty: Decimal;
  name?: string;
  unit?: string;
}
export interface Step {
  instruction: string;
  image_url: string;
  timer_seconds: number;
  step_no?: number;
}
export interface Recipe {
  product_id: string;
  version: number;
  ingredients: RecipeIngredient[];
  steps: Step[];
}
export type OrderStatus =
  "pending" | "preparing" | "ready" | "completed" | "cancelled";
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_price_satang?: number;
  status: OrderStatus;
  station: "bar" | "kitchen";
  note: string;
  options: { id: string; name: string; group_name: string }[];
  ingredients: {
    ingredient_id: string;
    name: string;
    unit: string;
    qty: number;
  }[];
  steps: Step[];
  target_prep_seconds: number;
  started_at: string | null;
  completed_at: string | null;
}
export interface Order {
  confirmed_at: string | null;
  source?: "pos" | "qr";
  id: string;
  order_no: Decimal;
  type: "dine-in" | "takeaway";
  table_no: string;
  status: OrderStatus;
  note: string;
  created_at: string;
  total_satang: number;
  payment_method: "cash" | "promptpay" | null;
  payment_status: "paid" | "refunded" | null;
  paid_at: string | null;
  created_by_name: string;
  items: OrderItem[];
  cancel_reason?: string;
}
export interface Kds {
  server_time: string;
  orders: Order[];
}
export interface List<T> {
  total: number;
  page: number;
  page_size: number;
  rows?: T[];
}
export interface Report {
  summary: {
    orders: number;
    revenue_satang: Decimal;
    cash_satang: Decimal;
    promptpay_satang: Decimal;
  };
  refunds: { count: number; amount_satang: Decimal };
  daily: { date: string; orders: number; revenue_satang: Decimal }[];
  products: {
    product_id: string;
    product_name: string;
    qty: number;
    revenue_satang: Decimal;
    cost_satang?: Decimal;
    profit_satang?: number;
    avg_prep_seconds: Decimal | null;
  }[];
  hourly: { hour: number; orders: number; revenue_satang: Decimal }[];
  closings: {
    date: string;
    closed_at: string;
    closed_by_name: string;
    note: string;
  }[];
}
export interface Forecasts {
  forecasts: {
    date: string;
    product_id: string;
    product_name: string;
    predicted_qty: Decimal;
    lower_qty: Decimal | null;
    upper_qty: Decimal | null;
    model_version: string;
    history_source: "actual" | "demo" | "mixed" | "unknown";
    generated_at: string;
    diagnostics?: {
      origin: string;
      history_days: number;
      reason: string;
      selection: Record<
        string,
        { mae: number; rmse: number; wape: number | null; samples: number }
      >;
    } | null;
  }[];
  actual: { date: string; product_id: string; qty: Decimal }[];
  recommendations: {
    id: string;
    name: string;
    unit: string;
    current_stock: Decimal;
    required_qty: Decimal;
    order_qty: Decimal;
  }[];
  accuracy: ForecastMetrics;
  runs: {
    id: string;
    generated_at: string;
    date_from: string;
    date_to: string;
    data_mode: "actual" | "mixed";
    target_basis: string;
    history_sha256: string;
    contains_simulated_sales: boolean;
  }[];
  coverage: {
    product_id: string;
    name: string;
    latest_date: string | null;
    consecutive_days: number;
    actual_days: number;
    ready: boolean;
  }[];
  evaluation: {
    basis: string;
    policy: string;
    by_source: (ForecastMetrics & { source: string })[];
    by_product_lead: (ForecastMetrics & {
      product_id: string;
      lead_days: number;
    })[];
    latest_test: { id: string; date_from: string; date_to: string } | null;
  };
  displayed_run: {
    id: string;
    generated_at: string;
    data_mode: "actual" | "mixed";
    contains_simulated_sales: boolean;
  } | null;
  selected_run_id: string | null;
  contains_demo_history: boolean;
  contains_simulated_sales: boolean;
  model_mode: "adaptive" | "mock" | "mixed" | "empty";
}
export interface ForecastMetrics {
  samples: number;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
  zero_actual_samples: number;
}
