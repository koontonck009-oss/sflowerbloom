/* =========================================================
   S.Flower Bloom - supabase-config.js
   ค่าตั้งของ Supabase + ค่าเริ่มต้นของร้าน ใช้ร่วมกันทั้ง index.html (หน้าร้าน),
   admin.html (หลังบ้าน) และ OrderManagers.html (ระบบจัดการออเดอร์)
   ========================================================= */
/* บัญชีผู้ดูแลร้าน (ชุดเดียวกับระบบจัดการออเดอร์)
   ช่องผู้ใช้กรอกว่า admin ระบบจะแปลงเป็นอีเมลข้างล่างนี้ให้เอง */
window.ADMIN_EMAIL = "admin@sflowerbloom.local";

/* ชนิดดอกไม้ "ค่าเริ่มต้น" ใช้ร่วมกันทั้งหน้าร้านและหลังบ้าน
   ปกติไม่ต้องแก้ที่นี่แล้ว — เพิ่ม/ลบ/เรียงชนิดดอกไม้ หมวดหมู่ และขนาดได้ที่หลังบ้าน
   เมนู ⋯ เพิ่มเติม › จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด (ค่าที่บันทึกไว้จะใช้แทนรายการนี้) */
window.FLOWER_TYPES = ['ดอกไม้คละชนิด', 'กุหลาบ', 'ทานตะวัน', 'ทิวลิป', 'ไฮเดรนเยีย', 'เดซี่', 'ลิลลี่', 'เยอบีร่า', 'สตรอว์เบอร์รี่'];

/* โอกาสพิเศษ / โทนสี / ลำดับเมนูหน้าร้านจอคอม — "ค่าเริ่มต้น" ใช้ร่วมกันทั้งหน้าร้านและหลังบ้าน
   ปกติไม่ต้องแก้ที่นี่ — เพิ่ม/ลบ/เรียงได้ที่หลังบ้าน เมนู ⋯ › จัดการตัวเลือกร้าน (แท็บ โอกาสพิเศษ · โทนสี · ลำดับเมนู)
   คีย์เมนู: home=หน้าแรก occasion=โอกาสพิเศษ tone=โทนสี all=สินค้า flower=ชนิดดอกไม้ price=ราคา reviews=รีวิว how=วิธีสั่งซื้อ contact=ติดต่อเรา */
window.OCCASIONS = ['วันเกิด', 'วันครบรอบ/วาเลนไทน์', 'รับปริญญา', 'ขอบคุณ/ให้กำลังใจ', 'ของขวัญทั่วไป'];
window.TONES = ['ชมพู', 'แดง', 'ส้ม/เหลือง', 'ขาว/ครีม', 'ม่วง', 'ฟ้า/น้ำเงิน', 'คละสี'];
window.MENU_ORDER = ['home', 'occasion', 'tone', 'all', 'flower', 'price', 'reviews', 'how', 'contact'];

/* Supabase: ข้อมูลร้าน (ตาราง shop_catalog / shop_private / orders ฯลฯ) และที่เก็บรูป (Storage)
   ค่าสองตัวนี้เปิดเผยในเว็บได้ (Project URL และ publishable/anon key) — ห้ามใส่ service_role key
   ชื่อ bucket ตรงกับที่สร้างใน supabase-setup.sql */
window.SUPABASE_URL = 'https://rfpnejnrosksrpndaytw.supabase.co';          // เช่น https://abcdefgh.supabase.co
window.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcG5lam5yb3Nrc3JwbmRheXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMjg0MDEsImV4cCI6MjEwODcwNDQwMX0.OtRaAZ9PKgowhJOz4LUpOUW1Oile_eYIEkm1yU2_sQE';          // publishable (anon) key
window.SUPABASE_BUCKET = 'images'; // ชื่อ bucket (ตรงกับที่สร้างใน supabase-setup.sql)
window.SUPABASE_ADMIN_EMAIL = '';  // เว้นว่าง = ใช้อีเมลเดียวกับ ADMIN_EMAIL ด้านบน (ต้องสร้างผู้ใช้นี้ใน Supabase Auth ด้วยรหัสผ่านเดียวกัน)
