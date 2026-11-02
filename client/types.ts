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
    lower_qty: Decimal;
    upper_qty: Decimal;
    model_version: string;
    generated_at: string;
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
  accuracy: { samples: number; mape: number | null; rmse: number | null };
  contains_demo_history: boolean;
}
