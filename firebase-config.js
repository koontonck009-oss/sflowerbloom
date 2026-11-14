/* =========================================================
   S.Flower Bloom - firebase-config.js
   ไฟล์นี้เก็บ "กุญแจเชื่อมต่อ Firebase" ไว้ที่เดียว ใช้ร่วมกันทั้ง
   index.html (หน้าร้าน) และ admin.html (หลังบ้าน)

   วิธีกรอก: เปิดไฟล์ระบบจัดการออเดอร์ (order-management) ที่ใช้อยู่แล้ว
   หาคำว่า firebaseConfig แล้วคัดลอกค่าทั้ง 6 บรรทัดมาวางแทนข้างล่างนี้
   (ต้องเป็นโปรเจกต์ Firebase เดียวกัน จะได้ล็อกอินด้วยรหัสเดิมได้)
   ========================================================= */

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAKFvEnppUTj2iW8UXsh4-fCnMBvtF1UP8",
  authDomain:        "sflowerbloomordermanager.firebaseapp.com",
  projectId:         "sflowerbloomordermanager",
  storageBucket:     "sflowerbloomordermanager.firebasestorage.app",
  messagingSenderId: "135079797740",
  appId:             "1:135079797740:web:5d3113074955f0ce3c16c9"
};

/* บัญชีผู้ดูแลร้าน (ชุดเดียวกับระบบจัดการออเดอร์)
   ช่องผู้ใช้กรอกว่า admin ระบบจะแปลงเป็นอีเมลข้างล่างนี้ให้เอง */
window.ADMIN_EMAIL = "admin@sflowerbloom.local";

/* ตำแหน่งที่เก็บข้อมูลสินค้าใน Firestore */
window.CATALOG_COLLECTION = "catalog";
window.CATALOG_DOC = "products";

/* ข้อมูลภายในร้าน (ลูกค้าอ่านไม่ได้) — ค่าส่งต่อสินค้า เก็บแยกจากข้อมูลสินค้า
   ต้องตั้ง Firestore Rules ให้ shopPrivate/{doc} อ่าน-เขียนได้เฉพาะที่ล็อกอิน */
window.PRIVATE_COLLECTION = "shopPrivate";
window.SHIPPING_DOC = "shipping";

/* ชนิดดอกไม้ "ค่าเริ่มต้น" ใช้ร่วมกันทั้งหน้าร้านและหลังบ้าน
   ปกติไม่ต้องแก้ที่นี่แล้ว — เพิ่ม/ลบ/เรียงชนิดดอกไม้ หมวดหมู่ และขนาดได้ที่หลังบ้าน
   เมนู ⋯ เพิ่มเติม › จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด (ค่าที่บันทึกไว้จะใช้แทนรายการนี้) */
window.FLOWER_TYPES = ['ดอกไม้คละชนิด', 'กุหลาบ', 'ทานตะวัน', 'ทิวลิป', 'ไฮเดรนเยีย', 'เดซี่', 'ลิลลี่', 'เยอบีร่า', 'สตรอว์เบอร์รี่'];

/* ที่เก็บรูปบน Supabase Storage (รอบ 1: ย้ายเฉพาะรูป ข้อมูลยังอยู่ที่ Firebase)
   เว้นว่าง = ระบบอัปโหลดรูปแบบเดิม (เขียนลงโฟลเดอร์เว็บแล้วลากขึ้น GitHub)
   กรอกแล้ว = หลังบ้านย่อรูปเป็น WebP แล้วอัปขึ้น Supabase ให้เลย ได้ลิงก์รูปกลับมาใช้ทันที
   ค่าสองตัวนี้เปิดเผยในเว็บได้ (Project URL และ publishable/anon key) — ห้ามใส่ service_role key เด็ดขาด */
window.SUPABASE_URL = 'https://rfpnejnrosksrpndaytw.supabase.co';          // เช่น https://abcdefgh.supabase.co
window.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcG5lam5yb3Nrc3JwbmRheXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMjg0MDEsImV4cCI6MjEwODcwNDQwMX0.OtRaAZ9PKgowhJOz4LUpOUW1Oile_eYIEkm1yU2_sQE';          // publishable (anon) key
window.SUPABASE_BUCKET = 'images'; // ชื่อ bucket (ตรงกับที่สร้างใน supabase-setup.sql)
window.SUPABASE_ADMIN_EMAIL = '';  // เว้นว่าง = ใช้อีเมลเดียวกับ ADMIN_EMAIL ด้านบน (ต้องสร้างผู้ใช้นี้ใน Supabase Auth ด้วยรหัสผ่านเดียวกัน)

window.DATA_SOURCE = 'supabase';

/* ตัวย้ายข้อมูลออเดอร์ Firebase → Supabase (รอบ 3, ชั่วคราว)
   โหลดเฉพาะเมื่อเปิดหน้าออเดอร์ด้วยลิงก์ที่ลงท้ายว่า ?migrate=1 — ใช้งานปกติไม่มีผลอะไร
   ลบทั้งบล็อกนี้พร้อมไฟล์ OrderMigrate.js ได้ตอนล้างโค้ด Firebase */
if (/[?&]migrate=1/.test(location.search) && /OrderManagers/i.test(location.pathname)) {
  var sfbMig = document.createElement('script');
  sfbMig.src = 'OrderMigrate.js';
  document.head.appendChild(sfbMig);
}

/* ระบบออเดอร์: เลือกฐานข้อมูล (รอบ 3 ช่วง 4ก)
   'firebase' = ใช้ Firebase เหมือนเดิม | 'supabase' = ใช้ Supabase
   ทดสอบก่อนได้โดยเติม ?src=supabase ท้ายลิงก์หน้าออเดอร์ (ไม่กระทบเครื่องอื่น) ย้อนกลับด้วย ?src=firebase */
window.ORDERS_SOURCE = 'firebase';
if (/OrderManagers/i.test(location.pathname)) {
  if (/[?&]src=supabase/.test(location.search)) { window.ORDERS_SOURCE = 'supabase'; window.ORDERS_SOURCE_TEST = true; }
  else if (/[?&]src=firebase/.test(location.search)) { window.ORDERS_SOURCE = 'firebase'; }
  if (window.ORDERS_SOURCE === 'supabase' && !/[?&]migrate=1/.test(location.search)) {
    document.write('<script src="supabase-js.umd.js"><\/script><script src="OrderData.js"><\/script>');
  }
}
