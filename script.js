/* =========================================================
   S.Flower Bloom - script.js
   ระบบทั้งหมดของหน้าเว็บ: โหลดสินค้าจาก products.json, ตะกร้าสินค้า,
   ตัวเลือกสินค้า (สี/ไซซ์/ของเสริม), คำนวณราคา และระบบสั่งซื้อ
   ถูกเรียกใช้จาก index.html ผ่าน <script src="script.js" defer><\/script>
   ========================================================= */

/* ---------------- แก้ไขสินค้าตรงนี้ได้เลย ---------------- */
let PRODUCTS = []; // โหลดจาก products.json ตอนเปิดหน้าเว็บ (ดูฟังก์ชัน loadProducts ด้านล่าง)
const PAGE_LINK = 'https://m.me/S.Flower.Bloom44';

/* ---------- โหมดปิดราคาทั้งร้าน (สวิตช์อยู่ที่หลังบ้าน admin.html) ----------
   ค่าเริ่มต้น = ซ่อนไว้ก่อน เพื่อกันราคาหลุดเมื่ออ่านค่าจาก Firestore ไม่ทัน/ไม่ได้ (ตกไปใช้ products.json)
   จะแสดงราคาก็ต่อเมื่ออ่านเอกสารจาก Firestore ได้สำเร็จ และหลังบ้านไม่ได้เปิดสวิตช์ซ่อนราคาไว้ */
let PRICES_HIDDEN = true;
let cloudHidePrices = true;   // ค่าที่อ่านได้ล่าสุดจาก Firestore
/* ---------- โหมดปิดระบบสั่งทำ/ตะกร้า (สวิตช์ "ปิดระบบสั่งทำ / ตะกร้า" ที่หลังบ้าน) ----------
   ยังแสดงราคาตามปกติ แต่ปิดตะกร้า/ปุ่มสั่งทำ ให้ลูกค้าแคปหน้าจอแล้วทักเพจ
   ค่าเริ่มต้น = ไม่ปิด (ต่างจากราคา) — อ่านค่าไม่ได้/เน็ตช้า ร้านจะได้ไม่เสียออเดอร์ */
let ORDERS_CLOSED = false;
let cloudOrderClosed = false; // ค่าที่อ่านได้ล่าสุดจาก Firestore (ช่อง orderClosed)
function setOrdersClosed(v){
  ORDERS_CLOSED = !!v;
  document.documentElement.classList.toggle('orders-closed', ORDERS_CLOSED);
}
function ordersBlocked(){ return PRICES_HIDDEN || ORDERS_CLOSED; } // ปิดสั่งซื้อไม่ว่าด้วยเหตุผลใด (ซ่อนราคา หรือ ปิดสั่งทำ)
let REVIEW_HIDDEN = new Set(); // รูปรีวิวที่ร้านลบออกจากเว็บ (ซ่อน) จากหลังบ้าน — ไม่แสดงในแถบรีวิว/รีวิวทั้งหมด/แกลเลอรีสินค้า
let REVIEW_TAGS = {};         // ป้ายสินค้าของรูปรีวิว { 'review12.jpg': ['s13'] } จากหลังบ้าน (ช่อง reviewsJson) — ว่าง = รีวิวไม่ผูกสินค้า
let cloudStamp = null;        // ตราเวลา+สถานะสวิตช์+เวลาแก้ตัวเลือกร้านล่าสุดจาก Firestore
let cloudOptions = null;      // ตัวเลือกร้าน (หมวดหมู่/ชนิดดอกไม้/ขนาด) ที่แก้จากหลังบ้าน null = ใช้ค่าเริ่มต้นในไฟล์นี้
let CATALOG_DOC_STAMP = null; // ตราที่ใช้ตอนโหลดหน้านี้ (null = ไม่ได้ใช้ข้อมูลจาก Firestore)
let SITE_CFG = null;           // ค่า "แต่งหน้าร้าน" จากหลังบ้าน (ช่อง siteJson) — null = ใช้ค่าตั้งต้นในโค้ด/HTML
let SITE_SHOP_NAME = 'S.Flower Bloom';
let _siteReadyRes; const SITE_READY = new Promise(r => { _siteReadyRes = r; }); // แบนเนอร์/ป๊อปอัปรอจนรู้ค่าตั้งก่อนค่อยเริ่ม
const PRICE_ASK_SHORT = 'สอบถามราคาทางเพจ';
const PRICE_LOADING_SHORT = 'กำลังโหลดราคา…';
let PRICES_PENDING = false;   // true = ยังไม่รู้สถานะราคาจาก Firestore (โหลดไม่ทัน/เน็ตช้า) — ยังซ่อนราคาไว้เหมือนเดิม แต่โชว์ว่า "กำลังโหลดราคา…" แทนข้อความให้ไปถามเพจ
function setPricesPending(v){
  PRICES_PENDING = !!v;
  document.documentElement.classList.toggle('prices-pending', PRICES_PENDING);
}
function setPricesHidden(v){
  PRICES_HIDDEN = !!v;
  document.documentElement.classList.toggle('prices-hidden', PRICES_HIDDEN);
}
function priceAskHtml(){
  if(PRICES_PENDING) return '<div class="price-ask-text">⏳ <b>กำลังโหลดราคา…</b> รอสักครู่นะคะ</div>';
  return '<div class="price-ask-text">📸 <b>แคปหน้าจอสินค้านี้</b> (ให้เห็นชื่อสินค้าและตัวเลือกที่เลือก) แล้วส่งให้เพจเพื่อสอบถามราคาได้เลยค่ะ</div>'
    + '<a class="price-ask-btn" href="' + PAGE_LINK + '" target="_blank" rel="noopener">💬 ทักเพจสอบถามราคา</a>';
}
// วาง URL ของ Google Apps Script Web App (หลัง Deploy แล้ว) แทนที่ค่าด้านล่างนี้
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwfNGO22TxU0kBqbNbn7eaSIo4W4qlXiqTVPcSo5wyLMWedZmOWLYDKiKzJcfHEW-TdnA/exec';
/* --------------------------------------------------------- */

const ICONS = {
  bouquet: `<svg viewBox="0 0 64 64"><g fill="none" stroke="#F62188" stroke-width="2.5"><path d="M32 30 L26 56" stroke="#E0399B"/><path d="M32 30 L38 56" stroke="#E0399B"/><path d="M32 30 L32 58" stroke="#E0399B"/></g><circle cx="32" cy="20" r="9" fill="#F62188"/><circle cx="20" cy="26" r="8" fill="#FFC6FF"/><circle cx="44" cy="26" r="8" fill="#FFC6FF"/><circle cx="26" cy="16" r="6" fill="#E0399B"/><circle cx="38" cy="16" r="6" fill="#E0399B"/></svg>`,
  frame: `<svg viewBox="0 0 64 64"><rect x="10" y="8" width="44" height="48" rx="3" fill="none" stroke="#E0399B" stroke-width="4"/><rect x="18" y="16" width="28" height="32" fill="#FFC6FF" opacity="0.6"/><circle cx="26" cy="26" r="4" fill="#F62188"/><path d="M18 44 L28 32 L36 40 L46 28 L46 48 L18 48 Z" fill="#E0399B" opacity="0.6"/></svg>`,
  pot: `<svg viewBox="0 0 64 64"><path d="M18 26 H46 L41 54 H23 Z" fill="#F62188"/><rect x="16" y="20" width="32" height="8" rx="2" fill="#E0399B"/><path d="M32 20 C20 20 20 4 32 8 C44 4 44 20 32 20 Z" fill="#FF8FCB"/></svg>`,
  other: `<svg viewBox="0 0 64 64"><rect x="12" y="14" width="40" height="36" rx="4" fill="#FFC6FF"/><path d="M12 22 H52" stroke="#E0399B" stroke-width="3"/><circle cx="32" cy="14" r="6" fill="#F62188"/></svg>`
};

function renderThumb(p, variantLabel){
  let src = null, alt = p.name;
  // variantLabel มาจากตะกร้า — ข้อความรวมที่บันทึกไว้ตอนกดเพิ่ม เช่น "ดอกส้มช่อขาว, ใส่ซองเงิน 5 ใบ"
  // (ถ้าสินค้ามีทั้งสีและตัวเลือกราคา) ต้องแยกส่วนสีกับส่วนตัวเลือกราคาออกจากกันก่อน
  // เพื่อหารูปที่ตรงกับตอนที่ลูกค้าเลือกไว้จริง ไม่ใช่ตัวเลือกปัจจุบันบนหน้าเว็บ
  if(hasNewOptions(p)){
    let v;
    if(variantLabel != null){
      // variantLabel มาจากตะกร้า — สำหรับสินค้าระบบ options ใหม่ จะเป็นค่าที่เลือกทุกมิติคั่นด้วย ", " เรียงตาม p.options เป๊ะ ๆ
      const sel = variantLabel.split(', ');
      v = matchVariant(p, sel);
    } else {
      // ยังไม่ได้เลือกตัวเลือกใดเลย = รูปปก ใช้แบบปกติราคาถูกสุด ไม่ใช่แถวแรกของลิสต์
      v = currentOptionSelection(p).every(x => x == null) ? coverVariantOf(p) : currentVariant(p);
    }
    src = (v && (v.image || (v.images && v.images[0]))) || p.image || (p.images && p.images[0]) || null;
    alt = p.name + (v ? ' ' + v.match.join(' ') : '');
    return src
      ? `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML=window.iconFallbackFor('${p.id}')">`
      : iconFor(p);
  }
  let colorName = null, sizeName = null;
  if(variantLabel != null){
    if(p.colors && p.sizes){
      const idx = variantLabel.lastIndexOf(', ');
      colorName = idx === -1 ? variantLabel : variantLabel.slice(0, idx);
      sizeName = idx === -1 ? null : variantLabel.slice(idx + 2);
    } else if(p.sizes){
      sizeName = variantLabel;
    } else if(p.colors){
      colorName = variantLabel;
    }
  }
  // ตัวเลือกราคา (sizes) มีรูปของตัวเองไหม — ถ้ามี ให้ใช้รูปนี้ก่อนเสมอ (เช่น ใส่ซองเงินแล้วรูปต้องโชว์ซองเงิน
  // ไม่ใช่รูปช่อธรรมดา ไม่ว่าจะเลือกสีอะไรไว้ก็ตาม)
  if(p.sizes && p.sizes.length){
    const sv = sizeName != null
      ? (p.sizes.find(x => x.name === sizeName) || p.sizes[selectedSizeVariant[p.id] || 0])
      : p.sizes[selectedSizeVariant[p.id] || 0];
    if(sv && (sv.image || (sv.images && sv.images.length))){
      src = sv.image || sv.images[0];
      alt = p.name + ' ' + sv.name;
    }
  }
  if(!src && p.colors && p.colors.length){
    // colorName ที่มาจากตะกร้าอาจมีตัวเลือกเสริมต่อท้ายอยู่ (เลือกได้หลายตัว) เช่น
    // "ดอกส้มช่อน้ำเงิน + ผึ้งน้อย 1 ตัว" — ต้องแยกชื่อสีกับชื่อตัวเลือกเสริมออกจากกันก่อน ถึงจะหาสีที่ตรงกันเจอ
    let addonNames = [], lookupColorName = colorName;
    if(colorName != null && colorName.includes(' + ')){
      const parts = colorName.split(' + ');
      lookupColorName = parts[0];
      addonNames = parts.slice(1);
    }
    const c = (lookupColorName != null && p.colors.find(x => x.name === lookupColorName)) || p.colors[resolvedColorIndex(p)];
    const chosenAddon = (addonNames.length && c.addons) ? c.addons.find(a => addonNames.includes(a.name) && a.image) : null;
    src = (chosenAddon && chosenAddon.image) || c.image || (c.images && c.images[0]);
    alt = p.name + ' ' + c.name;
  }
  // สินค้าที่ไม่มีสีเลย (เช่น กรอบรูปบางแบบ) แต่มีตัวเลือกเสริมของตัวเอง (p.addons) — label ในตะกร้า
  // จะเป็นแค่ชื่อตัวเลือกเสริมล้วนๆ (ไม่มีชื่อสีนำหน้า) เช่น "กล่องใส่กรอบรูป"
  if(!src && !p.colors && p.addons && p.addons.length && variantLabel != null){
    const addonNames = variantLabel.split(' + ');
    const chosenAddon = p.addons.find(a => addonNames.includes(a.name) && a.image);
    if(chosenAddon) src = chosenAddon.image;
  }
  if(!src && p.image){
    src = p.image;
  } else if(!src && p.images && p.images.length){
    src = p.images[0];
  }
  if(src){
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML=window.iconFallbackFor('${p.id}')">`;
  }
  return iconFor(p);
}
// เลือกไอคอนสำรอง (SVG) ให้ตรงกับหมวดหมู่สินค้า แทนที่จะโชว์ไอคอน "อื่นๆ" เหมือนกันหมดทุกครั้งที่รูปโหลดไม่ขึ้น
const CAT_ICON_KEY = { 'ช่อดอกไม้':'bouquet', 'กรอบรูป':'frame', 'กระถาง':'pot', 'อื่นๆ':'other' };
function iconFor(p){
  return ICONS[p.icon] || ICONS[CAT_ICON_KEY[p.cat]] || ICONS.other;
}
window.iconFallbackFor = function(id){
  const p = PRODUCTS.find(x => x.id === id);
  return p ? iconFor(p) : ICONS.other;
};

let selectedColor = {}; // productId -> chosen color index
function selectColor(id, idx){
  selectedColor[id] = idx;
  renderCatalog();
}
// Default color index to show before the customer picks one: prefer the first
// พร้อมส่ง (ready) color so the badge/thumbnail/label the customer sees by
// default are never out of sync with a product that has some ready colors.
// Falls back to index 0 if no color is marked ready.
function defaultColorIndex(p){
  if(!p.colors) return 0;
  const idx = p.colors.findIndex(c => c.ready);
  return idx === -1 ? 0 : idx;
}
// Resolves which color index is "currently shown" for a product: the
// customer's explicit pick if they made one, otherwise defaultColorIndex(p).
function resolvedColorIndex(p){
  return (selectedColor[p.id] !== undefined) ? selectedColor[p.id] : defaultColorIndex(p);
}
let selectedSizeVariant = {}; // productId -> chosen size index (for products with own per-size price, e.g. frames/pots)
function selectSizeVariant(id, idx){
  selectedSizeVariant[id] = idx;
  renderCatalog();
}

/* ---------- ระบบตัวเลือกสินค้าแบบ "options/variants" ----------
   สำหรับสินค้าใหม่ที่ซับซ้อน มีตัวเลือกหลายมิติที่ไม่เท่ากันในแต่ละสี/แบบ (เช่น สีดอก × สีช่อ × แบบใส่เงิน)
   สินค้าเก่าที่ใช้ colors/sizes/addons แบบเดิมไม่ต้องแก้อะไร อยู่ร่วมกันได้ปกติ — ระบบนี้ทำงาน
   เฉพาะสินค้าที่มีทั้ง p.options และ p.variants เท่านั้น

   โครงสร้างในไฟล์ products.json:
   "options": [
     { "name": "สีดอก", "values": ["ส้ม", "เหลือง"] },
     { "name": "สีช่อ", "values": ["ขาว", "แดง"] },
     { "name": "แบบ",   "values": ["ปกติ", "ใส่เงิน 5 ใบ"] }
   ],
   "variants": [
     { "match": ["ส้ม","ขาว","ปกติ"],        "price": 249, "image": "..." },
     { "match": ["ส้ม","ขาว","ใส่เงิน 5 ใบ"], "price": 274, "image": "...", "ready": true }
   ]
   — "match" ต้องเรียงตามลำดับเดียวกับ "options" เป๊ะ ๆ และควรมีให้ครบทุกชุดค่าผสมที่ขายได้จริง */
