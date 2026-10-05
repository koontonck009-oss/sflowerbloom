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

/* ---------- ที่เก็บรูปภาพ (แยกจากเว็บ เพื่อไม่ให้ Deployment Storage ของ Vercel เต็ม) ----------
   รูปสินค้า/รีวิว/โปรโมชันทั้งหมดไปอยู่ใน GitHub repo แยก แล้วเรียกผ่าน jsDelivr (CDN ฟรี)
   ใส่ค่าให้ครบแล้ว path ในระบบยังเป็น images/... เหมือนเดิม โค้ดจะต่อหน้า URL ให้เองตอนแสดงผล

   รูปแบบ:  https://cdn.jsdelivr.net/gh/<ชื่อ GitHub>/<ชื่อ repo รูป>@main/
   ตัวอย่าง: https://cdn.jsdelivr.net/gh/somchai/sflowerbloom-images@main/
   ปล่อยเป็น "" = ใช้รูปจากเว็บเดิมเหมือนก่อน (ปลอดภัย ใช้ได้ระหว่างย้าย) */
window.IMAGE_BASE = "https://cdn.jsdelivr.net/gh/koontonck009-oss/sflowerbloom-images@main/";

/* รูปที่ต้องอยู่กับเว็บ (ไฟล์เล็ก ใช้เป็นโลโก้/og:image) ไม่ย้ายไป repo รูป */
window.IMAGE_LOCAL = ["images/logo.jpg", "images/banner.jpg"];

window.imgUrl = function (p) {
  if (typeof p !== "string" || !p) return p;
  if (!window.IMAGE_BASE) return p;
  if (/^(https?:|data:|blob:|\/\/)/i.test(p)) return p;
  var clean = p.replace(/^\.?\//, "");
  if (window.IMAGE_LOCAL.indexOf(clean) !== -1) return p;
  var base = window.IMAGE_BASE.replace(/\/+$/, "") + "/";
  return base + clean.split("/").map(encodeURIComponent).join("/");
};