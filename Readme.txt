หมายเหตุระบบ
ready:true พร้อมส่ง
colors:[
  { name:'ช่อสีขาว', image:'...', ready:true },   // สีนี้พร้อมส่ง
  { name:'ช่อสีดำ',  image:'...' }                 // สีนี้ไม่พร้อมส่ง
]

isNew:true (สินค้าใหม่)
{ id:'b57', ..., isNew:true }

วิธีเพิ่มรูปหลายมุมใน products.json

เพิ่ม field images (array) แทนที่ image เดิม:

json
{
  "id": "S11",
  "name": "ช่อดอกทานตะวัน - S11",
  "images": [
    "images/s11-1.jpg",
    "images/s11-2.jpg",
    "images/s11-3.jpg"
  ],
  ...
}

ถ้าสินค้ามีตัวเลือกสี (colors) และอยากให้แต่ละสีมีรูปหลายมุมของตัวเอง ก็ใส่ images ในแต่ละสีได้เหมือนกัน:

json
"colors": [
  { "name": "ชมพู", "images": ["images/s11-pink-1.jpg", "images/s11-pink-2.jpg"] },
  { "name": "เหลือง", "image": "images/s11-yellow.jpg" }
]

ถ้ารีวิวไหนยังไม่มีรูป ใส่ "text" แทน "image" ใน reviews.json ได้ ระบบจะโชว์เป็นการ์ดข้อความสำรองแทนอัตโนมัติ (ไม่หายไปเฉยๆ)