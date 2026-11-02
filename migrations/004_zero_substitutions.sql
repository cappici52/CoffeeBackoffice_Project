ALTER TABLE product_options DROP CONSTRAINT product_options_ingredient_qty_check;
ALTER TABLE product_options ADD CONSTRAINT product_options_ingredient_qty_check CHECK(ingredient_qty >= 0);