function hasNewOptions(p){ return !!(p.options && p.options.length && p.variants && p.variants.length); }
// เดิม matchVariant จะ fallback ไปใช้ p.variants[0] เงียบๆ เมื่อไม่เจอชุดที่ตรงกัน ทำให้ถ้าลูกค้า
// เลือกชุดผสมที่ไม่มีขายจริง (เช่น สีที่ไม่ได้คู่กับสีช่อนั้น) หน้าเว็บจะโชว้ราคา/รูปของอีกชุดหนึ่งไปเลย
// โดยไม่มีการเตือน — ตะกร้า/ใบสั่งซื้อจะได้ label ของชุดที่เลือกจริง (ไม่มีขาย) คู่กับราคาของชุดอื่น
// exactVariantMatch คืนค่าตรงๆ แบบไม่ fallback ไว้ใช้เช็คก่อนยอมให้เลือก/สั่งซื้อ
// ส่วน matchVariant (มี fallback) ยังคงไว้สำหรับจุดที่ต้อง "เดาที่ดีที่สุด" เพื่อไม่ให้พัง เช่น
// เรนเดอร์รูปธัมบ์เนลในตะกร้าเก่าที่อาจมี label ค้างจากก่อนแก้บั๊กนี้
// ตอนเปิดหน้าสินค้าจากการ์ดที่ถูกตัวกรองบีบให้เหลือบางแบบ (เช่น กรอง "ใส่เงิน") ให้ใช้เฉพาะแบบที่ผ่านกรอง
// ไม่งั้นหน้าสินค้าจะโชว์รูป/ปุ่มของช่อปกติปนเข้ามา modalAllowedVariants = Set ของ index ใน p.variants (null = ไม่จำกัด)
let modalAllowedVariants = null;
let cardNarrowSizesByProduct = {}; // productId -> array ของ index ไซซ์ที่ผ่านกรอง (สินค้าโหมด "เลือกไซซ์")
let cardNarrowByProduct = {}; // productId -> array ของ index แบบที่ผ่านกรอง (เฉพาะการ์ดที่ถูกบีบ) รีเซ็ตทุกครั้งที่ renderCatalog
function modalVariantsOf(p){
  if(modalAllowedVariants && modalProductId === p.id){
    const sub = p.variants.filter((v,i) => modalAllowedVariants.has(i));
    if(sub.length) return sub;
  }
  return p.variants;
}
function exactVariantMatch(p, selection){
  return p.variants.find(v => v.match.length===selection.length && v.match.every((val,i)=>val===selection[i])) || null;
}
function matchVariant(p, selection){
  const exact = exactVariantMatch(p, selection);
  if(exact) return exact;
  const pool = modalVariantsOf(p);
  return pool === p.variants ? p.variants[0] : pool.reduce((a,b) => (b.price < a.price ? b : a));
}
// รูปปกการ์ด/รูปค้นหา ตอนลูกค้ายังไม่ได้เลือกอะไร: ใช้แบบที่ราคาถูกสุดและไม่ใช่ "ใส่เงิน" (ถ้าราคาเท่ากันใช้แบบที่อยู่ก่อน)
// ไม่ว่าลำดับตัวแปรในหลังบ้านจะเรียงยังไง ช่อใส่เงินจะไม่ขึ้นเป็นปกเอง (ถ้าสินค้ามีแต่แบบใส่เงินก็ใช้ตัวที่ถูกสุดของทั้งหมด)
function isMoneyVariant(v){
  return v.tag === 'ใส่เงิน' || (v.match || []).some(m => String(m).indexOf('ใส่เงิน') !== -1);
}
function coverVariantOf(p){
  const all = modalVariantsOf(p);
  const plain = all.filter(v => !isMoneyVariant(v));
  const pool = plain.length ? plain : all;
  return pool.reduce((a,b) => (b.price < a.price ? b : a));
}
// เช็คว่าค่านี้ "เลือกได้" ไหมถ้าจะตั้งมิติ optIndex เป็น value โดยพิจารณาจากตัวเลือกมิติอื่นที่เลือกไว้แล้ว
// (มิติที่ยังไม่ได้เลือก sel[i]==null ถือเป็น "อะไรก็ได้" ไม่จำกัด) ใช้ตัดสินว่าปุ่มไหนควรเป็นสีเทา (ปิด)
function optionValueCompatible(p, sel, optIndex, value){
  return modalVariantsOf(p).some(v => v.match[optIndex]===value &&
    v.match.every((val,i)=> i===optIndex || sel[i]==null || sel[i]===val));
}
// ราคาต่ำสุด-สูงสุดของ variant ที่ยังเป็นไปได้ตามตัวเลือกที่เลือกไว้ตอนนี้ (sel เป็น null ทุกช่อง = ยังไม่เลือกอะไรเลย
// จะได้ช่วงราคาเต็มของสินค้าทั้งชิ้น) ใช้ทั้งตอนแสดงราคาในการ์ดสินค้า (min อย่างเดียว "เริ่มต้น...") และในหน้า
// รายละเอียดสินค้าตอนที่ลูกค้ายังเลือกตัวเลือกไม่ครบ (แสดงเป็นช่วง)
function optionPriceRange(p, sel){
  const s = sel || p.options.map(()=>null);
  const pool = modalVariantsOf(p);
  const reachable = pool.filter(v => v.match.every((val,i)=> s[i]==null || s[i]===val));
  const prices = (reachable.length ? reachable : pool).map(v=>v.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
// สินค้าที่มีตัวเลือก แต่ราคาทุกแบบเท่ากัน (เช่น ช่อ R01 ทุกสี 99) ไม่ต้องขึ้น "เริ่มต้น"
function optionPricesVary(p){
  if(!hasNewOptions(p)) return false;
  const r = optionPriceRange(p);
  return r.min !== r.max;
}
function hasFullOptionSelection(p, sel){
  return sel.every(v => v!=null);
}
// ด่านกันเหนียวสุดท้ายก่อนใส่ตะกร้า/สั่งซื้อจริง — เผื่อกรณีเลือกยังไม่ครบทุกมิติ หรือสินค้าถูกแก้ variants
// หลังลูกค้าเปิดหน้าค้างไว้อยู่ก่อนแล้ว
let orderBuildBlockedMsgShown = false; // กันโชว์ toast ซ้อนกับ toast ทั่วไปของ startCheckout
function warnIfInvalidOptionSelection(p){
  if(!hasNewOptions(p)) return false;
  const sel = currentOptionSelection(p);
  if(exactVariantMatch(p, sel)) return false;
  showToast(hasFullOptionSelection(p, sel)
    ? 'ชุดตัวเลือกนี้ยังไม่มีขาย กรุณาเลือกใหม่อีกครั้ง'
    : 'กรุณาเลือกตัวเลือกให้ครบก่อนสั่งซื้อ');
  orderBuildBlockedMsgShown = true;
  return true;
}
// ค่าเริ่มต้นตอนเปิดหน้าสินค้าครั้งแรก: ยังไม่เลือกอะไรเลยสักมิติ (null ทุกช่อง) ให้ลูกค้าเป็นคนกดเลือกเอง
function defaultOptionSelection(p){
  return p.options.map(() => null);
}
let selectedOptions = {}; // productId -> array ของค่าที่เลือกไว้ เรียงตามลำดับ p.options (null = ยังไม่เลือก)
function currentOptionSelection(p){
  if(!selectedOptions[p.id]) selectedOptions[p.id] = defaultOptionSelection(p);
  return selectedOptions[p.id];
}
function currentVariant(p){ return matchVariant(p, currentOptionSelection(p)); }
function selectOption(id, optIndex, value){
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  const sel = currentOptionSelection(p).slice();
  if(sel[optIndex] === value){
    // กดปุ่มที่เลือกอยู่แล้วซ้ำอีกครั้ง = ปลดออก กลับไปเป็น "ยังไม่เลือก" มิตินี้ เผื่อลูกค้าอยาก
    // เปลี่ยนไปดูตัวเลือกอื่นที่ตอนนี้เทาอยู่เพราะติดค่าที่เลือกไว้ตัวนี้
    sel[optIndex] = null;
    selectedOptions[id] = sel;
    modalImgIndex = 0;
    renderModal();
    return;
  }
  // ปุ่มที่ไม่ตรงกับตัวเลือกอื่นที่เลือกไว้ถูกปิดไม่ให้กดอยู่แล้ว (ดู renderModal) เช็คซ้ำอีกชั้นกันเหนียว
  if(!optionValueCompatible(p, sel, optIndex, value)) return;
  sel[optIndex] = value;
  selectedOptions[id] = sel;
  modalImgIndex = 0;
  renderModal();
}

function cartKeyOf(id, colorName){ return colorName ? `${id}__${colorName}` : id; }
function parseCartKey(key){
  const i = key.indexOf('__');
  return i === -1 ? { id:key, color:null } : { id:key.slice(0,i), color:key.slice(i+2) };
}

// ค่าเริ่มต้นของหมวดหมู่/ขนาด — ถ้าแก้จากหลังบ้าน (เมนู ⋯ เพิ่มเติม › จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด)
// ตอนโหลดจาก Firestore ฟังก์ชัน applyShopOptions ด้านล่างจะเปลี่ยนค่าใน CATS / CATEGORY_SIZES / FLOWER_TYPES ในที่เดิม
const CATS = ['ทั้งหมด','ช่อดอกไม้','กรอบรูป','กระถาง','อื่นๆ'];
const CATEGORY_SIZES = {
  'ช่อดอกไม้': ['ทั้งหมด','เล็ก','กลาง','ใหญ่','ใส่เงิน',],
  'กรอบรูป': ['ทั้งหมด','A5','A4'],
  'กระถาง': ['ทั้งหมด','3 นิ้ว','5 นิ้ว','9 นิ้ว'],
  'อื่นๆ': ['ทั้งหมด','กลิตเตอร์','กล่องดอกไม้','ดอกไม้เจ้าสาว','ตุ๊กตา','มงกุฎ'],
};
// หมวดหมู่ที่เลือกไว้ตอนนี้ — เป็น Set เพื่อให้เลือกได้มากกว่า 1 หมวดพร้อมกัน
// เซตว่าง = "ทั้งหมด" (ไม่กรองหมวด) ปุ่มแท็บบนสุด (quick-nav) กดแล้วจะ "กระโดดไปหมวดนั้นหมวดเดียว"
// (แทนที่ทั้งเซต) ส่วนชิปในแผงตัวกรองสามารถกดติด/ปลดได้ทีละหมวดอิสระ (multi-select จริง)
let activeCats = new Set();
// ใช้แยกต่างหากจาก activeCats — เอาไว้ไฮไลต์แท็บบนสุดตาม scrollspy เฉพาะตอนอยู่ในโหมด "ทั้งหมด"
// (activeCats ว่าง) เท่านั้น ไม่กระทบตัวกรองจริง
let scrollSpyCat = 'ทั้งหมด';
// ตัวกรองขนาด — เลือกได้หลายอันพร้อมกัน (ผลลัพธ์เป็น "หรือ") เซตว่าง = "ทั้งหมด" (ไม่กรองขนาด)
// รายการตัวเลือกจะเป็น "ยูเนียน" ของทุกหมวดที่เลือกไว้อยู่
let activeSizes = new Set();
let showReadyOnly = false;
let showFavoritesOnly = false;
// โหมด "ดูสินค้าทั้งหมด" — แตกสินค้าทุกชิ้นที่มีสี/ตัวเลือก/ไซซ์ออกเป็นการ์ดย่อยรายตัว
// เหมือนที่โซน "สินค้าแนะนำ (พร้อมส่ง)" ทำอยู่แล้ว แต่ไม่จำกัดเฉพาะที่พร้อมส่ง
let showAllVariantsSplit = false;

/* ---------- รายการโปรด (บันทึกในเบราว์เซอร์ของลูกค้า เหมือนตะกร้า) ---------- */
const FAVORITES_STORAGE_KEY = 'sfb_favorites_v1';
function loadFavoritesFromStorage(){
  try{
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if(!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch(err){
    console.error('โหลดรายการโปรดที่บันทึกไว้ไม่สำเร็จ:', err);
    return new Set();
  }
}
function saveFavorites(){
  try{
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  } catch(err){
    console.error('บันทึกรายการโปรดไม่สำเร็จ:', err);
  }
}
let favorites = loadFavoritesFromStorage(); // Set ของคีย์รายการโปรด: "id" = ทั้งสินค้า, "id::ป้ายแบบ" = เฉพาะแบบนั้น
// รายการโปรดเก็บได้ 2 ระดับ — ทั้งสินค้า (คีย์ = id เหมือนเดิม จึงใช้กับรายการโปรดเก่าที่บันทึกไว้ได้เลย)
// หรือเฉพาะ "แบบ" ของสินค้า (สี / ตัวเลือก / ขนาด) เพื่อให้กดหัวใจ S08 ดอกเล็ก แล้วดอกใหญ่ไม่ติดไปด้วย
const FAV_SEP = '::';
// v = { colorIndex | optionIndex | sizeIndex } เหมือนที่ allVariantsOf()/readyVariantsOf() คืนมา
function variantLabelOf(p, v){
  if(!v) return null;
  if(v.colorIndex != null && p.colors && p.colors[v.colorIndex]) return p.colors[v.colorIndex].name;
  if(v.optionIndex != null && hasNewOptions(p) && p.variants[v.optionIndex]) return p.variants[v.optionIndex].match.join(', ');
  if(v.sizeIndex != null && p.sizes && p.sizes[v.sizeIndex]) return p.sizes[v.sizeIndex].name;
  return null;
}
function favKeyOf(p, v){
  const label = variantLabelOf(p, v);
  return label ? p.id + FAV_SEP + label : p.id;
}
// แบบนี้ถูกกดหัวใจไว้ไหม (นับทั้งกรณีกดทั้งสินค้าไว้ และกรณีกดเฉพาะแบบนี้)
function isVariantFavorite(p, v){
  return favorites.has(p.id) || favorites.has(favKeyOf(p, v));
}
// สินค้านี้มีอะไรถูกกดหัวใจไว้บ้างไหม (ทั้งสินค้า หรือบางแบบ) — ใช้กับการ์ดใบเดียวต่อสินค้า
function isProductFavorite(p){
  if(favorites.has(p.id)) return true;
  const prefix = p.id + FAV_SEP;
  for(const k of favorites){ if(k.startsWith(prefix)) return true; }
  return false;
}
// colorIndex/optionIndex/sizeIndex ทั้งหมดว่าง = กดหัวใจทั้งสินค้า
function toggleFavorite(id, colorIndex, optionIndex, sizeIndex){
  const p = PRODUCTS.find(x => x.id === id);
  if(!p) return;
  const hasVariant = colorIndex != null || optionIndex != null || sizeIndex != null;
  if(hasVariant){
    const key = favKeyOf(p, { colorIndex, optionIndex, sizeIndex });
    if(key === p.id){
      // ไม่พบแบบนั้นแล้ว (ข้อมูลสินค้าเปลี่ยน) — ถือเป็นการกดทั้งสินค้า
      if(favorites.has(p.id)) favorites.delete(p.id); else favorites.add(p.id);
    } else if(favorites.has(p.id)){
      // เคยกดทั้งสินค้าไว้ (รายการโปรดเก่า) แล้วมาเอาหัวใจออกจากแบบเดียว — แตกเป็นรายแบบ เหลือแบบอื่นไว้ตามเดิม
      favorites.delete(p.id);
      allVariantsOf(p).forEach(x => {
        const k = favKeyOf(p, x);
        if(k !== key && k !== p.id) favorites.add(k);
      });
    } else if(favorites.has(key)){
      favorites.delete(key);
    } else {
      favorites.add(key);
    }
  } else {
    if(isProductFavorite(p)){
      favorites.delete(p.id);
      const prefix = p.id + FAV_SEP;
      [...favorites].forEach(k => { if(k.startsWith(prefix)) favorites.delete(k); });
    } else {
      favorites.add(p.id);
    }
  }
  saveFavorites();
  renderCatalog();
  updateModalHeart();
  if(document.getElementById('productModal').classList.contains('open')) renderRelatedProducts();
  sfbHeartPop(id, colorIndex, optionIndex, sizeIndex);
}
// แบบที่กำลังเลือกอยู่ในหน้าสินค้า (ไว้ผูกหัวใจในหน้าสินค้ากับแบบนั้น) — null = ยังเลือกไม่ครบ/ไม่มีแบบ
function currentVariantRef(p){
  if(p.colors && p.colors.length) return { colorIndex: resolvedColorIndex(p) };
  if(hasNewOptions(p)){
    const sel = currentOptionSelection(p);
    if(hasFullOptionSelection(p, sel)){
      const i = p.variants.findIndex(x => x.match.join(', ') === sel.join(', '));
      if(i >= 0) return { optionIndex: i };
    }
    return null;
  }
  if(p.sizes && p.sizes.length) return { sizeIndex: selectedSizeVariant[p.id] || 0 };
  return null;
}
function toggleModalFavorite(){
  const p = PRODUCTS.find(x => x.id === modalProductId);
  if(!p) return;
  const v = currentVariantRef(p);
  toggleFavorite(p.id, v && v.colorIndex, v && v.optionIndex, v && v.sizeIndex);
}
function updateModalHeart(){
  const hearts = document.querySelectorAll('#modalFavHeart, #modalFavHeartImg');
  if(!hearts.length || !modalProductId) return;
  const p = PRODUCTS.find(x => x.id === modalProductId);
  if(!p) return;
  const v = currentVariantRef(p);
  const fav = v ? isVariantFavorite(p, v) : isProductFavorite(p);
  // มีปุ่มหัวใจ 2 ตัว: ข้างชื่อ (มือถือ) และบนรูป (คอม) — อัพเดทพร้อมกัน
  hearts.forEach(modalHeart => {
    modalHeart.classList.toggle('active', fav);
    modalHeart.textContent = fav ? '♥' : '♡';
    modalHeart.setAttribute('aria-label', fav ? 'เอาออกจากรายการโปรด' : 'บันทึกไว้ในรายการโปรด');
  });
}
// สินค้าบางชิ้น (หรือบางแบบ) อาจถูกลบออกจาก products.json ไปแล้ว — ตัดรายการโปรดที่ค้างอยู่ทิ้งไปด้วย
function pruneFavoritesAgainstProducts(){
  let changed = false;
  [...favorites].forEach(k => {
    const i = k.indexOf(FAV_SEP);
    const id = i === -1 ? k : k.slice(0, i);
    const p = PRODUCTS.find(x => x.id === id);
    let keep = !!p;
    if(p && i !== -1) keep = allVariantsOf(p).some(v => favKeyOf(p, v) === k);
    if(!keep){ favorites.delete(k); changed = true; }
  });
  if(changed) saveFavorites();
}
/* ---------- เก็บตะกร้าไว้ในเบราว์เซอร์ของลูกค้า ----------
   ถ้าลูกค้าเผลอปิดแท็บ/รีเฟรชหน้าเว็บระหว่างเลือกซื้อ ตะกร้าจะยังอยู่ครบเมื่อเปิดเว็บใหม่
   (เก็บเฉพาะในเบราว์เซอร์เครื่องนั้นๆ ของลูกค้าเอง ไม่ได้ส่งข้อมูลไปที่ไหน) */
const CART_STORAGE_KEY = 'sfb_cart_v1';
function loadCartFromStorage(){
  try{
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if(!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch(err){
    console.error('โหลดตะกร้าที่บันทึกไว้ไม่สำเร็จ:', err);
    return {};
  }
}
function saveCart(){
  try{
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch(err){
    console.error('บันทึกตะกร้าไม่สำเร็จ:', err);
  }
}
let searchQuery = '';
let scrollSpyObserver = null;
let cart = loadCartFromStorage(); // key -> { qty, unitPrice, label } — restored from the browser if the customer visited before

// สินค้าบางชิ้นอาจถูกลบออกจาก products.json ไปแล้วตั้งแต่ลูกค้าแวะมาครั้งก่อน —
// ตัดรายการเหล่านั้นออกจากตะกร้าที่กู้คืนมา กันไม่ให้ค้างเป็นรายการผี
function pruneCartAgainstProducts(){
  let changed = false;
  Object.keys(cart).forEach(key => {
    const { id } = parseCartKey(key);
    if(!PRODUCTS.find(p => p.id === id)){ delete cart[key]; changed = true; }
  });
  if(changed) saveCart();
}

function catSectionId(cat){ return 'cat-sec-' + CATS.indexOf(cat); }

function handleSearch(v){
  searchQuery = v.trim();
  const clearBtn = document.getElementById('searchClearBtn');
  if(clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';
  renderCatalog();
  if(searchQuery) revealSearchResults();
}
function clearSearch(){
  searchQuery = '';
  const input = document.getElementById('searchInput');
  if(input) input.value = '';
  const clearBtn = document.getElementById('searchClearBtn');
  if(clearBtn) clearBtn.style.display = 'none';
  renderCatalog();
}
/* ---------- ระบบค้นหา (ระดับ "แบบ") ----------
   หลักการ: สินค้าหนึ่งชิ้นมีหลายแบบ (สี/ตัวเลือก/ไซซ์) — คำค้นต้องครบ "ในแบบเดียวกัน" ไม่ใช่กระจายไปคนละแบบ
   ข้อความที่ใช้เทียบของแต่ละแบบ = ข้อความส่วนกลางของสินค้า (ชื่อ, คำอธิบาย, หมวด, ชนิดดอก ฯลฯ) + ข้อความเฉพาะของแบบนั้น
   เช่น "ใส่เงิน 10 ใบ" จะเจอเฉพาะสินค้าที่มีแบบ "ใส่เงิน 10 ใบ" จริง ไม่เจอสินค้าที่มีแค่ "ใส่เงิน 5 ใบ"
   - ไม่สนตัวพิมพ์เล็ก/ใหญ่ ช่องว่าง (ใส่เงิน10ใบ = ใส่เงิน 10 ใบ) และเลขไทย
   - เลขกับหน่วยที่พิมพ์ติดกัน/เว้นวรรค (10 ใบ, 5 ดอก, 15 ซม.) ถูกมองเป็นก้อนเดียว
   - ตัวเลขต้องตรงเป๊ะ: 10 ไม่ไปเจอ 100 หรือ 5 ใน 15 และไม่ไปติดกับรหัสสินค้า เช่น S10
   - คำพ้องความหมาย (SEARCH_SYNONYMS ด้านล่าง) แก้ไข/เพิ่มได้เอง ใส่เป็นกลุ่ม: คำในกลุ่มเดียวกันค้นแทนกันได้ */
const SEARCH_SYNONYMS = [
  ['ใส่เงิน', 'ช่อเงิน', 'ช่อแบงค์', 'ช่อแบงก์', 'ช่อธนบัตร', 'ช่อใส่แบงค์', 'ช่อใส่แบงก์'],
  ['สตรอว์เบอร์รี่', 'สตรอเบอร์รี่', 'สตรอเบอรี่', 'สตรอว์เบอรี่', 'สตรอเบอร์รี', 'สตอเบอรี่', 'strawberry'],
  ['ไฮเดรนเยีย', 'ไฮเดรนเจีย', 'ไฮเดรนจา', 'ไฮเดรนเยีย', 'hydrangea'],
  ['กุหลาบ', 'rose'],
  ['ทานตะวัน', 'sunflower'],
  ['ทิวลิป', 'tulip'],
  ['แกะ', 'ตุ๊กตาแกะ'],
];
const SEARCH_UNITS = new Set(['ใบ','ดอก','ช่อ','ชิ้น','ก้าน','ชุด','ลูก','กล่อง','อัน','ซม','ซม.','cm','นิ้ว','บาท','฿']);
const SEARCH_SEP = '|'; // คั่นระหว่างฟิลด์ กันคำค้นข้ามฟิลด์ (จะไม่ถูกลบตอนตัดช่องว่าง)

function srchNorm(str){
  return String(str == null ? '' : str).normalize('NFC').toLowerCase()
    .replace(/[\u0E50-\u0E59]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0E50 + 48)) // เลขไทย → เลขอารบิก
    .replace(/[\u200b-\u200d\ufeff]/g, '');
}
function srchSquash(str){ return srchNorm(str).replace(/\s+/g, ''); }

// ข้อความของสินค้าแบ่งเป็น 3 ชั้น (เก็บแคชไว้ที่ตัวสินค้า)
//  1) ชื่อ/หมวด/ชนิดดอก  — ใช้ร่วมกันทุกแบบ และเชื่อถือได้ (เช่น ชื่อ "...ใส่เงิน - RM01")
//  2) ข้อความเฉพาะของแบบนั้นๆ (สี/ตัวเลือก/ไซซ์ เช่น "ใส่เงิน 10 ใบ")
//  3) คำอธิบาย/ชื่อตัวเลือก — เป็นข้อความอธิบายกว้างๆ ของสินค้า บางทีพูดถึงหลายแบบพร้อมกัน
//     (เช่น "ซองใส่เงิน มี 2 แบบ: 5 ใบ / 10 ใบ") จึงห้ามใช้ตัดสินแทนแบบ ถ้าคำนั้นมีอยู่ในข้อความของแบบอยู่แล้ว
function searchNameText(p){
  if(p._srchName != null) return p._srchName;
  p._srchName = [p.name, p.cat, p.flowerType].filter(Boolean).map(srchSquash).join(SEARCH_SEP);
  return p._srchName;
}
function searchDescText(p){
  if(p._srchDesc != null) return p._srchDesc;
  const parts = [p.desc];
  if(p.options) p.options.forEach(o => parts.push(o.name));
  if(p.addons) p.addons.forEach(a => parts.push(a.name));
  // สินค้าแบบสี: ไซซ์เป็นตัวเลือกร่วมของทุกสี
  if(p.colors && p.colors.length && p.sizes) p.sizes.forEach(z => parts.push(z.name));
  p._srchDesc = parts.filter(Boolean).map(srchSquash).join(SEARCH_SEP);
  return p._srchDesc;
}
// ข้อความเฉพาะของแบบหนึ่งๆ (v = { colorIndex | optionIndex | sizeIndex } หรือไม่มี index = ทั้งสินค้า)
function searchVariantText(p, v){
  const out = [];
  const addColor = c => { if(!c) return; out.push(c.name); (c.addons || []).forEach(a => out.push(a.name)); };
  const addOpt = pv => { if(!pv) return; out.push((pv.match || []).join(' ')); if(pv.tag) out.push(pv.tag); };
  const addSize = z => { if(!z) return; out.push(z.name); if(z.tag) out.push(z.tag); };
  if(v && v.colorIndex != null && p.colors && p.colors[v.colorIndex]) addColor(p.colors[v.colorIndex]);
  else if(v && v.optionIndex != null && hasNewOptions(p)) addOpt(p.variants[v.optionIndex]);
  else if(v && v.sizeIndex != null && p.sizes) addSize(p.sizes[v.sizeIndex]);
  else {
    // ไม่ได้ระบุแบบ = ทั้งสินค้า → รวมทุกแบบเข้าด้วยกัน (ผ่านถ้าแบบไหนก็ตามมีคำนั้น)
    if(p.colors) p.colors.forEach(addColor);
    if(hasNewOptions(p)) p.variants.forEach(addOpt);
    if(p.sizes) p.sizes.forEach(addSize);
  }
  return out.filter(Boolean).map(srchSquash).join(SEARCH_SEP);
}
function searchVarKey(v){
  return v ? (v.colorIndex != null ? 'c' + v.colorIndex : v.optionIndex != null ? 'o' + v.optionIndex : v.sizeIndex != null ? 's' + v.sizeIndex : 'all') : 'all';
}
function searchVarHay(p, v){
  const cache = p._srchVar || (p._srchVar = {});
  const key = searchVarKey(v);
  if(cache[key] == null) cache[key] = searchVariantText(p, v);
  return cache[key];
}
// คำนี้มีอยู่ในข้อความของ "แบบ" ใดแบบหนึ่งของสินค้าไหม (ถ้ามี = ต้องตัดสินที่ระดับแบบ ห้ามไปพึ่งคำอธิบาย)
function tokenInAnyVariant(p, alts){
  const cache = p._srchAny || (p._srchAny = {});
  const key = alts.join('\u0001');
  if(cache[key] == null) cache[key] = allVariantsOf(p).some(v2 => alts.some(a => srchFind(searchVarHay(p, v2), a)));
  return cache[key];
}
// แปลงคำค้นเป็นรายการ "ก้อนคำ" (แต่ละก้อนมีทางเลือกคำพ้อง) — คำนวณใหม่เฉพาะตอนคำค้นเปลี่ยน
let _srchParsedFor = null, _srchParsed = [];
function parseSearchQuery(q){
  if(_srchParsedFor === q) return _srchParsed;
  const raw = srchNorm(q).split(/\s+/).filter(Boolean);
  const toks = [];
  for(let i = 0; i < raw.length; i++){
    const t = raw[i];
    // เลข + หน่วย (เช่น "10" "ใบ") รวมเป็นก้อนเดียว "10ใบ"
    if(/^\d+$/.test(t) && i + 1 < raw.length && SEARCH_UNITS.has(raw[i + 1])){ toks.push(t + raw[i + 1]); i++; }
    else toks.push(t);
  }
  _srchParsed = toks.map(t => {
    const alts = [t];
    SEARCH_SYNONYMS.forEach(g => { if(g.map(srchSquash).includes(t)) g.forEach(w => alts.push(srchSquash(w))); });
    return [...new Set(alts)];
  });
  _srchParsedFor = q;
  return _srchParsed;
}
// หา tok ใน hay โดยตัวเลขต้องตรงเป๊ะ (ไม่ติดเลขอื่น / ไม่ติดตัวอักษรอังกฤษนำหน้า เช่น S10)
function srchFind(hay, tok){
  let from = 0;
  const startsDigit = /\d/.test(tok[0]), endsDigit = /\d/.test(tok[tok.length - 1]);
  for(;;){
    const i = hay.indexOf(tok, from);
    if(i < 0) return false;
    let ok = true;
    if(startsDigit && i > 0 && /[0-9a-z]/.test(hay[i - 1])) ok = false;
    const nx = hay[i + tok.length];
    if(ok && endsDigit && nx && /\d/.test(nx)) ok = false;
    if(ok) return true;
    from = i + 1;
  }
}
// เลข+หน่วยที่เป็น "จำนวนใบเงิน" (เช่น 10ใบ) ใช้เทียบกับชื่อและแบบเท่านั้น ไม่ดูคำอธิบาย
// เพราะคำอธิบายมักเขียนรวมทุกแบบไว้ เช่น "มี 2 แบบ 5 ใบ / 10 ใบ" ทำให้ทุกแบบหลุดเข้าผลค้นหา
const SEARCH_VARIANT_ONLY = /^\d+ใบ$/;
// แบบนี้ตรงกับคำค้นไหม (ไม่มีคำค้น = ผ่านทุกแบบ) — ทุกก้อนคำต้องผ่านพร้อมกันในแบบเดียวกัน
function variantMatchesSearch(p, v){
  if(!searchQuery) return true;
  const toks = parseSearchQuery(searchQuery);
  if(!toks.length) return true;
  const nameHay = searchNameText(p), varHay = searchVarHay(p, v);
  return toks.every(alts => {
    if(alts.some(a => srchFind(nameHay, a) || srchFind(varHay, a))) return true;   // อยู่ในชื่อ หรือในแบบนี้
    if(alts.some(a => SEARCH_VARIANT_ONLY.test(a))) return false;                    // จำนวนใบ: ห้ามพึ่งคำอธิบาย
    if(tokenInAnyVariant(p, alts)) return false;                                      // แบบอื่นมีคำนี้ แต่แบบนี้ไม่มี
    const descHay = searchDescText(p);                                                // คำทั่วไปของสินค้า (เช่น ผ้าซาติน)
    return alts.some(a => srchFind(descHay, a));
  });
}
// สินค้าผ่านเมื่อมีอย่างน้อย 1 แบบที่ตรงทุกคำ
function matchesSearch(p){
  if(!searchQuery) return true;
  return allVariantsOf(p).some(v => variantMatchesSearch(p, v));
}
// ไม่มีรายการดรอปดาวน์แล้ว — ผลอยู่ในรายการสินค้าด้านล่างโดยตรง จึงพาหน้าเลื่อนลงไปให้เห็นผล
// (เลื่อนเฉพาะตอนที่รายการสินค้ายังอยู่ใต้จอ ถ้าลูกค้าเลื่อนอยู่ในรายการแล้วจะไม่ดึงหน้ากลับ)
function revealSearchResults(){
  const el = document.getElementById('catalog');
  if(!el) return;
  if(el.getBoundingClientRect().top > stickyOffset() + 40) scrollToCatalogTop();
}
// กด Enter / ปุ่มค้นหาบนคีย์บอร์ดมือถือ: ปิดคีย์บอร์ดเพื่อให้เห็นผล แล้วเลื่อนไปที่รายการสินค้า
function handleSearchSubmit(){
  const input = document.getElementById('searchInput');
  if(input) input.blur();
  if(searchQuery) scrollToCatalogTop();
}

function toggleReadyOnly(checked){
  showReadyOnly = checked;
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}
function toggleFavoritesOnly(checked){
  showFavoritesOnly = checked;
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}
function toggleAllVariantsSplit(checked){
  showAllVariantsSplit = checked;
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}
function setDraftAllSplit(checked){ filterDraft.allSplit = checked; renderFilterSheetBody(); }

// หนี HTML พิเศษก่อนแทรกข้อความที่ลูกค้าพิมพ์เองลงไปใน innerHTML (เช่น ชื่อ Facebook)
// ป้องกันไม่ให้โค้ด/แท็กที่ลูกค้าพิมพ์ไปถูกตีความเป็น HTML/JS จริงๆ ในหน้าเว็บ
function escapeHtml(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n){ return PRICES_HIDDEN ? 'สอบถามราคา' : '฿' + n.toLocaleString('th-TH'); } // ตอนปิดราคา: ด่านสุดท้ายกันราคาหลุดจากจุดที่ลืมดัก

function unitPriceFor(p, bills){
  if(p.billSelector){
    return p.pricePerBill * (bills != null ? bills : (p.minBills||1)) + (p.wrappingFee||0);
  }
  return p.price;
}
// Current price to display for a card, accounting for a chosen size-variant (frames/pots) or bill count (money bouquet)
function displayPrice(p){
  if(p.billSelector) return unitPriceFor(p);
  if(hasNewOptions(p)) return optionPriceRange(p).min;
  if(p.sizes) return p.sizes[selectedSizeVariant[p.id]||0].price;
  return p.price;
}
// A product can be "พร้อมส่ง" at the whole-product level (p.ready) or per color
// (each entry in p.colors can carry its own `ready` flag, e.g. only the white one is in stock).
// If the selected color defines its own ready flag, that wins; otherwise fall back to p.ready.
// คืนรายการตัวเลือกเสริม (addons) ที่ใช้ได้กับสถานะปัจจุบันของสินค้าชิ้นนี้:
// ถ้าสินค้ามีสี ให้ใช้ addons ที่ผูกกับสีที่กำลังเลือกอยู่ (ถ้ามี)
// ถ้าสินค้าไม่มีสีเลย (เช่นกรอบรูปบางแบบ) ให้ใช้ addons ที่ผูกกับตัวสินค้าโดยตรงแทน
function currentAddonSource(p){
  if(p.colors && p.colors.length){
    const c = p.colors[resolvedColorIndex(p)];
    return (c && c.addons) ? c.addons : null;
  }
  return p.addons || null;
}
function currentReadyState(p){
  // ถ้ากำลังเปิดหน้ารายละเอียดสินค้านี้อยู่ และลูกค้าติ๊กตัวเลือกเสริม (เช่น ผึ้งน้อย) ไว้ ให้เช็คเป็นรายตัว:
  // ต้องติด ready:true ครบทุกตัวเลือกเสริมที่เลือกไว้ ถึงจะยังถือว่าพร้อมส่งได้ (ถ้ามีตัวใดตัวหนึ่งไม่พร้อม ถือว่าไม่พร้อมทั้งช่อ)
  // ถ้าไม่ได้ใส่ ready ไว้ในตัว addon เลย ถือว่าไม่พร้อมส่งตามค่าเดิม (ต้องรอทำเพิ่ม)
  if(p.id === modalProductId && modalSelectedAddons.size){
    const addons = currentAddonSource(p);
    const chosen = addons ? addons.filter(a => modalSelectedAddons.has(a.name)) : [];
    if(chosen.length && !chosen.every(a => a.ready)) return false;
  }
  if(hasNewOptions(p)){
    const sel = currentOptionSelection(p);
    // ยังไม่ถือว่า "พร้อมส่ง" จนกว่าจะเลือกครบทุกมิติและตรงกับ variant ที่พร้อมส่งจริง —
    // ไม่งั้นตอนยังไม่เลือกอะไรเลยจะไปเดาโชว์ป้ายพร้อมส่งจาก variant แรกในลิสต์แบบผิดๆ
    if(!hasFullOptionSelection(p, sel)) return false;
    const v = exactVariantMatch(p, sel);
    return !!(v && v.ready);
  }
  if(p.colors){
    const c = p.colors[resolvedColorIndex(p)];
    if(c && typeof c.ready !== 'undefined') return !!c.ready;
  }
  if(p.sizes){
    const sv = p.sizes[selectedSizeVariant[p.id]||0];
    if(sv && typeof sv.ready !== 'undefined') return !!sv.ready;
  }
  return !!p.ready;
}
// For the "ดูเฉพาะสินค้าพร้อมส่ง" filter: show the product if ANY variant of it is ready,
// so the customer can still find it and pick the ready color specifically.
function productHasAnyReady(p){
  if(p.ready) return true;
  if(p.colors) return p.colors.some(c => c.ready);
  if(hasNewOptions(p)) return p.variants.some(v => v.ready);
  if(p.sizes) return p.sizes.some(s => s.ready);
  return false;
}
// สำหรับโซน "สินค้าแนะนำ (พร้อมส่ง)" เท่านั้น — แตกสินค้าที่มีหลายสี/หลายตัวเลือกออกเป็น
// "การ์ดย่อย" แยกต่อสี/ตัวเลือก/ขนาดที่พร้อมส่งจริง เพื่อให้ลูกค้าเห็นแต่ละแบบชัดๆ โดยไม่กระทบ
// การแสดงผลในหน้าหมวดหมู่ปกติ (ที่ยังคงเป็น renderProductCard(p) การ์ดเดียวต่อสินค้าเหมือนเดิม)
// คืนค่าเป็น array ของ { product, colorIndex|optionIndex|sizeIndex } — ไม่มี index ใดเลย
// แปลว่าไม่ต้องแตก (พร้อมส่งทั้งชิ้น/ไม่มีตัวเลือก)
function readyVariantsOf(p){
  if(p.colors && p.colors.length){
    const readyIdx = [];
    p.colors.forEach((c,i) => { if(c.ready) readyIdx.push(i); });
    if(readyIdx.length) return readyIdx.map(i => ({ product:p, colorIndex:i }));
    // ไม่มีสีไหนติด ready เจาะจงรายสี แต่ทั้งชิ้นติด ready ไว้ (p.ready) — ถือว่าทุกสีพร้อมส่ง แตกทุกสีออกมา
    if(p.ready) return p.colors.map((c,i) => ({ product:p, colorIndex:i }));
    return [];
  }
  if(hasNewOptions(p)){
    const readyIdx = [];
    p.variants.forEach((v,i) => { if(v.ready) readyIdx.push(i); });
    return readyIdx.map(i => ({ product:p, optionIndex:i }));
  }
  if(p.sizes){
    const readyIdx = [];
    p.sizes.forEach((s,i) => { if(s.ready) readyIdx.push(i); });
    return readyIdx.map(i => ({ product:p, sizeIndex:i }));
  }
  return p.ready ? [{ product:p, colorIndex:null }] : [];
}
// สำหรับโหมด "ดูสินค้าทั้งหมด" (ตัวกรอง) — แตกสินค้าทุกชิ้นที่มีสี/ตัวเลือก/ไซซ์ออกเป็นการ์ดย่อย
// รายตัวเหมือน readyVariantsOf() ด้านบน แต่ไม่กรองเฉพาะที่พร้อมส่ง (โชว์ทุกแบบที่มีขายจริง)
// สินค้าที่ไม่มีตัวเลือกอะไรเลยจะได้การ์ดเดียวตามปกติ (isSplit จะเป็น false ใน renderProductCard)
function allVariantsOf(p){
  if(p.colors && p.colors.length) return p.colors.map((c,i) => ({ product:p, colorIndex:i }));
  if(hasNewOptions(p)) return p.variants.map((v,i) => ({ product:p, optionIndex:i }));
  if(p.sizes && p.sizes.length) return p.sizes.map((s,i) => ({ product:p, sizeIndex:i }));
  return [{ product:p }];
}
// ป้ายกำกับขนาด (สำหรับตัวกรอง "ขนาด") ของสินค้าชิ้นหนึ่งอาจมีได้มากกว่า 1 ค่า เช่น สินค้าที่ปกติ
// จัดเป็นไซซ์ "กลาง" แต่ก็มีตัวเลือก "ใส่เงิน" ให้เลือกด้วย — p.size จึงรองรับทั้ง string เดิม
// (สินค้าที่ยังไม่ได้แก้) และ array ของหลายค่า คืนค่าเป็น array เสมอเพื่อให้เช็ค .includes() ได้ตรงๆ
function sizeTagsOf(p){
  if(!p.size) return [];
  return Array.isArray(p.size) ? p.size : [p.size];
}
// ---------- กรองระดับ "แบบ" (variant) ----------
// เดิมตัวกรองตัดสินที่ระดับสินค้า (ใช้ราคาถูกสุดของสินค้า) แล้วค่อยแตกการ์ดย่อยตามมา ทำให้แบบที่ราคาเกินงบ
// หรือเป็นแบบใส่เงินหลุดเข้ามาได้ ตอนนี้ทุกแบบต้องผ่านเงื่อนไขด้วยตัวเอง
// ราคาของ "แบบ" นั้นๆ (v = { colorIndex | optionIndex | sizeIndex } หรือ null = ทั้งสินค้า)
function variantPriceOf(p, v){
  if(v){
    if(v.optionIndex != null && hasNewOptions(p) && p.variants[v.optionIndex]) return p.variants[v.optionIndex].price;
    if(v.sizeIndex != null && p.sizes && p.sizes[v.sizeIndex]) return p.sizes[v.sizeIndex].price;
  }
  return displayPrice(p);
}
// พร้อมส่งของ "แบบ" นั้นๆ — ตรงกับที่ renderProductCard() ใช้โชว์ป้าย พร้อมส่ง บนการ์ดย่อย
function variantIsReadyOf(p, v){
  if(v && v.optionIndex != null && hasNewOptions(p)) return !!(p.variants[v.optionIndex] && p.variants[v.optionIndex].ready);
  if(v && v.sizeIndex != null && p.sizes) return !!(p.sizes[v.sizeIndex] && p.sizes[v.sizeIndex].ready);
  if(v && v.colorIndex != null && p.colors){
    const c = p.colors[v.colorIndex];
    return (c && typeof c.ready !== 'undefined') ? !!c.ready : !!p.ready;
  }
  return productHasAnyReady(p);
}
// ตัวกรองขนาดระดับแบบ: สินค้าที่ติดแท็กทั้ง "ใส่เงิน" และขนาดปกติ (เช่น ["กลาง","ใส่เงิน"]) —
// แบบที่ชื่อมีคำว่า "ใส่เงิน" นับเป็น "ใส่เงิน" ส่วนแบบอื่นนับเป็นขนาดปกติ (กลาง) ไม่ปนกัน
// สินค้าที่ไม่มีแบบย่อยให้แยก (เช่น DM01) ยังขึ้นเป็นการ์ดใบเดียวทั้งสองตัวกรอง
// sizes = Set ของขนาดที่เลือก (เลือกหลายอันได้ ผ่านถ้าตรงกับอันใดอันหนึ่ง) เซตว่าง = ไม่กรองขนาด
function variantMatchesSizeFilter(p, v, sizes){
  if(!sizes || sizes.size === 0) return true;
  return [...sizes].some(sz => variantMatchesOneSize(p, v, sz));
}
// ป้ายตัวกรองขนาดที่แอดมินตั้งไว้ที่ "คู่ผสม" นั้นๆ (variants[i].tag) — ถ้ามีจะใช้ตัดสินตรงๆ ไม่ต้องเดาจากชื่อ
function variantTagOf(p, v){
  if(v && v.optionIndex != null && hasNewOptions(p)){
    const t = p.variants[v.optionIndex];
    if(t && t.tag) return String(t.tag);
  }
  if(v && v.sizeIndex != null && p.sizes && p.sizes[v.sizeIndex]){
    const t = p.sizes[v.sizeIndex];
    if(t && t.tag) return String(t.tag);
  }
  return null;
}
function variantMatchesOneSize(p, v, sizeFilter){
  const explicitTag = variantTagOf(p, v);
  if(explicitTag != null) return explicitTag === sizeFilter;
  const tags = sizeTagsOf(p);
  if(!tags.includes(sizeFilter)) return false;
  if(tags.length > 1 && tags.includes('ใส่เงิน')){
    const label = variantLabelOf(p, v);
    if(label != null){
      const isMoney = label.includes('ใส่เงิน');
      return sizeFilter === 'ใส่เงิน' ? isMoney : !isMoney;
    }
  }
  return true;
}
// opts = { range:{min,max}, sizes:Set, readyOnly, favOnly }
function variantPasses(p, v, opts){
  if(!variantMatchesSearch(p, v)) return false;
  const price = variantPriceOf(p, v);
  if(price < opts.range.min || price > opts.range.max) return false;
  if(!variantMatchesSizeFilter(p, v, opts.sizes)) return false;
  if(opts.readyOnly && !variantIsReadyOf(p, v)) return false;
  if(opts.favOnly && !isVariantFavorite(p, v)) return false;
  return true;
}
function sortByPrice(arr, priceFn){
  if(activeSortOrder === 'asc') return arr.slice().sort((a,b)=> priceFn(a)-priceFn(b));
  if(activeSortOrder === 'desc') return arr.slice().sort((a,b)=> priceFn(b)-priceFn(a));
  return arr;
}
// Readiness of a specific order line (used to decide whether the deposit
// payment option should be offered): falls back to the product's own
// ready flag, but uses the picked color's ready flag when the line has one.
function orderItemIsReady(item){
  const p = PRODUCTS.find(x=>x.id===item.id);
  if(!p) return false;
  if(hasNewOptions(p) && item.label){
    const v = p.variants.find(v => v.match.join(', ') === item.label);
    if(v) return !!v.ready;
  }
  if(p.colors && item.label){
    const colorName = item.label.split(',')[0].trim();
    const c = p.colors.find(cc=>cc.name===colorName);
    if(c && typeof c.ready !== 'undefined') return !!c.ready;
  }
  return !!p.ready;
}
// The deposit option only makes sense when the order needs to be made to
// order — if every line is already พร้อมส่ง (ready to ship), full payment
// or COD covers it and there's nothing to "finish making" later.
function orderNeedsDeposit(items){
  return !!items && items.length > 0 && !items.every(orderItemIsReady);
}

function renderNav(){
  const nav = document.getElementById('catNav');
  const allMode = activeCats.size === 0;
  nav.innerHTML = `
    <button class="cat-filter-btn" onclick="openFilterSheet()" aria-label="ตัวกรอง">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4"></polygon></svg>
      <span class="cat-filter-label">ตัวกรอง</span>
      <span class="filter-count" id="filterCount" hidden></span>
      <span class="filter-badge-dot" id="filterBadgeDot"></span>
    </button>
    <button type="button" class="cat-quick cat-quick-ready${showReadyOnly ? ' active' : ''}" onclick="quickToggleReady()">⚡ พร้อมส่ง</button>` + CATS.map(c => {
    // "ทั้งหมด" ไฮไลต์เมื่อไม่ได้เลือกหมวดเจาะจงไว้เลย ส่วนหมวดอื่นไฮไลต์เมื่ออยู่ใน activeCats จริง
    // หรือ (ตอนอยู่โหมด "ทั้งหมด") เมื่อ scrollspy กำลังเลื่อนผ่านหมวดนั้นอยู่พอดี
    const isActive = c === 'ทั้งหมด' ? allMode : (activeCats.has(c) || (allMode && scrollSpyCat === c));
    return `<button class="cat-btn ${isActive?'active':''}" onclick="selectCategory('${c}')">${c}</button>`;
  }).join('');
  // เลื่อนแถบแท็บแนวนอนให้ปุ่มที่ active อยู่ในมุมมองเสมอ (เผื่อชื่อหมวดยาวจนล้นจอ)
  const activeBtn = nav.querySelector('.cat-btn.active');
  if(activeBtn) activeBtn.scrollIntoView({ behavior:'smooth', inline:'nearest', block:'nearest' });
  updateBottomNav();
}
// ความสูงรวมของแถบ sticky ด้านบน (แถบค้นหา+ตะกร้า และแถบหมวดหมู่) ใช้คำนวณระยะเลื่อน/scrollspy
function stickyOffset(){
  const bar = document.getElementById('searchCartBar');
  const nav = document.getElementById('catNav');
  return (bar ? bar.offsetHeight : 0) + (nav ? nav.offsetHeight : 0);
}
// ทำให้แถบหมวดหมู่ sticky ต่อท้ายแถบค้นหา (แทนที่จะซ้อนทับกันที่ top:0 เหมือนกัน)
function updateStickyOffsets(){
  const bar = document.getElementById('searchCartBar');
  const nav = document.getElementById('catNav');
  if(bar && nav) nav.style.top = bar.offsetHeight + 'px';
  // ใช้ตรึงแถบตัวกรองด้านข้าง (เดสก์ท็อป) ให้อยู่ใต้แถบค้นหาพอดี
  document.documentElement.style.setProperty('--bar-h', (bar ? bar.offsetHeight : 64) + 'px');
}
window.addEventListener('resize', updateStickyOffsets);
// เลื่อนหน้าไปบนสุดของรายการสินค้า (ใช้ร่วมกันทุกจุดที่เปลี่ยนตัวกรองแล้วอยากเลื่อนให้เห็นผลลัพธ์)
function scrollToCatalogTop(){
  sfbHeaderLock(1100); // เลื่อนด้วยโค้ด: ห้ามแถบบนซ่อน ไม่งั้นจะเหลือที่ว่างเท่าความสูงแถบ (ระยะเลื่อนคำนวณรวมแถบไว้แล้ว)
  const el = document.getElementById('catalog');
  if(el){
    const offset = stickyOffset() + 8;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}
// กดแท็บหมวดหมู่บนแถบ quick-nav ด้านบน = "กระโดดไปหมวดนั้นหมวดเดียว" (แทนที่ตัวเลือกหมวดเดิมทั้งหมด)
// (ชิปหมวดหมู่ในแผงตัวกรองก็เลือกได้ทีละหมวดเช่นกัน — ดู toggleCategory)
function selectCategory(c){
  const prevCat = activeCats.size === 1 ? [...activeCats][0] : null;
  activeCats = c === 'ทั้งหมด' ? new Set() : new Set([c]);
  activeSizes = new Set();
  // ชนิดดอกไม้เลือกแยกจากหมวด — คงไว้เฉพาะชนิดที่ยังมีในหมวดใหม่
  activeFlowerTypes = pruneFlowerTypes(activeFlowerTypes, activeCats);
  scrollSpyCat = c;
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  scrollToCatalogTop();
}
// ปุ่มหมวดหมู่ในแผงตัวกรอง (เดสก์ท็อป, live) — กดติด/ปลดได้ทีละหมวด เลือกพร้อมกันได้หลายหมวด
// หมวดหมู่หลักเลือกได้ทีละหมวดเดียว — กดหมวดอื่น = เปลี่ยนไปหมวดนั้น กดหมวดเดิมซ้ำ = กลับเป็น "ทั้งหมด"
// (activeCats ยังเป็น Set เพื่อไม่ต้องแก้โค้ดส่วนอื่น แต่จะมีสมาชิกไม่เกิน 1 ตัว)
function toggleCategory(c){
  activeCats = activeCats.has(c) ? new Set() : new Set([c]);
  activeSizes = new Set();
  activeFlowerTypes = pruneFlowerTypes(activeFlowerTypes, activeCats);
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  scrollToCatalogTop();
}
function clearCategorySelection(){
  activeCats = new Set();
  activeSizes = new Set();
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}
// Scrollspy: ไล่ดูว่าตอนนี้หมวดไหนอยู่ใต้แถบเมนูพอดี แล้วไฮไลต์แท็บนั้นให้อัตโนมัติ
// ทำงานเฉพาะตอนอยู่โหมด "ทั้งหมด" (ไม่ได้เลือกหมวดเจาะจงไว้) เท่านั้น — ไม่งั้นจะไปเปลี่ยนตัวกรองจริงโดยไม่ตั้งใจ
function setupScrollSpy(){
  if(scrollSpyObserver) scrollSpyObserver.disconnect();
  updateStickyOffsets();
  const totalSticky = stickyOffset();
  const sections = document.querySelectorAll('#catalog .cat-section');
  if(!sections.length) return;
  scrollSpyObserver = new IntersectionObserver((entries) => {
    if(activeCats.size !== 0) return;
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const cat = entry.target.getAttribute('data-cat');
        if(cat && cat !== scrollSpyCat){
          scrollSpyCat = cat;
          renderNav();
        }
      }
    });
  }, { rootMargin: `-${totalSticky + 4}px 0px -65% 0px`, threshold: 0 });
  sections.forEach(s => scrollSpyObserver.observe(s));
}
// กดปุ่มขนาด = ติด/ปลดทีละปุ่ม (เลือกได้หลายอัน) กด "ทั้งหมด" = ล้างขนาดที่เลือกไว้
function toggleSizeIn(set, s){
  if(s === 'ทั้งหมด'){ set.clear(); return; }
  if(set.has(s)) set.delete(s); else set.add(s);
}
function setSize(s){
  toggleSizeIn(activeSizes, s);
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}

// รายชนิดอ่านจาก window.FLOWER_TYPES ใน firebase-config.js (แหล่งเดียวกับหลังบ้าน) · ปุ่ม "ทั้งหมด" อยู่หน้าสุดเสมอ
const FLOWER_TYPES = ['ทั้งหมด', ...(Array.isArray(window.FLOWER_TYPES) ? window.FLOWER_TYPES : [])];
// ใส่ตัวเลือกร้านจากหลังบ้านทับค่าเริ่มต้น (หมวดหมู่ · ชนิดดอกไม้ · ขนาดของแต่ละหมวด) ปุ่ม "ทั้งหมด" ใส่ให้เองหน้าสุดเสมอ
function applyShopOptions(o){
  if(!o || typeof o !== 'object') return;
  const clean = a => Array.isArray(a)
    ? [...new Set(a.map(x => String(x ?? '').trim()).filter(x => x && x !== 'ทั้งหมด'))]
    : null;
  const cats = clean(o.cats), flowers = clean(o.flowers);
  if(cats && cats.length) CATS.splice(0, CATS.length, 'ทั้งหมด', ...cats);
  if(flowers) FLOWER_TYPES.splice(0, FLOWER_TYPES.length, 'ทั้งหมด', ...flowers);
  if(o.sizes && typeof o.sizes === 'object'){
    Object.keys(CATEGORY_SIZES).forEach(k => delete CATEGORY_SIZES[k]);
    CATS.slice(1).forEach(c => {
      const s = clean(o.sizes[c]);
      if(s && s.length) CATEGORY_SIZES[c] = ['ทั้งหมด', ...s];
    });
  }
}
// ชนิดดอกไม้ที่เลือก — เลือกได้หลายชนิดพร้อมกัน (Set ว่าง = ทุกชนิด) ใช้ได้ทุกหมวด ไม่ต้องเลือกหมวดก่อน
let activeFlowerTypes = new Set();
function flowerMatches(p, set = activeFlowerTypes){
  return !set || set.size === 0 || set.has(p.flowerType);
}
// ชนิดดอกไม้ที่มีสินค้าอยู่จริงในขอบเขตที่เลือก (ไม่เลือกหมวด = ทั้งร้าน)
function flowerTypesInScope(catsSet){
  const inScope = p => !catsSet || catsSet.size === 0 || catsSet.has(p.cat);
  // เรียงตามจำนวนสินค้าในขอบเขตที่เลือก มากไปน้อย (เท่ากันคงลำดับเดิม)
  return FLOWER_TYPES.slice(1)
    .map(t => [t, PRODUCTS.filter(p => p.flowerType === t && inScope(p)).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}
// เปลี่ยนหมวดแล้ว ตัดชนิดที่ไม่มีในหมวดใหม่ทิ้ง (ชนิดที่ยังมีอยู่ในหมวดใหม่จะคงไว้)
function pruneFlowerTypes(flowerSet, catsSet){
  const ok = new Set(flowerTypesInScope(catsSet));
  return new Set([...flowerSet].filter(t => ok.has(t)));
}
function toggleFlowerIn(set, t){
  if(set.has(t)) set.delete(t); else set.add(t);
}
function setFlowerType(t){
  if(t === 'ทั้งหมด') activeFlowerTypes = new Set(); else toggleFlowerIn(activeFlowerTypes, t);
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}

// ช่วงราคา — ใช้แถบเลื่อน + ช่องกรอกตัวเลขเป็นวิธีเดียวในการกรองราคา (ตัดปุ่มลัดออกแล้วตามคำขอ)
const PRICE_SLIDER_MIN = 0;
const PRICE_SLIDER_MAX = 3000;
const PRICE_SLIDER_STEP = 50;
let customPriceMin = PRICE_SLIDER_MIN;
let customPriceMax = PRICE_SLIDER_MAX;
// เรียงลำดับสินค้าตามราคา — แยกจากการกรองช่วงราคา (เรียงลำดับใหม่ ไม่ได้ซ่อนสินค้า)
let activeSortOrder = 'none'; // 'none' | 'asc' | 'desc'
function setSortOrder(order){
  activeSortOrder = (activeSortOrder === order) ? 'none' : order;
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}
function setDraftSortOrder(order){
  filterDraft.sortOrder = (filterDraft.sortOrder === order) ? 'none' : order;
  renderFilterSheetBody();
}
// ลากแถบเลื่อนราคา (ใช้ทั้ง sidebar ที่ apply ทันที และ sheet มือถือที่ staged ไว้ก่อน)
// อัปเดตเฉพาะ DOM ของแถบเลื่อนเอง ไม่ re-render ทั้งแผงตัวกรอง เพื่อไม่ให้การลากสะดุด
function onPriceSliderInput(mode, which, rawVal){
  const idPrefix = mode === 'sidebar' ? 'priceSlideSidebar' : 'priceSlideSheet';
  const minInput = document.getElementById(idPrefix + 'Min');
  const maxInput = document.getElementById(idPrefix + 'Max');
  if(!minInput || !maxInput) return;
  let minVal = parseInt(minInput.value, 10);
  let maxVal = parseInt(maxInput.value, 10);
  const val = parseInt(rawVal, 10);
  if(which === 'min'){
    minVal = Math.min(val, maxVal - PRICE_SLIDER_STEP);
    minInput.value = minVal;
  } else {
    maxVal = Math.max(val, minVal + PRICE_SLIDER_STEP);
    maxInput.value = maxVal;
  }
  applyPriceSliderValues(mode, minVal, maxVal);
}
// ช่องกรอกตัวเลขราคาเอง — ตรวจสอบตอน change/blur (ไม่ตรวจทุกตัวที่พิมพ์ กันกระตุก)
function onPriceNumberChange(mode, which, rawVal){
  const idPrefix = mode === 'sidebar' ? 'priceSlideSidebar' : 'priceSlideSheet';
  const minNum = document.getElementById(idPrefix + 'MinNum');
  const maxNum = document.getElementById(idPrefix + 'MaxNum');
  if(!minNum || !maxNum) return;
  let minVal = parseInt(minNum.value, 10);
  let maxVal = parseInt(maxNum.value, 10);
  if(isNaN(minVal)) minVal = PRICE_SLIDER_MIN;
  if(isNaN(maxVal)) maxVal = PRICE_SLIDER_MAX;
  minVal = Math.min(Math.max(minVal, PRICE_SLIDER_MIN), PRICE_SLIDER_MAX);
  maxVal = Math.min(Math.max(maxVal, PRICE_SLIDER_MIN), PRICE_SLIDER_MAX);
  if(which === 'min' && minVal > maxVal - PRICE_SLIDER_STEP) minVal = maxVal - PRICE_SLIDER_STEP;
  if(which === 'max' && maxVal < minVal + PRICE_SLIDER_STEP) maxVal = minVal + PRICE_SLIDER_STEP;
  minVal = Math.max(minVal, PRICE_SLIDER_MIN);
  maxVal = Math.min(maxVal, PRICE_SLIDER_MAX);
  minNum.value = minVal;
  maxNum.value = maxVal;
  const minInput = document.getElementById(idPrefix + 'Min');
  const maxInput = document.getElementById(idPrefix + 'Max');
  if(minInput) minInput.value = minVal;
  if(maxInput) maxInput.value = maxVal;
  applyPriceSliderValues(mode, minVal, maxVal);
}
// อัปเดตแถบสี + ช่องกรอกตัวเลข + ตัวแปรสถานะ ให้ตรงกันหลังได้ค่าใหม่จากแหล่งไหนก็ตาม (ลากหรือพิมพ์)
function applyPriceSliderValues(mode, minVal, maxVal){
  const idPrefix = mode === 'sidebar' ? 'priceSlideSidebar' : 'priceSlideSheet';
  const span = PRICE_SLIDER_MAX - PRICE_SLIDER_MIN;
  const minPct = (minVal - PRICE_SLIDER_MIN) / span * 100;
  const maxPct = (maxVal - PRICE_SLIDER_MIN) / span * 100;
  const rangeEl = document.getElementById(idPrefix + 'Range');
  if(rangeEl){ rangeEl.style.left = minPct + '%'; rangeEl.style.right = (100 - maxPct) + '%'; }
  const minNum = document.getElementById(idPrefix + 'MinNum');
  const maxNum = document.getElementById(idPrefix + 'MaxNum');
  if(minNum && document.activeElement !== minNum) minNum.value = minVal;
  if(maxNum && document.activeElement !== maxNum) maxNum.value = maxVal;

  if(mode === 'sidebar'){
    customPriceMin = minVal;
    customPriceMax = maxVal;
    renderCatalog();
    updateFilterBadge();
    syncSidebarClear();
  } else {
    filterDraft.customMin = minVal;
    filterDraft.customMax = maxVal;
    updateSheetApplyLabel();
  }
}
function activePriceBounds(){
  return { min: customPriceMin, max: customPriceMax };
}
function renderPriceSliderHtml(state, mode){
  const min = state.customMin ?? PRICE_SLIDER_MIN;
  const max = state.customMax ?? PRICE_SLIDER_MAX;
  const span = PRICE_SLIDER_MAX - PRICE_SLIDER_MIN;
  const minPct = (min - PRICE_SLIDER_MIN) / span * 100;
  const maxPct = (max - PRICE_SLIDER_MIN) / span * 100;
  const idPrefix = mode === 'sidebar' ? 'priceSlideSidebar' : 'priceSlideSheet';
  return `
    <div class="price-slider-wrap">
      <div class="price-slider">
        <div class="price-slider-track"></div>
        <div class="price-slider-range" id="${idPrefix}Range" style="left:${minPct}%; right:${100 - maxPct}%"></div>
        <input type="range" class="price-slider-input price-slider-min" id="${idPrefix}Min"
          min="${PRICE_SLIDER_MIN}" max="${PRICE_SLIDER_MAX}" step="${PRICE_SLIDER_STEP}" value="${min}"
          oninput="onPriceSliderInput('${mode}','min', this.value)" aria-label="ราคาต่ำสุด">
        <input type="range" class="price-slider-input price-slider-max" id="${idPrefix}Max"
          min="${PRICE_SLIDER_MIN}" max="${PRICE_SLIDER_MAX}" step="${PRICE_SLIDER_STEP}" value="${max}"
          oninput="onPriceSliderInput('${mode}','max', this.value)" aria-label="ราคาสูงสุด">
      </div>
      <div class="price-slider-labels">
        <div class="price-num-field">
          <input type="number" class="price-num-input" id="${idPrefix}MinNum"
            min="${PRICE_SLIDER_MIN}" max="${PRICE_SLIDER_MAX}" step="${PRICE_SLIDER_STEP}" value="${min}"
            onchange="onPriceNumberChange('${mode}','min', this.value)" aria-label="ราคาต่ำสุด (พิมพ์เอง)">
        </div>
        <span class="price-num-sep">ถึง</span>
        <div class="price-num-field">
          <input type="number" class="price-num-input" id="${idPrefix}MaxNum"
            min="${PRICE_SLIDER_MIN}" max="${PRICE_SLIDER_MAX}" step="${PRICE_SLIDER_STEP}" value="${max}"
            onchange="onPriceNumberChange('${mode}','max', this.value)" aria-label="ราคาสูงสุด (พิมพ์เอง)">
        </div>
        <span class="price-num-baht">บาท</span>
      </div>
    </div>
  `;
}

/* ---------- Unified filter panel: shared HTML builder for both the desktop
   sidebar (applies changes live) and the mobile bottom sheet (stages changes
   in a draft, only committed when the customer taps "แสดงผลลัพธ์") ---------- */
let filterDraft = null;

// ยูเนียนของตัวเลือกขนาดจากทุกหมวดที่เลือกไว้อยู่ตอนนี้ (คืน null ถ้าไม่ได้เลือกหมวดไหนเลย
// หรือทุกหมวดที่เลือกไม่มีตัวกรองขนาดกำหนดไว้ใน CATEGORY_SIZES เลย)
function unionSizeList(catsSet){
  if(!catsSet || catsSet.size === 0) return null;
  const lists = [...catsSet].map(c => CATEGORY_SIZES[c]).filter(Boolean);
  if(!lists.length) return null;
  const values = new Set();
  lists.forEach(list => list.slice(1).forEach(v => values.add(v)));
  return ['ทั้งหมด', ...values];
}

// สถานะเปิด/ปิดของกลุ่มที่พับได้ในแผงมือถือ (ต้องจำไว้นอกตัว HTML เพราะแผงถูกวาดใหม่ทุกครั้งที่กดเลือก)
let filterGroupOpen = { sort:false, more:false };

// มีตัวกรองใดต่างจากค่าเริ่มต้นหรือไม่ (ใช้โชว์/ซ่อนปุ่ม "ล้างตัวกรอง")
function filtersAreActive(st){
  return st.cats.size > 0 || st.flowerTypes.size > 0 || (st.sizes && st.sizes.size > 0)
    || st.customMin !== PRICE_SLIDER_MIN || st.customMax !== PRICE_SLIDER_MAX
    || st.sortOrder !== 'none' || st.ready || st.favorites || st.allSplit;
}
function sidebarState(){
  return {
    cats: activeCats, customMin: customPriceMin, customMax: customPriceMax,
    sortOrder: activeSortOrder, ready: showReadyOnly, favorites: showFavoritesOnly,
    allSplit: showAllVariantsSplit, sizes: activeSizes, flowerTypes: activeFlowerTypes
  };
}
// ซ่อน/โชว์ปุ่มล้างตัวกรองบนแถบข้างโดยไม่วาดแผงใหม่ (ใช้ตอนลากแถบราคา กันแถบกระตุก)
function syncSidebarClear(){
  const btn = document.querySelector('#filterSidebar .filter-sidebar-clear');
  if(btn) btn.hidden = !filtersAreActive(sidebarState());
}
// นับผลลัพธ์ตามตัวกรองในแผงมือถือ (ตรรกะเดียวกับ renderCatalog ส่วนรายหมวด)
function countResultsForState(st){
  const range = { min: st.customMin, max: st.customMax };
  const cats = st.cats.size ? CATS.slice(1).filter(c => st.cats.has(c)) : CATS.slice(1);
  let total = 0;
  cats.forEach(cat => {
    const opts = { range, sizes: CATEGORY_SIZES[cat] ? st.sizes : new Set(), readyOnly: st.ready, favOnly: st.favorites };
    PRODUCTS.filter(p => p.cat === cat && matchesSearch(p) && flowerMatches(p, st.flowerTypes)).forEach(p => {
      const passing = allVariantsOf(p).filter(v => variantPasses(p, v, opts));
      total += st.allSplit ? passing.length : (passing.length ? 1 : 0);
    });
  });
  return total;
}
function updateSheetApplyLabel(){
  const btn = document.querySelector('.filter-sheet-footer .filter-apply-btn');
  if(!btn || !filterDraft) return;
  const n = countResultsForState(filterDraft);
  btn.textContent = n ? `แสดง ${n} รายการ` : 'ไม่พบสินค้า';
}

function buildFilterPanelHtml(state, mode){
  // mode: 'sidebar' (live — pill click applies immediately) or 'sheet' (draft)
  const setReadyFn = mode === 'sidebar' ? 'toggleReadyOnly' : 'setDraftReady';
  const setFavFn = mode === 'sidebar' ? 'toggleFavoritesOnly' : 'setDraftFavorites';
  const setFlowerFn = mode === 'sidebar' ? 'setFlowerType' : 'setDraftFlowerType';
  const setSortFn = mode === 'sidebar' ? 'setSortOrder' : 'setDraftSortOrder';
  const setAllSplitFn = mode === 'sidebar' ? 'toggleAllVariantsSplit' : 'setDraftAllSplit';
  const toggleCatFn = mode === 'sidebar' ? 'toggleCategory' : 'toggleDraftCategory';
  const clearCatFn = mode === 'sidebar' ? 'clearCategorySelection' : 'clearDraftCategorySelection';

  // กลุ่มตัวกรอง: หัวข้อ + ตัวเลขจำนวนที่เลือก · บนมือถือกลุ่มที่ key ไว้พับได้ (เปิดเองเมื่อมีค่าที่เลือกอยู่)
  const group = (title, count, body, key, forceOpen) => {
    const t = `${title}${count ? `<span class="fg-count">${count}</span>` : ''}`;
    if(!key || mode !== 'sheet') return `<div class="filter-group"><div class="filter-group-title">${t}</div>${body}</div>`;
    const open = filterGroupOpen[key] || forceOpen;
    return `<details class="filter-group fg-details"${open ? ' open' : ''} ontoggle="filterGroupOpen['${key}']=this.open"><summary class="filter-group-title">${t}</summary>${body}</details>`;
  };

  // หมวดหมู่ — เลือกได้ทีละหมวด "ทั้งหมด" คือ "ไม่เลือกหมวดไหนเลย"
  const catHtml = CATS.map(c => {
    const isActive = c === 'ทั้งหมด' ? state.cats.size === 0 : state.cats.has(c);
    const clickFn = c === 'ทั้งหมด' ? clearCatFn + '()' : `${toggleCatFn}('${c}')`;
    return `<button class="filter-pill ${isActive?'active':''}" aria-pressed="${isActive}" onclick="${clickFn}">${c}</button>`;
  }).join('');

  // ตัวเลือกขนาด — เลือกได้หลายค่า ถ้าเลือกหลายหมวดจะรวมตัวเลือกของทุกหมวด
  const sizeList = unionSizeList(state.cats);
  const sizeHtml = sizeList ? group('📏 ขนาด', state.sizes ? state.sizes.size : 0,
    `<div class="filter-pills">${sizeList.map(s => {
      const on = s === 'ทั้งหมด' ? !(state.sizes && state.sizes.size) : !!(state.sizes && state.sizes.has(s));
      return `<button class="filter-pill${s === 'ทั้งหมด' ? '' : ' is-multi'} ${on?'active':''}" aria-pressed="${on}" onclick="${mode==='sidebar' ? `setSize('${s}')` : `setDraftSize('${s}')`}">${s}</button>`;
    }).join('')}</div>`) : '';

  // ชนิดดอกไม้ — แสดงตลอด เลือกได้หลายชนิด ("ทั้งหมด" = ไม่เลือกชนิดไหนเลย)
  // รายการชนิดมาจากสินค้าที่มีจริงในหมวดที่เลือก (ไม่เลือกหมวด = ทั้งร้าน)
  const flowerList = ['ทั้งหมด', ...flowerTypesInScope(state.cats)];
  const flowerHtml = group('🌸 ชนิดดอกไม้', state.flowerTypes.size,
    `<div class="filter-pills">${flowerList.map(t => {
      const on = t === 'ทั้งหมด' ? state.flowerTypes.size === 0 : state.flowerTypes.has(t);
      return `<button class="filter-pill${t === 'ทั้งหมด' ? '' : ' is-multi'} ${on?'active':''}" aria-pressed="${on}" onclick="${setFlowerFn}('${t}')">${t}</button>`;
    }).join('')}</div>`);

  const priceHtml = PRICES_HIDDEN ? '' : group('ช่วงราคา', 0, renderPriceSliderHtml(state, mode));

  const sortHtml = PRICES_HIDDEN ? '' : group('เรียงตามราคา', 0, `
    <div class="fseg" role="group" aria-label="เรียงตามราคา">
      <button class="${state.sortOrder==='asc'?'active':''}" aria-pressed="${state.sortOrder==='asc'}" onclick="${setSortFn}('asc')">น้อย → มาก</button>
      <button class="${state.sortOrder==='desc'?'active':''}" aria-pressed="${state.sortOrder==='desc'}" onclick="${setSortFn}('desc')">มาก → น้อย</button>
    </div>`, 'sort', state.sortOrder !== 'none');

  const moreCount = (state.ready ? 1 : 0) + (state.favorites ? 1 : 0) + (state.allSplit ? 1 : 0);
  const sw = (label, checked, fn, hint) => `
    <label class="fswitch"${hint ? ` title="${hint}"` : ''}>
      <span>${label}</span>
      <input type="checkbox" class="fswitch-input" ${checked?'checked':''} onchange="${fn}(this.checked)">
    </label>`;
  const moreHtml = group('ตัวเลือกอื่น', moreCount,
    sw('⚡ พร้อมส่ง', state.ready, setReadyFn) +
    sw('❤️ รายการโปรด', state.favorites, setFavFn) +
    sw('🧾 แยกการ์ดทุกสี/แบบ', state.allSplit, setAllSplitFn, 'แสดงทุกสี/แบบเป็นการ์ดแยกกัน'),
    'more', moreCount > 0);

  return group('หมวดหมู่', 0, `<div class="filter-pills">${catHtml}</div>`)
    + sizeHtml + flowerHtml + priceHtml + sortHtml + moreHtml;
}

// Desktop sidebar — always visible, applies every change immediately (no apply button needed)
function renderFilterSidebar(){
  const el = document.getElementById('filterSidebar');
  if(!el) return;
  const state = sidebarState();
  el.innerHTML = `<div class="filter-sidebar-head">
      <h4 class="filter-sidebar-title">ตัวกรองสินค้า</h4>
      <button class="filter-sidebar-clear" onclick="clearSidebarFilters()"${filtersAreActive(state) ? '' : ' hidden'}>ล้างตัวกรอง</button>
    </div>` + buildFilterPanelHtml(state, 'sidebar');
}
// ล้างตัวกรองทั้งหมด (ปุ่มบนแถบข้าง — เดสก์ท็อป) แล้วอัปเดตหน้าเว็บทันที
function clearSidebarFilters(){
  activeCats = new Set();
  customPriceMin = PRICE_SLIDER_MIN;
  customPriceMax = PRICE_SLIDER_MAX;
  activeSortOrder = 'none';
  showReadyOnly = false;
  showFavoritesOnly = false;
  showAllVariantsSplit = false;
  activeSizes = new Set();
  activeFlowerTypes = new Set();
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}

// Mobile bottom sheet — stages changes in filterDraft until "แสดงผลลัพธ์" is tapped
function renderFilterSheetBody(){
  const body = document.getElementById('filterSheetBody');
  if(body) body.innerHTML = buildFilterPanelHtml(filterDraft, 'sheet');
  updateSheetApplyLabel();
}
function openFilterSheet(){
  filterDraft = {
    cats: new Set(activeCats),
    customMin: customPriceMin,
    customMax: customPriceMax,
    sortOrder: activeSortOrder,
    ready: showReadyOnly,
    favorites: showFavoritesOnly,
    allSplit: showAllVariantsSplit,
    sizes: new Set(activeSizes),
    flowerTypes: new Set(activeFlowerTypes)
  };
  renderFilterSheetBody();
  document.getElementById('filterOverlay').classList.add('open');
  document.getElementById('filterSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeFilterSheet(){
  document.getElementById('filterOverlay').classList.remove('open');
  document.getElementById('filterSheet').classList.remove('open');
  document.body.style.overflow = '';
}
function toggleDraftCategory(c){
  filterDraft.cats = filterDraft.cats.has(c) ? new Set() : new Set([c]);
  filterDraft.sizes = new Set();
  filterDraft.flowerTypes = pruneFlowerTypes(filterDraft.flowerTypes, filterDraft.cats);
  renderFilterSheetBody();
}
function clearDraftCategorySelection(){
  filterDraft.cats = new Set();
  filterDraft.sizes = new Set();
  renderFilterSheetBody();
}
function setDraftReady(checked){ filterDraft.ready = checked; renderFilterSheetBody(); }
function setDraftFavorites(checked){ filterDraft.favorites = checked; renderFilterSheetBody(); }
function setDraftSize(s){ toggleSizeIn(filterDraft.sizes, s); renderFilterSheetBody(); }
function setDraftFlowerType(t){
  if(t === 'ทั้งหมด') filterDraft.flowerTypes = new Set(); else toggleFlowerIn(filterDraft.flowerTypes, t);
  renderFilterSheetBody();
}
function clearFilterDraft(){
  filterDraft = { cats:new Set(), customMin:PRICE_SLIDER_MIN, customMax:PRICE_SLIDER_MAX, sortOrder:'none', ready:false, favorites:false, allSplit:false, sizes:new Set(), flowerTypes:new Set() };
  renderFilterSheetBody();
}
function applyFilterDraft(){
  activeCats = new Set(filterDraft.cats);
  customPriceMin = filterDraft.customMin;
  customPriceMax = filterDraft.customMax;
  activeSortOrder = filterDraft.sortOrder;
  showReadyOnly = filterDraft.ready;
  showFavoritesOnly = filterDraft.favorites;
  showAllVariantsSplit = filterDraft.allSplit;
  activeSizes = new Set(filterDraft.sizes);
  activeFlowerTypes = new Set(filterDraft.flowerTypes);
  if(activeCats.size !== 1) scrollSpyCat = 'ทั้งหมด'; else scrollSpyCat = [...activeCats][0];
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  closeFilterSheet();
  scrollToCatalogTop();
}
// จุดสีบนปุ่ม "ตัวกรอง" (มือถือ) โชว์เมื่อมีตัวกรองใดๆ ต่างไปจากค่าเริ่มต้น
function updateFilterBadge(){
  const dot = document.getElementById('filterBadgeDot');
  const priceActive = customPriceMin !== PRICE_SLIDER_MIN || customPriceMax !== PRICE_SLIDER_MAX;
  // นับ "กลุ่มตัวกรอง" ที่เปิดอยู่ (ไม่ใช่จำนวนค่า) เพื่อโชว์เป็นตัวเลขบนปุ่มตัวกรองบนมือถือ
  const n = [activeCats.size > 0, priceActive, activeSortOrder !== 'none', showReadyOnly, showFavoritesOnly,
             showAllVariantsSplit, activeFlowerTypes.size > 0, activeSizes.size > 0].filter(Boolean).length;
  if(dot) dot.classList.toggle('show', n > 0);
  const cnt = document.getElementById('filterCount');
  if(cnt){ cnt.textContent = n; cnt.hidden = n === 0; }
  // ชิป "พร้อมส่ง" ด่วนบนแถบหมวด ให้สถานะตรงกับตัวกรองเสมอ ไม่ว่าจะเปลี่ยนจากแผงตัวกรองหรือจากชิป
  document.querySelectorAll('.cat-quick-ready').forEach(b => b.classList.toggle('active', showReadyOnly));
  updateBottomNav();
}
// กดชิป "พร้อมส่ง" บนแถบหมวด (มือถือ) = เปิด/ปิดตัวกรองพร้อมส่งทันที ไม่ต้องเปิดแผงตัวกรอง
function quickToggleReady(){ toggleReadyOnly(!showReadyOnly); }

// A product "มีตัวเลือกสินค้า" if the customer has to pick between colors,
// sizes, or a bill count before the price/line item is final.
function hasProductOptions(p){
  return !!(p.colors || p.sizes || p.billSelector || hasNewOptions(p));
}
// colorIndex/optionIndex/sizeIndex ว่างทั้งหมด = หัวใจของทั้งสินค้า (การ์ดใบเดียวต่อสินค้า)
// มีค่าอย่างใดอย่างหนึ่ง = หัวใจเฉพาะแบบนั้น (การ์ดย่อยที่แตกตามสี/ตัวเลือก/ขนาด)
function favHeartHtml(p, colorIndex, optionIndex, sizeIndex){
  const isVar = colorIndex != null || optionIndex != null || sizeIndex != null;
  const active = isVar ? isVariantFavorite(p, { colorIndex, optionIndex, sizeIndex }) : isProductFavorite(p);
  const args = `'${p.id}', ${colorIndex ?? 'null'}, ${optionIndex ?? 'null'}, ${sizeIndex ?? 'null'}`;
  return `<button type="button" class="fav-heart ${active?'active':''}" onclick="event.stopPropagation(); toggleFavorite(${args})" aria-label="${active?'เอาออกจากรายการโปรด':'บันทึกไว้ในรายการโปรด'}">${active?'♥':'♡'}</button>`;
}
// variant (optional): { colorIndex } หรือ { optionIndex } หรือ { sizeIndex } — ใช้เมื่อการ์ดนี้เป็น
// "การ์ดย่อยที่แตกตามสี/ตัวเลือก/ขนาด" ในโซนสินค้าแนะนำ — จะโชว์รูป/ชื่อ/ราคาของตัวเลือกนั้นๆ ตรงๆ
// (ไม่ผูกกับตัวเลือกที่ลูกค้าเลือกไว้ในสถานะกลาง) และเปิดหน้าสินค้าพร้อม pre-select ตัวเลือกนั้นให้ทันที
// ส่วนการ์ดปกติ (variant เป็น undefined) ทำงานเหมือนเดิมทุกอย่าง
// ---------- เก็บรายการการ์ดที่ผ่านตัวกรอง (ใช้ทำรูปแคตตาล็อก) ----------
// renderCatalog() จะเปิด catalogExportCollect เฉพาะตอนวาดการ์ดในแต่ละหมวด (ไม่รวมโซน "สินค้าแนะนำ" กันสินค้าซ้ำ)
// แล้ว renderProductCard() จะส่งชื่อ/ราคา/รูปของการ์ดนั้นเข้ามาเก็บตามลำดับที่ลูกค้าเห็นบนหน้าเว็บ
let catalogExportItems = [];
let catalogExportCollect = false;
let catalogExporting = false;
/* ---------- แถวรูปจิ๋วบนการ์ดสินค้า (บอกว่ามีหลายสี/แบบ + แตะแล้วรูปหลักเปลี่ยนตาม) ---------- */
function escAttr(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
// รวบรวมรูปของแต่ละสี/แบบ/ไซซ์ของสินค้า (ถ้าตัวกรองบีบเหลือบางแบบ ให้โชว์เฉพาะแบบที่ผ่านกรอง)
function cardSwatchItems(p, narrow){
  const narrowed = !!(narrow && narrow.passing.length && narrow.passing.length < narrow.total);
  const only = key => {
    if(!narrowed) return null;
    const s = new Set(narrow.passing.map(x => x[key]).filter(x => x != null));
    return s.size ? s : null;
  };
  const items = [], seen = new Set();
  let total = 0, noun = 'แบบ';
  const add = (src, label, key, idx, ready) => {
    total++;
    if(!src || seen.has(src)) return;
    seen.add(src);
    items.push({ src, label, key, idx, ready });
  };
  if(hasNewOptions(p)){
    const keep = only('optionIndex');
    p.variants.forEach((v, i) => {
      if(keep && !keep.has(i)) return;
      add(v.image || (v.images && v.images[0]), v.match.join(' '), 'o', i, !!v.ready);
    });
    const o = p.options;
    if(o.length === 1 && o[0].name && String(o[0].name).length <= 6) noun = o[0].name;
  } else if(p.colors && p.colors.length){
    const keep = only('colorIndex');
    p.colors.forEach((c, i) => {
      if(keep && !keep.has(i)) return;
      add(c.image || (c.images && c.images[0]), c.name, 'c', i, typeof c.ready !== 'undefined' ? !!c.ready : !!p.ready);
    });
    noun = 'สี';
  } else if(p.sizes && p.sizes.length){
    const keep = only('sizeIndex');
    p.sizes.forEach((z, i) => {
      if(keep && !keep.has(i)) return;
      add(z.image || (z.images && z.images[0]), z.name, 's', i, !!z.ready);
    });
  } else return null;
  return { items, total, noun };
}
function cardSwatchHtml(p, narrow){
  const info = cardSwatchItems(p, narrow);
  if(!info || info.total < 2) return '<span class="option-badge">เลือกแบบ/สีได้</span>';
  const label = escAttr(info.total + ' ' + info.noun);
  if(!info.items.length) return `<span class="option-badge">${label}</span>`;
  const SHOW_D = 4, SHOW_M = 3; // คอมโชว์ 4 รูป มือถือโชว์ 3 รูป (การ์ดสองคอลัมน์แคบ)
  const btns = info.items.slice(0, SHOW_D).map((it, i) =>
    `<button type="button" class="sw-btn${i >= SHOW_M ? ' sw-x' : ''}" data-pid="${escAttr(p.id)}" data-src="${escAttr(it.src)}" data-key="${it.key}" data-idx="${it.idx}" data-ready="${it.ready ? 1 : 0}" aria-pressed="false" aria-label="${escAttr('ดู ' + it.label)}" title="${escAttr(it.label)}" onclick="event.stopPropagation(); cardSwatchPick(this)" onmouseenter="cardSwatchHover(this)"><img src="${escAttr(it.src)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'"></button>`
  ).join('');
  const nD = info.items.length - SHOW_D, nM = info.items.length - SHOW_M;
  const more = (nD > 0 ? `<span class="sw-more sw-more-d">+${nD}</span>` : '')
             + (nM > 0 ? `<span class="sw-more sw-more-m">+${nM}</span>` : '');
  return `<div class="sw-row"><div class="sw-strip" onmouseleave="cardSwatchLeave(this)">${btns}${more}</div></div>`;
}
function cardSwatchOrig(card){
  if(!card._swOrig){
    const thumb = card.querySelector('.thumb');
    card._swOrig = { html: thumb ? thumb.innerHTML : '', ready: !!card.querySelector('.badge-ready') };
  }
  return card._swOrig;
}
function cardSwatchBadge(card, ready){
  const thumb = card.querySelector('.thumb'); if(!thumb) return;
  const b = thumb.parentElement.querySelector('.badge-ready');
  if(ready && !b){
    const el = document.createElement('span');
    el.className = 'badge-ready'; el.textContent = 'พร้อมส่ง';
    thumb.insertAdjacentElement('afterend', el);
  } else if(!ready && b){ b.remove(); }
}
function cardSwatchShow(card, btn){
  const thumb = card.querySelector('.thumb'); if(!thumb) return;
  cardSwatchOrig(card);
  const img = document.createElement('img');
  img.className = 'sw-in'; img.decoding = 'async'; img.alt = btn.getAttribute('title') || '';
  img.onerror = () => { thumb.innerHTML = window.iconFallbackFor(btn.dataset.pid); };
  img.src = btn.dataset.src;
  thumb.replaceChildren(img);
  cardSwatchBadge(card, btn.dataset.ready === '1');
}
const cardCanHover = () => window.matchMedia && window.matchMedia('(hover: hover)').matches;
// แตะ/คลิกรูปจิ๋ว: เปลี่ยนรูปหลักค้างไว้ และให้การ์ดนี้เปิดหน้าสินค้าพร้อมเลือกสี/แบบนั้นไว้ให้
function cardSwatchPick(btn){
  const card = btn.closest('.card'); if(!card) return;
  cardSwatchShow(card, btn);
  card._swCur = { html: card.querySelector('.thumb').innerHTML, ready: btn.dataset.ready === '1' };
  btn.parentElement.querySelectorAll('.sw-btn').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
  const idx = +btn.dataset.idx, key = btn.dataset.key, pid = btn.dataset.pid;
  card.onclick = () => openProductModal(pid, key === 'c' ? idx : null, key === 'o' ? idx : null, key === 's' ? idx : null);
}
// คอมเท่านั้น: เอาเมาส์ชี้ = พรีวิว เอาออก = กลับไปรูปที่เลือกไว้ (หรือรูปเดิม)
function cardSwatchHover(btn){
  if(!cardCanHover()) return;
  const card = btn.closest('.card'); if(card) cardSwatchShow(card, btn);
}
function cardSwatchLeave(strip){
  if(!cardCanHover()) return;
  const card = strip.closest('.card'); if(!card || !card._swOrig) return;
  const st = card._swCur || card._swOrig;
  const thumb = card.querySelector('.thumb'); if(!thumb) return;
  thumb.innerHTML = st.html;
  cardSwatchBadge(card, st.ready);
}
function renderProductCard(p, variant, narrow){
  const colorIndex = variant && variant.colorIndex != null ? variant.colorIndex : null;
  const optionIndex = variant && variant.optionIndex != null ? variant.optionIndex : null;
  const sizeIndex = variant && variant.sizeIndex != null ? variant.sizeIndex : null;
  const variantColor = (colorIndex != null && p.colors) ? p.colors[colorIndex] : null;
  const variantOption = (optionIndex != null && hasNewOptions(p)) ? p.variants[optionIndex] : null;
  const variantSize = (sizeIndex != null && p.sizes) ? p.sizes[sizeIndex] : null;
  const isSplit = !!(variantColor || variantOption || variantSize);

  let displayName = p.name, thumbHtml, priceHtml;
  if(variantColor){
    displayName = `${p.name} (${variantColor.name})`;
    thumbHtml = renderThumb(p, variantColor.name);
    priceHtml = fmt(displayPrice(p));
  } else if(variantOption){
    displayName = `${p.name} (${variantOption.match.join(', ')})`;
    thumbHtml = renderThumb(p, variantOption.match.join(', '));
    priceHtml = fmt(variantOption.price);
  } else if(variantSize){
    displayName = `${p.name} (${variantSize.name})`;
    thumbHtml = renderThumb(p, variantSize.name);
    priceHtml = fmt(variantSize.price);
  } else {
    thumbHtml = renderThumb(p);
    if(narrow && narrow.passing.length && narrow.passing.length < narrow.total && hasNewOptions(p) && (activeSizes.size || searchQuery)){
      // รูปการ์ด = รูปของแบบที่ผ่านกรองและราคาถูกสุด (ไม่ใช่แบบแรกของสินค้าซึ่งอาจเป็นช่อปกติ)
      const idxs = narrow.passing.filter(x => x.optionIndex != null).map(x => x.optionIndex);
      if(idxs.length){
        const best = idxs.map(i => p.variants[i]).reduce((a,b) => (b.price < a.price ? b : a));
        thumbHtml = renderThumb(p, best.match.join(', '));
      }
    }
    if(narrow && narrow.passing.length && narrow.passing.length < narrow.total && p.sizes && p.sizes.length && !hasNewOptions(p) && !(p.colors && p.colors.length) && (activeSizes.size || searchQuery)){
      const sidx = narrow.passing.filter(x => x.sizeIndex != null).map(x => x.sizeIndex);
      if(sidx.length){
        const bestSize = sidx.map(i => p.sizes[i]).reduce((a,b) => (b.price < a.price ? b : a));
        thumbHtml = renderThumb(p, bestSize.name);
      }
    }
    if(narrow && searchQuery && narrow.passing.length && narrow.passing.length < narrow.total && p.colors && p.colors.length){
      // ค้นหาเจอแค่บางสีของสินค้านี้ — รูปการ์ดใช้รูปสีแรกที่ตรงกับคำค้น
      const cidx = narrow.passing.filter(x => x.colorIndex != null).map(x => x.colorIndex);
      if(cidx.length && p.colors[cidx[0]]) thumbHtml = renderThumb(p, p.colors[cidx[0]].name);
    }
    if(narrow && narrow.passing.length && narrow.passing.length < narrow.total){
      // ตัวกรองเหลือแค่บางแบบของสินค้านี้ — โชว์ราคาจากแบบที่ผ่านกรองเท่านั้น (ไม่ใช่ราคาเริ่มต้นของทั้งสินค้า)
      const prices = narrow.passing.map(x => variantPriceOf(p, x));
      const lo = Math.min(...prices), hi = Math.max(...prices);
      priceHtml = (lo !== hi) ? `เริ่มต้น ${fmt(lo)}` : fmt(lo);
    } else {
      priceHtml = (p.billSelector || optionPricesVary(p)) ? `เริ่มต้น ${fmt(displayPrice(p))}` : fmt(displayPrice(p));
    }
  }
  // เดิมการ์ดย่อย (isSplit) จะถือว่าพร้อมส่งเสมอ เพราะ readyVariantsOf() คัดมาแต่ตัวที่พร้อมส่งอยู่แล้ว
  // แต่ allVariantsOf() (โหมด "ดูสินค้าทั้งหมด") ส่งมาทั้งที่พร้อมส่งและยังไม่พร้อม จึงต้องเช็คสถานะ
  // ของ "ตัวเลือกนั้นๆ" ตรงๆ แทนที่จะเหมารวมเป็น true เสมอ
  if(PRICES_HIDDEN) priceHtml = PRICES_PENDING ? PRICE_LOADING_SHORT : PRICE_ASK_SHORT;
  let isReady;
  if(variantOption) isReady = !!variantOption.ready;
  else if(variantSize) isReady = !!variantSize.ready;
  else if(variantColor) isReady = typeof variantColor.ready !== 'undefined' ? !!variantColor.ready : !!p.ready;
  else isReady = currentReadyState(p);
  const clickHandler = `openProductModal('${p.id}', ${colorIndex}, ${optionIndex}, ${sizeIndex})`;
  if(catalogExportCollect){
    catalogExportItems.push({ name: displayName, price: String(priceHtml), imgSrc: imgSrcFromThumbHtml(thumbHtml), ready: !!isReady, isNew: !!p.isNew });
  }
  return `
    <div class="card" onclick="${clickHandler}">
      <div class="thumb-wrap">
        <div class="thumb">${thumbHtml}</div>
        ${isReady ? '<span class="badge-ready">พร้อมส่ง</span>' : ''}
        ${p.isNew ? '<span class="badge-new">ใหม่</span>' : ''}
        ${favHeartHtml(p, colorIndex, optionIndex, sizeIndex)}
      </div>
      <div class="card-body">
        ${(!isSplit && hasProductOptions(p)) ? cardSwatchHtml(p, narrow) : ''}
        <h4>${displayName}</h4>
        <p class="desc">${p.desc || ''}</p>
        <div class="price-row">
          <span class="price${PRICES_HIDDEN ? ' price-ask' : ''}">${priceHtml}</span>
        </div>
      </div>
    </div>
  `;
}
function renderCatalog(){
  const main = document.getElementById('catalog');
  const range = activePriceBounds();
  let totalMatches = 0;
  let html = '';
  cardNarrowByProduct = {};
  cardNarrowSizesByProduct = {};
  catalogExportItems = [];
  catalogExportCollect = false;

  // "ทั้งหมด" (ไม่เลือกหมวดเจาะจง) = เรียกดูทุกอย่างเหมือนเดิม (การ์ดแนะนำ + ทุกหมวดเรียงต่อกัน)
  // เลือกหมวดเจาะจงไว้ (หนึ่งหมวดหรือหลายหมวด) = กรองจริง โชว์เฉพาะหมวดที่เลือก
  // โซน "สินค้าแนะนำ" จะไม่โชว์เมื่อเปิดโหมด "ดูสินค้าทั้งหมด" (การ์ดแยกครบทุกแบบอยู่ในแต่ละหมวดอยู่แล้ว)
  if(activeCats.size === 0 && !showAllVariantsSplit){
    // กรอง/เรียงที่ระดับ "แบบ" — แต่ละการ์ดย่อยต้องผ่านเงื่อนไขราคา/รายการโปรดด้วยตัวเอง
    // (สินค้าที่พร้อมส่งทั้งชิ้น/ไม่มีสี ยังเป็น 1 การ์ดเหมือนเดิม)
    const recOpts = { range, sizes:new Set(), readyOnly:false, favOnly:showFavoritesOnly };
    const recommended = sortByPrice(
      PRODUCTS
        .filter(p => productHasAnyReady(p) && matchesSearch(p) && flowerMatches(p))
        .flatMap(readyVariantsOf)
        .filter(v => variantPasses(v.product, v, recOpts)),
      v => variantPriceOf(v.product, v)
    );
    totalMatches += recommended.length;
    const recommendedHtml = recommended.length ? `
      <div class="section-title featured"><h3>🌟 สินค้าแนะนำ (พร้อมส่ง)</h3><span>${recommended.length} รายการ</span></div>
      <div class="grid">
        ${recommended.map(v => renderProductCard(v.product, v)).join('')}
      </div>
    ` : '';
    html += `<div class="cat-section" id="${catSectionId('ทั้งหมด')}" data-cat="ทั้งหมด">${recommendedHtml}</div>`;
  }

  const catsToRender = activeCats.size ? CATS.slice(1).filter(c => activeCats.has(c)) : CATS.slice(1);
  catalogExportCollect = true;
  html += catsToRender.map(cat => {
    const sizeList = CATEGORY_SIZES[cat];
    const catOpts = {
      range,
      sizes: sizeList ? activeSizes : new Set(),
      readyOnly: showReadyOnly,
      favOnly: showFavoritesOnly
    };
    const baseProducts = PRODUCTS.filter(p =>
      p.cat === cat
      && matchesSearch(p)
      && flowerMatches(p)
    );
    let items, cardsHtml;
    if(showAllVariantsSplit){
      // โหมด "ดูสินค้าทั้งหมด": แตกเป็นการ์ดย่อยรายแบบ แล้วกรอง/เรียงตามราคาของแต่ละแบบจริง
      items = sortByPrice(
        baseProducts.flatMap(allVariantsOf).filter(v => variantPasses(v.product, v, catOpts)),
        v => variantPriceOf(v.product, v)
      );
      cardsHtml = items.map(v => renderProductCard(v.product, v)).join('');
    } else {
      // โหมดการ์ดเดียวต่อสินค้า: ขึ้นเมื่อมีอย่างน้อย 1 แบบที่ผ่านเงื่อนไข ราคาบนการ์ดคือราคาของแบบที่ผ่านกรอง
      items = baseProducts.map(p => {
        const all = allVariantsOf(p);
        return { p, total: all.length, passing: all.filter(v => variantPasses(p, v, catOpts)) };
      }).filter(e => e.passing.length);
      items = sortByPrice(items, e => Math.min(...e.passing.map(v => variantPriceOf(e.p, v))));
      cardsHtml = items.map(e => {
        // เหลือแบบเดียวที่ผ่านกรอง (เช่น S08 ตอนกรอง ≤300) — โชว์เป็นการ์ดของแบบนั้นตรงๆ
        // รูป/ชื่อ/ราคา/หัวใจ และหน้าสินค้าที่เปิดจะตรงกับแบบนั้น ไม่ใช่แบบอื่นของสินค้าเดียวกัน
        const only = e.passing[0];
        const hasIdx = only && (only.colorIndex != null || only.optionIndex != null || only.sizeIndex != null);
        if(e.passing.length === 1 && e.total > 1 && hasIdx) return renderProductCard(e.p, only);
        // ตัวกรองขนาด (เช่น ใส่เงิน) บีบเหลือบางแบบ — จำไว้ว่าแบบไหนผ่าน เพื่อให้รูปบนการ์ดและหน้าสินค้าตรงกับตัวกรอง
        if((activeSizes.size || searchQuery) && hasNewOptions(e.p) && e.passing.length < e.total){
          cardNarrowByProduct[e.p.id] = e.passing.filter(x => x.optionIndex != null).map(x => x.optionIndex);
        }
        if((activeSizes.size || searchQuery) && e.p.sizes && e.p.sizes.length && !hasNewOptions(e.p) && !(e.p.colors && e.p.colors.length) && e.passing.length < e.total){
          cardNarrowSizesByProduct[e.p.id] = e.passing.filter(x => x.sizeIndex != null).map(x => x.sizeIndex);
        }
        return renderProductCard(e.p, undefined, e);
      }).join('');
    }
    totalMatches += items.length;
    // เลือกชนิดดอกไม้ตอนดูทุกหมวด: ซ่อนหมวดที่ไม่มีสินค้าชนิดนั้น ไม่ให้ขึ้น "0 รายการ" เต็มหน้า
    if(!items.length && activeFlowerTypes.size && activeCats.size === 0) return '';
    const body = !items.length ? `
      <div class="section-title"><h3>${cat}</h3><span>0 รายการ</span></div>
    ` : `
      <div class="section-title"><h3>${cat}</h3><span>${items.length} รายการ</span></div>
      <div class="grid">
        ${cardsHtml}
      </div>
    `;
    return `<div class="cat-section" id="${catSectionId(cat)}" data-cat="${cat}">${body}</div>`;
  }).join('');
  catalogExportCollect = false;

  if(searchQuery && totalMatches === 0){
    main.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--rose-dark);">
        <p style="font-size:16px; font-weight:700; margin-bottom:6px;">ไม่พบสินค้าที่ตรงกับ "${searchQuery}"</p>
        <p style="font-size:13.5px; color:var(--plum);">ลองค้นหาด้วยคำอื่น หรือกดล้างคำค้นหาเพื่อดูสินค้าทั้งหมด</p>
      </div>`;
  } else if(totalMatches === 0){
    main.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--rose-dark);">
        <p style="font-size:16px; font-weight:700; margin-bottom:6px;">ไม่พบสินค้าตามตัวกรองที่เลือก</p>
        <p style="font-size:13.5px; color:var(--plum);">ลองล้างตัวกรอง หรือเลือกเงื่อนไขอื่นดูนะ</p>
      </div>`;
  } else {
    // แถบ "พบสินค้า N รายการ" แสดงเฉพาะจอคอม (ซ่อนบนมือถือด้วย CSS) ไว้เหนือกริดสินค้า
    // ปุ่ม "โหลดแคตตาล็อก" ขึ้นเฉพาะตอนมีตัวกรอง/คำค้นหาทำงานอยู่ และมีสินค้าให้ทำรูปอย่างน้อย 1 ชิ้น (แถบนี้แสดงเฉพาะจอคอม)
    const showDl = !PRICES_HIDDEN && (filtersAreActive(sidebarState()) || !!searchQuery) && catalogExportItems.length > 0;
    const dlBtnHtml = showDl
      ? `<button type="button" class="catalog-dl-btn" id="catalogDlBtn" onclick="downloadCatalogImages()"${catalogExporting ? ' disabled' : ''}>📥 โหลดแคตตาล็อก (${catalogExportItems.length} รายการ)</button>`
      : '';
    const resultsBarHtml = `<div class="catalog-results-bar"><span>พบสินค้า ${totalMatches} รายการ</span>${dlBtnHtml}</div>`;
    main.innerHTML = resultsBarHtml + html;
  }
  setupScrollSpy();
  sfbCatalogEnter(main);
}

/* =========================================================
   โหลดแคตตาล็อกเป็นรูป (เฉพาะสินค้าที่ผ่านตัวกรอง)
   รูป JPG 1800x3200 (9:16) หน้าละ 12 ชิ้น จัด 3 คอลัมน์ x 4 แถว
   วาดด้วย canvas ในเบราว์เซอร์ แล้วโหลดทีละรูปต่อเนื่องกัน
   ========================================================= */
const CATALOG_IMG_W = 1080, CATALOG_IMG_H = 1920; // พิกัดที่ใช้จัดเลย์เอาต์ (9:16)
const CATALOG_OUT_W = 1800, CATALOG_OUT_H = 3200;  // ขนาดไฟล์จริงที่ได้ (9:16 — ขยายจากพิกัดเลย์เอาต์ด้วยตัวคูณเดียวกันทั้งแกน X และ Y จึงไม่บิดภาพ)
const CATALOG_PHOTO_RATIO = 1; // สูง/กว้างของช่องรูป (1 = สี่เหลี่ยมจัตุรัส 1:1)
const CATALOG_COLS = 3, CATALOG_ROWS = 4, CATALOG_PER_PAGE = CATALOG_COLS * CATALOG_ROWS;

// ดึง src ของรูปออกจาก HTML ของ thumbnail (ใช้ DOMParser = เอกสารเปล่า ไม่โหลดรูปจริง และไม่รัน onerror)
function imgSrcFromThumbHtml(html){
  try{
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const img = doc.querySelector('img');
    return img ? img.getAttribute('src') : null;
  }catch(e){ return null; }
}

// ข้อความสรุปตัวกรองที่ใช้อยู่ แสดงใต้ชื่อร้านบนหัวรูป
function catalogFilterSummary(){
  const parts = [];
  if(activeCats.size) parts.push([...activeCats].join(' + '));
  if(activeFlowerTypes.size) parts.push([...activeFlowerTypes].join(' + '));
  if(activeSizes.size) parts.push('ขนาด ' + [...activeSizes].join(' + '));
  if(customPriceMin !== PRICE_SLIDER_MIN || customPriceMax !== PRICE_SLIDER_MAX){
    const lo = customPriceMin, hi = customPriceMax;
    if(lo > PRICE_SLIDER_MIN && hi < PRICE_SLIDER_MAX) parts.push(`${fmt(lo)} - ${fmt(hi)}`);
    else if(lo > PRICE_SLIDER_MIN) parts.push(`ตั้งแต่ ${fmt(lo)}`);
    else parts.push(`ไม่เกิน ${fmt(hi)}`);
  }
  if(showReadyOnly) parts.push('พร้อมส่ง');
  if(showFavoritesOnly) parts.push('รายการโปรด');
  if(searchQuery) parts.push(`ค้นหา "${searchQuery}"`);
  return parts.length ? parts.join(' · ') : 'สินค้าทั้งหมด';
}

function catalogLoadImage(src){
  return new Promise(resolve => {
    if(!src) return resolve(null);
    const img = new Image();
    let done = false;
    const finish = v => { if(!done){ done = true; resolve(v); } };
    img.crossOrigin = 'anonymous'; // รูปจากโดเมนอื่นที่ไม่เปิด CORS จะโหลดไม่ขึ้น → ใช้ช่องสำรองแทน (ไม่ให้ไฟล์ทั้งรูปพัง)
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    setTimeout(() => finish(null), 10000);
    img.src = src;
  });
}

function catalogRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// ตัดข้อความให้พอดีความกว้าง (ตัดตามตัวอักษร เพราะภาษาไทยไม่มีเว้นวรรคระหว่างคำ) สูงสุด maxLines บรรทัด
function catalogWrapText(ctx, text, maxW, maxLines){
  const chars = Array.from(String(text));
  const lines = [];
  let cur = '', used = 0;
  for(let i = 0; i < chars.length; i++){
    const test = cur + chars[i];
    if(ctx.measureText(test).width > maxW && cur){
      lines.push(cur); used += Array.from(cur).length; cur = chars[i];
      if(lines.length === maxLines){ cur = ''; break; }
    } else cur = test;
  }
  if(cur && lines.length < maxLines){ lines.push(cur); used += Array.from(cur).length; }
  if(used < chars.length && lines.length){
    let last = lines[lines.length - 1];
    while(last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}
function catalogFitOneLine(ctx, text, maxW){
  let t = String(text);
  if(ctx.measureText(t).width <= maxW) return t;
  while(t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawCatalogPage(items, pageNo, pageCount, imgs, logo, summary){
  const W = CATALOG_IMG_W, H = CATALOG_IMG_H;
  const cv = document.createElement('canvas');
  cv.width = CATALOG_OUT_W; cv.height = CATALOG_OUT_H;
  const ctx = cv.getContext('2d');
  const K = CATALOG_OUT_W / W; // ตัวคูณขยาย: โค้ดวาดด้านล่างใช้พิกัด 1080x1920
  ctx.scale(K, K); // ตัวคูณเดียวกันทั้งสองแกน (1800/1080 = 3200/1920) รูปสินค้าไม่ถูกยืดหรือบีบ
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const PINK = '#F62188', PINK_DARK = '#C4106D', PLUM = '#3B1230', CREAM = '#FFF7FC';
  ctx.textBaseline = 'alphabetic';

  // พื้นหลัง
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);

  // หัวรูป
  const HEAD_H = 110;
  const grad = ctx.createLinearGradient(0, 0, W, HEAD_H);
  grad.addColorStop(0, PINK); grad.addColorStop(1, PINK_DARK);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, HEAD_H);
  let textX = 44;
  if(logo){
    const d = 72, lx = 44, ly = (HEAD_H - d) / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx + d/2, ly + d/2, d/2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(lx, ly, d, d);
    const r = Math.min(d / logo.width, d / logo.height);
    const lw = logo.width * r, lh = logo.height * r;
    ctx.drawImage(logo, lx + (d - lw)/2, ly + (d - lh)/2, lw, lh);
    ctx.restore();
    textX = lx + d + 20;
  }
  ctx.fillStyle = '#fff';
  ctx.font = '700 42px Kanit, sans-serif';
  ctx.fillText(SITE_SHOP_NAME, textX, 52);
  ctx.font = '500 23px Kanit, sans-serif';
  ctx.fillText(catalogFitOneLine(ctx, summary, W - textX - 44), textX, 88);

  // กริดสินค้า
  const FOOT_H = 58, PAD = 44, GAP = 14, GAP_Y = 10; // GAP = ช่องไฟแนวนอนระหว่างคอลัมน์, GAP_Y = ช่องไฟแนวตั้งระหว่างแถว
  const gridX = PAD, gridY = HEAD_H + 12;
  const gridW = W - PAD * 2;
  // แถบข้อความหมายเหตุ (อยู่นอกการ์ดสินค้า วางใต้ตาราง เหนือแถบท้ายรูป)
  const NOTE_H = 104, NOTE_GAP_TOP = 10, NOTE_GAP_BOTTOM = 10;
  const noteY = H - FOOT_H - NOTE_GAP_BOTTOM - NOTE_H;
  const gridH = noteY - NOTE_GAP_TOP - gridY;
  const cellW = (gridW - GAP * (CATALOG_COLS - 1)) / CATALOG_COLS;
  const cellH = (gridH - GAP_Y * (CATALOG_ROWS - 1)) / CATALOG_ROWS; // ความสูงการ์ด = ช่องรูปจัตุรัส + แถบชื่อ/ราคาที่กระชับขึ้น
  const photo = cellW;                         // ความกว้างช่องรูป
  const photoH = Math.round(cellW * CATALOG_PHOTO_RATIO); // ความสูงช่องรูป

  items.forEach((it, i) => {
    const col = i % CATALOG_COLS, row = Math.floor(i / CATALOG_COLS);
    const x = gridX + col * (cellW + GAP), y = gridY + row * (cellH + GAP_Y);

    // การ์ด
    ctx.save();
    ctx.shadowColor = 'rgba(59,18,48,0.10)'; ctx.shadowBlur = 10 * K; ctx.shadowOffsetY = 2 * K;
    ctx.fillStyle = '#fff';
    catalogRoundRect(ctx, x, y, cellW, cellH, 14); ctx.fill();
    ctx.restore();

    // รูป (ครอปให้เต็มช่องจัตุรัส) หรือช่องสำรองถ้ารูปโหลดไม่ขึ้น
    ctx.save();
    catalogRoundRect(ctx, x, y, cellW, cellH, 14); ctx.clip();
    const img = imgs[i];
    if(img){
      const sc = Math.max(photo / img.width, photoH / img.height);
      const sw = photo / sc, sh = photoH / sc;
      ctx.drawImage(img, (img.width - sw)/2, (img.height - sh)/2, sw, sh, x, y, photo, photoH);
    } else {
      ctx.fillStyle = '#FFE3F1'; ctx.fillRect(x, y, photo, photoH);
      ctx.font = '72px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = PINK;
      ctx.fillText('🌸', x + photo/2, y + photoH/2 + 24);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // ป้าย พร้อมส่ง / ใหม่
    const drawBadge = (label, bx, by, bg, align) => {
      ctx.font = '600 17px Kanit, sans-serif';
      const tw = ctx.measureText(label).width, bw = tw + 20, bh = 29;
      const px = align === 'right' ? bx - bw : bx;
      ctx.fillStyle = bg; catalogRoundRect(ctx, px, by, bw, bh, 13); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, px + 10, by + 21);
    };
    if(it.ready) drawBadge('พร้อมส่ง', x + 8, y + 8, '#16A34A', 'left');
    if(it.isNew) drawBadge('ใหม่', x + cellW - 8, y + 8, PINK, 'right');

    // ชื่อ + ราคา
    const tx = x + 10, tw2 = cellW - 20;
    ctx.fillStyle = PLUM;
    ctx.font = '600 19px Kanit, sans-serif';
    const lines = catalogWrapText(ctx, it.name, tw2, 2);
    lines.forEach((ln, li) => ctx.fillText(ln, tx, y + photoH + 21 + li * 20));
    ctx.fillStyle = PINK_DARK;
    let ps = 24;
    ctx.font = `700 ${ps}px Kanit, sans-serif`;
    while(ctx.measureText(it.price).width > tw2 && ps > 15){ ps -= 1; ctx.font = `700 ${ps}px Kanit, sans-serif`; }
    ctx.fillText(it.price, tx, y + cellH - 9);
  });

  // แถบข้อความหมายเหตุ
  ctx.save();
  ctx.fillStyle = '#FFE9F4';
  catalogRoundRect(ctx, PAD, noteY, W - PAD * 2, NOTE_H, 18); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(246,33,136,0.28)';
  catalogRoundRect(ctx, PAD, noteY, W - PAD * 2, NOTE_H, 18); ctx.stroke();
  ctx.restore();
  const noteLines = [
    'ราคาไม่รวมค่าจัดส่ง',
    'ลูกค้านครสวรรค์นัดรับฟรี (สั่งซื้อ 299 บาทขึ้นไป)',
    'หมายเหตุ: สามารถแจ้งแอดมินเพื่อปรับสี เพิ่มการ์ด หรือปรับรายละเอียดได้ค่ะ'
  ];
  const noteTextX = PAD + 50, noteMaxW = W - PAD * 2 - 50 - 24;
  ctx.fillStyle = PLUM;
  ctx.font = '500 23px Kanit, sans-serif';
  noteLines.forEach((t, i) => {
    const by = noteY + 34 + i * 31;
    ctx.fillStyle = PINK;
    ctx.beginPath(); ctx.arc(PAD + 30, by - 8, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PLUM;
    ctx.fillText(catalogFitOneLine(ctx, t, noteMaxW), noteTextX, by);
  });

  // ท้ายรูป
  const fy = H - FOOT_H;
  ctx.fillStyle = PINK_DARK; ctx.fillRect(0, fy, W, FOOT_H);
  ctx.fillStyle = '#fff';
  ctx.font = '500 21px Kanit, sans-serif';
  const chat = (typeof PAGE_LINK === 'string' ? PAGE_LINK.replace(/^https?:\/\//, '') : '');
  ctx.fillText('สั่งซื้อทักแชท Facebook: ' + chat, PAD, fy + 37);
  ctx.textAlign = 'right';
  ctx.font = '600 21px Kanit, sans-serif';
  ctx.fillText(`หน้า ${pageNo}/${pageCount}`, W - PAD, fy + 37);
  ctx.textAlign = 'left';
  return cv;
}

function catalogCanvasToBlob(cv){
  return new Promise(resolve => cv.toBlob(b => resolve(b), 'image/jpeg', 0.95));
}
function catalogSaveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const catalogSleep = ms => new Promise(r => setTimeout(r, ms));

// ชื่อไฟล์ตามตัวกรองที่ใช้ เช่น "S.Flower Bloom_ช่อดอกไม้_ไม่เกิน 600_01-12.jpg"
// ตัดอักขระที่ตั้งชื่อไฟล์ไม่ได้ออก (/ \ : * ? " < > | และ ฿) แล้วย่อไม่ให้ชื่อส่วนตัวกรองยาวเกิน 80 ตัวอักษร
function catalogFileName(pageNo, pageCount){
  let base = catalogFilterSummary()
    .replace(/\s·\s/g, '_')
    .replace(/[\\/:*?"<>|฿\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if(base.length > 80) base = base.slice(0, 80).trim();
  base = base.replace(/[ ._]+$/, '');
  if(!base) base = 'สินค้าทั้งหมด';
  const digits = String(pageCount).length;
  const n = String(pageNo).padStart(digits, '0');
  return `S.Flower Bloom_${base}_${n}-${pageCount}.jpg`;
}

async function downloadCatalogImages(){
  if(PRICES_HIDDEN || catalogExporting) return;
  const items = catalogExportItems.slice(); // ถ่ายสำเนา ณ ตอนกดปุ่ม กันตัวกรองเปลี่ยนระหว่างวาด
  if(!items.length) return;
  catalogExporting = true;
  const setLabel = t => { const b = document.getElementById('catalogDlBtn'); if(b){ b.disabled = true; b.textContent = t; } };
  try{
    setLabel('กำลังเตรียมรูป...');
    // รอให้ฟอนต์ Kanit พร้อมก่อนวาด ไม่งั้น canvas จะใช้ฟอนต์สำรอง
    try{
      await Promise.all(['500','600','700'].map(w => document.fonts.load(`${w} 24px Kanit`, 'กขค')));
    }catch(e){}
    const logo = await catalogLoadImage('images/logo.png?v=2');
    const summary = catalogFilterSummary();
    const pageCount = Math.ceil(items.length / CATALOG_PER_PAGE);
    for(let pg = 0; pg < pageCount; pg++){
      setLabel(`กำลังสร้างรูป ${pg + 1}/${pageCount}...`);
      const slice = items.slice(pg * CATALOG_PER_PAGE, (pg + 1) * CATALOG_PER_PAGE);
      const imgs = await Promise.all(slice.map(it => catalogLoadImage(it.imgSrc)));
      const cv = drawCatalogPage(slice, pg + 1, pageCount, imgs, logo, summary);
      const blob = await catalogCanvasToBlob(cv);
      if(!blob) throw new Error('toBlob failed');
      catalogSaveBlob(blob, catalogFileName(pg + 1, pageCount));
      if(pg < pageCount - 1) await catalogSleep(600); // เว้นช่วงให้เบราว์เซอร์รับไฟล์ต่อเนื่องได้
    }
    showToast(`โหลดแคตตาล็อกแล้ว ${pageCount} รูป 🌸`);
  }catch(e){
    console.error('catalog export failed', e);
    showToast('สร้างรูปแคตตาล็อกไม่สำเร็จ ลองใหม่อีกครั้งนะ');
  }finally{
    catalogExporting = false;
    const b = document.getElementById('catalogDlBtn');
    if(b){ b.disabled = false; b.textContent = `📥 โหลดแคตตาล็อก (${catalogExportItems.length} รายการ)`; }
  }
}

function changeQty(key, delta){
  if(!cart[key]) return;
  // อนิเมชั่นมือถือ: ลดจนเหลือ 0 = ลบสินค้า ให้แถวหุบหายก่อนค่อยลบจริง (ถ้าไม่เข้าเงื่อนไข ฟังก์ชันคืน false แล้วทำงานตามเดิม)
  if(cart[key].qty + delta <= 0 && sfbCartItemLeave(key, function(){ changeQty(key, delta); })) return;
  cart[key].qty += delta;
  if(cart[key].qty <= 0) delete cart[key];
  updateCartUI();
}
function removeItem(key){
  if(sfbCartItemLeave(key, function(){ removeItem(key); })) return;
  delete cart[key]; updateCartUI();
}

function cartCount(){ return Object.values(cart).reduce((a,e)=>a+e.qty,0); }
function cartTotal(){
  return Object.values(cart).reduce((sum,e)=> sum + e.unitPrice*e.qty, 0);
}

function updateCartUI(){
  saveCart();
  document.getElementById('cartBadge').textContent = cartCount();
  const pdCount = document.getElementById('pdCartCount'); // ตัวเลขบนปุ่มตะกร้าในแถบบนของหน้าสินค้า (จอคอม)
  if(pdCount){ const n = cartCount(); pdCount.textContent = n; pdCount.classList.toggle('is-zero', !n); }
  const wrap = document.getElementById('drawerItems');
  const entries = Object.entries(cart);
  if(!entries.length){
    wrap.innerHTML = `<div class="empty-cart">
      <svg viewBox="0 0 64 64" fill="none"><path d="M18 26 H46 L41 54 H23 Z" stroke="#8a7680" stroke-width="3"/></svg>
      <div>ยังไม่มีสินค้าในตะกร้า</div>
    </div>`;
  } else {
    wrap.innerHTML = Object.entries(cart).map(([key,entry]) => {
      const { id } = parseCartKey(key);
      const p = PRODUCTS.find(x=>x.id===id);
      if(!p) return '';
      const { qty, unitPrice, label } = entry;
      return `
        <div class="cart-item" data-key="${String(key).replace(/"/g, '&quot;')}">
          <div class="mini-thumb">${renderThumb(p, (p.colors || p.sizes || hasNewOptions(p)) ? label : undefined)}</div>
          <div class="info">
            <h5>${p.name}${label ? ` <span class="variant">(${label})</span>` : ''}</h5>
            <div class="unit">${fmt(unitPrice)} / ชิ้น</div>
          </div>
          <div class="qty-ctrl">
            <button onclick="changeQty('${key}',-1)">−</button>
            <span>${qty}</span>
            <button onclick="changeQty('${key}',1)">+</button>
          </div>
          <button class="remove-btn" onclick="removeItem('${key}')">ลบ</button>
        </div>
      `;
    }).join('');
  }
  document.getElementById('totalAmt').textContent = fmt(cartTotal());
  document.getElementById('checkoutBtn').disabled = entries.length === 0;

  const fab = document.getElementById('fabCart');
  const count = cartCount();
  const nb = document.getElementById('bnavCartBadge');
  if(nb){ nb.textContent = count > 99 ? '99+' : count; nb.hidden = count === 0; }
  // อนิเมชั่นมือถือ: ตัวเลขตะกร้าเด้งเมื่อ "เพิ่ม" สินค้า (ไม่เล่นตอนโหลดหน้า / ตอนลดจำนวน / ตอนเปิดตะกร้าอยู่)
  if(typeof __sfbLastCartCount === 'number' && count > __sfbLastCartCount) sfbCartBump();
  __sfbLastCartCount = count;
  if(count > 0){
    fab.style.display = 'flex';
    document.getElementById('fabCount').textContent = count;
    document.getElementById('fabTotal').textContent = fmt(cartTotal());
  } else {
    fab.style.display = 'none';
  }
}

function openCart(){
  if(ordersBlocked()) return;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  sfbCartItemsEnter();
}
function closeCart(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

/* ---------- อนิเมชั่นมือถือ (เฟส 1) ----------
   ตัวอนิเมชั่นอยู่ท้ายไฟล์ style.css (ทำงานเฉพาะจอ < 860px) ฝั่งนี้มีแค่ตัวช่วยสั่งเล่นกับตัวเช็กเครื่อง
   ปิดทั้งหมด: ตั้ง SFB_MOBILE_ANIMATION เป็น false (หรือใส่ class "no-anim" ที่แท็ก <html>) */
const SFB_MOBILE_ANIMATION = true;
// ใช้ var (ไม่ใช่ let) โดยตั้งใจ: updateCartUI() ถูกเรียกตั้งแต่ตอนโหลดสคริปต์ ก่อนจะวิ่งมาถึงบรรทัดนี้
// ถ้าเป็น let จะเกิด error แบบ TDZ (เหมือนบั๊กตะกร้าที่เคยเจอ) และห้ามใส่ค่าเริ่มต้นที่นี่ ไม่งั้นจะรีเซ็ตค่า
var __sfbLastCartCount;
(function sfbAnimInit(){
  const root = document.documentElement;
  if(!SFB_MOBILE_ANIMATION){ root.classList.add('no-anim'); return; }
  const conn = navigator.connection || {};
  const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 2)
    || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)
    || conn.saveData === true;
  if(lowEnd) root.classList.add('anim-lite'); // ตัดตัวเด้งออก เหลืออนิเมชั่นแบบเบา
  document.addEventListener('touchstart', function(){}, { passive:true }); // ให้ iOS Safari ยอมใช้ :active (แตะแล้วยุบ)
})();
function sfbAnimOk(){
  if(document.documentElement.classList.contains('no-anim')) return false;
  return window.matchMedia('(max-width:859px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// เล่นอนิเมชั่น 1 ครั้งโดยใส่ class ชั่วคราว (รีสตาร์ทได้ถ้ากดซ้ำเร็วๆ) แล้วถอดออกเอง
function sfbAnimPlay(el, cls){
  if(!el || !sfbAnimOk()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(el._sfbAnimT);
  el._sfbAnimT = setTimeout(function(){ el.classList.remove(cls); }, 700);
}
// หัวใจเด้งเฉพาะตอน "บันทึก" (ถ้ากดเอาออกจะไม่เด้ง) — หัวใจบนการ์ดถูกสร้างใหม่ทุกครั้งที่กด จึงหาตัวที่เพิ่งกดจาก onclick
function sfbHeartPop(id, colorIndex, optionIndex, sizeIndex){
  const sig = "toggleFavorite('" + id + "', " + (colorIndex ?? 'null') + ", " + (optionIndex ?? 'null') + ", " + (sizeIndex ?? 'null') + ")";
  document.querySelectorAll('.fav-heart.active').forEach(function(b){
    if((b.getAttribute('onclick') || '').indexOf(sig) !== -1) sfbAnimPlay(b, 'fav-pop');
  });
  if(typeof modalProductId !== 'undefined' && modalProductId === id){
    document.querySelectorAll('#modalFavHeart.active, #modalFavHeartImg.active').forEach(function(b){ sfbAnimPlay(b, 'fav-pop'); });
  }
}
// รอ ~0.28 วิ ให้หน้าสินค้าเลื่อนปิดก่อน ไม่งั้นแถบล่างยังถูกบังอยู่ มองไม่เห็นตัวเด้ง
function sfbCartBump(){
  const wait = __sfbBumpDelay || 280;
  __sfbBumpDelay = 0;
  setTimeout(function(){
    const drawer = document.getElementById('drawer');
    if(drawer && drawer.classList.contains('open')) return;
    sfbAnimPlay(document.getElementById('bnavCartBadge'), 'badge-bump');
    sfbAnimPlay(document.querySelector('#bnavCart .bnav-ic'), 'bnav-bounce');
  }, wait);
}

/* ---------- อนิเมชั่นมือถือ (เฟส 2): รูปจางเข้า + การ์ดเลื่อนขึ้น ----------
   เล่นเฉพาะ "ตอนเปิดหน้า" และ "ตอนเปลี่ยนหมวด" — ไม่เล่นซ้ำเวลากรองราคา/พิมพ์ค้นหา/กดหัวใจ (ไม่งั้นการ์ดกระพริบรำคาญ)
   ถ้ามีอะไรผิดพลาด การ์ด/รูปจะแสดงตามปกติ เพราะ "ซ่อน" จะเกิดขึ้นเมื่อ JS ใส่ class เท่านั้น */
var __sfbLastCatSig;      // var ด้วยเหตุผลเดียวกับ __sfbLastCartCount (กัน TDZ)
var __sfbLastRevealAt = 0;
var __sfbRevealIO = null;
function sfbCatalogEnter(main){
  if(__sfbRevealIO){ __sfbRevealIO.disconnect(); __sfbRevealIO = null; }
  const sig = Array.from(activeCats).sort().join('|');
  const catChanged = sig !== __sfbLastCatSig;
  __sfbLastCatSig = sig;
  // renderCatalog อาจถูกเรียกซ้ำสองรอบติดกันตอนเปิดหน้า — รอบที่สองให้เล่นต่อ ไม่ใช่โชว์การ์ดทันทีจนอนิเมชั่นหาย
  const justRevealed = Date.now() - __sfbLastRevealAt < 700;
  if(!catChanged && !justRevealed) return;
  if(!sfbAnimOk()) return;
  if(catChanged) __sfbLastRevealAt = Date.now();

  // 1) รูปที่ยังโหลดไม่เสร็จ: ซ่อนไว้ก่อนแล้วจางเข้าตอน load (รูปที่มีในแคชแล้วไม่แตะ)
  const pending = [];
  main.querySelectorAll('.card .thumb img').forEach(function(img){
    if(img.complete && img.naturalWidth > 0) return;
    img.classList.add('img-pending');
    const done = function(){ img.classList.remove('img-pending'); };
    img.addEventListener('load', done, { once:true });
    img.addEventListener('error', done, { once:true });
    pending.push(img);
  });
  // กันเหตุไม่คาดคิด: 8 วิแล้วรูปที่โหลดเสร็จแล้วแต่ยังค้างซ่อนอยู่ให้โชว์ (รูปที่ยังไม่ถึงตาโหลดเพราะ lazy ยังรอตามปกติ)
  if(pending.length) setTimeout(function(){
    pending.forEach(function(i){ if(i.complete) i.classList.remove('img-pending'); });
  }, 8000);

  // 2) การ์ด: ที่อยู่ในจอตอนนี้เลื่อนขึ้นไล่ทีละใบ (สูงสุด 8 ใบแรก) ที่อยู่ล่างลงไปรอเลื่อนมาเจอค่อยเลื่อนขึ้น
  if(!sfbRevealOk()) return;
  const vh = window.innerHeight;
  let n = 0;
  const below = [];
  main.querySelectorAll('.card').forEach(function(card){
    if(card.getBoundingClientRect().top < vh){
      card.style.setProperty('--sfb-d', (Math.min(n++, 8) * 45) + 'ms');
      sfbRevealRun(card);
    } else {
      card.classList.add('reveal-pending');
      below.push(card);
    }
  });
  if(!below.length) return;
  __sfbRevealIO = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      __sfbRevealIO.unobserve(en.target);
      en.target.classList.remove('reveal-pending');
      sfbRevealRun(en.target);
    });
  }, { rootMargin:'0px 0px -6% 0px' });
  below.forEach(function(c){ __sfbRevealIO.observe(c); });
}
function sfbRevealRun(card){
  card.classList.add('reveal-in');
  setTimeout(function(){ card.classList.remove('reveal-in'); card.style.removeProperty('--sfb-d'); }, 1000);
}
// เครื่องสเปกต่ำ (anim-lite) ข้ามการเลื่อนขึ้นของการ์ด เหลือแค่โครงการ์ดกับรูปจางเข้า
function sfbRevealOk(){
  return 'IntersectionObserver' in window && !document.documentElement.classList.contains('anim-lite');
}

/* ---------- อนิเมชั่นมือถือ (เฟส 3): รูปบินไปตะกร้า + แถวในตะกร้า ----------
   ทั้งหมดเล่นเฉพาะจอ < 860px และข้ามเองเมื่อเปิดโหมดลดการเคลื่อนไหว / no-anim (sfbAnimOk) */
var __sfbBumpDelay;   // var (กัน TDZ เหมือนตัวแปรอื่นในชุดนี้) — ตั้งค่าตอนรูปบิน ให้ตัวเลขตะกร้าเด้งตอนรูปบินถึง
// ก๊อปรูปสินค้าบนหน้าสินค้าเป็นวงกลมเล็กๆ แล้วบินโค้งไปที่ไอคอนตะกร้าที่แถบล่าง (ใช้ transform/opacity ผ่าน Web Animations API)
function sfbFlyToCart(){
  if(!sfbAnimOk() || document.documentElement.classList.contains('anim-lite')) return false;
  const src = document.querySelector('#modalImg img');
  const navBtn = document.getElementById('bnavCart');
  const target = navBtn && navBtn.querySelector('.bnav-ic');
  if(!src || !target || typeof src.animate !== 'function') return false;
  if(getComputedStyle(navBtn).display === 'none') return false;
  const s = src.getBoundingClientRect(), t = target.getBoundingClientRect();
  if(!s.width || !s.height || !t.width) return false;
  const size = 120;
  const sx = s.left + s.width / 2 - size / 2, sy = s.top + s.height / 2 - size / 2;
  const dx = (t.left + t.width / 2 - size / 2) - sx, dy = (t.top + t.height / 2 - size / 2) - sy;
  const endScale = Math.max(t.width, 20) / size;
  const fly = document.createElement('img');
  fly.src = src.currentSrc || src.src;
  fly.alt = '';
  fly.setAttribute('aria-hidden', 'true');
  fly.style.cssText = 'position:fixed;left:' + sx + 'px;top:' + sy + 'px;width:' + size + 'px;height:' + size + 'px;'
    + 'object-fit:cover;border-radius:50%;pointer-events:none;z-index:2000;'
    + 'box-shadow:0 8px 22px rgba(0,0,0,.25);will-change:transform,opacity;';
  document.body.appendChild(fly);
  const gone = function(){ if(fly.parentNode) fly.parentNode.removeChild(fly); };
  const anim = fly.animate([
    { transform:'translate(0px,0px) scale(1)', opacity:1, easing:'cubic-bezier(.2,.7,.4,1)' },
    { transform:'translate(' + (dx * 0.4) + 'px,' + (dy * 0.12 - 60) + 'px) scale(.72)', opacity:1, offset:.38, easing:'cubic-bezier(.5,0,.8,.5)' },
    { transform:'translate(' + dx + 'px,' + dy + 'px) scale(' + endScale + ')', opacity:.85 }
  ], { duration:620, fill:'forwards' });
  anim.onfinish = gone;
  anim.oncancel = gone;
  setTimeout(gone, 1500); // กันค้างบนจอ
  __sfbBumpDelay = 560;   // ให้ตัวเลขตะกร้าเด้งตอนรูปบินถึงพอดี
  return true;
}
// เปิดตะกร้า: แถวสินค้าเลื่อนเข้าไล่ทีละแถว
function sfbCartItemsEnter(){
  if(!sfbAnimOk()) return;
  document.querySelectorAll('#drawerItems .cart-item').forEach(function(el, i){
    if(i > 7) return;
    el.style.setProperty('--sfb-d', (140 + i * 45) + 'ms');
    el.classList.add('cart-item-in');
    setTimeout(function(){ el.classList.remove('cart-item-in'); el.style.removeProperty('--sfb-d'); }, 1000);
  });
}
// ลบสินค้าในตะกร้า: แถวเลื่อนออก+หุบความสูง แล้วค่อยเรียก done() เพื่อลบจริง
// คืน true = เริ่มเล่นอนิเมชั่นแล้ว (ผู้เรียกต้อง return รอ) / false = ไม่เล่น ให้ลบทันทีตามเดิม
function sfbCartItemLeave(key, done){
  if(!sfbAnimOk()) return false;
  const drawer = document.getElementById('drawer');
  if(!drawer || !drawer.classList.contains('open')) return false;
  const el = Array.prototype.find.call(drawer.querySelectorAll('.cart-item'), function(e){ return e.dataset.key === String(key); });
  if(!el || el.classList.contains('cart-item-out')) return false;
  el.style.height = el.offsetHeight + 'px';
  void el.offsetHeight;
  el.classList.add('cart-item-out');
  setTimeout(done, 300);
  return true;
}

/* ---------- อนิเมชั่นมือถือ (เฟส 4): แถบบนซ่อน/โผล่ตามการเลื่อน + รูปแกลเลอรีเลื่อนตามทิศปัด ---------- */
var __sfbGalleryDir;       // ทิศรูปแกลเลอรีที่เพิ่งเปลี่ยน: 1 = ถัดไป, -1 = ก่อนหน้า (ล้างทุกครั้งหลัง renderModal)
var __sfbHeaderLockUntil;  // เวลา (ms) ที่ห้ามแถบบนซ่อนจนถึง — ใช้ตอนโค้ดสั่งเลื่อนหน้าเอง
function sfbGallerySlide(img){
  const dir = __sfbGalleryDir;
  if(!dir || !sfbAnimOk()) return;
  img.classList.add(dir > 0 ? 'pd-slide-next' : 'pd-slide-prev'); // รูปเลื่อนเข้าจากฝั่งที่ปัด
}
function sfbHeaderLock(ms){
  __sfbHeaderLockUntil = Date.now() + ms;
  const bar = document.getElementById('searchCartBar');
  if(bar) bar.classList.remove('bar-hidden');
}
// เลื่อนลง = แถบค้นหาซ่อนขึ้นไป (ได้พื้นที่ดูสินค้าเพิ่ม) / เลื่อนขึ้นนิดเดียว = กลับมา
// ไม่ซ่อนเมื่อ: อยู่ใกล้บนสุด, กำลังพิมพ์ค้นหา, โค้ดกำลังเลื่อนหน้าให้, หรือเปิดโหมดลดการเคลื่อนไหว/ปิดอนิเมชั่น
(function sfbHeaderAutoHide(){
  const bar = document.getElementById('searchCartBar');
  if(!bar) return;
  let lastY = window.pageYOffset, acc = 0, ticking = false;
  const setHidden = function(h){ if(bar.classList.contains('bar-hidden') !== h) bar.classList.toggle('bar-hidden', h); };
  function update(){
    ticking = false;
    if(!sfbAnimOk()){ setHidden(false); return; }
    const y = Math.max(0, window.pageYOffset);
    if(y > document.documentElement.scrollHeight - window.innerHeight + 1) return; // ดึงเกินขอบล่าง (iOS เด้งกลับ) ไม่นับ
    const dy = y - lastY;
    lastY = y;
    if(dy === 0) return;
    acc = ((dy > 0) === (acc > 0)) ? acc + dy : dy; // สะสมระยะเลื่อนทิศเดียวกัน กลับทิศแล้วเริ่มนับใหม่
    if(y < 80 || bar.contains(document.activeElement) || Date.now() < (__sfbHeaderLockUntil || 0)){ setHidden(false); return; }
    if(acc > 24) setHidden(true);
    else if(acc < -12) setHidden(false);
  }
  window.addEventListener('scroll', function(){ if(!ticking){ ticking = true; requestAnimationFrame(update); } }, { passive:true });
  bar.addEventListener('focusin', function(){ setHidden(false); }); // เลื่อนแท็บด้วยคีย์บอร์ดมาโดนแถบ ต้องโผล่
  window.addEventListener('resize', function(){ if(!sfbAnimOk()) setHidden(false); });
})();

let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* ---------- Checkout: collect order lines, then straight to price summary ---------- */
function buildCartOrderLines(){
  const entries = Object.entries(cart);
  if(!entries.length) return null;
  let lines = [];
  let items = [];
  entries.forEach(([key,entry])=>{
    const { id } = parseCartKey(key);
    const p = PRODUCTS.find(x=>x.id===id);
    if(p){
      lines.push(`• ${p.name}${entry.label ? ` (${entry.label})` : ''} x${entry.qty} = ${fmt(entry.unitPrice*entry.qty)}`);
      items.push({ id, name:p.name, label:entry.label||'', qty:entry.qty, unitPrice:entry.unitPrice, lineTotal:entry.unitPrice*entry.qty });
    }
  });
  return { lines, items, subtotal: cartTotal() };
}
function buildModalOrderLines(){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return null;
  if(warnIfInvalidOptionSelection(p)) return null;
  const { label, unitPrice } = currentModalVariant(p);
  const lineTotal = unitPrice * modalQty;
  const lines = [`• ${p.name}${label ? ` (${label})` : ''} x${modalQty} = ${fmt(lineTotal)}`];
  const items = [{ id:p.id, name:p.name, label:label||'', qty:modalQty, unitPrice, lineTotal }];
  const result = { lines, items, subtotal: lineTotal };
  closeProductModal();
  return result;
}
function startCheckout(builderFn){
  if(ordersBlocked()) return;
  orderBuildBlockedMsgShown = false;
  const result = builderFn();
  if(!result){
    if(!orderBuildBlockedMsgShown) showToast('กรุณาเลือกสินค้าก่อน');
    return;
  }
  finalizeOrder(result);
}
const CARD_PRICE = 0; // การ์ดอวยพรฟรี
function finalizeOrder(result){
  let lines = ['สินค้า', ...result.lines];
  lines.push('');
  lines.push(`รวมค่าสินค้า: ${fmt(result.subtotal)}`);
  lines.push('(ยังไม่รวมค่าจัดส่ง ถ้ามี — แอดมินจะแจ้งยอดสุทธิให้อีกครั้ง)');
  lines.push('กดสั่งซื้อแล้ว รอแอดมินตอบกลับ เพื่อสรุปยอดสุทธิและรายละเอียดการจัดส่ง');
  closeCart();
  showOrderSummary(lines.join('\n'), result.subtotal, result.items);
}

/* ---------- Order summary: capture FB name, submit to backend, show success ---------- */
let currentOrderMessage = '';
let currentOrderSubtotal = 0;
let currentOrderItems = [];
let customerFbName = '';

/* ---------- FB name: silently reuse a previously saved name (asked at checkout instead) ---------- */
function loadSavedFbName(){
  let saved = '';
  try { saved = localStorage.getItem('sfb_fbName') || ''; } catch(e) { /* localStorage blocked, ignore */ }
  if(saved){ customerFbName = saved; }
}
function renderFbNameDisplay(editing){
  const wrap = document.getElementById('fbNameDisplay');
  if(editing || !customerFbName){
    const current = customerFbName ? escapeHtml(customerFbName) : '';
    wrap.innerHTML = `<input type="text" id="fbNameEditInput" class="form-input" placeholder="ชื่อ Facebook ที่ทักแชทร้าน" value="${current}" style="margin-bottom:14px;">`;
  } else {
    wrap.innerHTML = `<div class="fb-name-chip"><span>👤 สั่งในนาม: <strong>${escapeHtml(customerFbName)}</strong></span><button type="button" class="fb-name-edit" onclick="renderFbNameDisplay(true)">แก้ไข</button></div>`;
  }
}

function minPickupDateStr(){
  // ใช้วันที่ตามเวลาเครื่องลูกค้า (local time) ไม่ใช่ toISOString() ที่คืนค่าเป็นเวลา UTC —
  // ถ้าใช้ UTC ช่วงเที่ยงคืน-ตี 7 เวลาไทย (เวลาไทย = UTC+7) จะได้ "เมื่อวาน" แทนที่จะเป็นวันนี้จริงๆ
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // อนุญาตเลือกวันนี้ได้ (ช่อพร้อมส่ง/งานเร่ง) แอดมินจะแจ้งอีกครั้งถ้าทำไม่ทัน
}
const DELIVERY_HINTS = {
  pickup: '📍 นัดรับได้ตั้งแต่พยุหะ ถึงตัวเมืองนครสวรรค์และใกล้เคียง สั่งครบ 299 บาทขึ้นไปนัดรับฟรี ต่ำกว่านั้นคิดค่าส่งตามระยะทางจริง มีบริการเก็บเงินปลายทาง (COD) สำหรับช่อพร้อมส่ง',
  parcel: '📦 ค่าส่งพัสดุ ฿100 ต่อออเดอร์ (สำหรับต่างจังหวัด/นอกพื้นที่จัดส่ง)',
  unsure: 'แอดมินจะช่วยแนะนำวิธีรับสินค้าและแจ้งค่าจัดส่ง (ถ้ามี) ให้อีกครั้งค่ะ'
};
function calcShippingFee(deliveryMethod, subtotal){
  // คืนค่าตัวเลข = ยอดที่ทราบแน่นอน, null = ยังไม่ทราบ (รอแอดมินแจ้ง)
  if(deliveryMethod === 'parcel') return 100;
  if(deliveryMethod === 'pickup') return subtotal >= 299 ? 0 : null; // นัดรับ: ครบ 299 ส่งฟรี ต่ำกว่านั้นคิดตามระยะทางจริง (แอดมินแจ้ง)
  return null; // unsure หรือยังไม่เลือก
}
function onDeliveryMethodChange(){
  const selected = document.querySelector('input[name="deliveryMethod"]:checked');
  const value = selected ? selected.value : '';
  document.getElementById('pickupInfoGroup').style.display = value === 'pickup' ? 'block' : 'none';
  document.getElementById('deliveryAddressGroup').style.display = value === 'parcel' ? 'block' : 'none';

  // COD (เก็บเงินปลายทาง) มีไว้ "เฉพาะช่อพร้อมส่ง" ตามข้อความในตัวเลือก —
  // ต้องเช็คทั้งวิธีรับสินค้า (ต้องนัดรับ) และสถานะสินค้าในออเดอร์ (ต้องพร้อมส่งทุกชิ้น)
  // ไม่ใช่แค่เช็ควิธีรับสินค้าอย่างเดียว ไม่งั้นออเดอร์ที่ต้องสั่งทำ (ไม่พร้อมส่ง) จะเลือก COD ได้ทั้งที่ไม่ควร
  const codOption = document.getElementById('codPaymentOption');
  const codAllowed = value === 'pickup' && !orderNeedsDeposit(currentOrderItems);
  codOption.style.display = codAllowed ? 'flex' : 'none';
  if(!codAllowed){
    const codInput = codOption.querySelector('input');
    if(codInput.checked) codInput.checked = false;
  }

  const hintEl = document.getElementById('deliveryMethodHint');
  hintEl.textContent = DELIVERY_HINTS[value] || '';

  renderOrderTotalSummary();
}
function renderOrderTotalSummary(){
  const subtotal = currentOrderSubtotal || 0;
  const selected = document.querySelector('input[name="deliveryMethod"]:checked');
  const method = selected ? selected.value : '';
  const fee = calcShippingFee(method, subtotal);

  document.getElementById('totalBoxSubtotal').textContent = fmt(subtotal);

  const shippingEl = document.getElementById('totalBoxShipping');
  const grandEl = document.getElementById('totalBoxGrand');
  const approxEl = document.getElementById('totalBoxApproxNote');

  if(fee === null){
    shippingEl.textContent = method === 'parcel' ? fmt(100) : 'รอแจ้งยอด';
    grandEl.textContent = fmt(subtotal) + '+';
    approxEl.textContent = ' (โดยประมาณ)';
  } else if(fee === 0){
    shippingEl.textContent = method === 'pickup' ? 'ไม่มีค่าจัดส่ง' : 'ฟรี 🎉';
    grandEl.textContent = fmt(subtotal);
    approxEl.textContent = '';
  } else {
    shippingEl.textContent = fmt(fee);
    grandEl.textContent = fmt(subtotal + fee);
    approxEl.textContent = '';
  }
}
function resetOrderDetailFields(){
  const dateInput = document.getElementById('pickupDateInput');
  const minDate = minPickupDateStr();
  dateInput.min = minDate;
  dateInput.value = '';
  document.querySelectorAll('input[name="deliveryMethod"]').forEach(r => r.checked = false);
  document.querySelectorAll('input[name="paymentMethod"]').forEach(r => r.checked = false);
  document.getElementById('deliveryAddressInput').value = '';
  document.getElementById('deliveryAddressGroup').style.display = 'none';
  document.getElementById('pickupLocationInput').value = '';
  document.getElementById('pickupPhoneInput').value = '';
  document.getElementById('pickupInfoGroup').style.display = 'none';
  document.getElementById('codPaymentOption').style.display = 'none';
  document.getElementById('deliveryMethodHint').textContent = '';

  const depositOption = document.getElementById('depositPaymentOption');
  if(depositOption){
    const showDeposit = orderNeedsDeposit(currentOrderItems);
    depositOption.style.display = showDeposit ? 'flex' : 'none';
    if(!showDeposit){
      const depositInput = depositOption.querySelector('input');
      if(depositInput.checked) depositInput.checked = false;
    }
  }

  renderOrderTotalSummary();
}
function renderOrderItemsList(items){
  const wrap = document.getElementById('orderItemsList');
  wrap.innerHTML = (items||[]).map(it => `
    <div class="order-item-row">
      <div class="order-item-info">
        <span class="order-item-name">${it.name}</span>
        <span class="order-item-meta">${it.label ? it.label + ' · ' : ''}x${it.qty}</span>
      </div>
      <span class="order-item-price">${fmt(it.lineTotal)}</span>
    </div>
  `).join('');
}
function showOrderSummary(message, subtotal, items){
  currentOrderMessage = message;
  currentOrderSubtotal = subtotal || 0;
  currentOrderItems = items || [];
  renderOrderItemsList(currentOrderItems);
  renderFbNameDisplay(false);
  resetOrderDetailFields();
  document.getElementById('orderNoteInput').value = '';
  const cardEl = document.getElementById('addCardCart');
  if(cardEl) cardEl.checked = false;
  document.getElementById('messengerLink').href = PAGE_LINK;
  document.getElementById('orderReviewView').style.display = 'flex';
  document.getElementById('orderSuccessView').style.display = 'none';
  const btn = document.getElementById('confirmOrderBtn');
  btn.disabled = false;
  btn.textContent = 'ยืนยันสั่งทำสินค้า';
  document.getElementById('orderSummaryModal').classList.add('open');
  document.getElementById('summaryOverlay').classList.add('show');
  closeCart();
}
function closeOrderSummary(){
  document.getElementById('orderSummaryModal').classList.remove('open');
  document.getElementById('summaryOverlay').classList.remove('show');
}
let lastOrderNo = '';
function copyOrderNo(){
  if(!lastOrderNo) return;
  const text = `เลขที่ออเดอร์ของฉันคือ ${lastOrderNo}`;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(()=>showToast('คัดลอกเลขออเดอร์แล้ว 📋')).catch(()=>fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand('copy'); showToast('คัดลอกเลขออเดอร์แล้ว 📋'); }catch(e){ /* ignore */ }
  document.body.removeChild(ta);
}
function chatWithOrderNo(e){
  if(e) e.preventDefault();
  // ต้องเปิดแท็บใหม่ (window.open) เป็นคำสั่งแรกสุด ให้ใช้ "สิทธิ์จากการคลิก" ของลูกค้าโดยตรง —
  // ถ้าไปเรียก navigator.clipboard.writeText() (ใน copyOrderNo) ก่อน บางเบราว์เซอร์บนคอม
  // (โดยเฉพาะ Safari/Chrome ที่ตั้งค่าเข้มงวด) จะถือว่าสิทธิ์จากการคลิกถูกใช้ไปแล้ว แล้วบล็อก
  // window.open ที่ตามมาแบบเงียบๆ โดยไม่มี error ให้เห็น (นี่คือสาเหตุที่ปุ่มดูเหมือน "ไม่ทำงาน" บนคอม)
  const chatWin = window.open(PAGE_LINK, '_blank', 'noopener');
  copyOrderNo();
  if(!chatWin){
    showToast('เบราว์เซอร์บล็อกการเปิดหน้าต่างใหม่ กรุณาอนุญาต pop-up ให้เว็บนี้ แล้วลองกดใหม่ค่ะ');
  }
}
function generateOrderNumber(){
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  // เลขสุ่ม 4 หลักอย่างเดียวมีโอกาสชนกันได้ (1 ใน 9000) ถ้าวันนั้นออเดอร์เยอะ —
  // ผูกเวลา ชม:นาที:วินาที เข้าไปด้วย ทำให้แทบเป็นไปไม่ได้ที่จะซ้ำกันในวันเดียวกัน
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  const rand = String(Math.floor(10 + Math.random()*90)); // 2 หลักสุ่มเสริม กันชนกันตอนออเดอร์มาพร้อมกันในวินาทีเดียว
  return `SFB${yy}${mm}${dd}-${hh}${mi}${ss}${rand}`;
}
function formatDateThai(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' });
}
const DELIVERY_LABELS = { pickup:'นัดรับสินค้า (พยุหะ–ตัวเมืองนครสวรรค์และใกล้เคียง)', parcel:'ส่งพัสดุ (ต่างจังหวัด)', unsure:'ยังไม่แน่ใจ' };
const PAYMENT_LABELS = { full:'โอนเต็มยอด', deposit:'มัดจำ 50% ส่วนที่เหลือชำระวันทำช่อดอกไม้เสร็จ', cod:'เก็บเงินปลายทาง (COD)' };
async function confirmOrderSubmit(){
  if(ordersBlocked()) return; // ปิดสั่งทำ/ซ่อนราคาไปแล้ว (เช่นหน้ารีโหลดตามสถานะใหม่) — ไม่ส่งออเดอร์ต่อ
  const editInput = document.getElementById('fbNameEditInput');
  const fbName = editInput ? editInput.value.trim() : customerFbName;
  if(!fbName){
    showToast('กรุณากรอกชื่อ Facebook ที่ทักแชทร้านก่อนนะคะ');
    if(editInput) editInput.focus();
    return;
  }

  const pickupDateInput = document.getElementById('pickupDateInput');
  const pickupDate = pickupDateInput.value;
  if(!pickupDate){
    showToast('กรุณาเลือกวันที่ต้องการรับสินค้า');
    pickupDateInput.focus();
    return;
  }
  if(pickupDate < pickupDateInput.min){
    showToast('ไม่สามารถเลือกวันที่ผ่านมาแล้วได้ กรุณาเลือกวันที่ใหม่');
    pickupDateInput.focus();
    return;
  }

  const deliveryMethodEl = document.querySelector('input[name="deliveryMethod"]:checked');
  if(!deliveryMethodEl){
    showToast('กรุณาเลือกวิธีรับสินค้า');
    return;
  }
  const deliveryMethod = deliveryMethodEl.value;
  const needsAddress = deliveryMethod === 'parcel';

  const pickupLocation = document.getElementById('pickupLocationInput').value.trim();
  const pickupPhone = document.getElementById('pickupPhoneInput').value.trim();

  const deliveryAddressInput = document.getElementById('deliveryAddressInput');
  const deliveryAddress = deliveryAddressInput.value.trim();
  if(needsAddress && !deliveryAddress){
    showToast('กรุณากรอกที่อยู่จัดส่ง');
    deliveryAddressInput.focus();
    return;
  }

  const paymentMethodEl = document.querySelector('input[name="paymentMethod"]:checked');
  if(!paymentMethodEl){
    showToast('กรุณาเลือกวิธีชำระเงิน');
    return;
  }
  const paymentMethod = paymentMethodEl.value;

  customerFbName = fbName;
  try { localStorage.setItem('sfb_fbName', fbName); } catch(e) { /* localStorage blocked, ignore */ }

  const shippingFee = calcShippingFee(deliveryMethod, currentOrderSubtotal);
  let detailLines = [
    `📅 วันที่ต้องการรับสินค้า: ${formatDateThai(pickupDate)}`,
    `🚚 วิธีรับสินค้า: ${DELIVERY_LABELS[deliveryMethod]}`
  ];
  if(deliveryMethod === 'pickup' && (pickupLocation || pickupPhone)){
    if(pickupLocation) detailLines.push(`📍 สถานที่นัดรับ: ${pickupLocation}`);
    if(pickupPhone) detailLines.push(`📞 เบอร์โทรวันนัดรับ: ${pickupPhone}`);
  }
  if(needsAddress){
    detailLines.push(`📍 ที่อยู่จัดส่ง: ${deliveryAddress}`);
  }
  if(shippingFee !== null){
    detailLines.push(`🚛 ค่าจัดส่ง: ${shippingFee === 0 ? 'ฟรี' : fmt(shippingFee)}`);
    detailLines.push(`💰 ยอดรวมสุทธิ: ${fmt(currentOrderSubtotal + shippingFee)}`);
  } else {
    detailLines.push('🚛 ค่าจัดส่ง: คิดตามจริง (แอดมินจะแจ้งยอดสุทธิให้อีกครั้ง)');
  }
  detailLines.push(`💳 การชำระเงิน: ${PAYMENT_LABELS[paymentMethod]}`);

  const cardEl = document.getElementById('addCardCart');
  const addCard = !!(cardEl && cardEl.checked);
  const note = document.getElementById('orderNoteInput').value.trim();
  let orderTextWithNote = `${currentOrderMessage}\n\n${detailLines.join('\n')}`;
  if(addCard){ orderTextWithNote += `\n\n🎀 การ์ดอวยพร (ฟรี)`; }
  if(note){ orderTextWithNote += `\n\n📝 หมายเหตุจากลูกค้า: ${note}`; }

  const orderNo = generateOrderNumber();
  const btn = document.getElementById('confirmOrderBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังส่งออเดอร์...';
  try{
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors', // Apps Script ไม่ตอบ CORS header ให้ตรงๆ จึงต้องยิงแบบ no-cors (อ่าน response ไม่ได้ แต่ฝั่ง Apps Script ได้รับข้อมูลปกติ)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // ใช้ text/plain เพื่อเลี่ยง CORS preflight
      body: JSON.stringify({
        orderNo,
        fbName,
        orderText: orderTextWithNote,
        subtotal: currentOrderSubtotal,
        shippingFee: shippingFee,
        grandTotal: shippingFee !== null ? currentOrderSubtotal + shippingFee : null,
        items: currentOrderItems,
        pickupDate,
        deliveryMethod,
        pickupLocation: deliveryMethod === 'pickup' ? pickupLocation : '',
        pickupPhone: deliveryMethod === 'pickup' ? pickupPhone : '',
        deliveryAddress: needsAddress ? deliveryAddress : '',
        paymentMethod,
        addCard,
        note,
        timestamp: new Date().toISOString()
      })
    });
    clearCart();
    lastOrderNo = orderNo;
    document.getElementById('orderNoChip').innerHTML =
      `เลขที่ออเดอร์ของคุณ<br><strong>${orderNo} <button type="button" class="order-no-copy-btn" onclick="copyOrderNo()">คัดลอก</button></strong>`;
    document.getElementById('orderReviewView').style.display = 'none';
    document.getElementById('orderSuccessView').style.display = 'flex';
  } catch(err){
    btn.disabled = false;
    btn.textContent = 'ยืนยันสั่งทำสินค้า';
    showToast('ส่งออเดอร์ไม่สำเร็จ กรุณาลองใหม่ หรือทักแชทเพจโดยตรง');
  }
}
function clearCart(){
  cart = {};
  updateCartUI();
}
function startCustomOrder(){
  window.location.href = PAGE_LINK;
}

/* ---------- Product zoom / quick-order modal ---------- */
let modalProductId = null;
let modalQty = 1;
let modalBills = 1;
let modalImgIndex = 0; // which photo in the gallery is currently shown
let lastModalImgSrc = ''; // used to fade the main photo only when it actually changes (desktop CSS)
let modalSelectedAddons = new Set(); // ชื่อตัวเลือกเสริม (addon) ที่ลูกค้าติ๊กไว้ในหน้ารายละเอียดสินค้า — เลือกได้พร้อมกันหลายตัว, รีเซ็ตทุกครั้งที่เปลี่ยนสีหรือเปิดสินค้าใหม่

// Returns the list of photo URLs to show for the product's current selection.
// A "sizes" variant (e.g. ปกติ vs ใส่ซองเงิน, which also changes the price) can carry
// its own "image"/"images" too — checked FIRST, since a size choice like "ใส่ซองเงิน"
// should always show the money-envelope photo regardless of which color is selected.
// Falls back to the selected color's own image, then the product-level images/image.
// Existing products with just one "image" keep working unchanged — the
// gallery/thumbnails simply don't appear when there's only one photo.
// รวมรูปหลัก (image) + รูปเพิ่มเติม (images) เป็นลิสต์เดียว ตัดค่าว่าง/รูปซ้ำ
// (หลังบ้านเก็บ images ของสินค้า/สี = เฉพาะรูปเพิ่มเติม แต่ของไซซ์/ตัวเลือกคู่ผสม = รวมรูปหลักแล้ว → ตัดซ้ำให้เหลือชุดเดียว)
function photosOf(o){
  const out = [];
  [o && o.image].concat((o && Array.isArray(o.images)) ? o.images : []).forEach(function(s){
    s = String(s == null ? '' : s).trim();
    if(s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}
function productPhotoList(p){
  if(hasNewOptions(p)){
    // ยังไม่ได้เลือกตัวเลือกใดเลย = รูปแรกของแกลเลอรีใช้แบบปกติราคาถูกสุด (เหมือนรูปปกบนการ์ด) ไม่ใช่แถวแรกของลิสต์
    const v = currentOptionSelection(p).every(x => x == null) ? coverVariantOf(p) : currentVariant(p);
    if(v){
      const l = photosOf(v);
      if(l.length) return l;
    }
  }
  if(p.sizes && p.sizes.length){
    const sv = p.sizes[selectedSizeVariant[p.id] || 0];
    if(sv){
      const l = photosOf(sv);
      if(l.length) return l;
    }
  }
  if(p.colors && p.colors.length){
    const c = p.colors[resolvedColorIndex(p)];
    if(c){
      // ถ้าลูกค้าติ๊กเพิ่มตัวเลือกเสริม (เช่น ผึ้งน้อย) และตัวที่เลือกมีรูปของตัวเองอยู่ ให้ใช้รูปนั้นก่อน
      // (ถ้าเลือกหลายตัว ใช้รูปของตัวแรกที่มีรูปแนบมา)
      if(c.addons && c.addons.length){
        const chosen = c.addons.find(a => modalSelectedAddons.has(a.name) && a.image);
        if(chosen) return [chosen.image];
      }
      const l = photosOf(c);
      if(l.length) return l;
    }
  }
  // สินค้าที่ไม่มีสีเลยแต่มีตัวเลือกเสริมของตัวเอง (เช่น กรอบรูป + กล่องใส่กรอบรูป)
  if(!p.colors && p.addons && p.addons.length){
    const chosen = p.addons.find(a => modalSelectedAddons.has(a.name) && a.image);
    if(chosen) return [chosen.image];
  }
  return photosOf(p);
}
/* รูปรีวิวลูกค้าที่หลังบ้านผูกกับสินค้านี้ (เรียงรูปล่าสุดก่อน) — ต่อท้ายแกลเลอรีเท่านั้น
   ไม่ใช่รูปปก/รูปในตะกร้า/ภาพแคตตาล็อก เพราะฟังก์ชันเหล่านั้นอ่านจาก image/images ของสินค้าโดยตรง */
function reviewKeyOf(src){
  let s = String(src || '');
  try{ s = decodeURIComponent(s); }catch(_){}
  return s;
}
// คีย์ที่มี / = path เต็มที่เพิ่มจากหลังบ้าน · คีย์ไม่มี / = ชื่อไฟล์ใน images/reviews/
function reviewSrcOf(k){
  return k.includes('/') ? k.replace(/[#?%]/g, c => encodeURIComponent(c)) : 'images/reviews/' + k;
}
// ป้ายสินค้าของรูปรีวิว (ลองทั้ง path เต็ม และชื่อไฟล์เฉยๆ ถ้าอยู่ใน images/reviews/)
function reviewTagIdsOf(src){
  const full = reviewKeyOf(src);
  const plain = full.startsWith('images/reviews/') ? full.slice('images/reviews/'.length) : full;
  return [...new Set([...(REVIEW_TAGS[full] || []), ...(REVIEW_TAGS[plain] || [])])];
}
// รูปนี้ถูกลบออกจากเว็บไหม (ลองทั้ง path เต็ม และชื่อไฟล์เฉยๆ ถ้าอยู่ใน images/reviews/)
function isReviewHidden(srcOrKey){
  if(!REVIEW_HIDDEN.size) return false;
  const full = reviewKeyOf(srcOrKey);
  const plain = full.startsWith('images/reviews/') ? full.slice('images/reviews/'.length) : full;
  return REVIEW_HIDDEN.has(full) || REVIEW_HIDDEN.has(plain);
}
function reviewNumOf(key){ if(key.includes('/')) return 1e9; const m = /(\d+)/.exec(key); return m ? +m[1] : 0; }
function reviewPhotosOf(p){
  if(!p) return [];
  return Object.keys(REVIEW_TAGS)
    .filter(k => REVIEW_TAGS[k].includes(p.id) && !isReviewHidden(k))
    .sort((a, b) => reviewNumOf(b) - reviewNumOf(a))
    .map(reviewSrcOf);
}
function currentGalleryImages(p){
  const base = productPhotoList(p);
  const rv = reviewPhotosOf(p).filter(src => !base.includes(src));
  return rv.length ? base.concat(rv) : base;
}
// Small round preview photo inside a choice chip (desktop only — hidden by CSS on mobile).
// Works for anything with .image / .images[0] (colors, sizes, addons); no photo → no thumbnail.
function chipThumb(o){
  const src = o && (o.image || (o.images && o.images[0]));
  return src ? `<img class="chip-thumb" src="${src}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
}
function renderModalMainImage(p){
  const imgs = currentGalleryImages(p);
  const src = imgs[modalImgIndex];
  if(src){
    return `<img src="${src}" alt="${p.name}" decoding="async" onerror="this.parentElement.innerHTML=window.iconFallbackFor('${p.id}')">`;
  }
  return iconFor(p);
}
function renderModalThumbs(p){
  const wrap = document.getElementById('galleryThumbs');
  if(!wrap) return;
  const imgs = currentGalleryImages(p);
  if(imgs.length < 2){
    wrap.innerHTML = '';
    return;
  }
  const rvSet = new Set(reviewPhotosOf(p));
  wrap.innerHTML = imgs.map((src, i) => `
    <button type="button" class="gallery-thumb ${i===modalImgIndex?'active':''}${rvSet.has(src)?' is-review':''}" onclick="setModalImgIndex(${i})" aria-label="${rvSet.has(src)?'ดูรูปรีวิวลูกค้า':'ดูรูปที่ '+(i+1)}">
      <img src="${src}" alt="${p.name} มุมที่ ${i+1}" loading="lazy" decoding="async" onerror="this.closest('.gallery-thumb').style.display='none'">
    </button>
  `).join('');
}
function setModalImgIndex(i){
  __sfbGalleryDir = i > modalImgIndex ? 1 : (i < modalImgIndex ? -1 : 0); // ทิศที่รูปจะเลื่อนเข้า (อนิเมชั่นมือถือ)
  modalImgIndex = i;
  renderModal();
}
function toggleModalAddon(name, checked){
  if(checked) modalSelectedAddons.add(name);
  else modalSelectedAddons.delete(name);
  modalImgIndex = 0;
  renderModal();
}
function changeModalImg(delta){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return;
  const imgs = currentGalleryImages(p);
  if(imgs.length < 2) return;
  __sfbGalleryDir = delta > 0 ? 1 : -1; // ทิศที่รูปจะเลื่อนเข้า (อนิเมชั่นมือถือ)
  modalImgIndex = (modalImgIndex + delta + imgs.length) % imgs.length;
  renderModal();
}
// Swipe left/right on the main photo to move through the gallery on touch devices.
// Attached once to the persistent #modalImg element (its innerHTML is swapped on
// every render, but the element itself — and this listener — stays put).
(function(){
  let startX = 0, startY = 0;
  const el = document.getElementById('modalImg');
  if(!el) return;
  el.addEventListener('touchstart', function(e){
    const t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY;
  }, {passive:true});
  el.addEventListener('touchend', function(e){
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5){
      changeModalImg(dx < 0 ? 1 : -1);
    }
  }, {passive:true});
})();

// Desktop product card: click on the dark area outside the card to close it.
// Only counts when the mouse was pressed AND released on the backdrop, so dragging to
// select text inside the card and letting go outside does not close it by accident.
(function(){
  const page = document.getElementById('productModal');
  if(!page) return;
  let downOnBackdrop = false;
  page.addEventListener('mousedown', function(e){
    downOnBackdrop = (e.target === page);
  });
  page.addEventListener('click', function(e){
    if(e.target === page && downOnBackdrop && window.matchMedia('(min-width:860px)').matches){
      closeProductModal();
    }
    downOnBackdrop = false;
  });
})();

// Keyboard for the product card: Esc closes, ←/→ switch photos (when there are several).
// Skips when typing in a field, using modifier keys, or when another popup is on top.
document.addEventListener('keydown', function(e){
  const page = document.getElementById('productModal');
  if(!page || !page.classList.contains('open')) return;
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const onTop = ['reviewLightbox', 'promoOverlay', 'reviewsAllModal', 'orderSummaryModal']
    .some(id => { const el = document.getElementById(id); return el && el.classList.contains('open'); });
  if(onTop) return;
  if(e.key === 'Escape'){ closeProductModal(); }
  else if(e.key === 'ArrowLeft'){ changeModalImg(-1); }
  else if(e.key === 'ArrowRight'){ changeModalImg(1); }
});

// Full-page product view (not a floating pop-up) — behaves like a real "page" so the
// device/browser back button closes it and returns to the catalog, like a native app.
// colorIndex/optionIndex/sizeIndex (optional): มาจากการ์ดย่อยที่แตกตามสี/ตัวเลือก/ขนาด
// ในโซน "สินค้าแนะนำ" — เปิดหน้าสินค้าพร้อม pre-select ตัวเลือกนั้นทันที ลูกค้าจะไม่เจอ
// ตัวเลือกอื่นก่อนตัวที่กดเข้ามาจากการ์ดนั้น
// จอคอม: กดการ์ด "สินค้าอื่นๆ ที่คุณอาจชอบ" ในหน้าสินค้า = สลับสินค้าในหน้าเดิม (ไม่ซ้อนประวัติ ปุ่มกลับยังกลับไปหน้ารายการตรงเดิม)
// pdFromRelated: ตั้งโดยตัวดักคลิกด้านล่างก่อน onclick ของการ์ดทำงาน — สินค้าแนะนำไม่ผูกกับตัวกรองหน้ารายการ
let pdFromRelated = false;
function pdIsDesktop(){ return !!(window.matchMedia && window.matchMedia('(min-width:860px)').matches); }
function openProductModal(id, colorIndex, optionIndex, sizeIndex){
  const page = document.getElementById('productModal');
  const wasOpen = page.classList.contains('open');
  const fromRelated = pdFromRelated; pdFromRelated = false;
  modalProductId = id;
  modalQty = 1;
  modalImgIndex = 0;
  modalSelectedAddons = new Set();
  const p = PRODUCTS.find(x=>x.id===id);
  modalAllowedVariants = (!fromRelated && colorIndex == null && optionIndex == null && sizeIndex == null && cardNarrowByProduct[id])
    ? new Set(cardNarrowByProduct[id]) : null;
  modalBills = p && p.billSelector ? (p.minBills||1) : 1;
  if(p && p.colors && colorIndex != null){
    selectedColor[id] = colorIndex;
  }
  if(p && hasNewOptions(p) && optionIndex != null){
    const v = p.variants[optionIndex];
    if(v) selectedOptions[id] = v.match.slice();
  }
  if(p && p.sizes && sizeIndex != null){
    selectedSizeVariant[id] = sizeIndex;
  } else if(p && p.sizes && !fromRelated && colorIndex == null && optionIndex == null && cardNarrowSizesByProduct[id] && cardNarrowSizesByProduct[id].length){
    // เปิดจากการ์ดที่ตัวกรองบีบเหลือบางไซซ์ — เริ่มที่ไซซ์ราคาถูกสุดที่ผ่านกรอง ไม่ใช่ไซซ์แรก (ที่อาจเป็นช่อปกติ)
    selectedSizeVariant[id] = cardNarrowSizesByProduct[id].reduce((best, i) => (p.sizes[i].price < p.sizes[best].price ? i : best));
  }
  renderModal();
  renderRelatedProducts();
  page.classList.add('open');
  const scrollArea = document.getElementById('productPageScroll');
  if(scrollArea) scrollArea.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if(wasOpen){
    // สลับสินค้าในหน้าเดิม: แทนที่ประวัติเดิม (ไม่ push เพิ่ม) แล้วเล่นแอนิเมชันจางเข้า
    history.replaceState({ productPage:true }, '', '#product');
    const lay = document.getElementById('pdLayout');
    if(lay){ lay.classList.remove('pd-swap'); void lay.offsetWidth; lay.classList.add('pd-swap'); }
  } else {
    history.pushState({ productPage:true }, '', '#product');
  }
}

/* ---------- สินค้าอื่นๆ ที่คุณอาจชอบ (ใต้หน้าสินค้า: จอคอม 8 ชิ้น · มือถือ 6 ชิ้น) ----------
   ลำดับความใกล้เคียง: หมวดเดียวกัน+ชนิดดอกไม้เดียวกัน → หมวดเดียวกัน → หมวดอื่น
   แต่ละกลุ่มเรียงตามราคาที่ใกล้สินค้านี้ที่สุด · เรียงแบบคงที่ ไม่สุ่ม */
function relatedProductsFor(p, limit){
  const price = Number(displayPrice(p)) || 0;
  const diff = x => Math.abs((Number(displayPrice(x)) || 0) - price);
  const byNear = arr => arr.slice().sort((a, b) => diff(a) - diff(b));
  const pool = PRODUCTS.filter(x => x.id !== p.id);
  const sameCat = pool.filter(x => x.cat === p.cat);
  const tier1 = p.flowerType ? sameCat.filter(x => x.flowerType === p.flowerType) : [];
  const t1 = new Set(tier1.map(x => x.id));
  const tier2 = sameCat.filter(x => !t1.has(x.id));
  const tier3 = pool.filter(x => x.cat !== p.cat);
  return [...byNear(tier1), ...byNear(tier2), ...byNear(tier3)].slice(0, limit);
}
function renderRelatedProducts(){
  const sec = document.getElementById('pdRelated');
  const grid = document.getElementById('pdRelatedGrid');
  if(!sec || !grid) return;
  const p = PRODUCTS.find(x => x.id === modalProductId);
  const list = p ? relatedProductsFor(p, pdIsDesktop() ? 8 : 6) : [];
  grid.innerHTML = list.map(x => renderProductCard(x)).join('');
  sec.hidden = !list.length;
}
// ดักคลิกก่อนที่ onclick ของการ์ดจะทำงาน (เฟสดักจับ) แล้วคืนค่าทันทีหลังเหตุการณ์จบ — คลิกหัวใจ/รูปจิ๋วที่ไม่เปิดสินค้าจึงไม่ค้างค่า
document.addEventListener('click', function(e){
  if(e.target && e.target.closest && e.target.closest('#pdRelatedGrid')){
    pdFromRelated = true;
    setTimeout(() => { pdFromRelated = false; }, 0);
  }
}, true);
function closeProductModal(fromPopState){
  const page = document.getElementById('productModal');
  if(!page.classList.contains('open')) return;
  page.classList.remove('open');
  document.body.style.overflow = '';
  modalProductId = null;
  modalAllowedVariants = null;
  if(!fromPopState && history.state && history.state.productPage){
    history.back();
  }
}
window.addEventListener('popstate', function(){
  if(document.getElementById('productModal').classList.contains('open')){
    closeProductModal(true);
  }
});
function changeModalQty(delta){
  modalQty = Math.max(1, modalQty + delta);
  document.getElementById('modalQty').textContent = modalQty;
  updateModalPriceDisplay();
}
function changeModalBills(delta){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return;
  const min = p.minBills||1, max = p.maxBills||30;
  modalBills = Math.min(max, Math.max(min, modalBills+delta));
  renderModal();
}
function renderModal(){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return;
  const imgs = currentGalleryImages(p);
  if(modalImgIndex >= imgs.length) modalImgIndex = 0;
  document.getElementById('modalImg').innerHTML = renderModalMainImage(p);
  const mainImgEl = document.querySelector('#modalImg img');
  const mainSrc = imgs[modalImgIndex] || '';
  if(mainImgEl && mainSrc !== lastModalImgSrc){ mainImgEl.classList.add('pd-fade'); sfbGallerySlide(mainImgEl); }
  __sfbGalleryDir = 0;
  lastModalImgSrc = mainSrc;
  const rvTag = document.getElementById('modalReviewTag'); // ป้าย "รีวิวจากลูกค้า" บนรูปหลัก เมื่อกำลังดูรูปรีวิว
  if(rvTag) rvTag.hidden = !(mainSrc && reviewPhotosOf(p).includes(mainSrc));
  renderModalThumbs(p);
  document.getElementById('modalName').textContent = p.name;
  const modalCatEl = document.getElementById('modalCat');
  if(modalCatEl) modalCatEl.textContent = p.cat || '';
  const crumbs = document.getElementById('pdCrumbs'); // แถบบนจอคอม: สินค้า › หมวด › ชื่อสินค้า
  if(crumbs){
    const mk = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if(cls) el.className = cls; return el; };
    const home = mk('button', 'สินค้า'); home.type = 'button'; home.onclick = () => closeProductModal();
    crumbs.textContent = '';
    crumbs.append(home);
    if(p.cat) crumbs.append(mk('span', '›', 'pd-sep'), mk('span', p.cat));
    crumbs.append(mk('span', '›', 'pd-sep'), mk('b', p.name));
  }
  updateModalHeart();
  document.getElementById('modalDesc').textContent = p.desc;
  document.getElementById('modalQty').textContent = modalQty;
  const badgesHtml =
    (currentReadyState(p) ? '<span class="badge-inline ready">พร้อมส่ง</span>' : '') +
    (p.isNew ? '<span class="badge-inline new">ใหม่</span>' : '');
  document.getElementById('modalBadges').innerHTML = badgesHtml;
  const imgBadgesEl = document.getElementById('modalImgBadges'); // desktop: badges sit on the photo
  if(imgBadgesEl) imgBadgesEl.innerHTML = badgesHtml;

  const colorsWrap = document.getElementById('modalColors');
  if(p.colors){
    colorsWrap.innerHTML = p.colors.map((c,i)=>`
      <button class="color-chip ${(resolvedColorIndex(p)===i)?'active':''}" onclick="modalImgIndex=0; modalSelectedAddons=new Set(); selectColor('${p.id}',${i}); renderModal();">${chipThumb(c)}${c.name}</button>
    `).join('');
    const selColor = p.colors[resolvedColorIndex(p)];
    colorsWrap.dataset.sel = selColor ? ': ' + selColor.name : '';
  } else {
    colorsWrap.innerHTML = '';
    delete colorsWrap.dataset.sel;
  }

  const sizesWrap = document.getElementById('modalSizes');
  if(p.sizes){
    sizesWrap.innerHTML = p.sizes.map((s,i)=>`
      <button class="color-chip ${((selectedSizeVariant[p.id]||0)===i)?'active':''}" onclick="modalImgIndex=0; selectSizeVariant('${p.id}',${i}); renderModal();">${chipThumb(s)}${s.name}</button>
    `).join('');
    const selSize = p.sizes[selectedSizeVariant[p.id]||0];
    sizesWrap.dataset.sel = selSize ? ': ' + selSize.name : '';
  } else {
    sizesWrap.innerHTML = '';
    delete sizesWrap.dataset.sel;
  }

  // ตัวเลือกเสริมแบบมีราคา (เช่น "เพิ่มผึ้งน้อย +20 บาท") — โผล่เฉพาะตอนสีที่เลือกอยู่ประกาศ .addons ไว้
  // แสดงเป็นปุ่มชิพเหมือนปุ่มเลือกสี กดติดได้หลายปุ่มพร้อมกัน (เผื่อมี addon มากกว่า 1 ตัวในอนาคต)
  const addonWrap = document.getElementById('modalAddons');
  if(addonWrap){
    const addons = currentAddonSource(p);
    if(addons && addons.length){
      addonWrap.style.display = '';
      addonWrap.innerHTML = addons.map(a => `
        <button type="button" class="color-chip ${modalSelectedAddons.has(a.name)?'active':''}" onclick="toggleModalAddon('${a.name}', ${!modalSelectedAddons.has(a.name)})">${chipThumb(a)}➕ ${a.name}${PRICES_HIDDEN ? '' : ` (+${a.price}฿)`}</button>
      `).join('');
      addonWrap.dataset.sel = modalSelectedAddons.size ? ': ' + [...modalSelectedAddons].join(', ') : '';
    } else {
      addonWrap.style.display = 'none';
      addonWrap.innerHTML = '';
      delete addonWrap.dataset.sel;
      if(modalSelectedAddons.size) modalSelectedAddons = new Set();
    }
  }

  // สินค้าระบบ options ใหม่ (หลายมิติ เช่น สีดอก × สีช่อ × แบบ) — วาดปุ่มเลือกทีละกลุ่ม
  const optionGroupsWrap = document.getElementById('modalOptionGroups');
  if(optionGroupsWrap){
    if(hasNewOptions(p)){
      const sel = currentOptionSelection(p);
      optionGroupsWrap.innerHTML = p.options.map((opt, oi) => `
        <div class="option-group">
          <div style="font-size:12.5px; color:var(--plum); font-weight:600; margin:10px 0 4px;">${opt.name}<span class="pd-selval">${sel[oi] ? ': ' + sel[oi] : ''}</span></div>
          <div class="color-row">
            ${opt.values.map(val => {
              const isActive = sel[oi]===val;
              // เทา (ปิด กดไม่ได้) เฉพาะค่าที่ไม่มีทางเป็นไปได้ตามตัวเลือกมิติอื่นที่เลือกไว้แล้วตอนนี้
              // (มิติที่ยังไม่เลือกไม่จำกัด) เช่น เลือก ส้ม+ขาว ไว้ ปุ่ม "ใส่เงิน 15 ใบ" จะเทาเพราะไม่มีชุดนี้ขาย
              const compatible = isActive || optionValueCompatible(p, sel, oi, val);
              const cls = `color-chip ${isActive ? 'active' : ''} ${compatible ? '' : 'disabled'}`;
              const attrs = compatible
                ? `onclick="selectOption('${p.id}', ${oi}, '${val.replace(/'/g,"\\'")}')" ${isActive ? 'title="กดอีกครั้งเพื่อยกเลิก"' : ''}`
                : `disabled aria-disabled="true" title="ยังไม่มีสินค้าชุดนี้"`;
              return `<button class="${cls}" ${attrs}>${val}</button>`;
            }).join('')}
          </div>
        </div>
      `).join('');
    } else {
      optionGroupsWrap.innerHTML = '';
    }
  }

  const billsRow = document.getElementById('modalBillsRow');
  if(p.billSelector){
    billsRow.style.display = 'flex';
    document.getElementById('modalBills').textContent = modalBills;
  } else {
    billsRow.style.display = 'none';
  }

  updateModalPriceDisplay();
}
// ราคาต่อหน่วยอย่างเดียวไม่พอเมื่อลูกค้าเพิ่ม "จำนวนช่อ" มากกว่า 1 — ต้องโชว์ให้ชัดว่านี่คือราคา/ช่อ
// และคำนวณยอดรวมให้เห็นด้วย ไม่งั้นตัวเลขราคาตัวใหญ่ที่โชว์อยู่จะทำให้เข้าใจผิดว่าเป็นยอดรวมทั้งหมด
function updateModalPriceDisplay(){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  const priceEl = document.getElementById('modalPrice');
  if(!p || !priceEl) return;
  if(PRICES_HIDDEN){
    priceEl.classList.add('price-ask');
    priceEl.innerHTML = priceAskHtml();
    return;
  }
  priceEl.classList.remove('price-ask');
  // ยังเลือกตัวเลือกไม่ครบทุกมิติ — โชว์เป็นช่วงราคา (ต่ำสุด-สูงสุด) ของชุดที่ยังเป็นไปได้ตามที่เลือกไว้แล้ว
  // แทนที่จะเดาราคาจาก variant ใดตัวหนึ่งไปก่อน เพราะยังไม่รู้ว่าลูกค้าจะเลือกจบที่ชุดไหน
  if(hasNewOptions(p) && !hasFullOptionSelection(p, currentOptionSelection(p))){
    const { min, max } = optionPriceRange(p, currentOptionSelection(p));
    renderModalBar(p);
    priceEl.innerHTML = min === max
      ? `${fmt(min)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>`
      : `${fmt(min)} - ${fmt(max)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>`;
    return;
  }
  const unitPrice = currentModalVariant(p).unitPrice;
  const lineTotal = unitPrice * modalQty;
  // มือถือ: "฿249 / ช่อ × 2 = ฿498" (.pd-mx)   คอม: ราคาต่อช่อซ้าย + "ยอดรวม" ขวา (.pd-total) — CSS สลับให้
  priceEl.innerHTML = `${fmt(unitPrice)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>` +
    (modalQty > 1 ? `<span class="pd-mx"> × ${modalQty} = <strong>${fmt(lineTotal)}</strong></span>` : '') +
    (modalQty > 1 ? `<span class="pd-total"><span class="pd-total-label">ยอดรวม</span><b>${fmt(lineTotal)}</b></span>` : '');
  renderModalBar(p);
}
// แถบสั่งซื้อด้านล่างของหน้าสินค้าบนมือถือ: บอกสิ่งที่เลือกไว้ + ราคารวม ให้เห็นตลอดโดยไม่ต้องเลื่อนกลับขึ้นไปดู
// ถ้ายังเลือกตัวเลือกไม่ครบ จะบอกว่าต้องเลือกอะไรต่อ แทนที่จะรอให้กดปุ่มแล้วค่อยเจอข้อความเตือน
function renderModalBar(p){
  const el = document.getElementById('mabInfo');
  if(!el || !p || ordersBlocked()) return;
  let text = '', total = '', need = false;
  if(hasNewOptions(p) && !hasFullOptionSelection(p, currentOptionSelection(p))){
    const sel = currentOptionSelection(p);
    const missing = (p.options || []).find((o, i) => sel[i] == null);
    const { min, max } = optionPriceRange(p, sel);
    text = 'เลือก' + (missing && missing.name ? missing.name : 'ตัวเลือก') + 'ก่อนนะคะ';
    total = min === max ? fmt(min) : fmt(min) + ' - ' + fmt(max);
    need = true;
  } else {
    const v = currentModalVariant(p);
    text = (v.label || p.name || '') + (modalQty > 1 ? ' × ' + modalQty : '');
    total = fmt(v.unitPrice * modalQty);
  }
  el.classList.toggle('need', need);
  el.textContent = '';
  const a = document.createElement('span'); a.className = 'mab-label'; a.textContent = text;
  const b = document.createElement('span'); b.className = 'mab-total'; b.textContent = total;
  el.append(a, b);
}
function currentModalVariant(p){
  if(p.billSelector) return { label:`ใส่ธนบัตร ${modalBills} ใบ`, unitPrice: unitPriceFor(p, modalBills) };
  if(hasNewOptions(p)){
    const sel = currentOptionSelection(p);
    const v = matchVariant(p, sel);
    // บวกราคา/ชื่อของเสริมที่ลูกค้าติ๊กไว้ (เดิมคืนราคาตัวแปรเฉยๆ ทำให้ราคาไม่เปลี่ยนเมื่อเลือกของเสริม)
    const optAddons = currentAddonSource(p);
    const optChosen = optAddons ? optAddons.filter(a => modalSelectedAddons.has(a.name)) : [];
    return {
      label: [sel.join(', '), ...optChosen.map(a => a.name)].join(' + '),
      unitPrice: v.price + optChosen.reduce((sum,a) => sum + (+a.price || 0), 0)
    };
  }
  let label = null, unitPrice = p.price;
  if(p.colors){
    const c = p.colors[resolvedColorIndex(p)];
    label = c.name;
  }
  let addonSum = 0;
  const addons = currentAddonSource(p);
  if(addons && addons.length){
    const chosen = addons.filter(a => modalSelectedAddons.has(a.name));
    if(chosen.length){
      const names = chosen.map(a => a.name);
      label = label ? [label, ...names].join(' + ') : names.join(' + ');
      addonSum = chosen.reduce((sum,a) => sum + (+a.price || 0), 0);
      unitPrice += addonSum;
    }
  }
  if(p.sizes){
    const sv = p.sizes[selectedSizeVariant[p.id]||0];
    label = label ? `${label}, ${sv.name}` : sv.name;
    unitPrice = sv.price + addonSum; // เดิมใช้ sv.price ทับ ทำให้ราคาของเสริมหาย
  }
  return { label, unitPrice };
}
function addModalToCart(){
  if(ordersBlocked()) return;
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return;
  if(warnIfInvalidOptionSelection(p)) return;
  const { label, unitPrice } = currentModalVariant(p);
  const key = cartKeyOf(p.id, label);
  if(cart[key]) cart[key].qty += modalQty;
  else cart[key] = { qty:modalQty, unitPrice, label };
  sfbFlyToCart(); // ต้องเรียกก่อน updateCartUI/ปิดหน้าสินค้า เพราะต้องอ่านตำแหน่งรูปบนหน้าสินค้าก่อนมันเลื่อนออก
  updateCartUI();
  showToast('เพิ่มลงตะกร้าแล้ว 🌸');
  if(!pdIsDesktop()) closeProductModal(); // จอคอมอยู่หน้าเดิมต่อ จะได้ดูสินค้าแนะนำ/เพิ่มชิ้นอื่นได้ (ตัวเลขตะกร้าบนแถบบนอัปเดตเอง)
}

/* ---------- โหลดข้อมูลสินค้าจาก products.json ----------
   แก้ไข/เพิ่ม/ลบสินค้าได้ที่ไฟล์ products.json โดยตรง ไม่ต้องแก้ไฟล์นี้เลย
   ต้องเปิดเว็บผ่านลิงก์จริง (เช่น Netlify) เท่านั้น ถ้าดับเบิลคลิกเปิดไฟล์ตรงๆ
   (file://) เบราว์เซอร์จะบล็อกการโหลดไฟล์ json แล้วจะเห็นข้อความแจ้ง error สีแดงแทน */
/* ดึงสินค้าจาก Firestore (ที่หลังบ้าน admin.html บันทึกไว้)
   คืนค่า null ถ้ายังไม่ได้ตั้งค่า Firebase หรือเชื่อมต่อไม่ได้ เพื่อให้หน้าร้าน
   ตกไปใช้ products.json ต่อได้ตามปกติ ลูกค้าจะไม่เห็นหน้าเว็บพัง */
async function fetchProductsFromFirestore(){
  const cfg = window.FIREBASE_CONFIG;
  if(!cfg || !cfg.projectId || String(cfg.apiKey || '').includes('ใส่ค่าจริง')) return null;
  const [appMod, dbMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
  ]);
  const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(cfg);
  const ref = dbMod.doc(dbMod.getFirestore(app), window.CATALOG_COLLECTION || 'catalog', window.CATALOG_DOC || 'products');
  const snap = await dbMod.getDoc(ref);
  if(!snap.exists()) return null;
  const data = snap.data() || {};
  cloudHidePrices = data.hidePrices === true;
  cloudOrderClosed = data.orderClosed === true;
  cloudOptions = null;
  try{ if(typeof data.optionsJson === 'string') cloudOptions = JSON.parse(data.optionsJson); }catch(_){ cloudOptions = null; }
  REVIEW_TAGS = {};
  REVIEW_HIDDEN = new Set();
  try{
    const raw = typeof data.reviewsJson === 'string' ? JSON.parse(data.reviewsJson) : null;
    if(raw && typeof raw === 'object'){
      if(Array.isArray(raw.__hidden)) REVIEW_HIDDEN = new Set(raw.__hidden.map(x => String(x || '').trim()).filter(Boolean));
      Object.keys(raw).forEach(k => {
        if(k === '__hidden') return;
        const ids = (Array.isArray(raw[k]) ? raw[k] : [raw[k]]).map(x => String(x ?? '').trim()).filter(Boolean);
        if(ids.length || k.includes('/')) REVIEW_TAGS[k] = ids; // คีย์ที่เป็น path เต็ม = รูปที่เพิ่มจากหลังบ้านด้วย path (ผูกสินค้าหรือไม่ก็ได้)
      });
    }
  }catch(_){ REVIEW_TAGS = {}; REVIEW_HIDDEN = new Set(); }
  SITE_CFG = null;
  try{ if(typeof data.siteJson === 'string'){ const s = JSON.parse(data.siteJson); if(s && typeof s === 'object') SITE_CFG = s; } }catch(_){ SITE_CFG = null; }
  cloudStamp = String(data.updatedAt || '') + '|' + cloudHidePrices + '|' + cloudOrderClosed + '|' + String(data.optionsUpdatedAt || '') + '|' + String(data.reviewsUpdatedAt || '') + '|' + String(data.siteUpdatedAt || '');
  const list = typeof data.json === 'string' ? JSON.parse(data.json) : data.list;
  return (Array.isArray(list) && list.length) ? list : null;
}

/* ---------- แต่งหน้าร้านจากหลังบ้าน (ช่อง siteJson ในเอกสารเดียวกับสินค้า) ----------
   ไม่มีค่า / ค่าเสีย → ไม่แตะอะไร หน้าร้านใช้ข้อความและรูปที่เขียนไว้ใน HTML/โค้ดตามเดิม
   รูปรับเฉพาะ path ที่ขึ้นต้นด้วย images/ เท่านั้น */
function siteSafeSrc(s){
  s = String(s || '').trim();
  return (/^images\/[^\s"'<>\\]+$/.test(s) && !s.includes('..')) ? s : '';
}
function siteLines(s){ return escapeHtml(String(s)).replace(/\r?\n/g, '<br>'); }
function applySiteSettings(cfg){
  if(!cfg || typeof cfg !== 'object') return;
  const $id = id => document.getElementById(id);
  const setText = (id, v) => { const el = $id(id); if(el && typeof v === 'string' && v.trim()) el.textContent = v.trim(); };
  try{
    // สีธีม
    const th = cfg.theme && cfg.theme.vars;
    if(th && typeof th === 'object'){
      const hex = /^#[0-9a-f]{6}$/i, root = document.documentElement;
      const map = { sage:'--sage', sageDark:'--sage-dark', rose:'--rose', roseDark:'--rose-dark', peach:'--peach', cream:'--cream', sageLight:'--sage-light', tint1:'--tint-1', tint2:'--tint-2', tint3:'--tint-3', tint4:'--tint-4' };
      Object.keys(map).forEach(k => { if(hex.test(String(th[k] || ''))) root.style.setProperty(map[k], th[k]); });
      if(/^\d{1,3},\d{1,3},\d{1,3}$/.test(String(th.rgb || ''))) root.style.setProperty('--sage-rgb', th.rgb);
      const meta = document.querySelector('meta[name="theme-color"]');
      if(meta && hex.test(String(th.sage || ''))) meta.setAttribute('content', th.sage);
    }
    // ชื่อร้าน / ประโยคใต้ชื่อ / โลโก้ / ท้ายเว็บ
    const shop = cfg.shop || {};
    const name = typeof shop.name === 'string' ? shop.name.trim() : '';
    if(name){ SITE_SHOP_NAME = name; setText('brandName', name); setText('brandH1', name); }
    setText('brandTag', shop.tagline);
    const logo = siteSafeSrc(cfg.logo), logoEl = $id('brandLogo');
    if(logo && logoEl) logoEl.src = logo;
    const foot = $id('siteFooter');
    if(foot){
      if(typeof cfg.footer === 'string' && cfg.footer.trim()) foot.textContent = cfg.footer.trim();
      else if(name) foot.textContent = '© ' + name;
    }
    // แถบรีวิว
    const rv = cfg.reviews || {};
    setText('reviewsTitle', rv.title);
    if(rv.on === false && $id('reviewsSection')){ $id('reviewsSection').style.display = 'none'; heroRowFlag('no-reviews', true); }
    // FAQ
    const fq = cfg.faq || {}, fsec = $id('faqSection');
    if(fsec){
      setText('faqTitle', fq.title);
      const items = Array.isArray(fq.items) ? fq.items.filter(i => i && String(i.q || '').trim() && String(i.a || '').trim()) : null;
      if(fq.on === false || (items && !items.length)) fsec.style.display = 'none';
      else if(items){
        fsec.querySelectorAll('.faq-item').forEach(el => el.remove());
        fsec.insertAdjacentHTML('beforeend', items.map(i =>
          '<details class="faq-item"><summary>' + escapeHtml(String(i.q).trim()) + '</summary><p class="faq-answer">' + siteLines(String(i.a).trim()) + '</p></details>').join(''));
      }
    }
    // ป๊อปอัปตอนเปิดเว็บ
    const pp = cfg.popup;
    if(pp && typeof pp === 'object'){
      if(pp.on === false) PROMO_SLIDES.length = 0;
      else if(Array.isArray(pp.slides)){
        const slides = pp.slides.filter(s => s && s.on !== false).map(s => ({ image: siteSafeSrc(s.src), alt: 'โปรโมชั่น' })).filter(s => s.image);
        PROMO_SLIDES.splice(0, PROMO_SLIDES.length, ...slides);
      }
    }
  }catch(err){ console.warn('ใช้ค่าแต่งหน้าร้านไม่สำเร็จ ใช้ค่าเดิมต่อ:', err); }
}

// ห่อ loadProducts: ไม่ว่าจะโหลดจาก Firestore / products.json / ล้มเหลว ต้องปล่อยให้แบนเนอร์กับป๊อปอัปเริ่มเสมอ
async function loadProducts(){
  try{ await loadProductsInner(); }
  finally{ _siteReadyRes(); }
}
async function loadProductsInner(){
  const catalogEl = document.getElementById('catalog');
  // ลอง Firestore ก่อน แต่ไม่ยอมรอเกิน 6 วินาที ไม่งั้นเน็ตช้าจะค้างหน้าร้านทั้งหน้า
  // ถ้าช้า/ล้มเหลว (cloudPending) หน้าร้านเปิดจาก products.json ไปก่อน แล้วให้ loadPricesLate ตามดึงต่อเบื้องหลัง
  let cloudPromise = null, cloudPending = false;
  try{
    cloudPromise = fetchProductsFromFirestore();
    cloudPromise.catch(() => {}); // กัน error เด้งเป็น unhandled ตอนที่เราเลิกรอไปแล้ว (ตัว loadPricesLate จะรอ/จับเองอีกที)
    const CLOUD_SLOW = {};
    const fromCloud = await Promise.race([
      cloudPromise,
      new Promise(resolve => setTimeout(() => resolve(CLOUD_SLOW), 6000))
    ]);
    if(fromCloud === CLOUD_SLOW){
      cloudPending = true;
    } else if(fromCloud){
      PRODUCTS = fromCloud;
      applyShopOptions(cloudOptions);
      setPricesHidden(cloudHidePrices);
      setOrdersClosed(cloudOrderClosed);
      applySiteSettings(SITE_CFG);
      CATALOG_DOC_STAMP = cloudStamp;
      finishLoadingProducts();
      return;
    }
  } catch(err){
    cloudPending = true;
    cloudPromise = null; // ครั้งแรกล้มเหลวแล้ว — loadPricesLate จะเริ่มลองใหม่เอง
    console.warn('ดึงสินค้าจาก Firestore ไม่สำเร็จ จะใช้ products.json แทน:', err);
  }
  // ยังไม่รู้สถานะสวิตช์ราคา: ซ่อนราคาไว้ก่อน (กันราคาหลุด) แต่โชว์ว่ากำลังโหลด ไม่ใช่ให้ไปถามเพจ
  if(cloudPending) setPricesPending(true);
  try{
    const res = await fetch('products.json');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    PRODUCTS = await res.json();
  } catch(err){
    catalogEl.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--rose-dark);">
        <p style="font-size:16px; font-weight:700; margin-bottom:8px;">⚠️ โหลดข้อมูลสินค้าไม่สำเร็จ</p>
        <p style="font-size:13.5px; color:var(--plum);">กรุณาตรวจสอบว่าไฟล์ products.json อยู่ในโฟลเดอร์เดียวกับเว็บไซต์<br>และเปิดเว็บผ่านลิงก์จริง ไม่ใช่การดับเบิลคลิกเปิดไฟล์โดยตรง</p>
      </div>`;
    console.error('โหลด products.json ไม่สำเร็จ:', err);
    if(cloudPending) loadPricesLate(cloudPromise);
    return;
  }
  finishLoadingProducts();
  if(cloudPending) loadPricesLate(cloudPromise);
}

/* Firestore ตอบช้า/ล้มเหลวตอนเปิดหน้า: หน้าร้านเปิดจาก products.json ไปก่อน (ยังซ่อนราคา โชว์ "กำลังโหลดราคา…")
   แล้วรอ/ลองดึง Firestore ต่อเบื้องหลัง พอได้ค่าจริงก็อัปเดตหน้าเดิมเลย ไม่ต้องรีโหลด
   ลองครบแล้วยังไม่ได้ค่อยตกไปโชว์ข้อความให้แคปหน้าจอถามราคาทางเพจเหมือนเดิม
   (ระหว่างรอ PRICES_HIDDEN ยังเป็น true ตลอด จึงไม่มีทางโชว์ราคาทั้งที่ร้านเปิดสวิตช์ซ่อนไว้) */
async function loadPricesLate(firstPromise){
  const withCap = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const delays = firstPromise ? [0, 3000, 8000, 15000] : [3000, 8000, 15000];
  let list = null;
  for(let i = 0; i < delays.length; i++){
    if(delays[i]) await new Promise(r => setTimeout(r, delays[i]));
    try{
      const p = (i === 0 && firstPromise) ? firstPromise : fetchProductsFromFirestore();
      list = await withCap(p, 20000);
      break; // ได้คำตอบแล้ว (ได้รายการ หรือ null = ไม่มีเอกสาร/ยังไม่ได้ตั้งค่า) ไม่ต้องลองซ้ำ
    }catch(err){ list = null; }
  }
  if(list && list.length){
    try{
      PRODUCTS = list;
      applyShopOptions(cloudOptions);
      setPricesHidden(cloudHidePrices);
      setOrdersClosed(cloudOrderClosed);
      CATALOG_DOC_STAMP = cloudStamp;
      setPricesPending(false);
      PRODUCTS = PRODUCTS.filter(p => !(p && p.hidden));
      pruneCartAgainstProducts();
      pruneFavoritesAgainstProducts();
      renderNav();
      renderCatalog();
      renderFilterSidebar();
      updateFilterBadge();
      updateCartUI();
      if(modalProductId) updateModalPriceDisplay(); // ลูกค้าเปิดหน้าสินค้าค้างไว้ระหว่างรอ — อัปเดตกล่องราคาให้ด้วย
      return;
    }catch(err){
      console.warn('ใช้ข้อมูลที่ตามโหลดมาไม่สำเร็จ:', err);
    }
  }
  // ลองครบแล้วยังไม่ได้ — เลิกโชว์ "กำลังโหลด" แล้วกลับไปข้อความให้ถามราคาทางเพจ
  setPricesPending(false);
  renderCatalog();
  if(modalProductId) updateModalPriceDisplay();
}

/* ขั้นตอนหลังได้ข้อมูลสินค้ามาแล้ว ใช้ร่วมกันทั้งทาง Firestore และ products.json */
function finishLoadingProducts(){
  // สินค้าที่ซ่อนจากหลังบ้าน (hidden: true) ไม่แสดงบนหน้าร้านเลย — ตัดออกก่อนขั้นตอนอื่นทั้งหมด
  // ตะกร้าและรายการโปรดที่ค้างสินค้านี้อยู่จะถูกเคลียร์ตามโดย prune ด้านล่างเอง
  PRODUCTS = PRODUCTS.filter(p => !(p && p.hidden));
  pruneCartAgainstProducts();
  pruneFavoritesAgainstProducts();
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  updateCartUI();
  loadSavedFbName();
}
const PRODUCTS_LOADED = loadProducts().catch(() => {});

/* ลูกค้ากลับมาที่แท็บ: เช็คว่าหลังบ้านเปิด/ปิดสวิตช์ราคา หรือแก้ข้อมูลสินค้าไปหรือยัง ถ้าเปลี่ยนให้โหลดหน้าใหม่
   (กันลูกค้าที่เปิดหน้าค้างไว้เห็นราคาเก่า) เช็คเฉพาะตอนที่หน้านี้ใช้ข้อมูลจาก Firestore และไม่เช็คถี่เกิน 30 วินาที */
let lastCloudCheck = 0;
document.addEventListener('visibilitychange', async () => {
  if(document.visibilityState !== 'visible' || !CATALOG_DOC_STAMP) return;
  if(Date.now() - lastCloudCheck < 30000) return;
  lastCloudCheck = Date.now();
  try{
    await fetchProductsFromFirestore();
    if(cloudStamp && cloudStamp !== CATALOG_DOC_STAMP) location.reload();
  } catch(err){ /* เน็ตหลุด — ใช้ข้อมูลเดิมต่อ */ }
});

/* ---------- รีวิวจากลูกค้า (รูปภาพล้วน) ----------
   ไม่ต้องแก้โค้ดหรือแก้ไฟล์ JSON — แค่เอารูปรีวิว (แคปแชท/รูปที่ลูกค้าส่งมา) ไปวางใน
   โฟลเดอร์ images/reviews/ แล้วตั้งชื่อไฟล์เรียงเลขเป็น .jpg เสมอ: review1.jpg, review2.jpg,
   review3.jpg, ... ระบบจะยิงเช็คทุกเลขพร้อมกันทีเดียวตอนโหลดหน้าเว็บ (เร็วกว่าเช็คทีละไฟล์มาก)
   เพิ่มรีวิวใหม่ก็แค่เพิ่มไฟล์เลขถัดไปเป็น .jpg ไม่ต้องแตะโค้ดเลย
   (เว็บสถิตแบบนี้ดึงรายชื่อไฟล์ทั้งโฟลเดอร์ตรงๆ ไม่ได้ จึงต้องพึ่งชื่อไฟล์เรียงเลขแทน)
   ถ้าวันไหนมีรีวิวเกิน 60 รูป ให้เพิ่มเลข MAX_REVIEWS ด้านล่างนี้ */
const MAX_REVIEWS = 200;
const REVIEW_BATCH_SIZE = 20; // เช็คทีละ 20 ไฟล์ ไม่ยิงพร้อมกันทั้ง 200 ไฟล์ตั้งแต่แรก
function checkImageExists(src){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// อ่านรายชื่อไฟล์จาก images/reviews/list.json (รูปแบบ ["review1.jpg","review131.jpg", ...])
// คืน null ถ้าไม่มีไฟล์/อ่านไม่ได้ เพื่อให้ถอยไปใช้การสแกนเลขไฟล์แบบเดิม
async function loadReviewList(){
  try{
    const res = await fetch('images/reviews/list.json', { cache: 'no-cache' });
    if(!res.ok) return null;
    const arr = await res.json();
    if(!Array.isArray(arr)) return null;
    const names = arr.map(x => String(x || '').trim()).filter(n => n && !/[\\/]/.test(n));
    if(!names.length) return null;
    names.sort((x, y) => x.localeCompare(y, 'en', { numeric: true })); // เก่า → ใหม่ (เลขน้อย → มาก)
    return [...new Set(names)].map(n => `images/reviews/${encodeURIComponent(n)}`);
  }catch(_){ return null; }
}
// วิธีสำรอง: เดาชื่อ review1.jpg, review2.jpg, … ทีละชุด หยุดเมื่อว่างติดกัน 3 ชุด (60 เลข)
async function scanReviewsFallback(){
  const found = [];
  let emptyStreak = 0;
  for(let start = 1; start <= MAX_REVIEWS; start += REVIEW_BATCH_SIZE){
    const end = Math.min(start + REVIEW_BATCH_SIZE - 1, MAX_REVIEWS);
    const checks = [];
    for(let i = start; i <= end; i++){
      checks.push(checkImageExists(`images/reviews/review${i}.jpg`));
    }
    const batchFound = (await Promise.all(checks)).filter(Boolean);
    found.push(...batchFound);
    emptyStreak = batchFound.length ? 0 : emptyStreak + 1;
    if(emptyStreak >= 3) break;
  }
  return found;
}
async function loadReviews(){
  const found = (await loadReviewList()) || (await scanReviewsFallback());
  // รูปที่เพิ่มจากหลังบ้านด้วย path (เก็บใน REVIEW_TAGS คีย์ที่มี /) — ต้องรอข้อมูลจาก Firestore โหลดเสร็จก่อน
  try{ await PRODUCTS_LOADED; }catch(_){}
  Object.keys(REVIEW_TAGS).filter(k => k.includes('/')).forEach(k => {
    const src = reviewSrcOf(k);
    if(!found.includes(src)) found.push(src); // ต่อท้าย = นับเป็นรูปใหม่สุด
  });
  const shown = found.filter(src => !isReviewHidden(src)); // ตัดรูปที่ร้านลบออกจากเว็บแล้ว
  if(!shown.length){ heroRowFlag('no-reviews', true); return; } // ไม่มีรีวิว → แบนเนอร์กลับมาอยู่กลางหน้า
  renderReviews(shown);
}
let REVIEWS = []; // ลำดับสุ่ม — ใช้กับแถบพรีวิวหน้าแรก
let REVIEWS_ALL_SORTED = []; // เรียงจากรูปล่าสุด (เลขไฟล์มากสุด) ไปเก่าสุด — ใช้กับหน้าดูรีวิวทั้งหมด
function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function reviewCardHTML(src, i, isClone){
  const extra = isClone ? ' review-card-clone" aria-hidden="true" tabindex="-1' : '';
  return `<div class="review-card${extra}" onclick="openReviewLightbox(REVIEWS, ${i})">
      <div class="review-photo">
        <img src="${src}" alt="รีวิวจากลูกค้า" loading="lazy" decoding="async" onerror="this.closest('.review-card').style.display='none'">
      </div>
    </div>`;
}
// เปิด/ปิดคลาสของแถวบนสุด (แบนเนอร์ + รีวิว) เช่น no-reviews = ไม่มีรีวิวให้แสดง จึงจัดแบนเนอร์ไว้กลางหน้า
function heroRowFlag(cls, on){ const r = document.getElementById('heroRow'); if(r) r.classList.toggle(cls, !!on); }
function renderReviews(imagesIn){
  REVIEWS = shuffle(imagesIn); // random order each page load, for the homepage strip
  REVIEWS_ALL_SORTED = imagesIn.slice().reverse(); // newest first, for the "view all" grid
  const scrollEl = document.getElementById('reviewsScroll');
  const statEl = document.getElementById('reviewsStat');
  const section = document.getElementById('reviewsSection');
  // โคลนการ์ดแรกๆ ไปต่อท้าย (มองไม่เห็นความต่าง) เพื่อให้วนกลับจุดเริ่มได้แบบไร้รอยต่อ ไม่ต้องกระตุกย้อนยาว
  const cloneCount = Math.min(REVIEWS.length, 8);
  scrollEl.innerHTML =
    REVIEWS.map((src, i) => reviewCardHTML(src, i)).join('') +
    REVIEWS.slice(0, cloneCount).map((src, i) => reviewCardHTML(src, i, true)).join('');
  if(statEl) statEl.textContent = `${REVIEWS.length}+ รีวิวจากลูกค้าจริง`;
  section.hidden = false;
  initReviewAutoScroll();
}

/* ---------- เลื่อนรีวิวอัตโนมัติทีละการ์ด ----------
   เลื่อนเอง ทุก REVIEW_AUTO_INTERVAL ms ด้วยแอนิเมชัน ease-in-out ของเราเอง (นุ่มกว่า native
   scrollBy behavior:'smooth' ซึ่งแต่ละเบราว์เซอร์ทำ easing ไม่เหมือนกัน) หยุดทันทีเมื่อลูกค้า
   แตะ/ลาก/hover เอง แล้วกลับมาเลื่อนต่ออัตโนมัติหลังไม่มีการโต้ตอบ REVIEW_RESUME_DELAY ms
   วนกลับจุดเริ่มแบบไร้รอยต่อ โดยอาศัยการ์ดโคลนท้ายแถว (ดู renderReviews ด้านบน) */
const REVIEW_AUTO_INTERVAL = 3500;
const REVIEW_STEP_DURATION = 650;
const REVIEW_RESUME_DELAY = 4000;
let reviewAutoTimer = null;
let reviewResumeTimer = null;
let reviewJumpTimer = null;
let reviewScrollRAF = null;
let reviewAutoBound = false;

function easeInOutQuad(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }
function animateScrollLeft(el, to, duration){
  cancelAnimationFrame(reviewScrollRAF);
  const from = el.scrollLeft;
  const delta = to - from;
  if(Math.abs(delta) < 1){ el.scrollLeft = to; return; }
  const start = performance.now();
  function tick(now){
    const p = Math.min((now - start) / duration, 1);
    el.scrollLeft = from + delta * easeInOutQuad(p);
    if(p < 1) reviewScrollRAF = requestAnimationFrame(tick);
  }
  reviewScrollRAF = requestAnimationFrame(tick);
}
function startReviewAutoScroll(){
  stopReviewAutoScroll();
  const scrollEl = document.getElementById('reviewsScroll');
  if(!scrollEl || !scrollEl.children.length) return;
  reviewAutoTimer = setInterval(() => {
    if(document.hidden) return;
    if(document.getElementById('reviewsAllModal')?.classList.contains('open')) return;
    if(document.getElementById('reviewLightbox')?.classList.contains('open')) return;
    const card = scrollEl.querySelector('.review-card');
    const firstClone = scrollEl.querySelector('.review-card-clone');
    if(!card) return;
    const gap = 14; // ต้องตรงกับ gap ของ .reviews-scroll ใน CSS
    const step = card.getBoundingClientRect().width + gap;
    const realWidth = firstClone ? firstClone.offsetLeft : scrollEl.scrollWidth; // ความกว้างรวมของการ์ดจริง (ไม่รวมโคลน)
    const target = scrollEl.scrollLeft + step;
    animateScrollLeft(scrollEl, target, REVIEW_STEP_DURATION);
    if(firstClone && target >= realWidth - 2){
      // เลื่อนเข้าไปในโซนโคลน (หน้าตาเหมือนจุดเริ่มทุกประการ) แล้วค่อยกระโดดกลับจุดเริ่มจริงแบบไม่มีใครสังเกต
      clearTimeout(reviewJumpTimer);
      reviewJumpTimer = setTimeout(() => { scrollEl.scrollLeft -= realWidth; }, REVIEW_STEP_DURATION + 20);
    }
  }, REVIEW_AUTO_INTERVAL);
}
// ปุ่มลูกศรซ้าย/ขวาของแถบรีวิว (จอคอมกว้าง) — เลื่อนทีละการ์ด หยุดเลื่อนอัตโนมัติชั่วคราว และวนกลับจุดเริ่มแบบไร้รอยต่อเหมือนตอนเลื่อนเอง
function reviewManualStep(dir){
  const el = document.getElementById('reviewsScroll');
  const card = el && el.querySelector('.review-card');
  if(!card) return;
  pauseReviewAutoScroll();
  const step = card.getBoundingClientRect().width + 14; // ต้องตรงกับ gap ของ .reviews-scroll
  const firstClone = el.querySelector('.review-card-clone');
  const realWidth = firstClone ? firstClone.offsetLeft : el.scrollWidth;
  // กดรัวๆ ให้นับต่อจากจุดหมายเดิมที่กำลังเลื่อนไปอยู่ (ไม่ใช่ตำแหน่งกลางทาง) จะได้เลื่อนสะสมทีละการ์ดจริง
  const now = performance.now();
  const base = (reviewManualX !== null && now - reviewManualT < 450) ? reviewManualX : el.scrollLeft;
  const target = Math.max(0, base + dir * step);
  reviewManualX = target; reviewManualT = now;
  animateScrollLeft(el, target, 450);
  if(dir > 0 && firstClone && target >= realWidth - 2){
    reviewJumpTimer = setTimeout(() => { el.scrollLeft -= realWidth; reviewManualX = null; }, 470);
  }
}
let reviewManualX = null, reviewManualT = 0;
function stopReviewAutoScroll(){
  if(reviewAutoTimer){ clearInterval(reviewAutoTimer); reviewAutoTimer = null; }
  clearTimeout(reviewJumpTimer);
  cancelAnimationFrame(reviewScrollRAF);
}
function pauseReviewAutoScroll(){
  stopReviewAutoScroll();
  clearTimeout(reviewResumeTimer);
  reviewResumeTimer = setTimeout(startReviewAutoScroll, REVIEW_RESUME_DELAY);
}
function initReviewAutoScroll(){
  const scrollEl = document.getElementById('reviewsScroll');
  if(!scrollEl) return;
  if(!reviewAutoBound){
    ['pointerdown','touchstart','wheel','mouseenter'].forEach(evt => {
      scrollEl.addEventListener(evt, pauseReviewAutoScroll, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if(document.hidden) stopReviewAutoScroll(); else startReviewAutoScroll();
    });
    reviewAutoBound = true;
  }
  startReviewAutoScroll();
}

/* ---------- "ดูรีวิวทั้งหมด": กดที่ตัวเลขจำนวนรีวิว เปิด grid เต็มจอ ---------- */
// สินค้าที่หลังบ้านผูกกับรูปรีวิวนี้ (เฉพาะสินค้าที่ยังแสดงบนหน้าร้าน)
function reviewProductsOf(src){
  return reviewTagIdsOf(src).map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
}
function reviewGridTag(src){
  const p = reviewProductsOf(src)[0];
  return p ? `<span class="review-grid-tag">${escapeHtmlText(p.name)}</span>` : '';
}
function escapeHtmlText(t){
  return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function openProductFromReview(id){
  closeReviewLightbox();
  if(document.getElementById('reviewsAllModal').classList.contains('open')) closeReviewsAll();
  openProductModal(id);
}
function renderReviewsAllGrid(){
  const grid = document.getElementById('reviewsAllGrid');
  const countEl = document.getElementById('reviewsAllCount');
  if(countEl) countEl.textContent = `${REVIEWS_ALL_SORTED.length} รูป`;
  grid.innerHTML = REVIEWS_ALL_SORTED.map((src, i) => `
    <div class="review-grid-photo" onclick="openReviewLightbox(REVIEWS_ALL_SORTED, ${i})">
      <img src="${src}" alt="รีวิวจากลูกค้า" loading="lazy" decoding="async" onerror="this.closest('.review-grid-photo').style.display='none'">${reviewGridTag(src)}
    </div>`).join('');
}
function openReviewsAll(){
  if(!REVIEWS_ALL_SORTED.length) return;
  stopReviewAutoScroll();
  renderReviewsAllGrid();
  document.getElementById('reviewsAllOverlay').classList.add('show');
  document.getElementById('reviewsAllModal').classList.add('open');
}
function closeReviewsAll(){
  document.getElementById('reviewsAllOverlay').classList.remove('show');
  document.getElementById('reviewsAllModal').classList.remove('open');
  startReviewAutoScroll();
}

/* ---------- Lightbox: ดูรูปเต็มจอ เลื่อนซ้าย-ขวาดูรูปถัดไปได้โดยไม่ต้องปิด ----------
   เปิดได้จากทั้งแถบพรีวิวหน้าแรก (REVIEWS) และ grid ดูทั้งหมด (REVIEWS_ALL_SORTED)
   จึงรับ list ที่กำลังดูอยู่เข้ามาด้วย เพื่อให้ปุ่ม/ปัดถัดไปวิ่งอยู่ใน list เดียวกับที่เปิดมา */
let currentLightboxList = [];
let currentLightboxIndex = 0;
function showLightboxImage(){
  const src = currentLightboxList[currentLightboxIndex];
  if(!src) return;
  document.getElementById('reviewLightboxImg').src = src;
  const counter = document.getElementById('reviewLightboxCounter');
  if(counter) counter.textContent = `${currentLightboxIndex + 1} / ${currentLightboxList.length}`;
  const prodBox = document.getElementById('reviewLightboxProd'); // ปุ่ม "ดูสินค้านี้" ของรูปที่ผูกสินค้าไว้
  if(prodBox){
    const prods = reviewProductsOf(src).slice(0, 2);
    prodBox.innerHTML = prods.map(p => `<button type="button" onclick="openProductFromReview(${JSON.stringify(p.id).replace(/"/g, '&quot;')})">ดูสินค้านี้: ${escapeHtmlText(p.name)} ›</button>`).join('');
    prodBox.hidden = !prods.length;
  }
  const showNav = currentLightboxList.length > 1;
  document.querySelectorAll('.review-lightbox-nav').forEach(btn => btn.style.display = showNav ? 'flex' : 'none');
}
function openReviewLightbox(list, i){
  if(!list || !list[i]) return;
  stopReviewAutoScroll();
  currentLightboxList = list;
  currentLightboxIndex = i;
  showLightboxImage();
  document.getElementById('reviewLightbox').classList.add('open');
}
function navReviewLightbox(delta){
  if(!currentLightboxList.length) return;
  currentLightboxIndex = (currentLightboxIndex + delta + currentLightboxList.length) % currentLightboxList.length;
  showLightboxImage();
}
function closeReviewLightbox(){
  document.getElementById('reviewLightbox').classList.remove('open');
  // ถ้าปิด lightbox แล้วยังอยู่ในหน้าต่าง "ดูรีวิวทั้งหมด" ไม่ต้องเลื่อนอัตโนมัติต่อ
  // (openReviewsAll ได้ stopReviewAutoScroll ไว้แล้ว, closeReviewsAll จะ start ให้เองตอนปิดจริง)
  if(!document.getElementById('reviewsAllModal').classList.contains('open')){
    startReviewAutoScroll();
  }
}
// ปัดซ้าย-ขวาบนรูปเพื่อเลื่อนดูรูปถัดไป (รูปแบบเดียวกับที่ใช้ในแกลเลอรีสินค้า)
(function(){
  let startX = 0, startY = 0;
  const el = document.getElementById('reviewLightboxImg');
  if(!el) return;
  el.addEventListener('touchstart', function(e){
    const t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY;
  }, {passive:true});
  el.addEventListener('touchend', function(e){
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5){
      navReviewLightbox(dx < 0 ? 1 : -1);
    }
  }, {passive:true});
})();
// คีย์บอร์ด: Esc ปิด, ลูกศรซ้าย-ขวาเลื่อนรูป (เฉพาะตอน lightbox เปิดอยู่)
document.addEventListener('keydown', function(e){
  const lightboxOpen = document.getElementById('reviewLightbox').classList.contains('open');
  if(e.key === 'Escape'){
    if(lightboxOpen){ closeReviewLightbox(); return; }
    if(document.getElementById('reviewsAllModal').classList.contains('open')){ closeReviewsAll(); return; }
  }
  if(lightboxOpen){
    if(e.key === 'ArrowLeft') navReviewLightbox(-1);
    if(e.key === 'ArrowRight') navReviewLightbox(1);
  }
  const promoOpen = document.getElementById('promoOverlay').classList.contains('open');
  if(promoOpen){
    if(e.key === 'Escape') closePromoPopup();
    if(e.key === 'ArrowLeft') navPromo(-1);
    if(e.key === 'ArrowRight') navPromo(1);
  }
});
loadReviews();

/* ---------- Promo popup: auto-opens on page load ----------
   แก้ไขรายการรูป/ลิงก์ที่ต้องการโปรโมทได้ตรงนี้ — เพิ่ม/ลบ/แก้ path ได้เลย
   ไฟล์ "order process.jpg" อยู่ในโฟลเดอร์ images ตามที่แจ้งไว้ */
const PROMO_SLIDES = [
  { image: 'images/orderprocess.png', alt: 'ขั้นตอนการสั่งซื้อ' }
  // เพิ่มรูปโปรโมชันอื่น ๆ ได้ เช่น:
  // { image: 'images/promo2.jpg', alt: 'โปรโมชันพิเศษ', link: 'https://m.me/yourpage' }
];
let promoIndex = 0;
function renderPromoSlides(){
  const track = document.getElementById('promoTrack');
  const dots = document.getElementById('promoDots');
  if(!track || !dots) return;
  track.innerHTML = PROMO_SLIDES.map(s => {
    const img = `<img src="${s.image}" alt="${s.alt || ''}" loading="lazy">`;
    return `<div class="promo-slide">${s.link ? `<a href="${s.link}" target="_blank" rel="noopener">${img}</a>` : img}</div>`;
  }).join('');
  dots.innerHTML = PROMO_SLIDES.length > 1
    ? PROMO_SLIDES.map((_, i) => `<span class="promo-dot${i===promoIndex?' active':''}" onclick="event.stopPropagation(); goToPromo(${i});"></span>`).join('')
    : '';
  const nav = document.querySelectorAll('#promoTrackWrap .promo-nav');
  nav.forEach(btn => btn.style.display = PROMO_SLIDES.length > 1 ? 'flex' : 'none');
  updatePromoTrackPosition();
}
function updatePromoTrackPosition(){
  const track = document.getElementById('promoTrack');
  if(!track) return;
  track.style.transform = `translateX(-${promoIndex * 100}%)`;
  document.querySelectorAll('#promoDots .promo-dot').forEach((d,i)=> d.classList.toggle('active', i===promoIndex));
}
function goToPromo(i){
  promoIndex = (i + PROMO_SLIDES.length) % PROMO_SLIDES.length;
  updatePromoTrackPosition();
}
function navPromo(delta){
  if(PROMO_SLIDES.length < 2) return;
  goToPromo(promoIndex + delta);
}
function openPromoPopup(){
  if(!PROMO_SLIDES.length) return;
  promoIndex = 0;
  renderPromoSlides();
  document.getElementById('promoOverlay').classList.add('open');
}
function closePromoPopup(e){
  // ปิดเมื่อกดปุ่ม X หรือคลิกพื้นหลังนอกกล่อง (ไม่ปิดเมื่อคลิกในรูป/การ์ด)
  if(e && e.target !== e.currentTarget) return;
  document.getElementById('promoOverlay').classList.remove('open');
}
// ปัดซ้าย-ขวาเพื่อเลื่อนสไลด์ (รูปแบบเดียวกับแกลเลอรีสินค้า/รีวิว)
(function(){
  let startX = 0, startY = 0;
  const el = document.getElementById('promoTrackWrap');
  if(!el) return;
  el.addEventListener('touchstart', function(ev){
    const t = ev.changedTouches[0];
    startX = t.clientX; startY = t.clientY;
  }, {passive:true});
  el.addEventListener('touchend', function(ev){
    const t = ev.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5){
      navPromo(dx < 0 ? 1 : -1);
    }
  }, {passive:true});
})();
// เด้งขึ้นทันทีที่เปิดหน้าเว็บ — บนมือถือเด้งแค่ครั้งแรกของแต่ละวัน (เด้งทุกครั้งทำให้ลูกค้าเห็นสินค้าช้าและรำคาญ)
// คอมพิวเตอร์ยังเด้งทุกครั้งเหมือนเดิม
(function(){
  let show = true;
  try{
    if(window.matchMedia('(max-width:859px)').matches){
      const today = new Date().toLocaleDateString('en-CA');
      if(localStorage.getItem('sfb_promo_seen') === today) show = false;
      else localStorage.setItem('sfb_promo_seen', today);
    }
  }catch(e){ show = true; }
  SITE_READY.then(() => { if(show) openPromoPopup(); });
})();

/* ---------- แถบเมนูล่าง (มือถือ) ---------- */
const CAT_ICONS = { 'ทั้งหมด':'🌷', 'ช่อดอกไม้':'💐', 'กรอบรูป':'🖼️', 'กระถาง':'🪴', 'อื่นๆ':'🎁' };
function bnavHome(){
  if(activeCats.size > 0){ scrollSpyCat = 'ทั้งหมด'; clearCategorySelection(); }
  window.scrollTo({ top:0, behavior:'smooth' });
}
function renderCatSheet(){
  const body = document.getElementById('catSheetBody');
  if(!body) return;
  const allMode = activeCats.size === 0;
  body.innerHTML = CATS.map(c => {
    const on = c === 'ทั้งหมด' ? allMode : activeCats.has(c);
    return `<button type="button" class="cat-opt${on ? ' active' : ''}" onclick="pickCatFromSheet('${c}')">
      <span class="cat-opt-ic" aria-hidden="true">${CAT_ICONS[c] || '🌸'}</span>
      <span class="cat-opt-name">${c}</span><span class="cat-opt-check" aria-hidden="true">✓</span></button>`;
  }).join('');
}
function openCatSheet(){
  renderCatSheet();
  document.getElementById('catOverlay').classList.add('open');
  document.getElementById('catSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCatSheet(){
  document.getElementById('catOverlay').classList.remove('open');
  document.getElementById('catSheet').classList.remove('open');
  document.body.style.overflow = '';
}
function pickCatFromSheet(c){ closeCatSheet(); selectCategory(c); }
function catSheetMoreFilters(){ closeCatSheet(); openFilterSheet(); }
// อัปเดตสถานะทุกช่องในแถบล่างให้ตรงกับตัวกรองจริง (เรียกจาก renderNav / updateFilterBadge / updateCartUI)
function updateBottomNav(){
  const catBtn = document.getElementById('bnavCat');
  if(!catBtn) return;
  const picked = activeCats.size > 0 ? [...activeCats][0] : '';
  // ตอนอยู่โหมด "ทั้งหมด" แสดงชื่อหมวดที่เลื่อนผ่านอยู่ (scrollspy) ให้รู้ว่าอยู่ตรงไหน
  const spy = (!picked && scrollSpyCat && scrollSpyCat !== 'ทั้งหมด') ? scrollSpyCat : '';
  document.getElementById('bnavCatLabel').textContent = picked || spy || 'หมวดหมู่';
  catBtn.classList.toggle('active', !!picked);
  const ready = document.getElementById('bnavReady');
  ready.classList.toggle('active', showReadyOnly); ready.setAttribute('aria-pressed', String(!!showReadyOnly));
  const fav = document.getElementById('bnavFav');
  fav.classList.toggle('active', showFavoritesOnly); fav.setAttribute('aria-pressed', String(!!showFavoritesOnly));
  // ตัวกรองอื่นๆ (ราคา/เรียง/ขนาด/ชนิดดอกไม้/แยกการ์ด) นอกเหนือจากหมวด+พร้อมส่ง+โปรด
  const priceOn = customPriceMin !== PRICE_SLIDER_MIN || customPriceMax !== PRICE_SLIDER_MAX;
  const extra = [priceOn, activeSortOrder !== 'none', showAllVariantsSplit, activeFlowerTypes.size > 0, activeSizes.size > 0].filter(Boolean).length;
  const cb = document.getElementById('bnavCatBadge');
  cb.textContent = extra; cb.hidden = extra === 0;
  const mc = document.getElementById('catMoreCount');
  if(mc){ mc.textContent = extra; mc.hidden = extra === 0; }
}

/* กันหน้าเว็บโยกซ้าย-ขวา: ถ้าหน้าถูกลากไปด้านข้างด้วยเหตุใดก็ตาม ให้ดีดกลับมาที่ซ้ายสุดทันที */
window.addEventListener('scroll', function(){
  if(window.scrollX !== 0) window.scrollTo(0, window.scrollY);
}, { passive:true });