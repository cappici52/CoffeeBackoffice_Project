# ตรวจข้อมูลสำหรับพยากรณ์ — 3 พฤศจิกายน 2569

คำขอผู้ใช้อนุญาตให้หาแหล่งข้อมูลใหม่และเปลี่ยนโมเดลได้ เป้าหมายจึงเป็นข้อมูลที่เหมาะกับจำนวนสินค้ารายวันและประเมินตามเวลาได้ ไม่ใช่การหา dataset ใหญ่ขึ้นโดยไม่ตรวจที่มา

| แหล่ง                                                                                                  | สิ่งที่ตรวจพบจากต้นทาง                                                                                            | การตัดสินใจ                                                           |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Coffee Sales โดย ihelon](https://www.kaggle.com/datasets/ihelon/coffee-sales)                         | ประวัติเครื่องขายเครื่องดื่ม; metadata เดิมระบุ CC0; index_1 มี 3,636 ธุรกรรม 8 เครื่องดื่ม 2024-03-01–2025-03-23 | คงเป็น external benchmark ที่ตรวจ hash/ที่มาได้ ไม่ปลอมว่าเป็นร้านนี้ |
| [Maven Coffee Shop Sales](https://mavenanalytics.io/guided-projects/coffee-shop-dashboard)             | ต้นทางระบุร้าน fictitious แม้มี 149,116 records                                                                   | ไม่เลือกเป็นหลักฐานข้อมูลจริง                                         |
| [French bakery daily sales](https://www.kaggle.com/datasets/matthieugimbert/french-bakery-daily-sales) | ผู้เผยแพร่อธิบายธุรกรรมร้านปี 2021–2022 แต่ metadata license ระบุ Data files © Original Authors                   | ยังไม่ดาวน์โหลด/เทรน/แจกจ่าย เพราะสิทธิ์ใช้ต่อไม่ชัดจากข้อมูลที่ตรวจ  |
| [Transactions from a bakery](https://www.kaggle.com/datasets/sulmansarwar/transactions-from-a-bakery)  | API metadata ตอบ license Unknown และไม่มี description ที่ยืนยันได้ในรอบตรวจ                                       | ยังไม่เลือกหรืออ้างว่าอนุญาตใช้                                       |
| ยอดจากแอป                                                                                              | มีหลักฐานการส่งมอบจริงและรู้สูตร/เมนูของร้าน แต่ประวัติจริงยังสั้น                                                | เป็นข้อมูลหลักสำหรับ production เมื่อครบเกณฑ์; demo แยกโหมด           |

ไม่เลือกแหล่งใหม่มาใช้เพียงเพราะผู้ใช้อนุญาต หากมีข้อมูลจริงจากร้านที่ยินยอมให้ใช้ในอนาคต ให้ตรวจหน่วย quantity, timezone, วันที่ขาด, คืนเงิน/ยกเลิก, สินค้าขาด และสิทธิ์ก่อนเพิ่ม adapter ไม่จับคู่ชื่อสินค้าอังกฤษกับเมนูไทยแบบเดาเอง

## ข้อจำกัดของ Coffee Sales

ไฟล์ไม่มี quantity จึงนับธุรกรรมเครื่องดื่มเป็น proxy ของหน่วยขาย ข้อมูลต่างประเทศ/เครื่องจำหน่ายมี scale และกระบวนการต่างจากร้านนี้ วันที่ทั้งเครื่องไม่มีข้อมูลเป็น unknown ไม่เติมศูนย์ วันที่เครื่องมีธุรกรรมแต่เมนูไม่มีรายการอาจเป็น zero recorded transactions แต่ไม่ยืนยันว่าเมนูมี stock อยู่จริง

index_2 มีเพียง 262 รายการ 2025-02-08–2025-03-23 และ schema ไม่มี card ไม่รวมเข้ากับ index_1 โดยไม่ทราบว่าเป็น stream เดียวกัน ไม่นำ anonymous card IDs หรือราคาต่างสกุลเงินเป็น feature ในโมเดล external

## ผลเปรียบเทียบหลายจุดเวลา

`forecast-service/evaluate_rolling.py` ตรวจ prepared CSV SHA-256 กับ source manifest ใช้ห้า origins ที่มีประวัติและ target ครบ คือ 2024-06-26, 07-24, 08-21, 09-18 และ 10-16 จุดละ 28 วัน เว้น origins ที่มี unknown calendar dates ไว้ ใช้ช่วงเป้าหมายที่ไม่ซ้อนกันสำหรับ horizon 28 และไม่ใช้ final holdout 28 วันของรายงานเดิมในรอบนี้

เปรียบเทียบ seasonal/means/SES/damped Holt และ normalized XGBoost Poisson/absolute error บน target และจำนวนคู่เดียวกัน รายละเอียดครบอยู่ใน [rolling-evaluation.json](../forecast-service/evaluations/coffee-sales/rolling-evaluation.json) ตัวเลือก/ค่าพารามิเตอร์ประกาศในโค้ด ไม่ทำ parameter search บน holdout เดิม

ผล Windows ที่บันทึกไว้ (horizon คือคะแนนรวมวันที่ 1 ถึง h ของแต่ละ origin):

| Horizon | วิธีที่ MAE ต่ำสุด              | MAE    | WAPE   | คู่ทดสอบ |
| ------- | ------------------------------- | ------ | ------ | -------- |
| 1 วัน   | Relative XGBoost absolute error | 0.8031 | 66.92% | 40       |
| 7 วัน   | SES                             | 1.0382 | 77.52% | 280      |
| 14 วัน  | Relative XGBoost absolute error | 0.9987 | 76.82% | 560      |
| 28 วัน  | Relative XGBoost absolute error | 1.0399 | 81.56% | 1,120    |

คะแนนเหล่านี้วัด recorded transactions ของเครื่อง ไม่ใช่ accuracy ของแอปในร้านไทย และ WAPE ยังสูง ไม่ใช้เป็นเหตุผล promote โมเดล external ที่เคยแพ้ baseline บน frozen holdout เดิม

รายงานนี้เป็น **reanalysis ของ dataset ที่เคยตรวจแล้ว** ไม่ใช่ blind test ใหม่ แม้บางวิธีชนะในบาง horizons ก็ไม่ใช่หลักฐานว่าถ่ายโอนไปเมนูไทยได้ ดังนั้น `deployment_approved=false` โมเดล external ไม่ถูกใส่ใน production service และไม่มีข้อมูลภายนอกเข้าฐานยอดขายจริง

```powershell
.\.venv\Scripts\python.exe forecast-service/evaluate_rolling.py --output .local/coffee-rolling-replay.json
```

ผล retrain XGBoost ต่าง OS อาจมีความแตกต่างเชิงตัวเลข ต้องรายงาน environment และ artifact ที่ใช้ การทวน frozen holdout เดิมยังใช้ `holdout-model.json` เดิมโดยไม่แก้คะแนน

สำหรับ production ใช้ระบบเลือกวิธีจากข้อมูลร้านใน [forecast-v2.md](forecast-v2.md) โดยเปิดทางให้วิธีสถิติง่ายกว่าชนะได้ เก็บข้อมูลจริงเพิ่มเติมจึงสำคัญกว่าการบังคับใช้ XGBoost หรือเปลี่ยน dataset โดยไม่มีหลักฐาน
