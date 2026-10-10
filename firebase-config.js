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

/* ชนิดดอกไม้ "ค่าเริ่มต้น" ใช้ร่วมกันทั้งหน้าร้านและหลังบ้าน
   ปกติไม่ต้องแก้ที่นี่แล้ว — เพิ่ม/ลบ/เรียงชนิดดอกไม้ หมวดหมู่ และขนาดได้ที่หลังบ้าน
   เมนู ⋯ เพิ่มเติม › จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด (ค่าที่บันทึกไว้จะใช้แทนรายการนี้) */
window.FLOWER_TYPES = ['ดอกไม้คละชนิด', 'กุหลาบ', 'ทานตะวัน', 'ทิวลิป', 'ไฮเดรนเยีย', 'เดซี่', 'ลิลลี่', 'เยอบีร่า', 'สตรอว์เบอร์รี่'];