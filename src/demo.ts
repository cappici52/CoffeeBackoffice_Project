import { randomUUID } from "node:crypto";
import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { businessDate, moveStock, record } from "./shop/shared.js";

const config = readConfig();
if (config.NODE_ENV === "production")
  throw new Error("Demo seeding is disabled in production");
const db = connectDatabase(config.DATABASE_URL);
try {
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(7301006)");
    if ((await sql.query("SELECT id FROM products LIMIT 1")).rows.length) {
      console.log("Products already exist; demo seed skipped");
      return;
    }
    const actor = (
      await sql.query(
        "SELECT id,password_hash FROM users WHERE role='owner' AND is_active ORDER BY created_at LIMIT 1",
      )
    ).rows[0];
    if (!actor) throw new Error("Run db:seed first");
    const categories = new Map<string, string>();
    for (const name of ["กาแฟ", "ชาและอื่น ๆ", "เบเกอรี"]) {
      const id = randomUUID();
      categories.set(name, id);
      await sql.query(
        "INSERT INTO categories (id,name,sort_order) VALUES ($1,$2,$3)",
        [id, name, categories.size],
      );
    }
    const materials = [
      ["เมล็ดกาแฟ", "g", 2000, 300, 80],
      ["นมสด", "ml", 4000, 1500, 5],
      ["นมโอ๊ต", "ml", 1000, 1500, 10],
      ["น้ำเชื่อม", "ml", 2000, 300, 8],
      ["ผงชาไทย", "g", 1000, 200, 60],
      ["ผงมัทฉะ", "g", 500, 100, 250],
      ["น้ำกรอง", "ml", 100000, 10000, 0.01],
      ["แก้วและฝา", "ชิ้น", 200, 50, 350],
      ["ครัวซองต์", "ชิ้น", 30, 10, 1800],
      ["ผงโกโก้", "g", 800, 150, 90],
    ] as const;
    const ingredients = new Map<string, string>();
    for (const [name, unit, stock, reorder, cost] of materials) {
      const id = randomUUID();
      ingredients.set(name, id);
      await sql.query(
        "INSERT INTO ingredients (id,name,unit,reorder_point,cost_satang) VALUES ($1,$2,$3,$4,$5)",
        [id, name, unit, reorder, cost],
      );
      await moveStock(
        sql,
        actor.id,
        id,
        "receipt",
        stock,
        "ยอดตั้งต้นข้อมูลตัวอย่าง",
      );
    }
    const definitions = [
      {
        name: "อเมริกาโน่",
        category: "กาแฟ",
        price: 6500,
        qty: 28,
        recipe: [
          ["เมล็ดกาแฟ", 18],
          ["น้ำกรอง", 120],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "ลาเต้",
        category: "กาแฟ",
        price: 7500,
        qty: 23,
        recipe: [
          ["เมล็ดกาแฟ", 18],
          ["นมสด", 150],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "คาปูชิโน่",
        category: "กาแฟ",
        price: 7500,
        qty: 15,
        recipe: [
          ["เมล็ดกาแฟ", 18],
          ["นมสด", 130],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "เอสเปรสโซ่",
        category: "กาแฟ",
        price: 6000,
        qty: 12,
        recipe: [
          ["เมล็ดกาแฟ", 18],
          ["น้ำกรอง", 60],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "ชาไทย",
        category: "ชาและอื่น ๆ",
        price: 6500,
        qty: 18,
        recipe: [
          ["ผงชาไทย", 8],
          ["นมสด", 120],
          ["น้ำกรอง", 100],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "มัทฉะ",
        category: "ชาและอื่น ๆ",
        price: 8500,
        qty: 16,
        recipe: [
          ["ผงมัทฉะ", 4],
          ["นมสด", 160],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "โกโก้",
        category: "ชาและอื่น ๆ",
        price: 7500,
        qty: 13,
        recipe: [
          ["ผงโกโก้", 15],
          ["นมสด", 150],
          ["น้ำเชื่อม", 10],
          ["แก้วและฝา", 1],
        ],
      },
      {
        name: "ครัวซองต์",
        category: "เบเกอรี",
        price: 6500,
        qty: 10,
        recipe: [["ครัวซองต์", 1]],
      },
    ];
    for (const [index, p] of definitions.entries()) {
      const id = randomUUID();
      const bakery = p.category === "เบเกอรี";
      await sql.query(
        "INSERT INTO products (id,category_id,name,description,price_satang,station,target_prep_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          categories.get(p.category),
          p.name,
          bakery ? "อุ่นก่อนเสิร์ฟ" : "เตรียมสดตามออเดอร์ ปรับความหวานได้",
          p.price,
          bakery ? "kitchen" : "bar",
          bakery ? 240 : 180,
        ],
      );
      await sql.query("INSERT INTO recipes (product_id) VALUES ($1)", [id]);
      for (const [name, qty] of p.recipe)
        await sql.query(
          "INSERT INTO recipe_ingredients (product_id,ingredient_id,qty) VALUES ($1,$2,$3)",
          [id, ingredients.get(String(name)), qty],
        );
      const instructions = bakery
        ? ["อุ่นครัวซองต์ตามอุณหภูมิเตา", "จัดใส่จานหรือถุงตามประเภทออเดอร์"]
        : [
            "เตรียมวัตถุดิบและปริมาณตามรายการด้านบน",
            "ผสมหรือสกัดส่วนหลัก แล้วเติมนมและความหวานตามตัวเลือก",
            "ตรวจหมายเหตุลูกค้าและจัดเสิร์ฟ",
          ];
      for (const [n, instruction] of instructions.entries())
        await sql.query(
          "INSERT INTO recipe_steps (product_id,step_no,instruction,timer_seconds) VALUES ($1,$2,$3,$4)",
          [id, n + 1, instruction, n === 1 ? 30 : 0],
        );
      if (p.recipe.some(([name]) => name === "น้ำเชื่อม")) {
        const groupId = randomUUID();
        await sql.query(
          "INSERT INTO product_option_groups (id,product_id,name,is_required,multi_select,sort_order) VALUES ($1,$2,'ความหวาน',true,false,0)",
          [groupId, id],
        );
        for (const [n, [name, qty]] of [
          ["หวานปกติ", 10],
          ["หวานน้อย", 5],
          ["ไม่หวาน", 0],
          ["หวานมาก", 20],
        ].entries())
          await sql.query(
            "INSERT INTO product_options (id,group_id,name,ingredient_id,ingredient_qty,replaces_ingredient_id,sort_order) VALUES ($1,$2,$3,$4,$5,$4,$6)",
            [randomUUID(), groupId, name, ingredients.get("น้ำเชื่อม"), qty, n],
          );
      }
      if (p.recipe.some(([name]) => name === "นมสด")) {
        const groupId = randomUUID();
        await sql.query(
          "INSERT INTO product_option_groups (id,product_id,name,is_required,multi_select,sort_order) VALUES ($1,$2,'ชนิดนม',true,false,1)",
          [groupId, id],
        );
        await sql.query(
          "INSERT INTO product_options (id,group_id,name,sort_order) VALUES ($1,$2,'นมสด',0)",
          [randomUUID(), groupId],
        );
        await sql.query(
          "INSERT INTO product_options (id,group_id,name,extra_price_satang,ingredient_id,ingredient_qty,replaces_ingredient_id,sort_order) VALUES ($1,$2,'นมโอ๊ต',1500,$3,$4,$5,1)",
          [
            randomUUID(),
            groupId,
            ingredients.get("นมโอ๊ต"),
            p.recipe.find(([name]) => name === "นมสด")?.[1],
            ingredients.get("นมสด"),
          ],
        );
      }
      const today = businessDate();
      for (let day = 84; day > 0; day--) {
        const date = new Date(
          Date.parse(today + "T00:00:00Z") - day * 86400000,
        );
        const weekend = [0, 6].includes(date.getUTCDay());
        const qty = Math.max(
          0,
          Math.round(
            p.qty * (weekend ? 1.2 : 1) + ((day * 7 + index * 3) % 7) - 3,
          ),
        );
        await sql.query(
          "INSERT INTO sales_daily (date,product_id,qty,revenue_satang,source) VALUES ($1,$2,$3,$4,'demo')",
          [date.toISOString().slice(0, 10), id, qty, qty * p.price],
        );
      }
    }
    for (const [role, name] of [
      ["manager", "ผู้จัดการตัวอย่าง"],
      ["cashier", "แคชเชียร์ตัวอย่าง"],
      ["kitchen", "บาร์ตัวอย่าง"],
    ])
      await sql.query(
        "INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING",
        [randomUUID(), name, `${role}@example.com`, actor.password_hash, role],
      );
    await record(sql, actor.id, "demo.seeded", "demo", randomUUID(), {
      products: definitions.length,
      history_days: 84,
    });
    console.log(
      "Demo menu, recipes, opening stock and labeled historical sales created; no real orders/payments created",
    );
  });
} finally {
  await db.close();
}
