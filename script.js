/* =========================================================
   S.Flower Bloom - script.js
   ระบบทั้งหมดของหน้าเว็บ: โหลดสินค้าจาก products.json, ตะกร้าสินค้า,
   ตัวเลือกสินค้า (สี/ไซซ์/ของเสริม), คำนวณราคา และระบบสั่งซื้อ
   ถูกเรียกใช้จาก index.html ผ่าน <script src="script.js" defer><\/script>
   ========================================================= */

/* ---------------- แก้ไขสินค้าตรงนี้ได้เลย ---------------- */
let PRODUCTS = []; // โหลดจาก products.json ตอนเปิดหน้าเว็บ (ดูฟังก์ชัน loadProducts ด้านล่าง)
const PAGE_LINK = 'https://m.me/S.Flower.Bloom44';
const CATALOG_CACHE_KEY = 'sfb_catalog_fallback_v1';
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
      v = currentVariant(p);
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
function exactVariantMatch(p, selection){
  return p.variants.find(v => v.match.length===selection.length && v.match.every((val,i)=>val===selection[i])) || null;
}
function matchVariant(p, selection){
  return exactVariantMatch(p, selection) || p.variants[0];
}
// เช็คว่าค่านี้ "เลือกได้" ไหมถ้าจะตั้งมิติ optIndex เป็น value โดยพิจารณาจากตัวเลือกมิติอื่นที่เลือกไว้แล้ว
// (มิติที่ยังไม่ได้เลือก sel[i]==null ถือเป็น "อะไรก็ได้" ไม่จำกัด) ใช้ตัดสินว่าปุ่มไหนควรเป็นสีเทา (ปิด)
function optionValueCompatible(p, sel, optIndex, value){
  return p.variants.some(v => v.match[optIndex]===value &&
    v.match.every((val,i)=> i===optIndex || sel[i]==null || sel[i]===val));
}
// ราคาต่ำสุด-สูงสุดของ variant ที่ยังเป็นไปได้ตามตัวเลือกที่เลือกไว้ตอนนี้ (sel เป็น null ทุกช่อง = ยังไม่เลือกอะไรเลย
// จะได้ช่วงราคาเต็มของสินค้าทั้งชิ้น) ใช้ทั้งตอนแสดงราคาในการ์ดสินค้า (min อย่างเดียว "เริ่มต้น...") และในหน้า
// รายละเอียดสินค้าตอนที่ลูกค้ายังเลือกตัวเลือกไม่ครบ (แสดงเป็นช่วง)
function optionPriceRange(p, sel){
  const s = sel || p.options.map(()=>null);
  const reachable = p.variants.filter(v => v.match.every((val,i)=> s[i]==null || s[i]===val));
  const prices = (reachable.length ? reachable : p.variants).map(v=>v.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
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
// ตัวกรองขนาด — ค่าเดียว (เลือกได้ทีละอัน) รายการตัวเลือกจะเป็น "ยูเนียน" ของทุกหมวดที่เลือกไว้อยู่
let activeSizeFilter = 'ทั้งหมด';
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
let favorites = loadFavoritesFromStorage(); // Set ของ product id
function isFavorite(id){ return favorites.has(id); }
function toggleFavorite(id){
  if(favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  renderCatalog();
  // อัปเดตหัวใจในหน้ารายละเอียดสินค้าด้วย ถ้าเปิดอยู่พอดี
  const modalHeart = document.getElementById('modalFavHeart');
  if(modalHeart && modalProductId === id){
    const fav = favorites.has(id);
    modalHeart.classList.toggle('active', fav);
    modalHeart.textContent = fav ? '♥' : '♡';
    modalHeart.setAttribute('aria-label', fav ? 'เอาออกจากรายการโปรด' : 'บันทึกไว้ในรายการโปรด');
  }
}
// สินค้าบางชิ้นอาจถูกลบออกจาก products.json ไปแล้ว — ตัดรายการโปรดที่ค้างอยู่ทิ้งไปด้วย
function pruneFavoritesAgainstProducts(){
  let changed = false;
  [...favorites].forEach(id => {
    if(!PRODUCTS.find(p => p.id === id)){ favorites.delete(id); changed = true; }
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
}
function clearSearch(){
  searchQuery = '';
  const input = document.getElementById('searchInput');
  if(input) input.value = '';
  const clearBtn = document.getElementById('searchClearBtn');
  if(clearBtn) clearBtn.style.display = 'none';
  renderCatalog();
}
function matchesSearch(p){
  if(!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return (p.name && p.name.toLowerCase().includes(q)) || (p.desc && p.desc.toLowerCase().includes(q));
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

function fmt(n){ return '฿' + n.toLocaleString('th-TH'); }

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
      <span class="filter-badge-dot" id="filterBadgeDot"></span>
    </button>` + CATS.map(c => {
    // "ทั้งหมด" ไฮไลต์เมื่อไม่ได้เลือกหมวดเจาะจงไว้เลย ส่วนหมวดอื่นไฮไลต์เมื่ออยู่ใน activeCats จริง
    // หรือ (ตอนอยู่โหมด "ทั้งหมด") เมื่อ scrollspy กำลังเลื่อนผ่านหมวดนั้นอยู่พอดี
    const isActive = c === 'ทั้งหมด' ? allMode : (activeCats.has(c) || (allMode && scrollSpyCat === c));
    return `<button class="cat-btn ${isActive?'active':''}" onclick="selectCategory('${c}')">${c}</button>`;
  }).join('');
  // เลื่อนแถบแท็บแนวนอนให้ปุ่มที่ active อยู่ในมุมมองเสมอ (เผื่อชื่อหมวดยาวจนล้นจอ)
  const activeBtn = nav.querySelector('.cat-btn.active');
  if(activeBtn) activeBtn.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
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
}
window.addEventListener('resize', updateStickyOffsets);
// เลื่อนหน้าไปบนสุดของรายการสินค้า (ใช้ร่วมกันทุกจุดที่เปลี่ยนตัวกรองแล้วอยากเลื่อนให้เห็นผลลัพธ์)
function scrollToCatalogTop(){
  const el = document.getElementById('catalog');
  if(el){
    const offset = stickyOffset() + 8;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}
// กดแท็บหมวดหมู่บนแถบ quick-nav ด้านบน = "กระโดดไปหมวดนั้นหมวดเดียว" (แทนที่ตัวเลือกหมวดเดิมทั้งหมด)
// ถ้าต้องการเลือกได้หลายหมวดพร้อมกัน ให้ใช้ชิปหมวดหมู่ในแผงตัวกรอง (toggleCategory) แทน
function selectCategory(c){
  activeCats = c === 'ทั้งหมด' ? new Set() : new Set([c]);
  activeSizeFilter = 'ทั้งหมด';
  if(c !== 'ช่อดอกไม้') activeFlowerType = 'ทั้งหมด';
  scrollSpyCat = c;
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  scrollToCatalogTop();
}
// ปุ่มหมวดหมู่ในแผงตัวกรอง (เดสก์ท็อป, live) — กดติด/ปลดได้ทีละหมวด เลือกพร้อมกันได้หลายหมวด
function toggleCategory(c){
  if(activeCats.has(c)) activeCats.delete(c); else activeCats.add(c);
  activeSizeFilter = 'ทั้งหมด';
  if(!activeCats.has('ช่อดอกไม้')) activeFlowerType = 'ทั้งหมด';
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  scrollToCatalogTop();
}
function clearCategorySelection(){
  activeCats = new Set();
  activeSizeFilter = 'ทั้งหมด';
  activeFlowerType = 'ทั้งหมด';
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
function setSize(s){
  activeSizeFilter = s;
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}

const FLOWER_TYPES = ['ทั้งหมด','ดอกไม้คละชนิด','กุหลาบ','ทานตะวัน','ทิวลิป','ไฮเดรนเยีย','เดซี่','ลิลลี่','เยอบีร่า'];
let activeFlowerType = 'ทั้งหมด';
function setFlowerType(t){
  activeFlowerType = t;
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
function applySortOrder(arr){
  if(activeSortOrder === 'asc') return arr.slice().sort((a,b)=> displayPrice(a)-displayPrice(b));
  if(activeSortOrder === 'desc') return arr.slice().sort((a,b)=> displayPrice(b)-displayPrice(a));
  return arr;
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
  } else {
    filterDraft.customMin = minVal;
    filterDraft.customMax = maxVal;
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

function buildFilterPanelHtml(state, mode){
  // mode: 'sidebar' (live — pill click applies immediately) or 'sheet' (draft)
  const setReadyFn = mode === 'sidebar' ? 'toggleReadyOnly' : 'setDraftReady';
  const setFavFn = mode === 'sidebar' ? 'toggleFavoritesOnly' : 'setDraftFavorites';
  const setFlowerFn = mode === 'sidebar' ? 'setFlowerType' : 'setDraftFlowerType';
  const setSortFn = mode === 'sidebar' ? 'setSortOrder' : 'setDraftSortOrder';
  const setAllSplitFn = mode === 'sidebar' ? 'toggleAllVariantsSplit' : 'setDraftAllSplit';
  const toggleCatFn = mode === 'sidebar' ? 'toggleCategory' : 'toggleDraftCategory';
  const clearCatFn = mode === 'sidebar' ? 'clearCategorySelection' : 'clearDraftCategorySelection';

  // หมวดหมู่ — เลือกได้มากกว่า 1 พร้อมกัน (multi-select) "ทั้งหมด" คือ "ไม่เลือกหมวดไหนเลย"
  const catHtml = CATS.map(c => {
    const isActive = c === 'ทั้งหมด' ? state.cats.size === 0 : state.cats.has(c);
    const clickFn = c === 'ทั้งหมด' ? clearCatFn + '()' : `${toggleCatFn}('${c}')`;
    return `<button class="filter-pill ${isActive?'active':''}" onclick="${clickFn}">${c}</button>`;
  }).join('');
  const priceSliderHtml = renderPriceSliderHtml(state, mode);
  const sortHtml = `
    <div class="filter-group">
      <div class="filter-group-title">เรียงตาม</div>
      <div class="filter-pills">
        <button class="filter-pill ${state.sortOrder==='asc'?'active':''}" onclick="${setSortFn}('asc')">ราคา: น้อย → มาก</button>
        <button class="filter-pill ${state.sortOrder==='desc'?'active':''}" onclick="${setSortFn}('desc')">ราคา: มาก → น้อย</button>
      </div>
    </div>`;

  // ตัวเลือกขนาด — ถ้าเลือกหลายหมวดพร้อมกัน จะรวม (union) ตัวเลือกขนาดของทุกหมวดที่เลือกไว้
  const sizeList = unionSizeList(state.cats);
  const sizeHtml = sizeList ? `
    <div class="filter-group">
      <div class="filter-group-title">📏 ขนาด</div>
      <div class="filter-pills">${sizeList.map(s =>
        `<button class="filter-pill ${((state.size||'ทั้งหมด')===s)?'active':''}" onclick="${mode==='sidebar' ? `setSize('${s}')` : `setDraftSize('${s}')`}">${s}</button>`
      ).join('')}</div>
    </div>` : '';

  const flowerHtml = state.cats.has('ช่อดอกไม้') ? `
    <div class="filter-group">
      <div class="filter-group-title">🌸 ชนิดดอกไม้</div>
      <div class="filter-pills">${FLOWER_TYPES.map(t =>
        `<button class="filter-pill ${t===state.flowerType?'active':''}" onclick="${setFlowerFn}('${t}')">${t}</button>`
      ).join('')}</div>
    </div>` : '';

  return `
    <div class="filter-group">
      <div class="filter-group-title">หมวดหมู่</div>
      <div class="filter-pills">${catHtml}</div>
    </div>
    <div class="filter-group">
      <div class="filter-group-title">ช่วงราคา</div>
      ${priceSliderHtml}
    </div>
    ${sortHtml}
    ${sizeHtml}
    ${flowerHtml}
    <div class="filter-group">
      <label class="filter-ready-toggle">
        <input type="checkbox" ${state.ready?'checked':''} onchange="${setReadyFn}(this.checked)"> ⚡ พร้อมส่งเท่านั้น
      </label>
      <label class="filter-ready-toggle" style="margin-top:8px;">
        <input type="checkbox" ${state.favorites?'checked':''} onchange="${setFavFn}(this.checked)"> ❤️ รายการโปรดเท่านั้น
      </label>
      <label class="filter-ready-toggle" style="margin-top:8px;">
        <input type="checkbox" ${state.allSplit?'checked':''} onchange="${setAllSplitFn}(this.checked)"> 🧾 ดูสินค้าทั้งหมด (แยกทุกสี/แบบ)
      </label>
    </div>
  `;
}

// Desktop sidebar — always visible, applies every change immediately (no apply button needed)
function renderFilterSidebar(){
  const el = document.getElementById('filterSidebar');
  if(!el) return;
  const state = {
    cats: activeCats,
    customMin: customPriceMin,
    customMax: customPriceMax,
    sortOrder: activeSortOrder,
    ready: showReadyOnly,
    favorites: showFavoritesOnly,
    allSplit: showAllVariantsSplit,
    size: activeSizeFilter,
    flowerType: activeFlowerType
  };
  el.innerHTML = `<div class="filter-sidebar-head">
      <h4 class="filter-sidebar-title">ตัวกรองสินค้า</h4>
      <button class="filter-sidebar-clear" onclick="clearSidebarFilters()">ล้างตัวกรอง</button>
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
  activeSizeFilter = 'ทั้งหมด';
  activeFlowerType = 'ทั้งหมด';
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
}

// Mobile bottom sheet — stages changes in filterDraft until "แสดงผลลัพธ์" is tapped
function renderFilterSheetBody(){
  const body = document.getElementById('filterSheetBody');
  if(body) body.innerHTML = buildFilterPanelHtml(filterDraft, 'sheet');
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
    size: activeSizeFilter,
    flowerType: activeFlowerType
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
  if(filterDraft.cats.has(c)) filterDraft.cats.delete(c); else filterDraft.cats.add(c);
  filterDraft.size = 'ทั้งหมด';
  if(!filterDraft.cats.has('ช่อดอกไม้')) filterDraft.flowerType = 'ทั้งหมด';
  renderFilterSheetBody();
}
function clearDraftCategorySelection(){
  filterDraft.cats = new Set();
  filterDraft.size = 'ทั้งหมด';
  filterDraft.flowerType = 'ทั้งหมด';
  renderFilterSheetBody();
}
function setDraftReady(checked){ filterDraft.ready = checked; renderFilterSheetBody(); }
function setDraftFavorites(checked){ filterDraft.favorites = checked; renderFilterSheetBody(); }
function setDraftSize(s){ filterDraft.size = s; renderFilterSheetBody(); }
function setDraftFlowerType(t){ filterDraft.flowerType = t; renderFilterSheetBody(); }
function clearFilterDraft(){
  filterDraft = { cats:new Set(), customMin:PRICE_SLIDER_MIN, customMax:PRICE_SLIDER_MAX, sortOrder:'none', ready:false, favorites:false, allSplit:false, size:'ทั้งหมด', flowerType:'ทั้งหมด' };
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
  activeSizeFilter = filterDraft.size;
  activeFlowerType = filterDraft.flowerType;
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
  if(!dot) return;
  const priceActive = customPriceMin !== PRICE_SLIDER_MIN || customPriceMax !== PRICE_SLIDER_MAX;
  const isActive = activeCats.size > 0 || priceActive || activeSortOrder !== 'none' || showReadyOnly || showFavoritesOnly || showAllVariantsSplit || activeFlowerType !== 'ทั้งหมด' || activeSizeFilter !== 'ทั้งหมด';
  dot.classList.toggle('show', isActive);
}

// A product "มีตัวเลือกสินค้า" if the customer has to pick between colors,
// sizes, or a bill count before the price/line item is final.
function hasProductOptions(p){
  return !!(p.colors || p.sizes || p.billSelector || hasNewOptions(p));
}
function favHeartHtml(id){
  const active = isFavorite(id);
  return `<button type="button" class="fav-heart ${active?'active':''}" onclick="event.stopPropagation(); toggleFavorite('${id}')" aria-label="${active?'เอาออกจากรายการโปรด':'บันทึกไว้ในรายการโปรด'}">${active?'♥':'♡'}</button>`;
}
// variant (optional): { colorIndex } หรือ { optionIndex } หรือ { sizeIndex } — ใช้เมื่อการ์ดนี้เป็น
// "การ์ดย่อยที่แตกตามสี/ตัวเลือก/ขนาด" ในโซนสินค้าแนะนำ — จะโชว์รูป/ชื่อ/ราคาของตัวเลือกนั้นๆ ตรงๆ
// (ไม่ผูกกับตัวเลือกที่ลูกค้าเลือกไว้ในสถานะกลาง) และเปิดหน้าสินค้าพร้อม pre-select ตัวเลือกนั้นให้ทันที
// ส่วนการ์ดปกติ (variant เป็น undefined) ทำงานเหมือนเดิมทุกอย่าง
function renderProductCard(p, variant){
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
    priceHtml = (p.billSelector || hasNewOptions(p)) ? `เริ่มต้น ${fmt(displayPrice(p))}` : fmt(displayPrice(p));
  }
  // เดิมการ์ดย่อย (isSplit) จะถือว่าพร้อมส่งเสมอ เพราะ readyVariantsOf() คัดมาแต่ตัวที่พร้อมส่งอยู่แล้ว
  // แต่ allVariantsOf() (โหมด "ดูสินค้าทั้งหมด") ส่งมาทั้งที่พร้อมส่งและยังไม่พร้อม จึงต้องเช็คสถานะ
  // ของ "ตัวเลือกนั้นๆ" ตรงๆ แทนที่จะเหมารวมเป็น true เสมอ
  let isReady;
  if(variantOption) isReady = !!variantOption.ready;
  else if(variantSize) isReady = !!variantSize.ready;
  else if(variantColor) isReady = typeof variantColor.ready !== 'undefined' ? !!variantColor.ready : !!p.ready;
  else isReady = currentReadyState(p);
  const clickHandler = `openProductModal('${p.id}', ${colorIndex}, ${optionIndex}, ${sizeIndex})`;
  return `
    <div class="card" onclick="${clickHandler}">
      <div class="thumb-wrap">
        <div class="thumb">${thumbHtml}</div>
        ${isReady ? '<span class="badge-ready">พร้อมส่ง</span>' : ''}
        ${p.isNew ? '<span class="badge-new">ใหม่</span>' : ''}
        ${favHeartHtml(p.id)}
      </div>
      <div class="card-body">
        <h4>${displayName}</h4>
        <p class="desc">${p.desc || ''}</p>
        <div class="price-row">
          <span class="price">${priceHtml}</span>
        </div>
        ${(!isSplit && hasProductOptions(p)) ? '<span class="option-badge">เลือกแบบ/สีได้</span>' : ''}
      </div>
    </div>
  `;
}
function renderCatalog(){
  const main = document.getElementById('catalog');
  const range = activePriceBounds();
  let totalMatches = 0;
  let html = '';

  // "ทั้งหมด" (ไม่เลือกหมวดเจาะจง) = เรียกดูทุกอย่างเหมือนเดิม (การ์ดแนะนำ + ทุกหมวดเรียงต่อกัน)
  // เลือกหมวดเจาะจงไว้ (หนึ่งหมวดหรือหลายหมวด) = กรองจริง โชว์เฉพาะหมวดที่เลือก
  // โซน "สินค้าแนะนำ" จะไม่โชว์เมื่อเปิดโหมด "ดูสินค้าทั้งหมด" (การ์ดแยกครบทุกแบบอยู่ในแต่ละหมวดอยู่แล้ว)
  if(activeCats.size === 0 && !showAllVariantsSplit){
    // เรียงลำดับ/กรองที่ระดับ "สินค้า" ก่อน (ราคาไม่ต่างกันตามสี) แล้วค่อยแตกแต่ละสินค้า
    // เป็นการ์ดย่อยตามสีที่พร้อมส่งจริง — สินค้าที่พร้อมส่งทั้งชิ้น/ไม่มีสี ยังเป็น 1 การ์ดเหมือนเดิม
    const readyProducts = PRODUCTS.filter(p =>
      productHasAnyReady(p)
      && matchesSearch(p)
      && (!showFavoritesOnly || isFavorite(p.id))
      && (displayPrice(p) >= range.min && displayPrice(p) <= range.max)
    );
    const recommended = applySortOrder(readyProducts).flatMap(readyVariantsOf);
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
  html += catsToRender.map(cat => {
    const sizeList = CATEGORY_SIZES[cat];
    const currentSize = activeSizeFilter;
    const matched = applySortOrder(PRODUCTS.filter(p =>
      p.cat === cat
      && matchesSearch(p)
      && (!sizeList || currentSize === 'ทั้งหมด' || sizeTagsOf(p).includes(currentSize))
      && (cat !== 'ช่อดอกไม้' || activeFlowerType === 'ทั้งหมด' || p.flowerType === activeFlowerType)
      && (!showReadyOnly || productHasAnyReady(p))
      && (!showFavoritesOnly || isFavorite(p.id))
      && (displayPrice(p) >= range.min && displayPrice(p) <= range.max)
    ));
    // โหมด "ดูสินค้าทั้งหมด": แตกสินค้าทุกชิ้นที่มีสี/ตัวเลือก/ไซซ์ออกเป็นการ์ดย่อยรายตัว
    // (เหมือนโซนสินค้าแนะนำ) แทนที่จะโชว์การ์ดเดียวต่อสินค้าแบบปกติ
    const items = showAllVariantsSplit ? matched.flatMap(allVariantsOf) : matched;
    totalMatches += items.length;
    const body = !items.length ? `
      <div class="section-title"><h3>${cat}</h3><span>0 รายการ</span></div>
    ` : `
      <div class="section-title"><h3>${cat}</h3><span>${items.length} รายการ</span></div>
      <div class="grid">
        ${showAllVariantsSplit
          ? items.map(v => renderProductCard(v.product, v)).join('')
          : items.map(p => renderProductCard(p)).join('')}
      </div>
    `;
    return `<div class="cat-section" id="${catSectionId(cat)}" data-cat="${cat}">${body}</div>`;
  }).join('');

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
    main.innerHTML = html;
  }
  setupScrollSpy();
}

function addToCart(id){
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  if(p.billSelector){ openProductModal(id); return; }
  // สินค้าระบบ options ใหม่มีหลายมิติให้เลือกครบก่อนถึงจะสรุปราคาได้ — เปิดหน้ารายละเอียดให้เลือกแทนการเพิ่มจากการ์ดตรงๆ
  if(hasNewOptions(p)){ openProductModal(id); return; }
  let label = null, price = p.price;
  if(p.colors){ label = p.colors[resolvedColorIndex(p)].name; }
  if(p.sizes){
    const sv = p.sizes[selectedSizeVariant[id]||0];
    label = label ? `${label}, ${sv.name}` : sv.name;
    price = sv.price;
  }
  const key = cartKeyOf(id, label);
  if(cart[key]) cart[key].qty += 1;
  else cart[key] = { qty:1, unitPrice:price, label };
  updateCartUI();
  showToast('เพิ่มลงตะกร้าแล้ว 🌸');
  const btn = document.getElementById('add-'+id);
  if(btn){
    btn.classList.add('added'); btn.textContent = '✓';
    setTimeout(()=>{ btn.classList.remove('added'); btn.textContent='🧺'; }, 900);
  }
}
function changeQty(key, delta){
  if(!cart[key]) return;
  cart[key].qty += delta;
  if(cart[key].qty <= 0) delete cart[key];
  updateCartUI();
}
function removeItem(key){ delete cart[key]; updateCartUI(); }

function cartCount(){ return Object.values(cart).reduce((a,e)=>a+e.qty,0); }
function cartTotal(){
  return Object.values(cart).reduce((sum,e)=> sum + e.unitPrice*e.qty, 0);
}

function updateCartUI(){
  saveCart();
  document.getElementById('cartBadge').textContent = cartCount();
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
        <div class="cart-item">
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
  if(count > 0){
    fab.style.display = 'flex';
    document.getElementById('fabCount').textContent = count;
    document.getElementById('fabTotal').textContent = fmt(cartTotal());
  } else {
    fab.style.display = 'none';
  }
}

function openCart(){
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  updateChatFabVisibility();
}
function closeCart(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  updateChatFabVisibility();
}

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
function buildSingleProductLines(id){
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return null;
  let label = null, price = p.price;
  if(hasNewOptions(p)){
    const sel = currentOptionSelection(p);
    label = sel.join(', ');
    price = matchVariant(p, sel).price;
  } else {
    if(p.colors){ label = p.colors[resolvedColorIndex(p)].name; }
    if(p.sizes){
      const sv = p.sizes[selectedSizeVariant[id]||0];
      label = label ? `${label}, ${sv.name}` : sv.name;
      price = sv.price;
    }
  }
  const lines = [`• ${p.name}${label ? ` (${label})` : ''} x1 = ${fmt(price)}`];
  const items = [{ id:p.id, name:p.name, label:label||'', qty:1, unitPrice:price, lineTotal:price }];
  return { lines, items, subtotal: price };
}
function quickOrder(id){
  startCheckout(() => buildSingleProductLines(id));
}
function startCheckout(builderFn){
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
  updateChatFabVisibility();
}
function closeOrderSummary(){
  document.getElementById('orderSummaryModal').classList.remove('open');
  document.getElementById('summaryOverlay').classList.remove('show');
  updateChatFabVisibility();
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
let modalSelectedAddons = new Set(); // ชื่อตัวเลือกเสริม (addon) ที่ลูกค้าติ๊กไว้ในหน้ารายละเอียดสินค้า — เลือกได้พร้อมกันหลายตัว, รีเซ็ตทุกครั้งที่เปลี่ยนสีหรือเปิดสินค้าใหม่

// Returns the list of photo URLs to show for the product's current selection.
// A "sizes" variant (e.g. ปกติ vs ใส่ซองเงิน, which also changes the price) can carry
// its own "image"/"images" too — checked FIRST, since a size choice like "ใส่ซองเงิน"
// should always show the money-envelope photo regardless of which color is selected.
// Falls back to the selected color's own image, then the product-level images/image.
// Existing products with just one "image" keep working unchanged — the
// gallery/thumbnails simply don't appear when there's only one photo.
function currentGalleryImages(p){
  if(hasNewOptions(p)){
    const v = currentVariant(p);
    if(v){
      if(v.images && v.images.length) return v.images;
      if(v.image) return [v.image];
    }
  }
  if(p.sizes && p.sizes.length){
    const sv = p.sizes[selectedSizeVariant[p.id] || 0];
    if(sv){
      if(sv.images && sv.images.length) return sv.images;
      if(sv.image) return [sv.image];
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
      if(c.images && c.images.length) return c.images;
      if(c.image) return [c.image];
    }
  }
  // สินค้าที่ไม่มีสีเลยแต่มีตัวเลือกเสริมของตัวเอง (เช่น กรอบรูป + กล่องใส่กรอบรูป)
  if(!p.colors && p.addons && p.addons.length){
    const chosen = p.addons.find(a => modalSelectedAddons.has(a.name) && a.image);
    if(chosen) return [chosen.image];
  }
  if(p.images && p.images.length) return p.images;
  if(p.image) return [p.image];
  return [];
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
  wrap.innerHTML = imgs.map((src, i) => `
    <button type="button" class="gallery-thumb ${i===modalImgIndex?'active':''}" onclick="setModalImgIndex(${i})" aria-label="ดูรูปที่ ${i+1}">
      <img src="${src}" alt="${p.name} มุมที่ ${i+1}" loading="lazy" decoding="async" onerror="this.closest('.gallery-thumb').style.display='none'">
    </button>
  `).join('');
}
function setModalImgIndex(i){
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

// Full-page product view (not a floating pop-up) — behaves like a real "page" so the
// device/browser back button closes it and returns to the catalog, like a native app.
// colorIndex/optionIndex/sizeIndex (optional): มาจากการ์ดย่อยที่แตกตามสี/ตัวเลือก/ขนาด
// ในโซน "สินค้าแนะนำ" — เปิดหน้าสินค้าพร้อม pre-select ตัวเลือกนั้นทันที ลูกค้าจะไม่เจอ
// ตัวเลือกอื่นก่อนตัวที่กดเข้ามาจากการ์ดนั้น
function openProductModal(id, colorIndex, optionIndex, sizeIndex){
  modalProductId = id;
  modalQty = 1;
  modalImgIndex = 0;
  modalSelectedAddons = new Set();
  const p = PRODUCTS.find(x=>x.id===id);
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
  }
  renderModal();
  const page = document.getElementById('productModal');
  page.classList.add('open');
  const scrollArea = document.getElementById('productPageScroll');
  if(scrollArea) scrollArea.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ productPage:true }, '', '#product');
  updateChatFabVisibility();
}
function closeProductModal(fromPopState){
  const page = document.getElementById('productModal');
  if(!page.classList.contains('open')) return;
  page.classList.remove('open');
  document.body.style.overflow = '';
  modalProductId = null;
  updateChatFabVisibility();
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
  renderModalThumbs(p);
  document.getElementById('modalName').textContent = p.name;
  const modalHeart = document.getElementById('modalFavHeart');
  if(modalHeart){
    const fav = isFavorite(p.id);
    modalHeart.classList.toggle('active', fav);
    modalHeart.textContent = fav ? '♥' : '♡';
    modalHeart.setAttribute('aria-label', fav ? 'เอาออกจากรายการโปรด' : 'บันทึกไว้ในรายการโปรด');
  }
  document.getElementById('modalDesc').textContent = p.desc;
  document.getElementById('modalQty').textContent = modalQty;
  document.getElementById('modalBadges').innerHTML =
    (currentReadyState(p) ? '<span class="badge-inline ready">พร้อมส่ง</span>' : '') +
    (p.isNew ? '<span class="badge-inline new">ใหม่</span>' : '');

  const colorsWrap = document.getElementById('modalColors');
  if(p.colors){
    colorsWrap.innerHTML = p.colors.map((c,i)=>`
      <button class="color-chip ${(resolvedColorIndex(p)===i)?'active':''}" onclick="modalImgIndex=0; modalSelectedAddons=new Set(); selectColor('${p.id}',${i}); renderModal();">${c.name}</button>
    `).join('');
  } else {
    colorsWrap.innerHTML = '';
  }

  const sizesWrap = document.getElementById('modalSizes');
  if(p.sizes){
    sizesWrap.innerHTML = p.sizes.map((s,i)=>`
      <button class="color-chip ${((selectedSizeVariant[p.id]||0)===i)?'active':''}" onclick="modalImgIndex=0; selectSizeVariant('${p.id}',${i}); renderModal();">${s.name}</button>
    `).join('');
  } else {
    sizesWrap.innerHTML = '';
  }

  // ตัวเลือกเสริมแบบมีราคา (เช่น "เพิ่มผึ้งน้อย +20 บาท") — โผล่เฉพาะตอนสีที่เลือกอยู่ประกาศ .addons ไว้
  // แสดงเป็นปุ่มชิพเหมือนปุ่มเลือกสี กดติดได้หลายปุ่มพร้อมกัน (เผื่อมี addon มากกว่า 1 ตัวในอนาคต)
  const addonWrap = document.getElementById('modalAddons');
  if(addonWrap){
    const addons = currentAddonSource(p);
    if(addons && addons.length){
      addonWrap.style.display = '';
      addonWrap.innerHTML = addons.map(a => `
        <button type="button" class="color-chip ${modalSelectedAddons.has(a.name)?'active':''}" onclick="toggleModalAddon('${a.name}', ${!modalSelectedAddons.has(a.name)})">➕ ${a.name} (+${a.price}฿)</button>
      `).join('');
    } else {
      addonWrap.style.display = 'none';
      addonWrap.innerHTML = '';
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
          <div style="font-size:12.5px; color:var(--plum); font-weight:600; margin:10px 0 4px;">${opt.name}</div>
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
  // ยังเลือกตัวเลือกไม่ครบทุกมิติ — โชว์เป็นช่วงราคา (ต่ำสุด-สูงสุด) ของชุดที่ยังเป็นไปได้ตามที่เลือกไว้แล้ว
  // แทนที่จะเดาราคาจาก variant ใดตัวหนึ่งไปก่อน เพราะยังไม่รู้ว่าลูกค้าจะเลือกจบที่ชุดไหน
  if(hasNewOptions(p) && !hasFullOptionSelection(p, currentOptionSelection(p))){
    const { min, max } = optionPriceRange(p, currentOptionSelection(p));
    priceEl.innerHTML = min === max
      ? `${fmt(min)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>`
      : `${fmt(min)} - ${fmt(max)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>`;
    return;
  }
  const unitPrice = currentModalVariant(p).unitPrice;
  if(modalQty > 1){
    priceEl.innerHTML = `${fmt(unitPrice)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span> × ${modalQty} = <strong>${fmt(unitPrice * modalQty)}</strong>`;
  } else {
    priceEl.innerHTML = `${fmt(unitPrice)} <span style="font-size:13px; font-weight:500; color:var(--plum);">/ ช่อ</span>`;
  }
}
function currentModalVariant(p){
  if(p.billSelector) return { label:`ใส่ธนบัตร ${modalBills} ใบ`, unitPrice: unitPriceFor(p, modalBills) };
  if(hasNewOptions(p)){
    const sel = currentOptionSelection(p);
    const v = matchVariant(p, sel);
    return { label: sel.join(', '), unitPrice: v.price };
  }
  let label = null, unitPrice = p.price;
  if(p.colors){
    const c = p.colors[resolvedColorIndex(p)];
    label = c.name;
  }
  const addons = currentAddonSource(p);
  if(addons && addons.length){
    const chosen = addons.filter(a => modalSelectedAddons.has(a.name));
    if(chosen.length){
      const names = chosen.map(a => a.name);
      label = label ? [label, ...names].join(' + ') : names.join(' + ');
      unitPrice += chosen.reduce((sum,a) => sum + a.price, 0);
    }
  }
  if(p.sizes){
    const sv = p.sizes[selectedSizeVariant[p.id]||0];
    label = label ? `${label}, ${sv.name}` : sv.name;
    unitPrice = sv.price;
  }
  return { label, unitPrice };
}
function addModalToCart(){
  const p = PRODUCTS.find(x=>x.id===modalProductId);
  if(!p) return;
  if(warnIfInvalidOptionSelection(p)) return;
  const { label, unitPrice } = currentModalVariant(p);
  const key = cartKeyOf(p.id, label);
  if(cart[key]) cart[key].qty += modalQty;
  else cart[key] = { qty:modalQty, unitPrice, label };
  updateCartUI();
  showToast('เพิ่มลงตะกร้าแล้ว 🌸');
  closeProductModal();
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
  const list = typeof data.json === 'string' ? JSON.parse(data.json) : data.list;
  return (Array.isArray(list) && list.length) ? list : null;
}

function saveCatalogFallback(list){
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), list }));
  } catch(err) {
    console.warn('บันทึกแคตตาล็อกสำรองในเครื่องไม่สำเร็จ:', err);
  }
}

function readCatalogFallback(){
  try {
    const saved = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null');
    return Array.isArray(saved?.list) && saved.list.length ? saved.list : null;
  } catch(err) {
    return null;
  }
}

async function loadProducts(){
  const catalogEl = document.getElementById('catalog');
  // ลอง Firestore ก่อน แต่ไม่ยอมรอเกิน 6 วินาที ไม่งั้นเน็ตช้าจะค้างหน้าร้านทั้งหน้า
  try{
    const fromCloud = await Promise.race([
      fetchProductsFromFirestore(),
      new Promise(resolve => setTimeout(() => resolve(null), 6000))
    ]);
    if(fromCloud){
      PRODUCTS = fromCloud;
      saveCatalogFallback(PRODUCTS);
      finishLoadingProducts();
      return;
    }
  } catch(err){
    console.warn('ดึงสินค้าจาก Firestore ไม่สำเร็จ จะใช้ products.json แทน:', err);
  }
  try{
    const res = await fetch('products.json');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    PRODUCTS = await res.json();
    saveCatalogFallback(PRODUCTS);
  } catch(err){
    const cached = readCatalogFallback();
    if(cached){
      PRODUCTS = cached;
      finishLoadingProducts();
      return;
    }
    catalogEl.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--rose-dark);">
        <p style="font-size:16px; font-weight:700; margin-bottom:8px;">⚠️ โหลดข้อมูลสินค้าไม่สำเร็จ</p>
        <p style="font-size:13.5px; color:var(--plum);">กรุณาตรวจสอบว่าไฟล์ products.json อยู่ในโฟลเดอร์เดียวกับเว็บไซต์<br>และเปิดเว็บผ่านลิงก์จริง ไม่ใช่การดับเบิลคลิกเปิดไฟล์โดยตรง</p>
      </div>`;
    console.error('โหลด products.json ไม่สำเร็จ:', err);
    return;
  }
  finishLoadingProducts();
}

/* ขั้นตอนหลังได้ข้อมูลสินค้ามาแล้ว ใช้ร่วมกันทั้งทาง Firestore และ products.json */
function finishLoadingProducts(){
  pruneCartAgainstProducts();
  pruneFavoritesAgainstProducts();
  renderNav();
  renderCatalog();
  renderFilterSidebar();
  updateFilterBadge();
  updateCartUI();
  loadSavedFbName();
}
loadProducts();

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
async function loadReviews(){
  // เช็คทีละ batch (เรียงเลขไฟล์น้อยไปมาก) แล้วหยุดทันทีที่เจอ batch ที่ไม่มีไฟล์เลยสักไฟล์เดียว —
  // เพราะไฟล์รีวิวตั้งชื่อเรียงเลขต่อเนื่องไม่มีช่องว่าง (ดูคอมเมนต์ด้านบน) ถ้ามีรีวิวแค่ 15 รูป
  // ก็จะเช็คแค่ batch แรก (20 ไฟล์) แล้วหยุด แทนที่จะยิง 200 request ทุกครั้ง
  const found = [];
  for(let start = 1; start <= MAX_REVIEWS; start += REVIEW_BATCH_SIZE){
    const end = Math.min(start + REVIEW_BATCH_SIZE - 1, MAX_REVIEWS);
    const checks = [];
    for(let i = start; i <= end; i++){
      checks.push(checkImageExists(`images/reviews/review${i}.jpg`));
    }
    const results = await Promise.all(checks);
    const batchFound = results.filter(Boolean);
    found.push(...batchFound);
    if(batchFound.length === 0) break;
  }
  if(found.length === 0) return;
  renderReviews(found);
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
function renderReviewsAllGrid(){
  const grid = document.getElementById('reviewsAllGrid');
  const countEl = document.getElementById('reviewsAllCount');
  if(countEl) countEl.textContent = `${REVIEWS_ALL_SORTED.length} รูป`;
  grid.innerHTML = REVIEWS_ALL_SORTED.map((src, i) => `
    <div class="review-grid-photo" onclick="openReviewLightbox(REVIEWS_ALL_SORTED, ${i})">
      <img src="${src}" alt="รีวิวจากลูกค้า" loading="lazy" decoding="async" onerror="this.closest('.review-grid-photo').style.display='none'">
    </div>`).join('');
}
function openReviewsAll(){
  if(!REVIEWS_ALL_SORTED.length) return;
  stopReviewAutoScroll();
  renderReviewsAllGrid();
  document.getElementById('reviewsAllOverlay').classList.add('show');
  document.getElementById('reviewsAllModal').classList.add('open');
  updateChatFabVisibility();
}
function closeReviewsAll(){
  document.getElementById('reviewsAllOverlay').classList.remove('show');
  document.getElementById('reviewsAllModal').classList.remove('open');
  startReviewAutoScroll();
  updateChatFabVisibility();
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
  updateChatFabVisibility();
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
  updateChatFabVisibility();
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
  { image: 'images/orderprocess.png', alt: 'ขั้นตอนการสั่งซื้อ' },
  { image: 'images/promotions.png', alt: 'โปรโมชั่น' }
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
  updateChatFabVisibility();
}
function closePromoPopup(e){
  // ปิดเมื่อกดปุ่ม X หรือคลิกพื้นหลังนอกกล่อง (ไม่ปิดเมื่อคลิกในรูป/การ์ด)
  if(e && e.target !== e.currentTarget) return;
  document.getElementById('promoOverlay').classList.remove('open');
  updateChatFabVisibility();
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
// เด้งขึ้นทันทีที่เปิดหน้าเว็บ
openPromoPopup();

/* ---------- Chat button ---------- */
function closeChatBubble(){
  const b = document.getElementById('chatBubble');
  if(!b || b.style.display === 'none') return;
  b.classList.add('chat-bubble-hide');
  setTimeout(()=>{ b.style.display = 'none'; }, 350);
}
// เด้งข้อความชวนแชทขึ้นมาสักพัก แล้วหายไปเองอัตโนมัติหลังจาก 5 วินาที
// (ถ้าลูกค้ากดปิดเองก่อนหน้านั้น closeChatBubble ด้านบนจะจัดการให้ ไม่ซ้ำซ้อนกัน)
setTimeout(closeChatBubble, 5000);
/* ซ่อนปุ่มแชทลอยทุกครั้งที่มีป็อปอัพ/ตะกร้าเปิดอยู่ ป้องกันไปบังปุ่มหรือช่องกรอกข้อมูล */
function updateChatFabVisibility(){
  const wrap = document.getElementById('chatFabWrap');
  if(!wrap) return;
  const anyOpen =
    document.getElementById('drawer').classList.contains('open') ||
    document.getElementById('productModal').classList.contains('open') ||
    document.getElementById('orderSummaryModal').classList.contains('open') ||
    document.getElementById('reviewsAllModal').classList.contains('open') ||
    document.getElementById('reviewLightbox').classList.contains('open') ||
    document.getElementById('promoOverlay').classList.contains('open');
  wrap.style.display = anyOpen ? 'none' : '';
}
