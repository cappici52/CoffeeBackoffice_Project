import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function branchBrowserChecks({page,base,output,checks}){
 await page.goto(base+'/branches');
 await expect(page.getByRole('heading',{name:'สาขา',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'เพิ่มสาขา',exact:true}).click();
 await page.getByLabel('ชื่อสาขา',{exact:true}).fill('สาขา QA');
 await page.getByLabel('รหัสสาขา',{exact:true}).fill('QA4');
 await page.getByLabel('ที่อยู่',{exact:true}).fill('สถานที่ทดสอบแยกจากร้านจริง');
 await page.getByRole('button',{name:'บันทึกสาขา',exact:true}).click();
 await expect(page.getByRole('rowheader',{name:'สาขา QA',exact:true})).toBeVisible();
 const select=page.getByLabel('สาขาปัจจุบัน',{exact:true});
 const legacy=await select.inputValue();
 const branch=await select.locator('option').filter({hasText:'สาขา QA'}).getAttribute('value');
 async function choose(value){await page.getByLabel('สาขาปัจจุบัน',{exact:true}).selectOption(value);await page.getByRole('button',{name:'เปลี่ยนสาขา',exact:true}).click();await expect(page.getByLabel('สาขาปัจจุบัน',{exact:true})).toHaveValue(value);}
 await choose(branch);
 await page.goto(base+'/orders');
 const orders=await page.request.get(base+'/api/orders',{headers:{'X-Branch-Id':branch}});assert.equal((await orders.json()).total,0);
 await page.goto(base+'/reports');
 await expect(page.getByRole('heading',{name:'ผลประกอบการแยกสาขา'})).toBeVisible();
 await expect(page.getByRole('rowheader',{name:'สาขา QA',exact:true})).toBeVisible();
 const report=await page.request.get(base+'/api/reports?date_from=2026-01-01&date_to=2026-12-31',{headers:{'X-Branch-Id':branch}});assert.equal(Number((await report.json()).summary.revenue_satang),0);
 await page.screenshot({path:join(output,'branch-empty-desktop.png'),fullPage:true});
 await page.goto(base+'/branch-products');
 const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'ลาเต้',exact:true})});
 await row.getByRole('button',{name:'ตั้งค่า',exact:true}).click();
 await page.getByLabel('ราคาสาขา (บาท)',{exact:true}).fill('99');
 await page.getByRole('button',{name:'บันทึกเมนูสาขา',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(row).toContainText('99');
 await choose('all');
 await expect(page.getByRole('heading',{name:'ผลประกอบการแยกสาขา'})).toBeVisible();
 await expect(page.getByRole('button',{name:'ปิดวันขาย',exact:true})).toBeDisabled();
 await expect(page.getByRole('rowheader',{name:'สาขา QA',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:join(output,'branches-mobile.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Branch report overflows on mobile');
 await page.setViewportSize({width:1536,height:960});
 await choose(legacy);await page.goto(base+'/pos');
 checks.push('Fourth branch creation, guarded branch selection, empty branch data, branch price override, consolidated read-only report and 390px layout');
}
