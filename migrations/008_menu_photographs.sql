-- Only fill missing pictures for known menu names; preserve custom photos.
WITH photos(name,path) AS (VALUES
  ('อเมริกาโน่','/menu/americano.jpg'),
  ('ลาเต้','/menu/latte.jpg'),
  ('คาปูชิโน่','/menu/cappuccino.jpg'),
  ('เอสเปรสโซ่','/menu/espresso.jpg'),
  ('ชาไทย','/menu/thai-tea.jpg'),
  ('มัทฉะ','/menu/matcha.jpg'),
  ('โกโก้','/menu/cocoa.jpg'),
  ('ครัวซองต์','/menu/croissant.jpg')
) UPDATE products p SET image_url=photos.path,version=p.version+1
FROM photos WHERE p.name=photos.name AND p.image_url='' AND NOT p.is_archived;
