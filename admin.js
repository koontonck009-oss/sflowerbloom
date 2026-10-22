/* =========================================================
   S.Flower Bloom - admin.js
   หลังบ้านจัดการสินค้า: ล็อกอิน, เพิ่ม/แก้ไข/ลบสินค้า, จัดการสี ไซซ์
   ตัวเลือกหลายชั้น และของเสริม แล้วบันทึกขึ้น Firestore

   ข้อมูลทั้งหมดเก็บเป็น "ข้อความ JSON ก้อนเดียว" ในเอกสาร catalog/products
   เหตุผล: หน้าร้านอ่านแค่ครั้งเดียวต่อการเปิดเว็บ 1 ครั้ง (ไม่ใช่ 96 ครั้ง)
   โควต้าฟรีของ Firebase จึงเหลือเฟือ และโครงสร้างข้อมูลเหมือน products.json เป๊ะ
   ========================================================= */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const FIRESTORE_DOC_LIMIT = 1048576; // 1 MB ต่อเอกสาร

let fb = null;           // { auth, db, authApi, dbApi }
let catalog = [];        // รายการสินค้าทั้งหมด
let reviewHidden = new Set(); // รูปรีวิวที่ "ลบออกจากเว็บ" (ซ่อน) เก็บในช่อง reviewsJson คีย์ __hidden
let reviewTags = {};      // ป้ายสินค้าของรูปรีวิว { 'review12.jpg': ['s13'] } เก็บในเอกสารเดียวกับสินค้า (ช่อง reviewsJson)
let pricesHidden = false; // สวิตช์ "ซ่อนราคาบนหน้าร้าน" (เก็บในเอกสาร catalog/products ช่อง hidePrices)
let draft = null;        // สินค้าที่กำลังแก้ไขอยู่
let draftIndex = -1;     // -1 = สินค้าใหม่
let filterCat = 'ทั้งหมด';
let filterFlower = '';   // '' = ทุกชนิด · '__none__' = ช่อดอกไม้ที่ยังไม่ระบุชนิด · '__off__' = ชนิดนอกรายการหน้าร้าน · อื่นๆ = ชื่อชนิด
let searchTerm = '';
// มุมมองสินค้า: 'grid' (การ์ดเหมือนหน้าร้าน — ค่าเริ่มต้น) หรือ 'list' (ตาราง) จำค่าที่เลือกไว้ในเบราว์เซอร์
let viewMode = 'grid';
try{ if(localStorage.getItem('sfb_admin_view') === 'list') viewMode = 'list'; }catch(_){}
let confirmResolve = null;
let listScrollY = 0;
const selected = new Set();   // ดัชนีสินค้าที่ติ๊กเลือกในตาราง
const expanded = new Set();   // รหัสสินค้าที่กางดู "แบบทั้งหมด" อยู่ในหน้ารายการ

const $ = id => document.getElementById(id);

/* ───────────────── ตัวช่วยเล็กๆ ───────────────── */

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function clone(o){ return JSON.parse(JSON.stringify(o)); }

function num(v){
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function baht(n){ return Number(n).toLocaleString('th-TH'); }

// p.size ใช้เป็นตัวกรอง "ขนาด" ในหน้าร้าน ตอนนี้รองรับได้ทั้ง string เดี่ยว (สินค้าเก่า) หรือ array
// ของหลายค่า (สินค้าที่ติดได้มากกว่า 1 ป้าย เช่น "กลาง, ใส่เงิน") — สองฟังก์ชันนี้แปลงไปมาให้สม่ำเสมอ
function sizeTagsOf(p){
  if(!p || !p.size) return [];
  return Array.isArray(p.size) ? p.size : [p.size];
}
function sizeTagText(p){ return sizeTagsOf(p).join(', '); }
// ชนิดดอกไม้ที่หน้าร้านกรองได้ — อ่านจาก window.FLOWER_TYPES ใน firebase-config.js (แหล่งเดียวกับหน้าร้าน เพิ่มชนิดใหม่แก้ที่นั่นที่เดียว)
// ใช้ได้กับทุกหมวด — หน้าร้านจะโชว์ตัวกรองชนิดดอกไม้ให้หมวดที่มีสินค้าตั้งค่านี้ไว้ (ช่อดอกไม้โชว์เสมอ)
const FLOWER_TYPE_TAGS = Array.isArray(window.FLOWER_TYPES) ? window.FLOWER_TYPES.slice() : [];
// สถานะชนิดดอกไม้ของสินค้า: 'ok' | 'none' (ช่อดอกไม้ที่ยังไม่ระบุ) | 'off' (ค่านอกรายการหน้าร้าน) | 'skip' (หมวดอื่นที่ไม่มีค่า)
function flowerStateOf(p){
  const t = String(p.flowerType ?? '').trim();
  if(!t) return p.cat === 'ช่อดอกไม้' ? 'none' : 'skip';
  return FLOWER_TYPE_TAGS.includes(t) ? 'ok' : 'off';
}
function flowerMatchesFilter(p, f){
  if(!f) return true;
  if(f === '__none__') return flowerStateOf(p) === 'none';
  if(f === '__off__') return flowerStateOf(p) === 'off';
  return String(p.flowerType ?? '').trim() === f;
}
// ตัวเลือก "ขนาด/ป้ายกำกับ" ของแต่ละหมวด — ค่าด้านล่างเป็นค่าเริ่มต้น ใช้เมื่อยังไม่เคยแก้ในเมนู
// "⋯ เพิ่มเติม › จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด" (ถ้าแก้ในเมนูแล้ว ระบบใช้ค่าที่บันทึกใน Firestore แทน
// และหน้าร้านอ่านชุดเดียวกัน ไม่ต้องแก้โค้ดสองฝั่งอีก) ตัวแปรนี้ถูกเปลี่ยนค่าในที่เดิมโดย applyShopOptions
const CATEGORY_SIZE_TAGS = {
  'ช่อดอกไม้': ['เล็ก', 'กลาง', 'ใหญ่', 'ใส่เงิน'],
  'กรอบรูป': ['A5', 'A4'],
  'กระถาง': ['3 นิ้ว', '5 นิ้ว', '9 นิ้ว'],
  'อื่นๆ': ['กลิตเตอร์', 'กล่องดอกไม้', 'ดอกไม้เจ้าสาว', 'ตุ๊กตา', 'มงกุฎ'],
};
// หมวดหมู่ที่หน้าร้านแสดง (เรียงตามลำดับแท็บ ไม่รวม "ทั้งหมด") · หมวดหลักที่โค้ดบางจุดอ้างชื่อตรงๆ ห้ามแก้ชื่อ/ลบ
const CORE_CAT = 'ช่อดอกไม้';
const SHOP_CATS = ['ช่อดอกไม้', 'กรอบรูป', 'กระถาง', 'อื่นๆ'];
const DEFAULT_SHOP_OPTIONS = { cats: SHOP_CATS.slice(), flowers: FLOWER_TYPE_TAGS.slice(), sizes: clone(CATEGORY_SIZE_TAGS) };
function cleanNameList(a, fallback){
  if(!Array.isArray(a)) return fallback.slice();
  return [...new Set(a.map(x => String(x ?? '').trim()).filter(x => x && x !== 'ทั้งหมด'))];
}
// ใส่ตัวเลือกร้านที่โหลดจาก Firestore (null = ใช้ค่าเริ่มต้น) โดยเปลี่ยนค่าใน array/object เดิม โค้ดส่วนอื่นอ่านต่อได้เลย
function applyShopOptions(o){
  const d = DEFAULT_SHOP_OPTIONS;
  const src = (o && typeof o === 'object') ? o : {};
  let cats = cleanNameList(src.cats, d.cats);
  if(!cats.length) cats = d.cats.slice();
  const flowers = cleanNameList(src.flowers, d.flowers);
  const sizes = (src.sizes && typeof src.sizes === 'object') ? src.sizes : d.sizes;
  SHOP_CATS.splice(0, SHOP_CATS.length, ...cats);
  FLOWER_TYPE_TAGS.splice(0, FLOWER_TYPE_TAGS.length, ...flowers);
  Object.keys(CATEGORY_SIZE_TAGS).forEach(k => delete CATEGORY_SIZE_TAGS[k]);
  cats.forEach(c => { const s = cleanNameList(sizes[c], []); if(s.length) CATEGORY_SIZE_TAGS[c] = s; });
}
// หมวดที่ให้เลือกในหลังบ้าน: ตามลำดับที่ตั้งไว้ + หมวดเก่าที่มีสินค้าใช้อยู่แต่ไม่อยู่ในรายการ
function catChoices(){
  return [...new Set([...SHOP_CATS, ...catalog.map(p => p.cat).filter(Boolean)])];
}
// ตัวเลือกของหมวดนั้น (หมวดที่หน้าร้านไม่มีตัวกรองขนาด = array ว่าง)
function baseSizeTagsFor(cat){ return CATEGORY_SIZE_TAGS[String(cat ?? '').trim()] || []; }
// ค่านี้หน้าร้านกรองได้จริงในหมวดนี้หรือไม่
function isSizeTagValid(cat, tag){ return baseSizeTagsFor(cat).includes(String(tag ?? '').trim()); }
// ป้ายที่ใช้แสดงใน dropdown — ค่านอกรายการของหมวดจะมีหมายเหตุกำกับให้เห็นชัด
function sizeTagLabel(cat, tag){ return isSizeTagValid(cat, tag) ? tag : `${tag} (ไม่อยู่ในตัวกรองหน้าร้าน)`; }
// ค่าขนาดทุกตัวที่สินค้านี้ตั้งไว้ (ระดับสินค้า + ไซซ์ + คู่ผสม) ที่ไม่อยู่ในตัวเลือกของหมวดปัจจุบัน
function offListSizeTags(p){
  const all = [
    ...sizeTagsOf(p),
    ...(p.sizes || []).map(s => s && s.tag),
    ...(p.variants || []).map(v => v && v.tag),
  ].flatMap(v => String(v ?? '').split(',')).map(v => v.trim()).filter(Boolean);
  return [...new Set(all)].filter(t => !isSizeTagValid(p.cat, t));
}
// ตัวเลือกใน dropdown = ค่ามาตรฐาน + ค่าเดิมของสินค้านี้ที่ไม่อยู่ในรายการมาตรฐาน (กันค่าเก่าหายเงียบๆ)
// สินค้าที่มีไซซ์/คู่ผสม: ขนาดระดับสินค้าสรุปจาก tag ของแต่ละแถวให้เอง (คืน null = สินค้าราคาเดียว ให้ใช้ค่าที่ตั้งไว้ตรงๆ)
// ถ้าทุกแถวตั้ง tag แล้ว ใช้เฉพาะ tag ของแถว ถ้ามีแถว "อัตโนมัติ" ปนอยู่ ยังคงค่าเดิมของสินค้าไว้เป็นตัวสำรองให้แถวนั้น
function derivedSizeTags(p){
  const m = priceMode(p);
  const clean = v => String(v ?? '').trim();
  const rows = m === 'sizes' ? (p.sizes || []).filter(s => clean(s.name))
             : m === 'options' ? (p.variants || []) : null;
  if(!rows) return null;
  const tags = rows.map(r => clean(r.tag)).filter(Boolean);
  const all = (rows.length && tags.length === rows.length) ? tags : [...sizeTagsOf(p), ...tags];
  const uniq = [...new Set(all.flatMap(v => clean(v).split(',')).map(clean).filter(Boolean))];
  const base = baseSizeTagsFor(p.cat);
  return [...base.filter(t => uniq.includes(t)), ...uniq.filter(t => !base.includes(t))];
}
// ตัวเลือกใน dropdown = ตัวเลือกของหมวดนั้น + ค่าเดิมของสินค้าที่ไม่อยู่ในรายการ (กันค่าเก่าหายเงียบๆ — ค่าพวกนี้จะมีหมายเหตุกำกับ)
function sizeChoicesFor(current, cat){
  const base = baseSizeTagsFor(cat);
  const cur = (Array.isArray(current) ? current : [current]).map(v => String(v ?? '').trim()).filter(Boolean);
  return [...base, ...cur.filter(v => !base.includes(v))];
}

function toast(msg, isError){
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('is-error', !!isError);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2600);
}

function setSaveState(text, cls){
  const el = $('saveState');
  el.textContent = text;
  el.className = 'save-state' + (cls ? ' ' + cls : '');
}

function askConfirm(title, text, yesLabel){
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmYes').textContent = yesLabel || 'ยืนยัน';
  $('confirmScrim').hidden = false;
  return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirm(answer){
  $('confirmScrim').hidden = true;
  if(confirmResolve){ confirmResolve(answer); confirmResolve = null; }
}

/* รูปตัวอย่าง: ถ้าไฟล์ไม่มีจริง จะกลายเป็นกรอบเส้นประแทนไอคอนรูปแตก */
function thumbHtml(src, baseClass){
  const c = baseClass || 'img-preview';
  return `<img class="${c}${src ? '' : ' is-missing'}" ${src ? `src="${esc(src)}"` : ''} alt="" loading="lazy"
    onerror="this.removeAttribute('src'); this.classList.add('is-missing');">`;
}

/* ───────────────── ค่าในเส้นทาง เช่น colors.0.name ───────────────── */

function getPath(obj, path){
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value){
  const keys = path.split('.');
  let cur = obj;
  for(let i = 0; i < keys.length - 1; i++){
    // คีย์ถัดไปเป็นตัวเลข แปลว่าชั้นนี้ต้องเป็น array ไม่ใช่ object
    if(cur[keys[i]] == null) cur[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/* ───────────────── เริ่มระบบ ───────────────── */

async function boot(){
  const cfg = window.FIREBASE_CONFIG;
  if(!cfg || !cfg.projectId || String(cfg.apiKey || '').includes('ใส่ค่าจริง')){
    $('bootScreen').innerHTML =
      '<div class="empty"><p class="empty-title">ยังไม่ได้ตั้งค่า Firebase</p>' +
      '<p>เปิดไฟล์ firebase-config.js แล้วกรอกค่าจากโปรเจกต์ Firebase ของร้าน ' +
      '(คัดลอกได้จากไฟล์ระบบจัดการออเดอร์ที่ใช้อยู่)</p></div>';
    return;
  }

  try{
    const [appMod, authMod, dbMod] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js')
    ]);
    const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(cfg);
    fb = {
      authApi: authMod,
      dbApi: dbMod,
      auth: authMod.getAuth(app),
      db: dbMod.getFirestore(app)
    };
  } catch(err){
    $('bootScreen').innerHTML =
      '<div class="empty"><p class="empty-title">เชื่อมต่อ Firebase ไม่ได้</p>' +
      '<p>ตรวจสอบอินเทอร์เน็ต แล้วลองรีเฟรชหน้านี้อีกครั้ง</p></div>';
    console.error(err);
    return;
  }

  fb.authApi.onAuthStateChanged(fb.auth, user => {
    $('bootScreen').hidden = true;
    // UI check เป็นด่านเพิ่มความชัดเจน; สิทธิ์เขียนจริงบังคับโดย Firestore Rules
    const isStoreAdmin = user && user.email === window.ADMIN_EMAIL;
    if(isStoreAdmin){
      $('loginScreen').hidden = true;
      $('app').hidden = false;
      loadCatalog();
    } else {
      if(user){
        fb.authApi.signOut(fb.auth);
        $('loginError').textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าระบบจัดการสินค้า';
        $('loginError').hidden = false;
      }
      $('app').hidden = true;
      $('loginScreen').hidden = false;
      $('loginUser').focus();
    }
  });
}

async function doLogin(){
  const user = $('loginUser').value.trim().toLowerCase();
  const pass = $('loginPass').value;
  const errEl = $('loginError');
  errEl.hidden = true;

  if(!user || !pass){
    errEl.textContent = 'กรอกชื่อผู้ใช้และรหัสผ่านให้ครบก่อน';
    errEl.hidden = false;
    return;
  }

  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังเข้าสู่ระบบ…';
  try{
    // หน้าร้านนี้มีบัญชีผู้ดูแลเพียงบัญชีเดียว จึงไม่เปิดให้ป้อนอีเมลอื่น
    const email = window.ADMIN_EMAIL || 'admin@sflowerbloom.local';
    await fb.authApi.signInWithEmailAndPassword(fb.auth, email, pass);
    $('loginPass').value = '';
  } catch(err){
    errEl.textContent = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
      ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      : 'เข้าสู่ระบบไม่สำเร็จ: ' + (err.code || err.message);
    errEl.hidden = false;
  } finally{
    btn.disabled = false;
    btn.textContent = 'เข้าสู่ระบบ';
  }
}

/* ───────────────── อ่าน/เขียน Firestore ───────────────── */

function catalogRef(){
  return fb.dbApi.doc(fb.db, window.CATALOG_COLLECTION || 'catalog', window.CATALOG_DOC || 'products');
}

async function loadCatalog(){
  setSaveState('กำลังโหลดสินค้า…', 'is-saving');
  try{
    const snap = await fb.dbApi.getDoc(catalogRef());
    if(snap.exists()){
      const data = snap.data() || {};
      const list = typeof data.json === 'string' ? JSON.parse(data.json) : data.list;
      catalog = Array.isArray(list) ? list : [];
      pricesHidden = data.hidePrices === true;
      let opts = null;
      try{ if(typeof data.optionsJson === 'string') opts = JSON.parse(data.optionsJson); }catch(_){ opts = null; }
      applyShopOptions(opts);
      reviewTags = parseReviewTags(data.reviewsJson);
      reviewHidden = parseReviewHidden(data.reviewsJson);
      siteCfgSaved = parseSiteCfg(data.siteJson);
    } else {
      reviewTags = {};
      reviewHidden = new Set();
      siteCfgSaved = null;
      catalog = [];
      pricesHidden = false;
      applyShopOptions(null);
    }
    applyPricesHiddenUI(true);
    setSaveState(catalog.length ? 'ข้อมูลตรงกับหน้าร้านแล้ว' : 'ยังไม่มีสินค้าในระบบ');
    renderList();
  } catch(err){
    setSaveState('โหลดข้อมูลไม่สำเร็จ', 'is-error');
    toast('โหลดสินค้าไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
  }
}

async function saveCatalog(successMsg){
  const json = JSON.stringify(catalog);
  const bytes = new Blob([json]).size;
  if(bytes > FIRESTORE_DOC_LIMIT * 0.9){
    toast('ข้อมูลสินค้าใหญ่เกินกว่าที่ Firestore เก็บได้ในเอกสารเดียว ยังบันทึกไม่ได้', true);
    return false;
  }

  setSaveState('กำลังบันทึก…', 'is-saving');
  try{
    // merge:true สำคัญ — ไม่งั้นการบันทึกสินค้าจะเขียนทับและลบช่อง hidePrices ทิ้ง
    await fb.dbApi.setDoc(catalogRef(), {
      json,
      count: catalog.length,
      updatedAt: new Date().toISOString(),
      updatedBy: fb.auth.currentUser ? fb.auth.currentUser.email : ''
    }, { merge: true });
    setSaveState('บันทึกแล้ว · หน้าร้านอัปเดตทันที');
    if(successMsg) toast(successMsg);
    return true;
  } catch(err){
    setSaveState('บันทึกไม่สำเร็จ', 'is-error');
    toast(err.code === 'permission-denied'
      ? 'บันทึกไม่ได้: กฎความปลอดภัยของ Firestore ยังไม่อนุญาต'
      : 'บันทึกไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
    return false;
  }
}

/* ───────────────── สวิตช์ซ่อนราคาหน้าร้าน ───────────────── */

function applyPricesHiddenUI(ready){
  const btn = $('hidePricesBtn');
  $('priceSwitch').classList.toggle('is-on', pricesHidden);
  document.body.classList.toggle('prices-off', pricesHidden);
  btn.setAttribute('aria-checked', String(pricesHidden));
  if(ready) btn.disabled = false;
  $('priceSwitchHint').textContent = pricesHidden
    ? 'เปิดอยู่ — หน้าร้านไม่แสดงราคา และปิดตะกร้า/การสั่งซื้อ ลูกค้าต้องแคปหน้าจอแล้วทักเพจ (ปุ่มภาพแคตตาล็อกถูกซ่อนไว้)'
    : 'ปิดอยู่ — หน้าร้านแสดงราคาตามปกติ';
}

async function togglePricesHidden(){
  const next = !pricesHidden;
  const ok = await askConfirm(
    next ? 'ซ่อนราคาบนหน้าร้าน?' : 'แสดงราคาบนหน้าร้านอีกครั้ง?',
    next
      ? 'ลูกค้าจะไม่เห็นราคาทุกจุด และสั่งซื้อผ่านหน้าเว็บไม่ได้ (ต้องแคปหน้าจอแล้วทักเพจ) ราคาที่ตั้งไว้ในสินค้าไม่หายไปไหน'
      : 'หน้าร้านจะกลับมาแสดงราคาและเปิดตะกร้า/การสั่งซื้อตามปกติ ตรวจสอบราคาสินค้าให้เรียบร้อยก่อนนะ',
    next ? 'ซ่อนราคา' : 'แสดงราคา'
  );
  if(!ok) return;
  const btn = $('hidePricesBtn');
  btn.disabled = true;
  setSaveState('กำลังบันทึก…', 'is-saving');
  try{
    await fb.dbApi.setDoc(catalogRef(), {
      hidePrices: next,
      hidePricesUpdatedAt: new Date().toISOString()
    }, { merge: true });
    pricesHidden = next;
    applyPricesHiddenUI(true);
    setSaveState('บันทึกแล้ว · หน้าร้านอัปเดตทันที');
    toast(next ? 'ซ่อนราคาบนหน้าร้านแล้ว' : 'แสดงราคาบนหน้าร้านแล้ว');
  } catch(err){
    btn.disabled = false;
    setSaveState('บันทึกไม่สำเร็จ', 'is-error');
    toast(err.code === 'permission-denied'
      ? 'บันทึกไม่ได้: กฎความปลอดภัยของ Firestore ยังไม่อนุญาตให้เพิ่มช่อง hidePrices'
      : 'บันทึกไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
  }
}

/* ───────────────── รายการสินค้า ───────────────── */

// ราคาทุกแบบเท่ากัน = โชว์ราคาเดียว (ไม่ขึ้นเป็นช่วง 99–99 → "เริ่มต้น 99")
function priceSpan(prices){
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? baht(lo) : baht(lo) + '–' + baht(hi);
}
function priceInfo(p){
  if(Array.isArray(p.variants) && p.variants.length){
    const prices = p.variants.map(v => num(v.price)).filter(Boolean);
    if(prices.length) return { text: priceSpan(prices), note: 'ตามตัวเลือก' };
  }
  if(Array.isArray(p.sizes) && p.sizes.length){
    const prices = p.sizes.map(s => num(s.price)).filter(Boolean);
    if(prices.length) return { text: priceSpan(prices), note: 'ตามไซซ์' };
  }
  if(num(p.price)) return { text: baht(p.price), note: 'บาท' };
  return { text: '—', note: 'ยังไม่มีราคา' };
}

function mainImageOf(p){
  if(p.image) return p.image;
  if(Array.isArray(p.images) && p.images[0]) return p.images[0];
  const c = (p.colors || [])[0];
  if(c) return c.image || (c.images || [])[0] || '';
  const s = (p.sizes || [])[0];
  if(s && s.image) return s.image;
  const v = (p.variants || [])[0];
  if(v && v.image) return v.image;
  return '';
}

function allCats(){
  const used = new Set(catalog.filter(p => !p.hidden).map(p => p.cat).filter(Boolean));
  return ['ทั้งหมด', ...SHOP_CATS.filter(c => used.has(c)), ...[...used].filter(c => !SHOP_CATS.includes(c)).sort()];
}

/* ───────────── สินค้าที่มีหลายแบบ (แสดงในหน้ารายการ) ─────────────
   รวมทุกรูปแบบ: คู่ผสมหลายชั้น (variants), ไซซ์ (sizes), สี (colors)
   คืน null ถ้ามีไม่ถึง 2 แบบ = ไม่ต้องขึ้นป้าย */
function variantInfoOf(p){
  const txt = v => String(v ?? '').trim();
  const list = a => Array.isArray(a) ? a : [];

  const vs = list(p.variants);
  if(vs.length >= 2){
    const total = comboList(list(p.options)).length;
    return {
      unit: 'แบบ',
      rows: vs.map(v => ({
        name: list(v.match).map(txt).filter(Boolean).join(' · ') || '(ยังไม่ตั้งชื่อ)',
        price: num(v.price), image: v.image || '', ready: !!v.ready })),
      summary: list(p.options).filter(o => txt(o.name))
        .map(o => `${txt(o.name)} ${list(o.values).length}`).join(' · '),
      note: total > vs.length ? `เปิดขาย ${vs.length} จาก ${total} คู่ผสม` : ''
    };
  }

  const ss = list(p.sizes).filter(s => txt(s.name));
  if(ss.length >= 2){
    return {
      unit: 'ไซซ์',
      rows: ss.map(s => ({ name: txt(s.name), price: num(s.price), image: s.image || '', ready: !!s.ready })),
      summary: ss.map(s => txt(s.name)).join(' · '),
      note: ''
    };
  }

  const cs = list(p.colors).filter(c => txt(c.name));
  if(cs.length >= 2){
    return {
      unit: 'สี',
      rows: cs.map(c => ({ name: txt(c.name), price: num(p.price),
        image: c.image || list(c.images)[0] || '', ready: !!c.ready })),
      summary: cs.map(c => txt(c.name)).join(' · '),
      note: ''
    };
  }
  return null;
}

function isMulti(p){ return !!variantInfoOf(p); }
function expandKey(p, i){ return String(p.id || '') || '#' + i; }

function variantPanelHtml(p, i){
  const info = variantInfoOf(p);
  if(!info) return '';
  return `
    <div class="variant-panel" id="vp-${i}">
      <div class="vp-grid">
        ${info.rows.map(r => `
          <div class="vp-item">
            ${thumbHtml(r.image, 'vp-thumb')}
            <div class="vp-text">
              <p class="vp-name">${esc(r.name)}</p>
              <p class="vp-price">${r.price ? baht(r.price) + ' บาท' : '<span class="vp-nop">ยังไม่มีราคา</span>'}${r.ready ? '<span class="tag tag-ready">พร้อมส่ง</span>' : ''}</p>
            </div>
          </div>`).join('')}
      </div>
      <div class="vp-foot">
        <span>${info.note ? esc(info.note) : ''}</span>
        <button class="btn btn-ghost btn-sm" data-act="edit" data-i="${i}">แก้ไขสินค้านี้</button>
      </div>
    </div>`;
}

/* ───────────── มุมมองการ์ด (หน้าตาเหมือนหน้าร้าน) ───────────── */

// สถานะพร้อมส่งระดับสินค้า: 'all' = ติ๊กที่สินค้า · 'some' = บางแบบ/สี/ไซซ์พร้อมส่ง · '' = ไม่มี
function readyStateOf(p){
  if(p.ready) return 'all';
  const rows = [...(p.colors || []), ...(p.sizes || []), ...(p.variants || [])];
  return rows.some(r => r && r.ready) ? 'some' : '';
}

function cardHtml(p, i, filtering){
  const pi = priceInfo(p);
  const vinfo = variantInfoOf(p);
  const rs = readyStateOf(p);
  const fs = flowerStateOf(p);
  const warns = [];
  if(pi.text === '—') warns.push('<span class="tag tag-warn">ยังไม่มีราคา</span>');
  if(!mainImageOf(p)) warns.push('<span class="tag tag-warn">ยังไม่มีรูป</span>');
  if(fs === 'off') warns.push(`<span class="tag tag-warn">⚠ ${esc(String(p.flowerType).trim())}</span>`);
  if(fs === 'none') warns.push('<span class="tag tag-warn">ยังไม่ระบุชนิด</span>');
  const isRange = pi.text.includes('–');
  const priceTxt = pi.text === '—' ? 'ยังไม่มีราคา' : (isRange ? 'เริ่มต้น ' + pi.text.split('–')[0] : pi.text);
  return `
    <div class="pcard${selected.has(i) ? ' is-selected' : ''}${p.hidden ? ' is-hidden' : ''}" data-i="${i}">
      <div class="pc-photo">
        ${thumbHtml(mainImageOf(p), 'pc-img')}
        <span class="pc-sel sel-cell"><input type="checkbox" class="sel" data-i="${i}" aria-label="เลือก ${esc(p.name || p.id || '')}"${selected.has(i) ? ' checked' : ''}></span>
        ${p.hidden ? '<span class="pc-hidden">ซ่อนอยู่</span>' : rs ? `<span class="pc-ready${rs === 'some' ? ' is-some' : ''}">${rs === 'some' ? 'พร้อมส่งบางแบบ' : 'พร้อมส่ง'}</span>` : ''}
        <details class="menu pc-menu">
          <summary class="icon-btn" title="เมนูอื่นๆ">⋯</summary>
          <div class="menu-pop">
            <button data-act="edit" data-i="${i}">แก้ไข</button>
            <button data-act="ready-toggle" data-i="${i}">${p.ready ? 'ยกเลิกพร้อมส่ง' : 'ตั้งเป็นพร้อมส่ง'}</button>
            <button data-act="copy" data-i="${i}">ทำสำเนา</button>
            <button data-act="hide-toggle" data-i="${i}">${p.hidden ? 'เลิกซ่อน (กลับมาขาย)' : 'ซ่อนจากหน้าร้าน'}</button>
            <button data-act="up" data-i="${i}" ${filtering || stepVisible(i, -1) < 0 ? 'disabled' : ''}>เลื่อนขึ้น</button>
            <button data-act="down" data-i="${i}" ${filtering || stepVisible(i, 1) < 0 ? 'disabled' : ''}>เลื่อนลง</button>
            <button class="is-danger" data-act="del" data-i="${i}">ลบสินค้า</button>
          </div>
        </details>
        <span class="drag-handle pc-drag${filtering ? ' is-disabled' : ''}" draggable="${filtering ? 'false' : 'true'}" data-i="${i}" title="ลากเพื่อเรียงลำดับใหม่">⠿</span>
      </div>
      <div class="pc-body">
        <p class="pc-name">${esc(p.name || '(ยังไม่ตั้งชื่อ)')}</p>
        <p class="pc-meta"><span>${esc(p.id || '—')}</span>${p.cat ? `<span>${esc(p.cat)}</span>` : ''}</p>
        <p class="pc-price">${esc(priceTxt)}${priceTxt.startsWith('เริ่มต้น') || pi.text === '—' ? '' : '<small> บาท</small>'}</p>
        ${vinfo ? `<span class="pc-multi">เลือกได้ ${vinfo.rows.length} ${vinfo.unit}</span>` : ''}
        ${warns.length ? `<p class="pc-warns">${warns.join('')}</p>` : ''}
      </div>
    </div>`;
}

function applyViewMode(){
  const grid = viewMode === 'grid';
  $('productList').classList.toggle('is-grid', grid);
  $('listCard').classList.toggle('is-grid', grid);
  document.querySelectorAll('.vs-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === viewMode)));
}

function needsFix(p){ return !p.hidden && (priceInfo(p).text === '—' || !mainImageOf(p)); }

function visibleProducts(){
  const q = searchTerm.trim().toLowerCase();
  return catalog
    .map((p, i) => ({ p, i }))
    // สินค้าที่ซ่อนอยู่จะโผล่เฉพาะแท็บ "ซ่อนอยู่" ส่วนแท็บอื่นเห็นแต่สินค้าที่ยังขาย
    .filter(({ p }) => filterCat === '__hidden__' ? !!p.hidden : !p.hidden)
    .filter(({ p }) => filterCat === 'ทั้งหมด' || filterCat === '__hidden__' ||
      (filterCat === '__fix__' ? needsFix(p) : filterCat === '__multi__' ? isMulti(p) : p.cat === filterCat))
    .filter(({ p }) => !q ||
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.id || '').toLowerCase().includes(q) ||
      String(p.flowerType || '').toLowerCase().includes(q))
    .filter(({ p }) => flowerMatchesFilter(p, filterFlower));
}

function renderBulk(rows){
  const n = selected.size;
  $('bulkBar').hidden = !n;
  $('bulkCount').textContent = `เลือกแล้ว ${n} รายการ`;
  const vis = rows.map(r => r.i);
  const all = vis.length > 0 && vis.every(i => selected.has(i));
  const some = !all && vis.some(i => selected.has(i));
  ['selAll', 'selAll2'].forEach(id => { $(id).checked = all; $(id).indeterminate = some; });
  $('bulkHide').hidden = filterCat === '__hidden__';
  $('bulkUnhide').hidden = filterCat !== '__hidden__';
  updateCatalogBtn(rows);
}

function renderList(){
  applyViewMode();
  selected.forEach(i => { if(i >= catalog.length) selected.delete(i); });
  const fixCount = catalog.filter(needsFix).length;
  const multiCount = catalog.filter(p => !p.hidden && isMulti(p)).length;
  const hiddenCount = catalog.filter(p => p.hidden).length;
  if(filterCat === '__fix__' && !fixCount) filterCat = 'ทั้งหมด';
  if(filterCat === '__multi__' && !multiCount) filterCat = 'ทั้งหมด';
  if(filterCat === '__hidden__' && !hiddenCount) filterCat = 'ทั้งหมด';
  if(!['ทั้งหมด', '__fix__', '__multi__', '__hidden__'].includes(filterCat) && !allCats().includes(filterCat)) filterCat = 'ทั้งหมด';
  // กลุ่มสินค้าที่กำลังดูอยู่ (แท็บซ่อนอยู่ = เฉพาะที่ซ่อน, แท็บอื่น = เฉพาะที่ยังขาย)
  const pool = catalog.filter(p => filterCat === '__hidden__' ? p.hidden : !p.hidden);

  const tabs = [['ทั้งหมด', 'ทั้งหมด']];
  if(fixCount) tabs.push(['__fix__', `ต้องแก้ไข ${fixCount}`]);
  if(multiCount) tabs.push(['__multi__', `มีหลายแบบ ${multiCount}`]);
  allCats().slice(1).forEach(c => tabs.push([c, c]));
  if(hiddenCount) tabs.push(['__hidden__', `ซ่อนอยู่ ${hiddenCount}`]);
  $('catChips').innerHTML = tabs.map(([k, l]) =>
    `<button class="chip${k === filterCat ? ' is-active' : ''}${k === '__fix__' ? ' is-fix' : ''}${k === '__hidden__' ? ' is-hiddentab' : ''}" data-cat="${esc(k)}">${esc(l)}</button>`
  ).join('');

  const cats = catChoices();
  $('bulkCat').innerHTML = '<option value="">เปลี่ยนหมวดหมู่เป็น…</option>' +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  // ตัวกรองชนิดดอกไม้ — นับจากสินค้าทั้งหมด (ไม่ขึ้นกับแท็บหมวด) ตัวเลือกที่ไม่มีสินค้าเลยจะไม่แสดง
  const fCount = f => pool.filter(p => flowerMatchesFilter(p, f)).length;
  const noneCount = fCount('__none__'), offCount = fCount('__off__');
  if(filterFlower === '__none__' && !noneCount) filterFlower = '';
  if(filterFlower === '__off__' && !offCount) filterFlower = '';
  if(filterFlower && !['__none__', '__off__'].includes(filterFlower) && !fCount(filterFlower)) filterFlower = '';
  const flowerOpts = [['', 'ชนิดดอกไม้: ทั้งหมด']];
  FLOWER_TYPE_TAGS.map(t => [t, fCount(t)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]) // มากไปน้อย (จำนวนเท่ากันคงลำดับเดิม)
    .forEach(([t, n]) => flowerOpts.push([t, `${t} (${n})`]));
  if(noneCount) flowerOpts.push(['__none__', `⚠ ยังไม่ระบุชนิด (${noneCount})`]);
  if(offCount) flowerOpts.push(['__off__', `⚠ ชนิดนอกรายการ (${offCount})`]);
  $('flowerFilter').innerHTML = flowerOpts.map(([v, l]) => `<option value="${esc(v)}"${v === filterFlower ? ' selected' : ''}>${esc(l)}</option>`).join('');
  $('flowerFilter').classList.toggle('is-active', !!filterFlower);

  const rows = visibleProducts();
  const filtering = filterCat !== 'ทั้งหมด' || !!searchTerm.trim() || !!filterFlower;

  $('emptyState').hidden = catalog.length > 0;
  $('listCard').hidden = !catalog.length;
  $('listMeta').textContent = filtering ? `แสดง ${rows.length} จาก ${pool.length} รายการ` : `ทั้งหมด ${pool.length} รายการ`;

  if(!catalog.length){ $('productList').innerHTML = ''; return; }
  if(!rows.length){
    $('productList').innerHTML =
      (!pool.length && hiddenCount
        ? '<div class="empty"><p class="empty-title">ตอนนี้ไม่มีสินค้าที่ขายอยู่</p><p>สินค้าทั้งหมดถูกซ่อนไว้ ดูและเลิกซ่อนได้ที่แท็บ “ซ่อนอยู่”</p></div>'
        : '<div class="empty"><p class="empty-title">ไม่พบสินค้าที่ค้นหา</p><p>ลองเปลี่ยนคำค้นหรือเลือกแท็บอื่น</p></div>');
    renderBulk(rows);
    return;
  }

  if(viewMode === 'grid'){
    $('productList').innerHTML = rows.map(({ p, i }) => cardHtml(p, i, filtering)).join('');
    renderBulk(rows);
    return;
  }

  $('productList').innerHTML = rows.map(({ p, i }) => {
    const pi = priceInfo(p);
    const warns = [];
    if(p.hidden) warns.push('<span class="tag tag-hidden">ซ่อนอยู่</span>');
    if(pi.text === '—') warns.push('<span class="tag tag-warn">ยังไม่มีราคา</span>');
    if(!mainImageOf(p)) warns.push('<span class="tag tag-warn">ยังไม่มีรูป</span>');
    const fs = flowerStateOf(p);
    const flowerHtml = fs === 'ok' ? `<span class="row-flower">🌸 ${esc(String(p.flowerType).trim())}</span>`
      : fs === 'off' ? `<span class="tag tag-warn">⚠ ${esc(String(p.flowerType).trim())} (หน้าร้านกรองไม่ได้)</span>`
      : fs === 'none' ? '<span class="tag tag-warn">ยังไม่ระบุชนิดดอกไม้</span>' : '';
    const vinfo = variantInfoOf(p);
    const isOpen = !!vinfo && expanded.has(expandKey(p, i));
    return `
      <div class="tr${selected.has(i) ? ' is-selected' : ''}${isOpen ? ' is-open' : ''}${p.hidden ? ' is-hidden' : ''}" data-i="${i}">
        <span class="sel-cell"><input type="checkbox" class="sel" data-i="${i}"${selected.has(i) ? ' checked' : ''}></span>
        <span class="drag-handle${filtering ? ' is-disabled' : ''}" draggable="${filtering ? 'false' : 'true'}" data-i="${i}" title="ลากเพื่อเรียงลำดับใหม่">⠿</span>
        ${thumbHtml(mainImageOf(p), 'row-thumb')}
        <div class="td-name">
          <p class="row-name">${esc(p.name || '(ยังไม่ตั้งชื่อ)')}${vinfo ? `<button class="multi-badge" data-act="toggle-variants" data-i="${i}" aria-expanded="${isOpen}" aria-controls="vp-${i}" title="กดเพื่อดูแบบทั้งหมด">${vinfo.rows.length} ${vinfo.unit}<span class="caret" aria-hidden="true">▾</span></button>` : ''}</p>
          <p class="row-sub"><span>${esc(p.id || '—')}</span>${sizeTagText(p) ? `<span>${esc(sizeTagText(p))}</span>` : ''}${flowerHtml}${warns.join('')}</p>
          ${vinfo && vinfo.summary ? `<p class="row-variants">${esc(vinfo.summary)}</p>` : ''}
        </div>
        <span class="td-status"><button class="badge ${p.ready ? 'badge-ok' : ''}" data-act="ready-toggle" data-i="${i}" title="กดเพื่อสลับสถานะ">${p.ready ? 'พร้อมส่ง' : 'ปกติ'}</button></span>
        <span class="td-price">${pi.text}<small>${pi.note}</small></span>
        <span class="td-cat">${esc(p.cat || '—')}</span>
        <details class="menu td-menu">
          <summary class="icon-btn" title="เมนูอื่นๆ">⋯</summary>
          <div class="menu-pop">
            <button data-act="edit" data-i="${i}">แก้ไข</button>
            <button data-act="copy" data-i="${i}">ทำสำเนา</button>
            <button data-act="hide-toggle" data-i="${i}">${p.hidden ? 'เลิกซ่อน (กลับมาขาย)' : 'ซ่อนจากหน้าร้าน'}</button>
            <button data-act="up" data-i="${i}" ${filtering || stepVisible(i, -1) < 0 ? 'disabled' : ''}>เลื่อนขึ้น</button>
            <button data-act="down" data-i="${i}" ${filtering || stepVisible(i, 1) < 0 ? 'disabled' : ''}>เลื่อนลง</button>
            <button class="is-danger" data-act="del" data-i="${i}">ลบสินค้า</button>
          </div>
        </details>
        ${isOpen ? variantPanelHtml(p, i) : ''}
      </div>`;
  }).join('');
  renderBulk(rows);
}

async function bulkApply(fn, msg){
  const n = selected.size;
  selected.forEach(i => fn(catalog[i]));
  selected.clear();
  renderList();
  await saveCatalog(`${msg} ${n} รายการแล้ว`);
}

/* ───────────────── ทำสำเนา / ลบ / เรียงลำดับ ───────────────── */

function uniqueId(base){
  let n = 2;
  let id = base + '-' + n;
  const taken = new Set(catalog.map(p => p.id));
  while(taken.has(id)){ n++; id = base + '-' + n; }
  return id;
}

async function duplicateProduct(i){
  selected.clear();
  const copy = clone(catalog[i]);
  copy.id = uniqueId(copy.id || 'สินค้า');
  copy.name = (copy.name || '') + ' (สำเนา)';
  catalog.splice(i + 1, 0, copy);
  renderList();
  await saveCatalog('ทำสำเนาแล้ว');
}

async function deleteProduct(i){
  selected.clear();
  const p = catalog[i];
  const ok = await askConfirm('ลบสินค้า', `ลบ “${p.name || p.id}” ออกจากหน้าร้านถาวร กู้คืนไม่ได้`, 'ลบสินค้า');
  if(!ok) return;
  catalog.splice(i, 1);
  renderList();
  await saveCatalog('ลบแล้ว');
}

// หาตำแหน่งสินค้าที่ "ยังขายอยู่" ตัวถัดไปในทิศนั้น (ข้ามตัวที่ซ่อน กันกดเลื่อนแล้วไม่เห็นอะไรเปลี่ยน) -1 = ไม่มี
function stepVisible(i, delta){
  let j = i + delta;
  while(j >= 0 && j < catalog.length && catalog[j].hidden) j += delta;
  return (j < 0 || j >= catalog.length) ? -1 : j;
}

// ซ่อน/เลิกซ่อนสินค้า — ข้อมูลยังอยู่ครบ แค่หน้าร้านไม่แสดง
async function toggleHidden(i){
  selected.clear();
  const p = catalog[i];
  if(p.hidden) delete p.hidden; else p.hidden = true;
  const nowHidden = !!p.hidden;
  renderList();
  await saveCatalog(nowHidden ? 'ซ่อนจากหน้าร้านแล้ว (ดูได้ที่แท็บ “ซ่อนอยู่”)' : 'เลิกซ่อนแล้ว สินค้ากลับมาขายบนหน้าร้าน');
}

async function moveProduct(i, delta){
  selected.clear();
  const j = stepVisible(i, delta);
  if(j < 0) return;
  [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
  renderList();
  await saveCatalog();
}

// ลากการ์ดสินค้าไปวางตรงตำแหน่งใหม่ (คลิกที่ไอคอน ⠿ แล้วลาก — เดสก์ท็อปเท่านั้น มือถือใช้ปุ่ม ↑/↓ แทน)
async function reorderProduct(from, to){
  selected.clear();
  if(from === to || from < 0 || to < 0 || from >= catalog.length || to >= catalog.length) return;
  const [item] = catalog.splice(from, 1);
  catalog.splice(to, 0, item);
  renderList();
  await saveCatalog();
}

/* ───────────────── ตัวแก้ไขสินค้า ───────────────── */

function nextId(){
  const ids = catalog.map(p => String(p.id || ''));
  const last = [...ids].reverse().find(id => /^[A-Za-z]+\d+$/.test(id));
  if(!last) return '';
  const m = last.match(/^([A-Za-z]+)(\d+)$/);
  const width = m[2].length;
  const nums = ids.map(id => id.match(/^([A-Za-z]+)(\d+)$/)).filter(x => x && x[1] === m[1]).map(x => +x[2]);
  return m[1] + String(Math.max(...nums) + 1).padStart(width, '0');
}

function blankProduct(){
  return { id:nextId(), cat: SHOP_CATS[0] || 'ช่อดอกไม้', flowerType:'', size:'', name:'', price:0, desc:'', image:'' };
}

function priceMode(p){
  if(Array.isArray(p.options) && p.options.length) return 'options';
  if(Array.isArray(p.sizes) && p.sizes.length) return 'sizes';
  return 'single';
}

function openEditor(i){
  draftIndex = i;
  draft = i < 0 ? blankProduct() : clone(catalog[i]);
  $('editorTitle').textContent = i < 0 ? 'เพิ่มสินค้าใหม่' : 'แก้ไขสินค้า';
  $('editorSub').textContent = i < 0 ? 'กรอกข้อมูลแล้วกดบันทึก' : (draft.id || '');
  $('editorProblem').hidden = true;
  renderAllPanels();
  updateSummaries();
  listScrollY = window.scrollY;
  document.querySelector('main.page').hidden = true;
  $('app').classList.add('is-editing');
  $('editorPage').hidden = false;
  window.scrollTo(0, 0);
}

function closeEditor(){
  $('editorPage').hidden = true;
  $('app').classList.remove('is-editing');
  document.querySelector('main.page').hidden = false;
  window.scrollTo(0, listScrollY);
  draft = null;
  draftIndex = -1;
}

function updateSummaries(){
  if(!draft) return;
  const mode = priceMode(draft);
  const nc = (draft.colors || []).length;
  let price = '';
  if(mode === 'single') price = nc ? nc + ' สี' : 'ไม่มีตัวแปร';
  if(mode === 'sizes') price = 'ไซซ์ ' + (draft.sizes || []).length + ' ค่า' + (nc ? ' · ' + nc + ' สี' : '');
  if(mode === 'options') price = (draft.options || []).length + ' ตัวแปร · เปิดขาย ' + (draft.variants || []).length + ' แบบ';
  const media = (draft.image ? 'มีรูปหลัก' : 'ยังไม่มีรูป') + ((draft.images || []).length ? ' · แกลเลอรี ' + draft.images.length + ' รูป' : '');
  const na = (draft.addons || []).length + (draft.colors || []).reduce((a, c) => a + (c.addons || []).length, 0);
  const auto = $('sizeAutoText');
  if(auto) auto.textContent = (derivedSizeTags(draft) || []).join(', ') || 'ยังไม่ได้ตั้ง';
  $('sumPrice').textContent = price;
  $('sumMedia').textContent = media;
  if(reviewPanelFor !== String(draft.id || '')) renderReviewsPanel();
  $('sumReviews').textContent = draft.id ? (reviewKeysOf(draft.id).length ? reviewKeysOf(draft.id).length + ' รูป' : 'ยังไม่มี (ไม่บังคับ)') : '';
  $('sumAddons').textContent = na ? na + ' รายการ' : 'ไม่มี (ไม่บังคับ)';

  // ตัวอย่างการ์ดที่ลูกค้าเห็น
  const src = mainImageOf(draft);
  const im = $('pvImg');
  if((im.getAttribute('src') || '') !== src){
    if(src){ im.classList.remove('is-missing'); im.src = src; }
    else { im.removeAttribute('src'); im.classList.add('is-missing'); }
  }
  $('pvName').textContent = draft.name || 'ชื่อสินค้า';
  const pi = priceInfo(draft);
  $('pvPrice').textContent = pi.text === '—' ? 'ยังไม่มีราคา' : pi.text + ' บาท';
  $('pvReady').hidden = !draft.ready;
}
$('pvImg').addEventListener('error', e => { e.target.removeAttribute('src'); e.target.classList.add('is-missing'); });

function renderAllPanels(){
  renderMainPanel();
  renderPricePanel();
  renderAddonsPanel();
  renderMediaPanel();
  renderReviewsPanel();
}

/* --- การ์ด 1: ข้อมูลสินค้า (ชื่อ · หมวด · ชนิด · ขนาด · รายละเอียด · พร้อมส่ง · ราคา · รหัส) --- */

// คืน { field, notes } — field = ช่อง "ขนาด" ที่วางในแถวแรก, notes = ข้อความอธิบาย/คำเตือนที่วางใต้แถว (ไม่ให้ดันความสูงของช่องในแถว)
function sizeFieldHtml(){
  if(!CATEGORY_SIZE_TAGS[String(draft.cat || '').trim()] && !offListSizeTags(draft).length){
    return {
      field: `<div class="field"><span>ขนาด</span><p class="size-auto">หมวดนี้ไม่มีตัวกรองขนาด</p></div>`,
      notes: ''
    };
  }
  if(priceMode(draft) === 'single'){
    return {
      field: `
        <div class="field">
          <span>ขนาด</span>
          <details class="menu size-menu" id="sizeMenu">
            <summary class="size-summary" id="sizeSummary">${esc(sizeTagText(draft)) || 'เลือกขนาด'}</summary>
            <div class="menu-pop size-pop">
              ${sizeChoicesFor(sizeTagsOf(draft), draft.cat).map(t => `<label class="size-opt${isSizeTagValid(draft.cat, t) ? '' : ' is-off'}"><input type="checkbox" data-size-tag value="${esc(t)}"${sizeTagsOf(draft).includes(t) ? ' checked' : ''}><span>${esc(sizeTagLabel(draft.cat, t))}</span></label>`).join('')}
            </div>
          </details>
        </div>`,
      notes: `
        <p class="field-hint">ขนาด: ติ๊กได้มากกว่า 1 ค่า${draft.cat === 'ช่อดอกไม้' ? ' เช่น “กลาง” + “ใส่เงิน” สินค้าจะโผล่ทั้งตอนกรอง “กลาง” และ “ใส่เงิน”' : ' สินค้าจะโผล่ในตัวกรองของทุกค่าที่ติ๊ก'}</p>
        ${offListSizeTags(draft).length ? `<p class="field-hint size-warn">⚠ มีค่า “${esc(offListSizeTags(draft).join(', '))}” ที่หน้าร้านไม่มีให้กรองในหมวดนี้ — ติ๊กออกแล้วเลือกค่าที่ถูกต้อง</p>` : ''}`
    };
  }
  return {
    field: `
      <div class="field">
        <span>ขนาด</span>
        <p class="size-auto">ตั้งในการ์ด “ตัวแปร” · <b id="sizeAutoText">${esc((derivedSizeTags(draft) || []).join(', ') || 'ยังไม่ได้ตั้ง')}</b></p>
      </div>`,
    notes: `
      <p class="field-hint">ขนาด: ระบบสรุปให้เองตอนบันทึก ${draft.cat === 'ช่อดอกไม้' ? 'แถวที่เลือก “อัตโนมัติ” จะใช้คำว่า “ใส่เงิน” ในชื่อเป็นตัวตัดสิน' : 'แถวที่ไม่ได้เลือกค่า จะไม่ถูกจัดเข้าตัวกรองขนาดใดๆ ในหน้าร้าน'}</p>
      ${offListSizeTags(draft).length ? `<p class="field-hint size-warn">⚠ มีค่า “${esc(offListSizeTags(draft).join(', '))}” ที่หน้าร้านไม่มีให้กรองในหมวดนี้ — แก้ที่การ์ด “ตัวแปร”</p>` : ''}`
  };
}

function renderMainPanel(){
  const mode = priceMode(draft);
  const hasVars = mode !== 'single';
  const cats = catChoices();
  const curFlower = String(draft.flowerType || '').trim();
  const offFlower = curFlower && !FLOWER_TYPE_TAGS.includes(curFlower);
  const flowers = [...FLOWER_TYPE_TAGS, ...(offFlower ? [curFlower] : [])];
  const size = sizeFieldHtml();

  let priceField;
  if(mode === 'single'){
    priceField = `
      <label class="field">
        <span>ราคา (บาท)</span>
        <input type="number" min="0" step="1" data-bind="price" data-type="number" value="${num(draft.price) || ''}">
      </label>
      <p class="field-hint">${(draft.colors || []).length ? 'ราคานี้ใช้กับทุกสีในการ์ด “ตัวแปร”' : 'ถ้าสินค้ามีหลายแบบที่ราคาต่างกัน ให้เพิ่มตัวแปรในการ์ดถัดไป แล้วตั้งราคาที่นั่นแทน'}</p>`;
  }else{
    const shown = mode === 'sizes' ? (num(draft.price) || Math.min(...(draft.sizes || []).map(s => num(s.price)).filter(Boolean), Infinity)) : 0;
    priceField = `
      <label class="field is-locked">
        <span>ราคา (บาท)</span>
        <input type="text" disabled value="${Number.isFinite(shown) && shown ? 'เริ่มต้น ' + baht(shown) : 'ตั้งที่การ์ดตัวแปร'}">
      </label>
      <p class="field-hint">สินค้านี้มีตัวแปร ราคาตั้งแยกในแต่ละแถวของการ์ด “ตัวแปร”</p>`;
  }

  $('panelMain').innerHTML = `
    <div class="main-rows">

      <div class="main-row main-row-top">
        <label class="field">
          <span>ชื่อสินค้า</span>
          <input type="text" data-bind="name" value="${esc(draft.name)}" placeholder="เช่น ช่อดอกทานตะวัน - S16">
        </label>
        <label class="field">
          <span>หมวดหมู่</span>
          <select data-bind="cat">
            ${cats.map(c => `<option value="${esc(c)}"${c === draft.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>ชนิด (ดอกไม้)</span>
          <select data-bind="flowerType">
            <option value="">— ไม่ระบุ —</option>
            ${flowers.map(t => `<option value="${esc(t)}"${curFlower === t ? ' selected' : ''}>${esc(FLOWER_TYPE_TAGS.includes(t) ? t : t + ' (ไม่อยู่ในตัวกรองหน้าร้าน)')}</option>`).join('')}
          </select>
        </label>
        ${size.field}
      </div>
      ${offFlower ? '<p class="field-hint size-warn">⚠ ชนิดดอกไม้นี้หน้าร้านไม่มีให้กรอง — เลือกชนิดที่ถูกต้องจากรายการ</p>' : ''}
      ${size.notes}

      <div class="main-row">
        <label class="field">
          <span>รายละเอียด</span>
          <textarea data-bind="desc" placeholder="อธิบายสิ่งที่ลูกค้าจะได้รับ เช่น จำนวนดอก สีกระดาษห่อ">${esc(draft.desc || '')}</textarea>
        </label>
      </div>

      <div class="main-row">
        <label class="check${hasVars ? ' is-locked' : ''}" style="margin:0">
          <input type="checkbox" ${hasVars ? 'disabled' : 'data-bind="ready" data-type="bool"'}${draft.ready ? ' checked' : ''}>
          <span>${hasVars ? 'พร้อมส่ง — ตั้งแยกในแต่ละแถวของการ์ด “ตัวแปร”' : 'ทำไว้แล้ว พร้อมส่งทันที (ขึ้นป้าย “พร้อมส่ง” ในหน้าร้าน)'}</span>
        </label>
      </div>

      <div class="main-row">
        <label class="check" style="margin:0">
          <input type="checkbox" data-bind="hidden" data-type="bool"${draft.hidden ? ' checked' : ''}>
          <span>ซ่อนจากหน้าร้าน (เลิกขายแล้ว) — ข้อมูลยังเก็บไว้ เปิดกลับมาขายได้ทุกเมื่อ</span>
        </label>
      </div>

      <div class="main-row">
        <div>${priceField}</div>
      </div>

      <div class="main-row">
        <div>
          <label class="field">
            <span>รหัสสินค้า</span>
            <input type="text" data-bind="id" value="${esc(draft.id)}" placeholder="เช่น s16">
          </label>
          <p class="field-hint">รหัสห้ามซ้ำกับสินค้าอื่น ใช้เป็นตัวอ้างอิงในตะกร้าและใบสั่งซื้อ</p>
        </div>
      </div>
    </div>`;
}

/* --- แท็บ 2: รูปภาพและสี --- */

// รูปทั้งหมดของแถว (ไซซ์/คู่ผสม): รูปหลัก (image) ตามด้วยรูปเพิ่มเติม (images) ตัดค่าว่าง/ซ้ำ
function imgsOf(o){
  const out = [];
  [o && o.image, ...((o && o.images) || [])].forEach(v => {
    const t = String(v ?? '').trim();
    if(t && !out.includes(t)) out.push(t);
  });
  return out;
}
// ข้อมูลเก่าอาจมีแต่ images[] (ไม่มี image) → ยกรูปแรกขึ้นเป็นรูปหลัก ส่วน images เก็บเฉพาะรูปเพิ่มเติม (ทำซ้ำกี่รอบก็ได้ผลเท่าเดิม)
function normalizeRowImages(o){
  if(!o || !Array.isArray(o.images)) return;
  const t = v => String(v ?? '').trim();
  if(!t(o.image)){
    const i = o.images.findIndex(x => t(x));
    if(i >= 0){ o.image = t(o.images[i]); o.images.splice(i, 1); }
  }
  const main = t(o.image);
  // ตัดรูปที่ซ้ำกับรูปหลักออก แต่เก็บช่องว่างที่เพิ่งกด "เพิ่มรูป" ไว้ (ผู้ใช้ยังไม่ทันพิมพ์)
  o.images = o.images.filter(x => !t(x) || t(x) !== main);
  if(!o.images.length) delete o.images;
}

function imageListHtml(arr, pathPrefix){
  const list = arr || [];
  return `
    <div data-img-list="${pathPrefix}">
      ${list.map((src, k) => `
        <div class="img-list-row">
          ${src ? `<img src="${esc(src)}" alt="" onerror="this.removeAttribute('src')">` : '<img alt="">'}
          <input type="text" data-bind="${pathPrefix}.${k}" value="${esc(src)}" placeholder="images/…">
          <button class="icon-btn" data-act="rm-img" data-path="${pathPrefix}" data-k="${k}" title="ลบรูปนี้">✕</button>
        </div>`).join('')}
      <button class="add-line" data-act="add-img" data-path="${pathPrefix}">+ เพิ่มรูป</button>
    </div>`;
}

function renderMediaPanel(){
  const all = pdAll();
  const tiles = all.map((src, k) => `
        <div class="pd-tile${k === 0 ? ' is-main' : ''}">
          ${thumbHtml(src, 'pd-img')}
          ${k === 0 ? '<span class="pd-badge">รูปหลัก</span>' : ''}
          <div class="pd-tools">
            ${k > 0 ? `<button type="button" class="pd-btn" data-act="pd-main" data-k="${k}" title="ตั้งเป็นรูปหลัก">★</button>` : ''}
            ${k > 0 ? `<button type="button" class="pd-btn" data-act="pd-left" data-k="${k}" title="เลื่อนไปก่อนหน้า">◀</button>` : ''}
            ${k < all.length - 1 ? `<button type="button" class="pd-btn" data-act="pd-right" data-k="${k}" title="เลื่อนไปถัดไป">▶</button>` : ''}
            <button type="button" class="pd-btn pd-del" data-act="pd-rm" data-k="${k}" title="เอารูปนี้ออกจากสินค้า (ไฟล์ยังอยู่ในโฟลเดอร์)">✕</button>
          </div>
        </div>`).join('');
  $('panelMedia').innerHTML = `
    <div class="group">
      <div class="rv-drop pd-drop" tabindex="0" role="button"><b>ลากรูปสินค้ามาวางที่นี่</b><span>หรือคลิกเพื่อเลือกรูป (เลือกได้หลายรูป) · รูปแรกเป็นรูปหลักถ้ายังว่าง · ระบบย่อรูปและตั้งชื่อให้เอง</span></div>
      <input type="file" class="pd-file" accept="image/*" multiple hidden>
      <div class="rv-adv-row"><button type="button" class="btn btn-ghost btn-sm" data-act="pd-pickdir">เลือกโฟลเดอร์เว็บ</button><span class="rv-adv-note" id="pdDirName">${window.showDirectoryPicker ? '' : 'ต้องเปิดด้วย Chrome หรือ Edge บนคอมพิวเตอร์'}</span></div>
      <div id="pdOut"></div>
      ${pdPendingHtml()}
      ${all.length ? `<div class="pd-grid">${tiles}</div>` : '<p class="group-note" style="margin:10px 0 0">ยังไม่มีรูป ลากรูปมาวางด้านบนได้เลย</p>'}
      <details class="rv-old"><summary>วิธีเดิม: พิมพ์พาธรูปเอง</summary>
      <p class="group-note">ใส่เป็นที่อยู่ไฟล์ในโฟลเดอร์ images เช่น images/bouquet/ช่อทานตะวัน/เล็ก.jpg — ต้องอัปโหลดไฟล์รูปขึ้นเว็บแยกต่างหากก่อน · รูปของแต่ละตัวเลือกใส่ในการ์ด “ตัวแปร”</p>
      <div class="img-field">
        <label class="field">
          <span>รูปหลัก</span>
          <input type="text" data-bind="image" value="${esc(draft.image || '')}" placeholder="images/…">
        </label>
        ${thumbHtml(draft.image)}
      </div>
      <div style="margin-top:14px">
        <span class="field" style="margin:0"><span>รูปเพิ่มเติม (แกลเลอรี)</span></span>
        ${imageListHtml(draft.images, 'images')}
      </div>
      </details>
    </div>`;
}

/* --- แท็บ 3: ราคา --- */

function comboList(options){
  // สร้างทุกคู่ผสมที่เป็นไปได้จากตัวเลือกทุกชั้น
  return (options || []).reduce((acc, opt) => {
    const vals = opt.values && opt.values.length ? opt.values : [];
    const out = [];
    for(const base of acc) for(const v of vals) out.push([...base, v]);
    return out;
  }, [[]]);
}

function variantFor(combo){
  return (draft.variants || []).find(v =>
    Array.isArray(v.match) && v.match.length === combo.length && v.match.every((m, i) => m === combo[i]));
}


/* ───────── ตารางค่าตัวเลือก: ค้นหา · แก้หลายแถว · แถวละบรรทัด ───────── */

let comboQuery = '';
let comboQueryFor = null;   // ผูกคำค้นกับสินค้าที่กำลังแก้ ถ้าเปลี่ยนสินค้าให้ล้างคำค้น

function comboQ(){
  if(comboQueryFor !== draft){ comboQueryFor = draft; comboQuery = ''; }
  return comboQuery.trim().toLowerCase();
}
function comboMatches(c, v){
  const q = comboQ();
  if(!q) return true;
  return (c.join(' ') + ' ' + (v ? (v.image || '') : '')).toLowerCase().includes(q);
}
function comboMoreLabel(v){
  const n = v ? (v.images || []).filter(x => String(x || '').trim()).length : 0;
  return n ? `📷 +${n}` : '📷 เพิ่ม';
}

function comboToolsHtml(combos){
  const tags = comboTagChoices(draft.cat, '');
  return `
    <div class="combo-tools">
      <input type="search" id="comboSearch" value="${esc(comboQuery)}" placeholder="ค้นหาในตัวเลือก เช่น ขาว หรือ Birthday" autocomplete="off">
      <span class="combo-vis" id="comboVis"></span>
    </div>
    <div class="combo-bulk">
      <span class="cb-label">ทำกับแถวที่แสดงอยู่</span>
      <button type="button" class="btn btn-ghost btn-sm" data-cb="sell-on">ขายทั้งหมด</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cb="sell-off">ปิดขายทั้งหมด</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cb="ready-on">พร้อมส่งทั้งหมด</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cb="ready-off">ยกเลิกพร้อมส่ง</button>
      <span class="cb-set"><input type="number" id="cbPrice" min="0" step="1" placeholder="ราคา"><button type="button" class="btn btn-ghost btn-sm" data-cb="price">ตั้งราคา</button></span>
      <span class="cb-set"><select id="cbTag">${tags.map(([val, label]) => `<option value="${esc(val)}">${esc(label)}</option>`).join('')}</select><button type="button" class="btn btn-ghost btn-sm" data-cb="tag">ตั้งขนาด</button></span>
    </div>`;
}

function comboRowHtml(c, ci){
  const v = variantFor(c);
  const filtered = comboMatches(c, v) ? '' : ' is-filtered';
  return `
              <tbody class="combo-item${v ? '' : ' is-off'}${filtered}" data-ci="${ci}">
                <tr>
                  <td class="c-sell"><input type="checkbox" data-act="toggle-combo" data-ci="${ci}"${v ? ' checked' : ''} aria-label="ขาย"></td>
                  <td class="c-ready"><label><input type="checkbox" data-combo-ready="${ci}"${v && v.ready ? ' checked' : ''}${v ? '' : ' disabled'}><span class="c-lbl">พร้อมส่ง</span></label></td>
                  <td class="c-thumb"><button type="button" class="combo-thumb" data-combo-path="${ci}" title="กดเพื่อเปลี่ยนรูปหลัก / แก้พาธ"${v ? '' : ' disabled'}>${thumbHtml(v ? v.image : '', 'combo-thumb-img')}</button></td>
                  <td class="combo-combo">${c.map(esc).join(' · ')}</td>
                  <td class="c-price"><input type="number" min="0" step="1" data-combo-price="${ci}" value="${v ? (num(v.price) || '') : ''}" placeholder="${v ? 'ราคา' : 'ไม่ขาย'}" aria-label="ราคา"></td>
                  <td class="c-tag"><select data-combo-tag="${ci}"${v ? '' : ' disabled'}>${comboTagChoices(draft.cat, v && v.tag).map(([val, label]) => `<option value="${esc(val)}"${(v && v.tag || '') === val ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></td>
                  <td class="c-more"><button type="button" class="btn btn-ghost btn-sm combo-more" data-combo-more="${ci}"${v ? '' : ' disabled'} title="รูปเพิ่มเติมที่ลูกค้าเห็นต่อจากรูปหลัก">${comboMoreLabel(v)}</button></td>
                </tr>
                <tr class="combo-imgrow" hidden>
                  <td colspan="7">
                    <label class="combo-pathlabel"><span>พาธรูปหลัก</span>
                      <input type="text" data-combo-image="${ci}" value="${v ? esc(v.image || '') : ''}" placeholder="images/…" autocomplete="off"${v ? '' : ' disabled'}>
                    </label>
                  </td>
                </tr>
              </tbody>`;
}

function updateComboVis(){
  const items = [...document.querySelectorAll('#panelPrice .combo-item')];
  const shown = items.filter(t => !t.classList.contains('is-filtered')).length;
  const el = $('comboVis');
  if(el) el.textContent = comboQ() ? `แสดง ${shown} จาก ${items.length} แถว` : `ทั้งหมด ${items.length} แถว`;
}

function applyComboFilter(){
  const combos = comboList(draft.options);
  document.querySelectorAll('#panelPrice .combo-item').forEach(t => {
    const c = combos[+t.dataset.ci];
    t.classList.toggle('is-filtered', !comboMatches(c, variantFor(c)));
  });
  updateComboVis();
}

async function comboBulk(kind){
  if(!draft) return;
  const combos = comboList(draft.options);
  const vis = combos.map((c, ci) => ({ c, ci, v: variantFor(c) })).filter(x => comboMatches(x.c, x.v));
  if(!vis.length){ toast('ไม่มีแถวที่แสดงอยู่', true); return; }
  draft.variants = draft.variants || [];
  const sellable = vis.filter(x => x.v);

  if(kind === 'sell-on'){
    let n = 0;
    vis.forEach(x => { if(!x.v){ draft.variants.push({ match: x.c.slice(), price: 0, image: '' }); n++; } });
    toast(n ? `เปิดขาย ${n} แถว (อย่าลืมใส่ราคา)` : 'ทุกแถวที่แสดงเปิดขายอยู่แล้ว');
  } else if(kind === 'sell-off'){
    if(!sellable.length){ toast('ไม่มีแถวที่เปิดขายอยู่'); return; }
    const ok = await askConfirm('ปิดขายทั้งหมด', `ปิดขาย ${sellable.length} แถวที่แสดงอยู่ ราคา รูป และพร้อมส่งของแถวเหล่านี้จะหายไป ทำต่อไหม`, 'ปิดขาย');
    if(!ok) return;
    const drop = new Set(sellable.map(x => x.v));
    draft.variants = draft.variants.filter(v => !drop.has(v));
  } else if(kind === 'ready-on' || kind === 'ready-off'){
    if(!sellable.length){ toast('ไม่มีแถวที่เปิดขายในรายการที่แสดง', true); return; }
    sellable.forEach(x => { if(kind === 'ready-on') x.v.ready = true; else delete x.v.ready; });
    toast(`${kind === 'ready-on' ? 'ตั้งพร้อมส่ง' : 'ยกเลิกพร้อมส่ง'} ${sellable.length} แถว`);
  } else if(kind === 'price'){
    const price = num($('cbPrice').value);
    if(price <= 0){ toast('ใส่ราคาก่อน', true); $('cbPrice').focus(); return; }
    if(!sellable.length){ toast('ไม่มีแถวที่เปิดขายในรายการที่แสดง', true); return; }
    sellable.forEach(x => { x.v.price = price; });
    toast(`ตั้งราคา ${price} บาท ให้ ${sellable.length} แถว`);
  } else if(kind === 'tag'){
    const tag = $('cbTag').value;
    if(!sellable.length){ toast('ไม่มีแถวที่เปิดขายในรายการที่แสดง', true); return; }
    sellable.forEach(x => { if(tag) x.v.tag = tag; else delete x.v.tag; });
    toast(`ตั้งขนาดให้ ${sellable.length} แถว`);
  }
  renderPricePanel();
  updateSummaries();
}

function colorsBlockHtml(){
  const colors = draft.colors || [];
  return `
    <div class="group">
      <div class="group-head">
        <h3>ตัวแปร: สี</h3>
        <button class="btn btn-ghost btn-sm" data-act="add-color">+ เพิ่มสี</button>
      </div>
      <p class="group-note">ทุกสีใช้ราคาเดียวกันจากการ์ดแรก ลูกค้ากดเลือกสีแล้วรูปจะเปลี่ยนตาม</p>
      ${colors.length ? colors.map((c, k) => `
        <div class="item-card">
          <div class="item-card-head">
            <span class="item-no">สีที่ ${k + 1}</span>
            <span class="spacer"></span>
            <button class="icon-btn" data-act="move-color" data-k="${k}" data-d="-1" ${k === 0 ? 'disabled' : ''} title="เลื่อนขึ้น">↑</button>
            <button class="icon-btn" data-act="move-color" data-k="${k}" data-d="1" ${k === colors.length - 1 ? 'disabled' : ''} title="เลื่อนลง">↓</button>
            <button class="icon-btn" data-act="rm-color" data-k="${k}" title="ลบสีนี้">✕</button>
          </div>
          <label class="check" style="margin:0 0 12px">
            <input type="checkbox" data-bind="colors.${k}.ready" data-type="bool"${c.ready ? ' checked' : ''}>
            <span>สีนี้ทำไว้แล้ว พร้อมส่ง</span>
          </label>
          <label class="field">
            <span>ชื่อสี</span>
            <input type="text" data-bind="colors.${k}.name" value="${esc(c.name || '')}" placeholder="เช่น ขาว, แบบที่ 1">
          </label>
          <div class="img-field">
            <label class="field">
              <span>รูปสินค้าของสีนี้</span>
              <input type="text" data-bind="colors.${k}.image" value="${esc(c.image || '')}" placeholder="images/…">
            </label>
            ${thumbHtml(c.image)}
          </div>
          ${pdRowDropHtml(`colors.${k}`)}
          <div style="margin-top:12px">
            <span class="field" style="margin:0"><span>รูปเพิ่มเติมของสีนี้</span></span>
            ${imageListHtml(c.images, `colors.${k}.images`)}
          </div>
          <div style="margin-top:12px">
            <span class="field" style="margin:0"><span>ของเสริมเฉพาะสีนี้</span></span>
            ${addonsEditorHtml(c.addons, `colors.${k}.addons`, 'color-addon', k)}
          </div>
        </div>`).join('') : '<p class="field-hint" style="margin:0">ยังไม่มีสี</p>'}
    </div>`;
}

function renderPricePanel(){
  (draft.variants || []).forEach(normalizeRowImages);
  (draft.sizes || []).forEach(normalizeRowImages);
  const mode = priceMode(draft);
  const hasColors = (draft.colors || []).length > 0;
  let body = '';

  // ---- ไม่มีตัวแปร ----
  if(mode === 'single' && !hasColors){
    body = `
      <div class="group var-empty">
        <p class="var-empty-title">ยังไม่มีตัวแปร</p>
        <p class="group-note" style="margin:0 0 12px">สินค้านี้ขายแบบเดียว ใช้ราคาและสถานะพร้อมส่งจากการ์ดแรก ถ้ามีหลายแบบ (เช่น ปกติ / ใส่เงิน) ให้เพิ่มตัวแปร แล้วตั้งราคา รูป และพร้อมส่งแยกแต่ละค่า</p>
        <button class="btn btn-ghost" data-act="add-var">+ เพิ่มตัวแปร</button>
      </div>`;
  }

  // ---- สินค้าเดิมที่ใช้ "สี" (ราคาเท่ากันทุกสี) ----
  if(mode === 'single' && hasColors){
    body = colorsBlockHtml() + `
      <div class="group var-foot">
        <button class="btn btn-ghost btn-sm" data-act="to-options">เปลี่ยนเป็นตัวแปรแบบตั้งราคาแยกแต่ละสี / เพิ่มตัวแปรอื่น</button>
      </div>`;
  }

  // ---- สินค้าเดิมที่ใช้ "ไซซ์" ----
  if(mode === 'sizes'){
    const sizes = draft.sizes || [];
    body = `
      <div class="group">
        <div class="group-head">
          <h3>ตัวแปร: ไซซ์</h3>
          <button class="btn btn-ghost btn-sm" data-act="add-size">+ เพิ่มค่า</button>
        </div>
        <p class="group-note">ราคาที่ถูกที่สุดจะถูกใช้เป็นราคาเริ่มต้นที่โชว์บนการ์ดสินค้าในหน้าร้าน</p>
        ${sizes.length ? sizes.map((s, k) => `
          <div class="item-card">
            <div class="item-card-head">
              <span class="item-no">ค่าที่ ${k + 1}</span>
              <span class="spacer"></span>
              <button class="icon-btn" data-act="rm-size" data-k="${k}" title="ลบค่านี้">✕</button>
            </div>
            <label class="check" style="margin:0 0 12px">
              <input type="checkbox" data-bind="sizes.${k}.ready" data-type="bool"${s.ready ? ' checked' : ''}>
              <span>ทำไว้แล้ว พร้อมส่ง</span>
            </label>
            <div class="field-row">
              <label class="field">
                <span>ชื่อค่าตัวเลือก</span>
                <input type="text" data-bind="sizes.${k}.name" value="${esc(s.name || '')}" placeholder="เช่น ดอกใหญ่">
              </label>
              <label class="field">
                <span>ราคา (บาท)</span>
                <input type="number" min="0" step="1" data-bind="sizes.${k}.price" data-type="number" value="${num(s.price) || ''}">
              </label>
            </div>
            <div class="img-field">
              <label class="field">
                <span>รูปสินค้า</span>
                <input type="text" data-bind="sizes.${k}.image" value="${esc(s.image || '')}" placeholder="images/…">
              </label>
              ${thumbHtml(s.image)}
            </div>
            ${pdRowDropHtml(`sizes.${k}`)}
            <div style="margin-top:12px">
              <span class="field" style="margin:0"><span>รูปเพิ่มเติมของค่านี้</span></span>
              ${imageListHtml(s.images, `sizes.${k}.images`)}
            </div>
            <label class="field" style="margin-top:12px">
              <span>ตัวกรองขนาด (หน้าร้าน)</span>
              <select data-bind="sizes.${k}.tag">
                <option value="">อัตโนมัติ (ตามชื่อ)</option>
                ${sizeChoicesFor(s.tag, draft.cat).map(t => `<option value="${esc(t)}"${(s.tag || '') === t ? ' selected' : ''}>${esc(sizeTagLabel(draft.cat, t))}</option>`).join('')}
              </select>
            </label>
          </div>`).join('')
        : '<p class="field-hint" style="margin:0">ยังไม่มีค่า กด “เพิ่มค่า” เพื่อเริ่ม</p>'}
      </div>
      ${hasColors ? colorsBlockHtml() : ''}
      <div class="group var-foot">
        <button class="btn btn-ghost btn-sm" data-act="to-options">เพิ่มตัวแปรอีกชั้น (เช่น สี × ไซซ์)</button>
        <button class="btn btn-ghost btn-sm is-danger" data-act="clear-vars">เลิกใช้ตัวแปร</button>
      </div>`;
  }

  // ---- ตัวแปรหลายชั้น (options + variants) ----
  if(mode === 'options'){
    const options = draft.options || [];
    const combos = comboList(options);
    const sellable = combos.filter(c => variantFor(c)).length;
    body = `
      <div class="group">
        <div class="group-head">
          <h3>ตัวแปร</h3>
          <button class="btn btn-ghost btn-sm" data-act="edit-vars">แก้ไขตัวเลือก</button>
        </div>
        <div class="vsum">
          ${options.map(o => `
            <div class="vsum-row">
              <b>${esc(o.name || '(ยังไม่มีชื่อ)')}</b>
              <div class="value-chips">${(o.values || []).map(v => `<span class="value-chip" style="padding:4px 12px">${esc(v)}</span>`).join('')}</div>
            </div>`).join('')}
        </div>
      </div>

      ${combos.length && combos[0].length ? `
      <div class="group">
        <div class="group-head"><h3>ราคา รูป และสถานะของแต่ละค่า</h3></div>
        <p class="group-note">ติ๊ก “ขาย” เฉพาะแบบที่ทำขายจริง ที่ไม่ติ๊กจะถูกปิดไม่ให้ลูกค้ากดเลือกในหน้าร้าน — เปิดขายอยู่ <span id="comboCount">${sellable}</span> จาก ${combos.length} แบบ</p>
        ${comboToolsHtml(combos)}
        <div class="combo-scroll">
          <table class="combo-table">
            <thead>
              <tr>
                <th class="c-sell">ขาย</th>
                <th class="c-ready">พร้อมส่ง</th>
                <th class="c-thumb">รูป</th>
                <th>ค่าตัวเลือก</th>
                <th class="c-price">ราคา</th>
                <th class="c-tag">ตัวกรองขนาด</th>
                <th class="c-more">แกลเลอรี</th>
              </tr>
            </thead>
            ${combos.map((c, ci) => comboRowHtml(c, ci)).join('')}
          </table>
        </div>
      </div>` : ''}
      <div class="group var-foot">
        <button class="btn btn-ghost btn-sm is-danger" data-act="clear-vars">เลิกใช้ตัวแปร</button>
      </div>`;
  }

  $('panelPrice').innerHTML = body;
  if(mode === 'options') updateComboVis();
}

/* --- แท็บ 4: ของเสริม --- */

function addonsEditorHtml(arr, pathPrefix, addAct, colorIndex){
  const list = arr || [];
  return `
    ${list.map((a, k) => `
      <div class="item-card">
        <div class="item-card-head">
          <span class="item-no">ของเสริมที่ ${k + 1}</span>
          <span class="spacer"></span>
          <button class="icon-btn" data-act="rm-addon" data-path="${pathPrefix}" data-k="${k}" title="ลบ">✕</button>
        </div>
        <div class="field-row">
          <label class="field">
            <span>ชื่อของเสริม</span>
            <input type="text" data-bind="${pathPrefix}.${k}.name" value="${esc(a.name || '')}" placeholder="เช่น ผึ้งน้อย">
          </label>
          <label class="field">
            <span>ราคาเพิ่ม (บาท)</span>
            <input type="number" min="0" step="1" data-bind="${pathPrefix}.${k}.price" data-type="number" value="${num(a.price) || ''}">
          </label>
        </div>
        <div class="img-field">
          <label class="field">
            <span>รูปตอนใส่ของเสริมนี้</span>
            <input type="text" data-bind="${pathPrefix}.${k}.image" value="${esc(a.image || '')}" placeholder="images/…">
          </label>
          ${thumbHtml(a.image)}
        </div>
        ${pdRowDropHtml(`${pathPrefix}.${k}`, true)}
        <label class="check" style="margin:12px 0 0">
          <input type="checkbox" data-bind="${pathPrefix}.${k}.ready" data-type="bool"${a.ready ? ' checked' : ''}>
          <span>ทำแบบใส่ของเสริมนี้ไว้แล้ว พร้อมส่ง</span>
        </label>
      </div>`).join('')}
    <button class="add-line" data-act="${addAct}" data-path="${pathPrefix}"${colorIndex != null ? ` data-k="${colorIndex}"` : ''}>+ เพิ่มของเสริม</button>`;
}

function renderAddonsPanel(){
  const usedOnColors = (draft.colors || []).some(c => (c.addons || []).length);
  $('panelAddons').innerHTML = `
    <div class="group">
      <div class="group-head"><h3>ของเสริมของสินค้าชิ้นนี้</h3></div>
      <p class="group-note">ลูกค้ากดเปิด/ปิดได้เอง เลือกพร้อมกันหลายอย่างได้ ราคาจะบวกเพิ่มจากราคาสินค้า${
        (draft.colors || []).length
          ? ' — สินค้าชิ้นนี้มีสีให้เลือก ถ้าของเสริมมีเฉพาะบางสี ให้ไปใส่ในการ์ด “ตัวแปร” แทน'
          : ''}</p>
      ${addonsEditorHtml(draft.addons, 'addons', 'add-addon')}
      ${usedOnColors ? '<p class="field-hint">หมายเหตุ: ตอนนี้มีของเสริมที่ผูกกับสีอยู่แล้วในการ์ด “ตัวแปร”</p>' : ''}
    </div>`;
}

/* ───────────────── ผูกค่าจากช่องกรอกเข้ากับ draft ───────────────── */

// ตัวเลือกตัวกรองขนาดต่อ "คู่ผสม" — ค่าว่าง = อัตโนมัติ (หน้าร้านเดาจากคำว่า "ใส่เงิน" ในชื่อแบบ เหมือนเดิม)
// ตัวเลือก "ตัวกรองขนาด" ของแต่ละคู่ผสม ตามหมวดของสินค้า (+ ค่าเดิมที่ตั้งไว้แล้วแต่ไม่อยู่ในหมวด จะมีหมายเหตุกำกับ)
function comboTagChoices(cat, current){
  const auto = ['', cat === 'ช่อดอกไม้' ? 'อัตโนมัติ (ตามชื่อ)' : 'ไม่กำหนด'];
  return [auto, ...sizeChoicesFor(current ? [current] : [], cat).map(t => [t, sizeTagLabel(cat, t)])];
}

function onDraftInput(e){
  const el = e.target;
  if(!draft) return;

  if(el.dataset.bind){
    const type = el.dataset.type;
    let val;
    if(type === 'bool') val = el.checked;
    else if(type === 'number') val = num(el.value);
    else val = el.value;
    setPath(draft, el.dataset.bind, val);

    // เปลี่ยนหมวด → ตัวเลือกขนาดเปลี่ยนตาม ต้องวาดแผงข้าง/การ์ดราคาใหม่ และเตือนถ้ามีค่าเดิมที่ไม่เข้าหมวดใหม่
    if(el.dataset.bind === 'cat'){
      renderMainPanel();
      renderPricePanel();
      const bad = offListSizeTags(draft);
      if(bad.length) toast(`ค่าขนาด “${bad.join(', ')}” ไม่อยู่ในตัวกรองของหมวด ${val} กรุณาเลือกใหม่`, true);
      return;
    }

    // อัปเดตรูปตัวอย่างข้างช่องทันทีโดยไม่ต้องวาดใหม่ทั้งแท็บ (ไม่งั้นเคอร์เซอร์จะเด้ง)
    if(/(^|\.)image$|(^|\.)images\.\d+$/.test(el.dataset.bind)){
      const box = el.closest('.img-field') || el.closest('.img-list-row');
      const img = box && box.querySelector('img, .img-preview');
      if(img && img.tagName === 'IMG'){
        img.classList.remove('is-missing');
        if(el.value) img.src = el.value; else img.removeAttribute('src');
      }
    }
    return;
  }

  if(el.dataset.comboPrice != null){
    const combo = comboList(draft.options)[+el.dataset.comboPrice];
    let v = variantFor(combo);
    // พิมพ์ราคาในแถวที่ปิดขาย = เปิดขายแถวนั้นให้เลย
    if(!v && num(el.value) > 0){
      const cb = el.closest('tbody').querySelector('[data-act="toggle-combo"]');
      cb.checked = true;
      onComboToggle({ target: cb });
      v = variantFor(combo);
    }
    if(v) v.price = num(el.value);
    return;
  }

  if(el.dataset.comboImage != null){
    const combo = comboList(draft.options)[+el.dataset.comboImage];
    const v = variantFor(combo);
    // พาธบนเว็บต้องใช้ / (ไม่ใช่ \ ของ Windows)
    if(el.value.includes('\\')){
      const pos = el.selectionStart;
      el.value = el.value.replace(/\\/g, '/');
      try{ el.setSelectionRange(pos, pos); }catch(_){}
    }
    if(v) v.image = el.value;
    const img = el.closest('tbody').querySelector('.combo-thumb-img');
    if(img){
      const s = el.value.trim();
      if(s){ img.classList.remove('is-missing'); img.src = s; } else { img.removeAttribute('src'); img.classList.add('is-missing'); }
    }
    return;
  }

  if(el.dataset.comboReady != null){
    const combo = comboList(draft.options)[+el.dataset.comboReady];
    const v = variantFor(combo);
    if(v) v.ready = el.checked;
    return;
  }

  if(el.dataset.comboTag != null){
    const combo = comboList(draft.options)[+el.dataset.comboTag];
    const v = variantFor(combo);
    if(v){ if(el.value) v.tag = el.value; else delete v.tag; }
  }
}

/* ───────────────── ปุ่มต่างๆ ในตัวแก้ไข ───────────────── */

function onDraftClick(e){
  const btn = e.target.closest('[data-act]');
  if(!btn || !draft) return;
  const act = btn.dataset.act;
  const k = btn.dataset.k != null ? +btn.dataset.k : null;
  const path = btn.dataset.path;

  switch(act){
    case 'add-var':
    case 'edit-vars':
      openVarModal();
      return;

    case 'to-options':
      convertToOptions();
      return;

    case 'clear-vars':
      clearVariables();
      return;

    case 'pd-pickdir':
      rvGetRoot(true);
      return;
    case 'pd-pending-done':
      pdPendingSet([]);
      renderMediaPanel();
      return;
    case 'pd-main': case 'pd-left': case 'pd-right': case 'pd-rm': {
      const all = pdAll(), i = +btn.dataset.k;
      if(i < 0 || i >= all.length) return;
      if(act === 'pd-main'){ all.unshift(all.splice(i, 1)[0]); }
      else if(act === 'pd-left' && i > 0){ [all[i - 1], all[i]] = [all[i], all[i - 1]]; }
      else if(act === 'pd-right' && i < all.length - 1){ [all[i + 1], all[i]] = [all[i], all[i + 1]]; }
      else if(act === 'pd-rm'){ all.splice(i, 1); }
      pdSetAll(all);
      pdRefresh();
      return;
    }
    case 'add-img': {
      const arr = getPath(draft, path) || [];
      arr.push('');
      setPath(draft, path, arr);
      if(path.startsWith('colors.') || path.startsWith('sizes.')) renderPricePanel(); else renderMediaPanel();
      return;
    }
    case 'rm-img': {
      const arr = getPath(draft, path) || [];
      arr.splice(+btn.dataset.k, 1);
      if(!arr.length) setPath(draft, path, undefined);
      if(path.startsWith('colors.') || path.startsWith('sizes.')) renderPricePanel(); else renderMediaPanel();
      return;
    }

    case 'add-color':
      draft.colors = draft.colors || [];
      draft.colors.push({ name:'', image:'' });
      renderPricePanel();
      return;
    case 'rm-color':
      draft.colors.splice(k, 1);
      if(!draft.colors.length) delete draft.colors;
      renderMainPanel();
      renderPricePanel();
      renderAddonsPanel();
      return;
    case 'move-color': {
      const d = +btn.dataset.d, j = k + d;
      if(j < 0 || j >= draft.colors.length) return;
      [draft.colors[k], draft.colors[j]] = [draft.colors[j], draft.colors[k]];
      renderPricePanel();
      return;
    }

    case 'add-size':
      draft.sizes = draft.sizes || [];
      draft.sizes.push({ name:'', price:0, image:'' });
      renderPricePanel();
      return;
    case 'rm-size':
      draft.sizes.splice(k, 1);
      renderPricePanel();
      return;

    case 'add-addon':
      draft.addons = draft.addons || [];
      draft.addons.push({ name:'', price:0, image:'' });
      renderAddonsPanel();
      return;
    case 'color-addon':
      draft.colors[k].addons = draft.colors[k].addons || [];
      draft.colors[k].addons.push({ name:'', price:0, image:'' });
      renderPricePanel();
      return;
    case 'rm-addon': {
      const arr = getPath(draft, path) || [];
      arr.splice(k, 1);
      if(!arr.length) setPath(draft, path, undefined);
      if(path.startsWith('colors.')) renderPricePanel(); else renderAddonsPanel();
      return;
    }
  }
}

// แปลง "สี" (ราคาเท่ากันทุกสี) หรือ "ไซซ์" ของสินค้าเดิม ให้เป็นตัวแปรแบบ options เพื่อเพิ่มตัวแปรอื่นหรือตั้งราคาแยกได้
async function convertToOptions(){
  const mode = priceMode(draft);
  const str = v => String(v ?? '').trim();
  if(mode === 'sizes'){
    const sizes = (draft.sizes || []).filter(s => str(s.name));
    if(!sizes.length){ toast('เพิ่มค่าไซซ์ก่อน', true); return; }
    draft.options = [{ name:'ไซซ์', values: sizes.map(s => str(s.name)) }];
    draft.variants = sizes.map(s => {
      const o = { match:[str(s.name)], price: num(s.price), image: s.image || '' };
      if((s.images || []).length) o.images = s.images.slice();
      if(s.tag) o.tag = s.tag;
      if(s.ready) o.ready = true;
      return o;
    });
    delete draft.sizes; delete draft.price;
  }else{
    const colors = (draft.colors || []).filter(c => str(c.name));
    if(!colors.length){ toast('เพิ่มสีก่อน', true); return; }
    const losing = colors.some(c => (c.addons || []).length);
    if(losing){
      const ok = await askConfirm('เปลี่ยนเป็นตัวแปร', 'ของเสริมเฉพาะสีจะหายไป (ตัวแปรเก็บของเสริมรายแถวไม่ได้ ส่วนรูปทุกรูปยังติดไปครบ) ทำต่อไหม', 'เปลี่ยน');
      if(!ok) return;
    }
    const base = num(draft.price);
    draft.options = [{ name:'สี', values: colors.map(c => str(c.name)) }];
    draft.variants = colors.map(c => {
      const o = { match:[str(c.name)], price: base, image: c.image || '' };
      if((c.images || []).length) o.images = c.images.slice();
      if(c.ready) o.ready = true;
      return o;
    });
    delete draft.colors; delete draft.price;
  }
  renderMainPanel();
  renderPricePanel();
  renderAddonsPanel();
  updateSummaries();
}

async function clearVariables(){
  const ok = await askConfirm('เลิกใช้ตัวแปร', 'ราคา รูป และพร้อมส่งของแต่ละค่าจะหายไป สินค้ากลับไปขายราคาเดียว (ตั้งราคาที่การ์ดแรก) ทำต่อไหม', 'เลิกใช้ตัวแปร');
  if(!ok) return;
  const min = Math.min(...(draft.sizes || []).map(s => num(s.price)).filter(Boolean), Infinity);
  delete draft.sizes; delete draft.options; delete draft.variants;
  draft.price = Number.isFinite(min) ? min : 0;
  renderMainPanel();
  renderPricePanel();
  updateSummaries();
}

/* ───────────────── หน้าต่าง "สร้างตัวเลือก" ───────────────── */

let vm = null;   // { rows:[{name, values:[], orig}], hadVariants } ขณะหน้าต่างเปิดอยู่

function openVarModal(){
  const old = draft.options || [];
  vm = {
    rows: old.length
      ? old.map((o, i) => ({ name: o.name || '', values: (o.values || []).slice(), orig: i }))
      : [{ name:'', values:[], orig:null }],
    dragFrom: null
  };
  $('varTitle').textContent = old.length ? 'แก้ไขตัวเลือก' : 'สร้างตัวเลือก';
  $('varScrim').hidden = false;
  renderVarModal(old.length ? null : { row:0, field:'name' });
}

function closeVarModal(){
  $('varScrim').hidden = true;
  vm = null;
}

// อ่านค่าที่ยังพิมพ์ค้างในช่องจากหน้าจอ (ชื่อตัวเลือก + ค่าที่ยังไม่ได้กด Enter)
function readVarModalInputs(){
  if(!vm) return;
  document.querySelectorAll('#varBody [data-vm-name]').forEach(inp => { vm.rows[+inp.dataset.vmName].name = inp.value; });
  document.querySelectorAll('#varBody [data-vm-newval]').forEach(inp => { vm.rows[+inp.dataset.vmNewval].pending = inp.value; });
}

function renderVarModal(focus){
  $('varBody').innerHTML = vm.rows.map((r, i) => `
    <div class="vm-row" data-vm-row="${i}">
      <span class="vm-handle" draggable="true" data-vm-handle="${i}" title="ลากเพื่อเรียงลำดับ">☰</span>
      <label class="vm-name">
        <span class="vm-label">ชื่อตัวเลือก</span>
        <input type="text" data-vm-name="${i}" value="${esc(r.name)}" placeholder="เช่น สี, แบบ" autocomplete="off">
      </label>
      <div class="vm-vals">
        <span class="vm-label">ค่าตัวเลือก</span>
        <div class="vm-chips">
          ${r.values.map((v, vi) => `<span class="vm-chip" data-vm-chip="${i}" data-vi="${vi}" title="${r.values.length > 1 ? 'ลากเพื่อเรียงลำดับ (จอสัมผัส: กดค้างแล้วลาก)' : ''}">${esc(v)}<button type="button" data-vm-rmval="${i}" data-vi="${vi}" aria-label="ลบ ${esc(v)}">✕</button></span>`).join('')}
        </div>
        <input type="text" class="vm-newval" data-vm-newval="${i}" value="${esc(r.pending || '')}" placeholder="${r.values.length ? '' : 'ค่าตัวเลือก'}" autocomplete="off">
        <small>กด Enter เพื่อเพิ่มค่า</small>
      </div>
      <button type="button" class="vm-del" data-vm-delrow="${i}" title="ลบตัวเลือกนี้" ${vm.rows.length === 1 ? 'disabled' : ''}>🗑</button>
    </div>`).join('');
  refreshVarModal();
  if(focus){
    const sel = focus.field === 'name' ? `[data-vm-name="${focus.row}"]` : `[data-vm-newval="${focus.row}"]`;
    const el = $('varBody').querySelector(sel);
    if(el) el.focus();
  }
}

// ตัวเลือกที่สมบูรณ์ (รวมค่าที่พิมพ์ค้างไว้แต่ยังไม่ได้กด Enter) + ปัญหาที่ทำให้ยังบันทึกไม่ได้
function collectVarModal(){
  readVarModalInputs();
  const rows = vm.rows.map((r, i) => {
    const pending = r.pending;
    const values = r.values.slice();
    const p = String(pending || '').trim();
    if(p && !values.includes(p)) values.push(p);
    return { name: r.name.trim(), values, orig: r.orig };
  });
  const filled = rows.filter(r => r.name || r.values.length);
  let problem = '';
  if(!filled.length) problem = 'ใส่ชื่อและค่าตัวเลือกอย่างน้อย 1 อย่าง';
  else{
    const noName = filled.find(r => !r.name);
    const noVals = filled.find(r => !r.values.length);
    const names = filled.map(r => r.name);
    if(noName) problem = 'มีตัวเลือกที่ยังไม่ได้ตั้งชื่อ';
    else if(noVals) problem = `ตัวเลือก “${noVals.name}” ยังไม่มีค่า`;
    else if(new Set(names).size !== names.length) problem = 'ชื่อตัวเลือกซ้ำกัน';
  }
  return { rows: filled, problem };
}

function refreshVarModal(){
  const { problem } = collectVarModal();
  $('varSave').disabled = !!problem;
  $('varHint').textContent = problem && vm.rows.some(r => r.name || r.values.length) ? problem : '';
}

function addVarValue(i){
  const inp = $('varBody').querySelector(`[data-vm-newval="${i}"]`);
  const v = inp.value.trim();
  if(!v) return;
  if(vm.rows[i].values.includes(v)){ toast('มีค่านี้อยู่แล้ว', true); return; }
  readVarModalInputs();
  vm.rows[i].values.push(v);
  vm.rows[i].pending = '';
  renderVarModal({ row:i, field:'val' });
}

async function saveVarModal(){
  const { rows, problem } = collectVarModal();
  if(problem) return;
  const old = draft.options || [];
  const oldVariants = draft.variants || [];

  // แถวราคา/รูป/พร้อมส่งเดิม เก็บไว้ได้ก็ต่อเมื่อจำนวนตัวเลือกเท่าเดิม (แค่สลับลำดับ/เพิ่มลบค่าได้)
  let kept = [];
  const sameShape = rows.length === old.length && rows.every(r => r.orig != null) && new Set(rows.map(r => r.orig)).size === rows.length;
  if(sameShape){
    kept = oldVariants
      .filter(v => (v.match || []).length === old.length && rows.every(r => r.values.includes(v.match[r.orig])))
      .map(v => Object.assign({}, v, { match: rows.map(r => v.match[r.orig]) }));
  }
  const lost = oldVariants.length - kept.length;
  if(lost > 0){
    const ok = await askConfirm('ยืนยันการแก้ไขตัวเลือก', `การเปลี่ยนนี้ทำให้ราคา/รูป/พร้อมส่งของ ${lost} แบบเดิมหายไป ต้องตั้งใหม่ ทำต่อไหม`, 'ทำต่อ');
    if(!ok) return;
  }

  // ตัวเลือกเดียว: ทุกค่าคือแถวขายอยู่แล้ว สร้างแถวให้ครบเลย (ไม่ต้องติ๊ก "ขาย" ทีละแถว)
  if(rows.length === 1){
    rows[0].values.forEach(val => {
      if(!kept.some(v => v.match[0] === val)) kept.push({ match:[val], price:0, image:'' });
    });
    kept.sort((x, y) => rows[0].values.indexOf(x.match[0]) - rows[0].values.indexOf(y.match[0]));
  }

  draft.options = rows.map(r => ({ name: r.name, values: r.values }));
  draft.variants = kept;
  delete draft.sizes;
  delete draft.price;
  closeVarModal();
  renderMainPanel();
  renderPricePanel();
  updateSummaries();
}

$('varBody').addEventListener('input', e => { if(e.target.dataset.vmName != null || e.target.dataset.vmNewval != null) refreshVarModal(); });
$('varBody').addEventListener('keydown', e => {
  const t = e.target;
  if(t.dataset.vmNewval != null){
    if(e.key === 'Enter'){ e.preventDefault(); addVarValue(+t.dataset.vmNewval); }
    // กด Backspace ในช่องว่าง = ลบค่าสุดท้ายของแถวนั้น
    if(e.key === 'Backspace' && !t.value){
      const i = +t.dataset.vmNewval;
      if(vm.rows[i].values.length){ readVarModalInputs(); vm.rows[i].values.pop(); renderVarModal({ row:i, field:'val' }); }
    }
  }else if(t.dataset.vmName != null && e.key === 'Enter'){
    e.preventDefault();
    const nv = $('varBody').querySelector(`[data-vm-newval="${t.dataset.vmName}"]`);
    if(nv) nv.focus();
  }
});
$('varBody').addEventListener('click', e => {
  const rm = e.target.closest('[data-vm-rmval]');
  if(rm){
    readVarModalInputs();
    const i = +rm.dataset.vmRmval;
    vm.rows[i].values.splice(+rm.dataset.vi, 1);
    renderVarModal({ row:i, field:'val' });
    return;
  }
  const del = e.target.closest('[data-vm-delrow]');
  if(del && vm.rows.length > 1){
    readVarModalInputs();
    vm.rows.splice(+del.dataset.vmDelrow, 1);
    renderVarModal();
  }
});
// ลากเรียงลำดับตัวเลือก (ใช้ที่จับ ☰)
$('varBody').addEventListener('dragstart', e => {
  const h = e.target.closest('[data-vm-handle]');
  if(!h) return;
  vm.dragFrom = +h.dataset.vmHandle;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(vm.dragFrom));
  const row = h.closest('.vm-row');
  if(row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 20, 20);
  row.classList.add('is-dragging');
});
$('varBody').addEventListener('dragend', () => { document.querySelectorAll('.vm-row.is-dragging,.vm-row.is-over').forEach(r => r.classList.remove('is-dragging', 'is-over')); });
$('varBody').addEventListener('dragover', e => {
  if(!vm || vm.dragFrom == null) return;
  const row = e.target.closest('.vm-row');
  if(!row) return;
  e.preventDefault();
  document.querySelectorAll('.vm-row.is-over').forEach(r => r.classList.remove('is-over'));
  row.classList.add('is-over');
});
$('varBody').addEventListener('drop', e => {
  if(!vm || vm.dragFrom == null) return;
  const row = e.target.closest('.vm-row');
  if(!row) return;
  e.preventDefault();
  readVarModalInputs();
  const from = vm.dragFrom, to = +row.dataset.vmRow;
  vm.dragFrom = null;
  if(from === to) { renderVarModal(); return; }
  const [moved] = vm.rows.splice(from, 1);
  vm.rows.splice(to, 0, moved);
  renderVarModal();
});

// ลากเรียงลำดับ "ค่า" (ชิป) ภายในตัวเลือกเดียวกัน — เมาส์ลากได้เลย · จอสัมผัสกดค้างแล้วลาก
(function(){
  const body = $('varBody');
  let drag = null;
  const MARKS = ['is-dragging', 'is-over-before', 'is-over-after'];
  function clearMarks(){ body.querySelectorAll('.vm-chip.is-dragging,.vm-chip.is-over-before,.vm-chip.is-over-after').forEach(c => c.classList.remove(...MARKS)); }
  function endDrag(){
    if(drag && drag.timer) clearTimeout(drag.timer);
    clearMarks();
    document.body.classList.remove('vm-chip-dragging');
    drag = null;
  }
  function startDrag(){
    if(!drag || drag.active) return;
    drag.active = true;
    drag.chip.classList.add('is-dragging');
    document.body.classList.add('vm-chip-dragging');
    try{ drag.chip.setPointerCapture(drag.id); }catch(_){}
  }
  function targetAt(x, y){
    const el = document.elementFromPoint(x, y);
    const chip = el && el.closest ? el.closest('.vm-chip[data-vm-chip]') : null;
    if(!chip || +chip.dataset.vmChip !== drag.row) return null;
    const r = chip.getBoundingClientRect();
    return { vi: +chip.dataset.vi, after: x > r.left + r.width / 2, chip };
  }
  body.addEventListener('pointerdown', e => {
    if(!vm) return;
    const chip = e.target.closest('.vm-chip[data-vm-chip]');
    if(!chip || e.target.closest('button')) return;
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    const row = +chip.dataset.vmChip;
    if(vm.rows[row].values.length < 2) return;
    drag = { row, vi: +chip.dataset.vi, chip, id: e.pointerId, x: e.clientX, y: e.clientY,
             touch: e.pointerType !== 'mouse', active: false, timer: null, target: null };
    if(drag.touch) drag.timer = setTimeout(startDrag, 350);
  });
  document.addEventListener('pointermove', e => {
    if(!drag || e.pointerId !== drag.id) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if(!drag.active){
      if(drag.touch){ if(moved > 8) endDrag(); return; }   // ขยับก่อนกดค้างครบเวลา = ไม่ใช่การลาก
      if(moved < 4) return;
      startDrag();
    }
    e.preventDefault();
    clearMarks();
    drag.chip.classList.add('is-dragging');
    const t = targetAt(e.clientX, e.clientY);
    drag.target = t;
    if(t && t.vi !== drag.vi) t.chip.classList.add(t.after ? 'is-over-after' : 'is-over-before');
  });
  document.addEventListener('pointerup', e => {
    if(!drag || e.pointerId !== drag.id) return;
    const d = drag, wasActive = d.active, t = d.target;
    endDrag();
    if(!wasActive || !t || !vm) return;
    let to = t.vi + (t.after ? 1 : 0);
    if(to > d.vi) to--;
    if(to === d.vi) return;
    readVarModalInputs();
    const vals = vm.rows[d.row].values;
    const [moved] = vals.splice(d.vi, 1);
    vals.splice(to, 0, moved);
    renderVarModal();
  });
  document.addEventListener('pointercancel', e => { if(drag && e.pointerId === drag.id) endDrag(); });
  // ไม่ให้เลือกข้อความ/เปิดเมนูค้างตอนกดค้างบนชิป
  body.addEventListener('contextmenu', e => { if(drag && drag.active) e.preventDefault(); });
})();

$('varAddRow').addEventListener('click', () => {
  readVarModalInputs();
  vm.rows.push({ name:'', values:[], orig:null });
  renderVarModal({ row: vm.rows.length - 1, field:'name' });
  const body = $('varBody'); body.scrollTop = body.scrollHeight;
});
$('varCancel').addEventListener('click', closeVarModal);
$('varSave').addEventListener('click', saveVarModal);
$('varScrim').addEventListener('mousedown', e => { if(e.target === $('varScrim')) closeVarModal(); });

/* ───────────────── หน้าต่าง "รูปเพิ่มเติม" ของแต่ละแถวตัวแปร ───────────────── */

let im = null;   // { v: แถวที่กำลังแก้, list: [รูปเพิ่มเติม], main }

function openImgModal(ci){
  const combo = comboList(draft.options)[ci];
  const v = variantFor(combo);
  if(!v) return;
  normalizeRowImages(v);
  im = { v, list: (v.images || []).slice(), main: v.image || '' };
  $('imgSub').textContent = combo.join(' · ');
  $('imgScrim').hidden = false;
  renderImgModal();
}

function closeImgModal(){
  $('imgScrim').hidden = true;
  im = null;
}

function renderImgModal(focusLast){
  $('imgBody').innerHTML = `
    <div class="im-main">
      <span class="vm-label">รูปหลัก</span>
      <div class="im-row">${thumbHtml(im.main, 'im-thumb')}<span class="im-path">${esc(im.main) || '— ยังไม่ได้ใส่ —'}</span></div>
    </div>
    ${pdRowDropHtml('im')}
    <span class="vm-label" style="margin-top:14px">รูปเพิ่มเติม (ลูกค้าเห็นต่อจากรูปหลัก ตามลำดับนี้)</span>
    ${im.list.length ? im.list.map((src, i) => `
      <div class="im-row">
        ${thumbHtml(src, 'im-thumb')}
        <input type="text" data-im-i="${i}" value="${esc(src)}" placeholder="images/…" autocomplete="off">
        <button type="button" class="icon-btn" data-im-main="${i}" title="ตั้งเป็นรูปหลัก (สลับกับรูปหลักเดิม)">★</button>
        <button type="button" class="icon-btn" data-im-move="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="เลื่อนขึ้น">↑</button>
        <button type="button" class="icon-btn" data-im-move="${i}" data-d="1" ${i === im.list.length - 1 ? 'disabled' : ''} title="เลื่อนลง">↓</button>
        <button type="button" class="icon-btn" data-im-rm="${i}" title="ลบรูปนี้">✕</button>
      </div>`).join('') : '<p class="field-hint" style="margin:6px 0 0">ยังไม่มีรูปเพิ่มเติม กด “เพิ่มรูป” ด้านล่าง</p>'}`;
  if(focusLast){
    const inputs = $('imgBody').querySelectorAll('[data-im-i]');
    if(inputs.length) inputs[inputs.length - 1].focus();
  }
}

function saveImgModal(){
  const list = [];
  im.list.forEach(x => { const t = String(x || '').trim(); if(t && t !== im.main && !list.includes(t)) list.push(t); });
  if(list.length) im.v.images = list; else delete im.v.images;
  if(im.mainChanged) im.v.image = im.main;
  closeImgModal();
  renderPricePanel();
  updateSummaries();
}

$('imgBody').addEventListener('input', e => {
  if(e.target.dataset.imI == null) return;
  im.list[+e.target.dataset.imI] = e.target.value;
  // อัปเดตรูปตัวอย่างข้างช่อง (ไม่วาดใหม่ทั้งหน้าต่าง กันเสียตำแหน่งที่พิมพ์)
  const th = e.target.previousElementSibling;
  if(th && th.tagName === 'IMG'){ if(e.target.value.trim()){ th.classList.remove('is-missing'); th.src = e.target.value.trim(); } else { th.removeAttribute('src'); th.classList.add('is-missing'); } }
});
$('imgBody').addEventListener('click', e => {
  const rm = e.target.closest('[data-im-rm]');
  if(rm){ im.list.splice(+rm.dataset.imRm, 1); renderImgModal(); return; }
  const mn = e.target.closest('[data-im-main]');
  if(mn){
    const i = +mn.dataset.imMain, t = String(im.list[i] || '').trim();
    if(!t) return;
    if(String(im.main || '').trim()) im.list[i] = im.main; else im.list.splice(i, 1);
    im.main = t; im.mainChanged = true;
    renderImgModal(); return;
  }
  const mv = e.target.closest('[data-im-move]');
  if(mv){
    const i = +mv.dataset.imMove, j = i + +mv.dataset.d;
    if(j < 0 || j >= im.list.length) return;
    [im.list[i], im.list[j]] = [im.list[j], im.list[i]];
    renderImgModal();
  }
});
$('imgBody').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.dataset.imI != null){ e.preventDefault(); $('imgAddRow').click(); }
});
$('imgAddRow').addEventListener('click', () => { im.list.push(''); renderImgModal(true); });
$('imgCancel').addEventListener('click', closeImgModal);
$('imgSave').addEventListener('click', saveImgModal);
$('imgScrim').addEventListener('mousedown', e => { if(e.target === $('imgScrim')) closeImgModal(); });

// ติ๊ก/เอาออกใน dropdown "ขนาด/ป้ายกำกับ" ระดับสินค้า — เก็บเป็น array เรียงตามลำดับตัวเลือก (cleanProduct จะย่อเป็น string ถ้ามีค่าเดียว)
function onSizeTagToggle(){
  if(!draft) return;
  const menu = $('sizeMenu');
  if(!menu) return;
  const picked = [...menu.querySelectorAll('input[data-size-tag]')].filter(i => i.checked).map(i => i.value);
  draft.size = picked;
  const sum = $('sizeSummary');
  if(sum) sum.textContent = picked.join(', ') || 'เลือกขนาด/ป้ายกำกับ';
}

function onComboToggle(e){
  const el = e.target;
  if(!draft || el.dataset.act !== 'toggle-combo') return;
  const combo = comboList(draft.options)[+el.dataset.ci];
  draft.variants = draft.variants || [];
  if(el.checked){
    if(!variantFor(combo)) draft.variants.push({ match: combo.slice(), price: 0, image: '' });
  } else {
    const existing = variantFor(combo);
    draft.variants = draft.variants.filter(v => v !== existing);
  }

  // แก้เฉพาะแถวนั้นแถวเดียว ไม่วาดตารางใหม่ทั้งตาราง คนกรอกจะได้ไม่เสียตำแหน่งที่พิมพ์ค้างไว้
  const tr = el.closest('tbody');
  const priceInput = tr.querySelector('[data-combo-price]');
  const imageInput = tr.querySelector('[data-combo-image]');
  const readyInput = tr.querySelector('[data-combo-ready]');
  const tagSelect = tr.querySelector('[data-combo-tag]');
  const moreBtn = tr.querySelector('[data-combo-more]');
  const pathBtn = tr.querySelector('[data-combo-path]');
  tr.classList.toggle('is-off', !el.checked);
  imageInput.disabled = readyInput.disabled = tagSelect.disabled = moreBtn.disabled = pathBtn.disabled = !el.checked;
  priceInput.placeholder = el.checked ? 'ราคา' : 'ไม่ขาย';
  if(!el.checked){
    priceInput.value = ''; imageInput.value = ''; readyInput.checked = false; tagSelect.value = '';
    const th = tr.querySelector('.combo-thumb-img');
    if(th){ th.removeAttribute('src'); th.classList.add('is-missing'); }
    tr.querySelector('.combo-imgrow').hidden = true;
  }
  moreBtn.textContent = comboMoreLabel(variantFor(comboList(draft.options)[+el.dataset.ci]));
  const counter = $('comboCount');
  if(counter) counter.textContent = draft.variants.length;
  if(el.checked && document.activeElement !== priceInput) priceInput.focus();
}

/* ───────────────── ตรวจสอบและบันทึกสินค้า ───────────────── */

function validateDraft(){
  const id = String(draft.id || '').trim();
  if(!id) return 'ใส่รหัสสินค้าก่อน';
  if(/[\s/\\#?]/.test(id)) return 'รหัสสินค้าห้ามมีช่องว่างหรืออักขระพิเศษ';
  const clash = catalog.findIndex((p, i) => i !== draftIndex && p.id === id);
  if(clash >= 0) return `รหัส ${id} ซ้ำกับ “${catalog[clash].name || catalog[clash].id}”`;
  if(!String(draft.name || '').trim()) return 'ใส่ชื่อสินค้าก่อน';
  if(!String(draft.cat || '').trim()) return 'เลือกหมวดหมู่ก่อน';

  const mode = priceMode(draft);
  if(mode === 'single' && num(draft.price) <= 0) return 'ใส่ราคาก่อน';
  if(mode === 'sizes'){
    const sizes = draft.sizes || [];
    if(!sizes.length) return 'เพิ่มไซซ์อย่างน้อย 1 รายการ หรือเปลี่ยนไปใช้ราคาเดียว';
    if(sizes.some(s => !String(s.name || '').trim())) return 'ตั้งชื่อไซซ์ให้ครบทุกรายการ';
    if(sizes.some(s => num(s.price) <= 0)) return 'ใส่ราคาให้ครบทุกไซซ์';
  }
  if(mode === 'options'){
    const options = draft.options || [];
    if(!options.length) return 'เพิ่มชั้นตัวเลือกอย่างน้อย 1 ชั้น';
    if(options.some(o => !String(o.name || '').trim())) return 'ตั้งชื่อชั้นตัวเลือกให้ครบ';
    if(options.some(o => !(o.values || []).length)) return 'ทุกชั้นต้องมีค่าให้เลือกอย่างน้อย 1 ค่า';
    const vs = draft.variants || [];
    if(!vs.length) return 'ติ๊กคู่ผสมที่เปิดขายอย่างน้อย 1 คู่';
    if(vs.some(v => num(v.price) <= 0)) return 'ใส่ราคาให้ครบทุกคู่ผสมที่เปิดขาย';
  }

  const addons = [...(draft.addons || []), ...(draft.colors || []).flatMap(c => c.addons || [])];
  if(addons.some(a => !String(a.name || '').trim())) return 'ตั้งชื่อของเสริมให้ครบทุกรายการ';
  if((draft.colors || []).some(c => !String(c.name || '').trim())) return 'ตั้งชื่อสีให้ครบทุกรายการ';

  return null;
}

/* ตัดช่องว่างและฟิลด์ว่างทิ้ง เพื่อให้ข้อมูลหน้าตาเหมือน products.json เดิมเป๊ะ */
function cleanProduct(p){
  const out = {};
  const str = v => String(v ?? '').trim();

  out.id = str(p.id);
  out.cat = str(p.cat);
  if(str(p.flowerType)) out.flowerType = str(p.flowerType);
  // ช่อง "ขนาด/ป้ายกำกับ" พิมพ์ได้หลายค่าคั่นด้วยจุลภาค (เช่น "กลาง, ใส่เงิน") — เก็บเป็น array ถ้ามี
  // มากกว่า 1 ค่า หรือเก็บเป็น string เดี่ยวเหมือนเดิมถ้ามีค่าเดียว (ไม่เปลี่ยนหน้าตาไฟล์โดยไม่จำเป็น)
  {
    // เติมป้ายที่ตั้งไว้ในไซซ์/คู่ผสมเข้าไปด้วย ให้ขนาดระดับสินค้าไม่หลุดจากที่ตั้งรายแบบ
    const derived = derivedSizeTags(p);
    const sizeParts = (derived || sizeTagsOf(p)).flatMap(v => str(v).split(',')).map(v => v.trim()).filter(Boolean);
    const uniqueSizes = [...new Set(sizeParts)];
    if(uniqueSizes.length === 1) out.size = uniqueSizes[0];
    else if(uniqueSizes.length > 1) out.size = uniqueSizes;
  }
  out.name = str(p.name);
  if(num(p.price) > 0) out.price = num(p.price);
  if(str(p.desc)) out.desc = str(p.desc);
  if(p.ready) out.ready = true;
  if(p.hidden) out.hidden = true;
  if(str(p.image)) out.image = str(p.image);

  const imgs = (p.images || []).map(str).filter(Boolean);
  if(imgs.length) out.images = imgs;

  const cleanAddons = list => (list || [])
    .filter(a => str(a.name))
    .map(a => {
      const o = { name: str(a.name), price: num(a.price) };
      if(str(a.image)) o.image = str(a.image);
      if(a.ready) o.ready = true;
      return o;
    });

  const colors = (p.colors || []).filter(c => str(c.name)).map(c => {
    const o = { name: str(c.name) };
    if(str(c.image)) o.image = str(c.image);
    const ci = (c.images || []).map(str).filter(Boolean);
    if(ci.length) o.images = ci;
    if(c.ready) o.ready = true;
    const ca = cleanAddons(c.addons);
    if(ca.length) o.addons = ca;
    return o;
  });
  if(colors.length) out.colors = colors;

  const mode = priceMode(p);
  if(mode === 'sizes'){
    const sizes = (p.sizes || []).filter(s => str(s.name)).map(s => {
      const o = { name: str(s.name), price: num(s.price) };
      { const all = imgsOf(s); if(all.length) o.image = all[0]; if(all.length > 1) o.images = all; }
      if(str(s.tag)) o.tag = str(s.tag);
      if(s.ready) o.ready = true;
      return o;
    });
    if(sizes.length){
      out.sizes = sizes;
      // ราคาเริ่มต้นบนการ์ดสินค้า = ไซซ์ที่ถูกที่สุด
      out.price = Math.min(...sizes.map(s => s.price));
    }
  }

  if(mode === 'options'){
    delete out.price;
    out.options = (p.options || [])
      .filter(o => str(o.name) && (o.values || []).length)
      .map(o => ({ name: str(o.name), values: o.values.map(str).filter(Boolean) }));
    out.variants = (p.variants || []).filter(v => (v.match || []).length === out.options.length).map(v => {
      const o = { match: (v.match || []).map(str), price: num(v.price) };
      { const all = imgsOf(v).map(s => String(s).replace(/\\/g, '/')); if(all.length) o.image = all[0]; if(all.length > 1) o.images = all; }
      if(str(v.tag)) o.tag = str(v.tag);
      if(v.ready) o.ready = true;
      return o;
    });
  }

  const addons = cleanAddons(p.addons);
  if(addons.length) out.addons = addons;

  return out;
}

async function saveDraft(){
  const problem = validateDraft();
  const box = $('editorProblem');
  if(problem){
    box.textContent = problem;
    box.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  box.hidden = true;

  const cleaned = cleanProduct(draft);
  const oldId = draftIndex < 0 ? '' : String(catalog[draftIndex].id || '');
  if(draftIndex < 0) catalog.push(cleaned);
  else catalog[draftIndex] = cleaned;

  renderList();
  const ok = await saveCatalog(draftIndex < 0 ? 'เพิ่มสินค้าแล้ว' : 'บันทึกการแก้ไขแล้ว');
  if(ok){
    // เปลี่ยนรหัสสินค้า → ย้ายป้ายรูปรีวิวตามไปด้วย ไม่งั้นรีวิวจะหลุดจากสินค้านี้
    if(oldId && cleaned.id !== oldId && Object.values(reviewTags).some(ids => ids.includes(oldId))){
      const next = clone(reviewTags);
      Object.keys(next).forEach(k => { next[k] = next[k].map(id => id === oldId ? cleaned.id : id); });
      await persistReviewTags(next);
    }
    closeEditor();
  }
}

/* ───────────────── นำเข้า / สำรองข้อมูล ───────────────── */

async function importFromFile(file){
  let list;
  try{
    list = JSON.parse(await file.text());
  } catch(err){
    toast('อ่านไฟล์ไม่ได้ ไฟล์อาจไม่ใช่ JSON ที่ถูกต้อง', true);
    return;
  }
  if(!Array.isArray(list) || !list.length){
    toast('ไฟล์นี้ไม่ใช่รายการสินค้า', true);
    return;
  }
  if(!list.every(p => p && typeof p === 'object' && p.id)){
    toast('ไฟล์นี้มีรายการที่ไม่มีรหัสสินค้า ยังนำเข้าไม่ได้', true);
    return;
  }

  const ok = await askConfirm(
    'นำเข้าสินค้า',
    `ไฟล์นี้มีสินค้า ${list.length} รายการ จะเขียนทับข้อมูลสินค้าทั้งหมดที่มีอยู่ตอนนี้ (${catalog.length} รายการ)`,
    'นำเข้าและเขียนทับ');
  if(!ok) return;

  selected.clear();
  catalog = list;
  renderList();
  await saveCatalog(`นำเข้าสินค้า ${list.length} รายการแล้ว`);
}

async function downloadBackup(){
  const stamp = new Date().toISOString().slice(0, 10);
  const ok = await askConfirm(
    'ดาวน์โหลดไฟล์สำรอง',
    `ไฟล์สำรองจะมีสินค้าทั้งหมด ${catalog.length} รายการ บันทึกเป็น products-${stamp}.json`,
    'ดาวน์โหลด');
  if(!ok) return;
  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `products-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ดาวน์โหลดไฟล์สำรองแล้ว');
}

/* ───────────────── ภาพแคตตาล็อก (JPG 2:3) ─────────────────
   ภาพละ 1200×1800: ครึ่งบนเป็นรูปสินค้า 1:1 ครึ่งล่างเป็นแผงข้อความพื้นขาว
   สร้างทุกสี/ไซซ์/คู่ผสมของสินค้า โหลดหลายภาพรวมเป็น ZIP ภาพเดียวโหลดเป็น JPG ตรงๆ */

const POSTER = { W: 1200, H: 1800, PHOTO: 1200, PAD: 56, PINK: '#F62188', INK: '#111111', GRAY: '#5A5A5A' };
const POSTER_CONDITIONS = ['ราคาไม่รวมค่าจัดส่ง', 'ลูกค้านครสวรรค์นัดรับฟรี (สั่งซื้อ 299 ขึ้นไป)'];
const POSTER_NOTE = 'หมายเหตุ: หากต้องการเปลี่ยนสีดอกไม้ ช่อ ริบบิ้น กระดาษรองช่อ หรือเพิ่มการ์ดอวยพร สามารถแจ้งแอดมินได้เลยค่ะ';

let posterBusy = false;
let posterCancel = false;
const posterImgCache = new Map();

// แตกสินค้า 1 ชิ้นเป็นรายการภาพ: คู่ผสม (variants) > ไซซ์ > สี > ภาพเดียว
function posterEntries(p){
  const txt = v => String(v ?? '').trim();
  const list = a => Array.isArray(a) ? a : [];
  const addonsOf = o => list(o && o.addons).filter(a => txt(a.name));
  const base = mainImageOf(p);
  const basePrice = num(p.price);
  let out = [];

  const vs = list(p.variants).filter(v => list(v.match).some(txt));
  const ss = list(p.sizes).filter(s => txt(s.name));
  const cs = list(p.colors).filter(c => txt(c.name));

  if(vs.length){
    out = vs.map(v => ({ parts: list(v.match).map(txt).filter(Boolean), price: num(v.price) || basePrice, image: v.image || base, addons: addonsOf(p) }));
  }else if(ss.length){
    out = ss.map(s => ({ parts: [txt(s.name)], price: num(s.price) || basePrice, image: s.image || base, addons: addonsOf(s).length ? addonsOf(s) : addonsOf(p) }));
  }else if(cs.length){
    // สินค้ามีสี: ของเสริมอยู่ที่สีนั้น (เหมือนหน้าร้าน)
    out = cs.map(c => ({ parts: [txt(c.name)], price: basePrice, image: c.image || list(c.images)[0] || base, addons: addonsOf(c) }));
  }else{
    out = [{ parts: [], price: basePrice, image: base, addons: addonsOf(p) }];
  }
  if(out.length === 1) out[0].parts = [];   // มีแบบเดียว ไม่ต้องต่อท้ายชื่อ
  return out;
}

function posterFileName(p, e, used){
  // รูปแบบ: หมวดหมู่_ชื่อสินค้า_ราคา_แบบ-สี.jpg (ช่องว่างในชื่อ " - " บีบเหลือ "-")
  const clean = s => String(s ?? '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/^[-\s]+|[-\s]+$/g, '');
  const bits = [
    clean(p.cat),
    clean(p.name || p.id || 'product'),
    e.price ? e.price + '฿' : '',
    e.parts.map(clean).filter(Boolean).join('-')
  ].filter(Boolean);
  const name = bits.join('_');
  let final = name, n = 2;
  while(used.has(final)) final = `${name}-${n++}`;
  used.add(final);
  return final + '.jpg';
}

function posterEncodePath(src){
  if(/^(https?:|data:|blob:)/i.test(src)) return src;
  return src.split('/').map(encodeURIComponent).join('/');
}

function posterLoadImage(src){
  if(!src) return Promise.resolve(null);
  if(posterImgCache.has(src)) return posterImgCache.get(src);
  const pr = new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = posterEncodePath(src);
  });
  posterImgCache.set(src, pr);
  return pr;
}

async function posterEnsureFonts(){
  const specs = ['400 30px Kanit', '600 30px Kanit', '700 60px Kanit', 'italic 400 28px Kanit'];
  await Promise.all(specs.map(f => document.fonts.load(f, 'กขค฿0Aa').catch(() => {})));
  await document.fonts.ready;
}

// ตัดบรรทัดตามความกว้าง (ภาษาไทยไม่มีเว้นวรรค ใช้ Intl.Segmenter ช่วยตัดคำ)
function posterWrap(ctx, text, maxW){
  const lines = [];
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  String(text || '').split(/\r?\n/).forEach(par => {
    const words = seg ? [...seg.segment(par)].map(s => s.segment) : par.split(/(?<= )/);
    let line = '';
    words.forEach(w => {
      const t = line + w;
      if(line.trim() && ctx.measureText(t.trimEnd()).width > maxW){
        lines.push(line.trimEnd());
        line = w.trimStart();
      }else line = t;
    });
    lines.push(line.trimEnd());
  });
  while(lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function posterPillPath(ctx, x, y, w, h){
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// วงกลมรูปของเสริมที่มุมล่างขวาของรูปสินค้า + ป้ายชื่อ/ราคาสีชมพูใต้วงกลม
async function posterDrawAddons(ctx, addons){
  const { W, PHOTO, PINK } = POSTER;
  const list = addons.slice(0, 3);
  if(!list.length) return;
  const R = 150, EDGE = 36, GAP = 28, PILL_H = 54;
  const imgs = await Promise.all(list.map(a => posterLoadImage(a.image)));
  const maxPill = list.length > 1 ? 2 * R + GAP - 10 : 560;

  list.forEach((a, k) => {
    const cx = W - EDGE - R - k * (2 * R + GAP);
    const cy = PHOTO - EDGE - PILL_H - 12 - R;

    // วงกลมขอบขาว + เงา
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 10, 0, Math.PI * 2); ctx.clip();
    const im = imgs[k];
    if(im){
      const s = Math.min(im.naturalWidth, im.naturalHeight);
      ctx.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, cx - R, cy - R, 2 * R, 2 * R);
    }else{
      ctx.fillStyle = '#FFD9EA';
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.fillStyle = PINK;
      ctx.font = '600 30px Kanit, sans-serif';
      ctx.textAlign = 'center';
      posterWrap(ctx, a.name, 2 * R - 60).slice(0, 3).forEach((l, i, arr) =>
        ctx.fillText(l, cx, cy + 10 + (i - (arr.length - 1) / 2) * 38));
    }
    ctx.restore();

    // ป้ายชื่อ + ราคา
    const price = num(a.price);
    const priceTxt = price ? ` +฿${price.toLocaleString('en-US')}` : '';
    let nm = String(a.name).trim();
    let fs = 28;
    ctx.font = `600 ${fs}px Kanit, sans-serif`;
    while(fs > 20 && ctx.measureText(nm + priceTxt).width + 44 > maxPill){ fs -= 2; ctx.font = `600 ${fs}px Kanit, sans-serif`; }
    // ชื่อยาวเกินให้ตัดที่ชื่อ เก็บราคาไว้ครบเสมอ
    while(nm.length > 1 && ctx.measureText(nm + priceTxt).width + 44 > maxPill) nm = nm.slice(0, -1).trimEnd();
    const text = (nm === String(a.name).trim() ? nm : nm + '…') + priceTxt;
    const pw = ctx.measureText(text).width + 44;
    const px = Math.min(cx - pw / 2, W - 24 - pw);
    const py = cy + R + 12;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = PINK;
    posterPillPath(ctx, px, py, pw, PILL_H);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(text, px + pw / 2, py + PILL_H / 2 + fs * 0.35);
    ctx.textAlign = 'left';
  });
}

async function posterRender(p, e){
  const { W, H, PHOTO, PAD, PINK, INK, GRAY } = POSTER;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // ── รูปสินค้า 1:1 (ครอบกึ่งกลาง) ──
  const img = await posterLoadImage(e.image);
  if(img){
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, PHOTO, PHOTO);
  }else{
    ctx.fillStyle = '#EFEAEC';
    ctx.fillRect(0, 0, PHOTO, PHOTO);
    ctx.fillStyle = '#9A8F94';
    ctx.font = '600 44px Kanit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ไม่พบไฟล์รูปสินค้า', W / 2, PHOTO / 2);
    ctx.textAlign = 'left';
  }

  await posterDrawAddons(ctx, e.addons || []);

  const maxW = W - PAD * 2;

  // ── ชื่อสินค้า ──
  const title = String(p.name || p.id || '') + (e.parts.length ? ` (${e.parts.join(' · ')})` : '');
  let fs = 64;
  for(; fs > 34; fs -= 2){
    ctx.font = `700 ${fs}px Kanit, sans-serif`;
    if(ctx.measureText(title).width <= maxW) break;
  }
  ctx.fillStyle = INK;
  ctx.fillText(title, PAD, 1292);

  // ── ราคา + เงื่อนไข ──
  if(e.price){
    ctx.font = '700 128px Kanit, sans-serif';
    ctx.fillStyle = PINK;
    const priceText = '฿' + Number(e.price).toLocaleString('en-US');
    ctx.fillText(priceText, PAD, 1432);
    const pw = ctx.measureText(priceText).width;
    const cx = PAD + pw + 30;
    ctx.font = 'italic 400 28px Kanit, sans-serif';
    ctx.fillStyle = GRAY;
    let cy = 1362;
    POSTER_CONDITIONS.forEach((c, i) => {
      posterWrap(ctx, c, W - PAD - cx).forEach(l => { ctx.fillText(l, cx, cy); cy += 36; });
      if(i === 0) cy += 14;
    });
  }

  // ── หมายเหตุด้านล่างสุด ──
  ctx.font = 'italic 400 26px Kanit, sans-serif';
  const noteLines = posterWrap(ctx, POSTER_NOTE, maxW);
  const noteLast = 1768;
  const noteFirst = noteLast - (noteLines.length - 1) * 36;
  ctx.fillStyle = GRAY;
  noteLines.forEach((l, i) => ctx.fillText(l, PAD, noteFirst + i * 36));

  // ── รายละเอียดสินค้า ──
  ctx.fillStyle = INK;
  ctx.font = '600 36px Kanit, sans-serif';
  ctx.fillText('รายละเอียดสินค้า', PAD, 1534);

  const descTop = 1552;
  const descBottom = noteFirst - 44;
  let size = 30, lines = [];
  for(; size >= 22; size -= 2){
    ctx.font = `400 ${size}px Kanit, sans-serif`;
    lines = posterWrap(ctx, p.desc || '', maxW);
    if(lines.length * size * 1.5 <= descBottom - descTop) break;
  }
  const lh = size * 1.5;
  const maxLines = Math.max(1, Math.floor((descBottom - descTop) / lh));
  if(lines.length > maxLines){
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while(last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + '…';
  }
  ctx.fillStyle = '#222';
  lines.forEach((l, i) => ctx.fillText(l, PAD, descTop + size + i * lh));

  const blob = await new Promise((res, rej) => {
    try{ cv.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', 0.92); }
    catch(err){ rej(err); }
  });
  return { blob, hadImage: !!img };
}

function posterProgress(show, text, pct){
  $('progressScrim').hidden = !show;
  if(!show) return;
  $('progressText').textContent = text;
  $('progressBar').style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
}

function posterSave(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportPosters(products, zipBase){
  if(posterBusy) return;
  if(pricesHidden){ toast('ตอนนี้ปิดราคาอยู่ จึงสร้างภาพแคตตาล็อกไม่ได้ (ภาพมีราคา)', true); return; }
  const jobs = [];
  products.forEach(p => posterEntries(p).forEach(e => jobs.push({ p, e })));
  if(!jobs.length){ toast('ไม่มีสินค้าให้สร้างภาพ', true); return; }
  if(jobs.length > 1 && typeof JSZip === 'undefined'){
    toast('โหลดตัวสร้างไฟล์ ZIP ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้าก่อน', true);
    return;
  }

  posterBusy = true;
  posterCancel = false;
  const used = new Set();
  const files = [];
  let missing = 0;
  try{
    posterProgress(true, 'กำลังเตรียมฟอนต์…', 0);
    await posterEnsureFonts();
    for(let k = 0; k < jobs.length; k++){
      if(posterCancel) break;
      posterProgress(true, `กำลังสร้าง ${k + 1}/${jobs.length}`, (k / jobs.length) * 100);
      await new Promise(r => setTimeout(r, 0));   // ให้เบราว์เซอร์วาดแถบความคืบหน้าก่อน
      const { p, e } = jobs[k];
      const { blob, hadImage } = await posterRender(p, e);
      if(!hadImage) missing++;
      files.push({ name: posterFileName(p, e, used), blob });
    }
    if(posterCancel){ toast('ยกเลิกการสร้างภาพแล้ว'); return; }

    if(files.length === 1){
      posterSave(files[0].blob, files[0].name);
    }else{
      const zip = new JSZip();
      files.forEach(f => zip.file(f.name, f.blob, { binary: true }));
      const zblob = await zip.generateAsync({ type: 'blob', compression: 'STORE' },
        m => posterProgress(true, `กำลังรวมไฟล์ ZIP ${Math.round(m.percent)}%`, m.percent));
      posterSave(zblob, `${zipBase}.zip`);
    }
    toast(missing
      ? `สร้างเสร็จ ${files.length} ภาพ (${missing} ภาพไม่พบไฟล์รูป ตรวจพาธรูปในสินค้า)`
      : `สร้างเสร็จ ${files.length} ภาพ`, !!missing);
  }catch(err){
    console.error(err);
    const tainted = err && (err.name === 'SecurityError' || /tainted|insecure/i.test(String(err.message)));
    toast(tainted
      ? 'สร้างภาพไม่ได้ ต้องเปิดหน้าแอดมินผ่านเว็บไซต์จริง ไม่ใช่เปิดไฟล์ในเครื่อง'
      : 'สร้างภาพไม่สำเร็จ: ' + (err.message || err), true);
  }finally{
    posterProgress(false);
    posterImgCache.clear();
    posterBusy = false;
  }
}

// สินค้าที่จะโหลด: ที่ติ๊กเลือกไว้ ถ้าไม่ได้เลือกใช้ตามตัวกรองที่แสดงอยู่ (ไม่กรองเลย = ทั้งหมด)
function catalogTargets(){
  if(selected.size) return [...selected].sort((a, b) => a - b).map(i => catalog[i]).filter(p => p && !p.hidden);
  return visibleProducts().map(r => r.p).filter(p => !p.hidden);
}

function updateCatalogBtn(rows){
  const btn = $('catalogBtn');
  if(!btn) return;
  const n = selected.size ? [...selected].filter(i => catalog[i] && !catalog[i].hidden).length : rows.filter(r => !r.p.hidden).length;
  $('catalogLabel').textContent = `แคตตาล็อก (${selected.size ? 'ที่เลือก ' : ''}${n})`;
  btn.title = n
    ? `ดาวน์โหลดภาพแคตตาล็อก (JPG) ของ ${n} สินค้า ${selected.size ? 'ที่ติ๊กเลือกไว้' : 'ตามที่กรองอยู่'}`
    : 'ไม่มีสินค้าให้ทำแคตตาล็อก';
  btn.disabled = !n;
}

/* ───────────────── รูปรีวิวลูกค้า ─────────────────
   ไฟล์รูปยังอยู่ที่ images/reviews/reviewN.jpg เหมือนเดิม (หน้าร้านหาเองตามเลขไฟล์)
   หลังบ้านเก็บแค่ "ป้ายสินค้า" ของแต่ละรูป ในช่อง reviewsJson ของเอกสารเดียวกับสินค้า
   หน้าร้านเลยได้ป้ายมาพร้อมสินค้า ไม่ต้องอ่าน Firestore เพิ่ม — รูปที่ไม่ผูกสินค้ายังแสดงในแถบรีวิวเหมือนเดิม */

const REVIEW_DIR = 'images/reviews/';
const REVIEW_MAX = 200, REVIEW_BATCH = 20;
let rvm = null;            // { files, tags, view:'tag'|'all', filter, ctx(รหัสสินค้าที่เปิดมาจากหน้าแก้ไข), cur, back, skipped:Set, history, recent, loading, dirty }
let reviewPanelFor = null; // รหัสสินค้าที่การ์ด "รูปรีวิวลูกค้า" ในหน้าแก้ไขแสดงอยู่

const REVIEW_HIDDEN_KEY = '__hidden';
function parseReviewHidden(raw){
  try{
    const o = typeof raw === 'string' ? JSON.parse(raw) : null;
    const a = o && Array.isArray(o[REVIEW_HIDDEN_KEY]) ? o[REVIEW_HIDDEN_KEY] : [];
    return new Set(a.map(x => String(x || '').trim()).filter(Boolean));
  }catch(_){ return new Set(); }
}
function parseReviewTags(raw){
  const out = {};
  try{
    const o = typeof raw === 'string' ? JSON.parse(raw) : null;
    if(o && typeof o === 'object') Object.keys(o).forEach(k => {
      if(k === REVIEW_HIDDEN_KEY) return; // รายการรูปที่ซ่อน ไม่ใช่ป้ายสินค้า
      const ids = (Array.isArray(o[k]) ? o[k] : [o[k]]).map(x => String(x ?? '').trim()).filter(Boolean);
      if(ids.length || k.includes('/')) out[k] = ids; // คีย์ที่มี / = รูปที่เพิ่มด้วย path (ไม่ผูกสินค้าก็เก็บไว้)
    });
  }catch(_){}
  return out;
}
function reviewNum(k){ if(String(k).includes('/')) return 1e9; const m = /(\d+)/.exec(k); return m ? +m[1] : 0; } // รูปที่เพิ่มด้วย path ถือว่าใหม่สุด
// src ของรูป: คีย์ที่มี / = path เต็ม · ไม่มี = ชื่อไฟล์ใน images/reviews/
function reviewSrc(k){ return String(k).includes('/') ? String(k).replace(/[#?%]/g, c => encodeURIComponent(c)) : REVIEW_DIR + k; }
// ทำ path ที่กรอกให้เป็นรูปแบบเดียวกัน: ตัด ./ และ / หน้าสุด, \ → /, ชื่อไฟล์เฉยๆ = อยู่ใน images/reviews/
function normalizeReviewPath(raw){
  let s = String(raw || '').trim().replace(/^["']+|["']+$/g, '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if(!s) return '';
  if(!s.includes('/')) s = REVIEW_DIR + s;
  return s;
}
function reviewKeysOf(id){
  const t = String(id || '').trim();
  if(!t) return [];
  return Object.keys(reviewTags).filter(k => reviewTags[k].includes(t) && !reviewHidden.has(k)).sort((a, b) => reviewNum(b) - reviewNum(a));
}
function probeImage(src){
  return new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
}
// รายชื่อรูปรีวิว = ไฟล์ใน images/reviews/list.json + ไฟล์ที่สแกนเจอ (review1.jpg … ทนช่องว่างได้ 3 ชุด)
async function fetchReviewListNames(){
  try{
    const res = await fetch(REVIEW_DIR + 'list.json', { cache: 'no-store' });
    if(!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(n => n && !/[\\/]/.test(n)) : [];
  }catch(_){ return []; }
}
let scanListedNames = new Set(); // ชื่อไฟล์ที่อยู่ใน list.json (หน้าร้านเห็นอยู่แล้ว)
async function scanReviewFiles(){
  const found = [];
  let emptyStreak = 0;
  for(let start = 1; start <= REVIEW_MAX; start += REVIEW_BATCH){
    const nums = Array.from({ length: Math.min(REVIEW_BATCH, REVIEW_MAX - start + 1) }, (_, i) => start + i);
    const ok = await Promise.all(nums.map(n => probeImage(`${REVIEW_DIR}review${n}.jpg`)));
    const hit = nums.filter((n, i) => ok[i]);
    found.push(...hit);
    emptyStreak = hit.length ? 0 : emptyStreak + 1;
    if(emptyStreak >= 3) break;
  }
  const scanned = found.map(n => `review${n}.jpg`);
  const listed = await fetchReviewListNames();
  scanListedNames = new Set(listed);
  const custom = Object.keys(reviewTags).filter(k => k.includes('/')).reverse(); // รูปที่เพิ่มด้วย path (เพิ่มล่าสุดก่อน)
  // ไฟล์เดียวกันที่มีทั้งแบบ path เต็ม (เพิ่มจากหลังบ้าน) และแบบชื่อเฉยๆ (สแกนเจอบนเว็บ) ให้เหลือแบบ path เต็มอย่างเดียว ไม่งั้นรูปเดียวขึ้นซ้ำสองใบ
  const customSet = new Set(custom);
  const plainNames = [...listed, ...scanned].filter(n => !customSet.has(REVIEW_DIR + n));
  return [...new Set([...custom, ...plainNames])].sort((a, b) => reviewNum(b) - reviewNum(a)); // ใหม่สุดก่อน
}
// เพิ่มรูปรีวิวหลายรูปพร้อมกัน: วางชื่อไฟล์ (หนึ่งบรรทัดต่อหนึ่งรูป) ที่เอาไปไว้ใน images/reviews/ แล้ว
// ชื่อเฉยๆ = เติม images/reviews/ ให้เอง · ตรวจก่อนว่าเปิดรูปได้จริง · เก็บเป็น path เต็ม หน้าร้านจึงเห็นทันทีโดยไม่ต้องแก้ list.json
const REVIEW_IMG_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
function reviewShortName(k){ return String(k).startsWith(REVIEW_DIR) && !String(k).slice(REVIEW_DIR.length).includes('/') ? String(k).slice(REVIEW_DIR.length) : String(k); }
async function reviewAddMany(){
  if(!rvm) return;
  const lines = $('revAddText').value.split(/[\n\r,;]+/).map(x => x.trim()).filter(Boolean);
  if(!lines.length){ toast('วางชื่อไฟล์รูปก่อน (หนึ่งบรรทัดต่อหนึ่งรูป) เช่น abc.jpg', true); return; }
  const keys = [...new Set(lines.map(normalizeReviewPath).filter(Boolean))];
  const go = $('revAddGo');
  go.disabled = true; go.textContent = 'กำลังตรวจรูป …';
  const out = await Promise.all(keys.map(async key => {
    if(!REVIEW_IMG_RE.test(key)) return { t: 'bad', key };
    const plain = key.startsWith(REVIEW_DIR) && !key.slice(REVIEW_DIR.length).includes('/') ? key.slice(REVIEW_DIR.length) : null;
    const live = rvm.files.includes(key) ? key : (plain && rvm.files.includes(plain) ? plain : null);
    // มีในรายการอยู่แล้ว และหน้าร้านเห็นอยู่ (path เต็ม หรืออยู่ใน list.json)
    if(live && (live.includes('/') || scanListedNames.has(live))){
      return rvm.hidden.has(live) ? { t: 'restore', key: live } : { t: 'exists', key: live };
    }
    if(!(await probeImage(reviewSrc(key)))) return { t: 'missing', key };
    return { t: 'add', key, plain };
  }));
  go.disabled = false; go.textContent = 'ตรวจและเพิ่ม';
  if(!rvm) return;
  const by = t => out.filter(o => o.t === t);
  by('restore').forEach(o => rvm.hidden.delete(o.key));
  by('add').forEach(({ key, plain }) => {
    let ids = rvm.tags[key] || [];
    if(plain && rvm.files.includes(plain)){ // ไฟล์ที่ระบบเจอเอง แต่หน้าร้านยังไม่เห็น → ย้ายมาเป็น path เต็ม พร้อมป้ายเดิม
      ids = [...new Set([...ids, ...(rvm.tags[plain] || [])])];
      rvm.files = rvm.files.filter(x => x !== plain);
      delete rvm.tags[plain]; rvm.hidden.delete(plain);
    }
    rvm.tags[key] = ids;
    rvm.hidden.delete(key);
    rvm.files = rvm.files.filter(x => x !== key);
  });
  by('add').slice().reverse().forEach(o => rvm.files.unshift(o.key)); // เรียงตามที่วาง ใหม่สุดอยู่หน้า
  const added = by('add'), restored = by('restore'), exists = by('exists'), missing = by('missing'), bad = by('bad');
  if(added.length || restored.length){
    rvm.history = [];
    rvm.dirty = true;
    rvm.filter = 'all'; rvm.q = ''; $('revSearch').value = ''; // ให้เห็นรูปที่เพิ่มใหม่ที่หัวกริดทันที
  }
  const nm = arr => arr.map(o => esc(reviewShortName(o.key))).join(', ');
  const rows = [];
  if(added.length) rows.push(`<p class="rv-add-ok">✓ เพิ่มแล้ว ${added.length} รูป — กดบันทึกด้านล่างเพื่อให้หน้าร้านเห็น</p><div class="rv-add-thumbs">${added.slice(0, 12).map(o => `<img src="${esc(reviewSrc(o.key))}" alt="">`).join('')}</div>`);
  if(restored.length) rows.push(`<p class="rv-add-ok">↩ กู้คืนรูปที่เคยลบ ${restored.length} รูป: ${nm(restored)}</p>`);
  if(exists.length) rows.push(`<p class="rv-add-note">มีอยู่ในรายการแล้ว ${exists.length} รูป: ${nm(exists)}</p>`);
  if(missing.length) rows.push(`<p class="rv-add-err">เปิดรูปไม่ได้ ${missing.length} รูป: ${nm(missing)}<br>เช็คชื่อไฟล์/ตัวพิมพ์เล็กใหญ่ และว่าอัปโหลดเว็บขึ้นไปแล้ว</p>`);
  if(bad.length) rows.push(`<p class="rv-add-err">ไม่ใช่ไฟล์รูป ${bad.length} รายการ: ${nm(bad)} (ต้องลงท้าย .jpg .png .webp …)</p>`);
  $('revAddOut').innerHTML = rows.join('');
  $('revAddText').value = [...missing, ...bad].map(o => reviewShortName(o.key)).join('\n'); // เหลือเฉพาะที่ยังไม่สำเร็จ ไว้แก้แล้วกดใหม่
  renderReviewsModal();
}
/* ───────────── อัปโหลดรูปรีวิวลงโฟลเดอร์เว็บในเครื่อง (Chrome / Edge บนคอมพิวเตอร์) ─────────────
   ลากรูปมาวาง → ย่อเป็น JPG → ตั้งชื่อ reviewN.jpg ต่อจากเลขล่าสุด → เขียนลง images/reviews/ ในโฟลเดอร์เว็บ
   → ผูกเข้ารายการแบบ path เต็ม (หน้าร้านเห็นโดยไม่ต้องแก้ list.json) · แล้วให้ลากโฟลเดอร์ขึ้น GitHub ต่อเอง */
const RV_MAX_SIDE = 1600, RV_QUALITY = 0.85, RV_PENDING_KEY = 'sfb_review_pending';
let rvDirHandle = null;
function rvDb(){ return new Promise((res, rej) => { const r = indexedDB.open('sfb-admin', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function rvKvGet(k){ try{ const db = await rvDb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }catch(e){ return null; } }
async function rvKvSet(k, v){ try{ const db = await rvDb(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); }catch(e){} }
function rvPendingGet(){ try{ return JSON.parse(localStorage.getItem(RV_PENDING_KEY) || '[]'); }catch(e){ return []; } }
function rvPendingSet(a){ try{ localStorage.setItem(RV_PENDING_KEY, JSON.stringify(a)); }catch(e){} }
const RV_PENDING_DEL_KEY = 'sfb_review_pending_del';
function rvPendingDelGet(){ try{ return JSON.parse(localStorage.getItem(RV_PENDING_DEL_KEY) || '[]'); }catch(e){ return []; } }
function rvPendingDelSet(a){ try{ localStorage.setItem(RV_PENDING_DEL_KEY, JSON.stringify(a)); }catch(e){} }
function rvRenderPending(){
  const box = $('revPending'); if(!box) return;
  const a = rvPendingGet(), d = rvPendingDelGet();
  if(!window.showDirectoryPicker) $('revDirName').textContent = 'ต้องเปิดด้วย Chrome หรือ Edge บนคอมพิวเตอร์';
  const list = arr => `<small>${arr.slice(0, 20).map(esc).join(', ')}${arr.length > 20 ? ' …' : ''}</small>`;
  let html = '';
  if(a.length) html += `<div class="rv-pending"><b>ยังไม่ได้อัปโหลดขึ้น GitHub: ${a.length} รูป</b><br>ลากโฟลเดอร์ <code>images/reviews</code> ไปวางใน GitHub แล้วกดปุ่มด้านล่าง${a.length > 100 ? '<br>⚠ GitHub รับลากไฟล์ได้ไม่เกิน 100 ไฟล์ต่อครั้ง — ให้ลากเป็นชุดๆ' : ''}<br>${list(a)}<br><button type="button" class="btn btn-ghost btn-sm" id="revPendingDone">อัปโหลดขึ้น GitHub แล้ว (ล้างรายการ)</button></div>`;
  if(d.length) html += `<div class="rv-pending rv-pending-del"><b>ต้องลบบน GitHub: ${d.length} ไฟล์</b><br>ลบในเครื่องแล้ว แต่ GitHub ยังมีไฟล์อยู่ — เข้าโฟลเดอร์ <code>images/reviews</code> บน GitHub เปิดไฟล์ แล้วกดไอคอนถังขยะ (การลากโฟลเดอร์ขึ้นไปไม่ลบไฟล์เก่าให้)<br>${list(d)}<br><button type="button" class="btn btn-ghost btn-sm" id="revPendingDelDone">ลบบน GitHub แล้ว (ล้างรายการ)</button></div>`;
  box.innerHTML = html;
  const b1 = $('revPendingDone'); if(b1) b1.addEventListener('click', () => { rvPendingSet([]); rvRenderPending(); });
  const b2 = $('revPendingDelDone'); if(b2) b2.addEventListener('click', () => { rvPendingDelSet([]); rvRenderPending(); });
}
// โฟลเดอร์ images/reviews ในโฟลเดอร์เว็บ — ครั้งแรกให้เลือกโฟลเดอร์เว็บ ครั้งต่อไปจำไว้ (ขออนุญาตใหม่ทุกครั้งที่เปิดหลังบ้าน)
async function rvGetRoot(forcePick){
  if(!window.showDirectoryPicker){ toast('ฟีเจอร์นี้ใช้ได้เฉพาะ Chrome หรือ Edge บนคอมพิวเตอร์', true); return null; }
  let h = forcePick ? null : (rvDirHandle || await rvKvGet('webDir'));
  if(h){
    try{
      let p = await h.queryPermission({ mode: 'readwrite' });
      if(p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
      if(p !== 'granted') h = null;
    }catch(e){ toast('กดปุ่ม "เลือกโฟลเดอร์เว็บ" ก่อน แล้วลองลากรูปอีกครั้ง', true); return null; }
  }
  if(!h){
    try{ h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'sfb-web' }); }catch(e){ return null; }
    try{ await h.getFileHandle('index.html'); }catch(e){ toast('โฟลเดอร์นี้ไม่ใช่โฟลเดอร์เว็บ (ไม่พบ index.html) — เลือกโฟลเดอร์ที่มี index.html อยู่ข้างใน', true); return null; }
    await rvKvSet('webDir', h);
  }
  rvDirHandle = h;
  const n1 = $('revDirName'); if(n1) n1.textContent = '✓ โฟลเดอร์เว็บ: ' + h.name;
  const n2 = $('pdDirName'); if(n2) n2.textContent = '✓ โฟลเดอร์เว็บ: ' + h.name;
  return h;
}
async function rvGetDir(forcePick){
  const h = await rvGetRoot(forcePick);
  if(!h) return null;
  const imgs = await h.getDirectoryHandle('images', { create: true });
  return imgs.getDirectoryHandle('reviews', { create: true });
}
/* ───────────── อัปโหลดรูปสินค้า (ลากมาวาง) ─────────────
   ใช้โฟลเดอร์เว็บและการย่อรูปชุดเดียวกับรูปรีวิว → ย่อเป็น JPG → ตั้งชื่อ <รหัสสินค้า>-N.jpg
   → เขียนลง images/products/<รหัสสินค้า>/ → ใส่พาธเข้ารูปหลัก/แกลเลอรี · ต้องลากโฟลเดอร์ขึ้น GitHub ต่อเอง
   ชื่อโฟลเดอร์/ไฟล์เป็นอังกฤษ-ตัวเลขล้วน กันปัญหาภาษาไทยในพาธ */
const PD_DIR = 'images/products/', PD_PENDING_KEY = 'sfb_product_pending';
function pdPendingGet(){ try{ return JSON.parse(localStorage.getItem(PD_PENDING_KEY) || '[]'); }catch(e){ return []; } }
function pdPendingSet(a){ try{ localStorage.setItem(PD_PENDING_KEY, JSON.stringify(a)); }catch(e){} }
function pdSlug(id){ return String(id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); }
// ชุดรูปทั้งหมดของสินค้า (รูปหลักก่อน) / เขียนกลับเป็น image + images
function pdAll(){ return imgsOf(draft); }
function pdSetAll(all){
  draft.image = all[0] || '';
  if(all.length > 1) draft.images = all.slice(1); else delete draft.images;
}
function pdRefresh(){ renderMediaPanel(); updateSummaries(); }
async function pdFileExists(root, path){
  try{
    const seg = String(path).split('/').filter(Boolean);
    let d = root;
    for(let i = 0; i < seg.length - 1; i++) d = await d.getDirectoryHandle(seg[i]);
    await d.getFileHandle(seg[seg.length - 1]);
    return true;
  }catch(e){ return false; }
}
// แกนอัปโหลด: ย่อรูป → เขียนลง images/products/<รหัส>/ → คืนรายการพาธ (ไม่แตะข้อมูลสินค้า) · have = พาธที่ปลายทางมีอยู่แล้ว
async function pdProcess(all, have, onProgress){
  const slug = pdSlug(draft && draft.id);
  if(!slug){ toast('กรอกรหัสสินค้า (ตัวอักษรอังกฤษหรือตัวเลข) ในการ์ดข้อมูลสินค้าก่อน แล้วค่อยลากรูป', true); return null; }
  const files = all.filter(f => /^image\//.test(f.type) || REVIEW_IMG_RE.test(f.name));
  if(!files.length){ toast('ไม่พบไฟล์รูป ลากไฟล์ .jpg .png .webp มาวาง', true); return null; }
  const root = await rvGetRoot(false);
  if(!root) return null;
  const imgs = await root.getDirectoryHandle('images', { create: true });
  const prods = await imgs.getDirectoryHandle('products', { create: true });
  const dir = await prods.getDirectoryHandle(slug, { create: true });
  // เลขถัดไป = เลขสูงสุดของ <รหัส>-N ที่มีทั้งในโฟลเดอร์และในสินค้านี้ (ทุกแถว) + 1
  let next = 0;
  const re = new RegExp('^' + slug.replace(/[-_]/g, '\\$&') + '-(\\d+)\\.', 'i');
  const bump = n => { const m = re.exec(String(n).split('/').pop()); if(m) next = Math.max(next, +m[1]); };
  for await (const name of dir.keys()) bump(name);
  pdEveryImagePath().forEach(bump);
  const hmap = (await rvKvGet('pdHashMap')) || {}; // { sha: พาธ } รูปเดียวกัน → ใช้พาธเดิม ไม่เขียนไฟล์ซ้ำ
  const added = [], reused = [], already = [], fails = [];
  have = new Set(have);
  for(let i = 0; i < files.length; i++){
    const f = files[i];
    if(onProgress) onProgress(i + 1, files.length);
    try{
      const sha = await rvSha(f);
      const known = hmap[sha];
      if(known && await pdFileExists(root, known)){
        if(have.has(known)){ already.push(f.name); continue; }
        have.add(known); added.push(known); reused.push(f.name); continue;
      }
      const blob = await rvResize(f);
      if(!blob) throw new Error('resize');
      const name = `${slug}-${++next}.jpg`;
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(blob); await w.close();
      const path = PD_DIR + slug + '/' + name;
      hmap[sha] = path; have.add(path); added.push(path);
      pdPendingSet([...new Set([...pdPendingGet(), path])]);
    }catch(e){ fails.push(f.name); }
  }
  await rvKvSet('pdHashMap', hmap);
  return { added, reused, already, fails, nonImage: all.length - files.length };
}
// ทุกพาธรูปในสินค้านี้ (หลัก/แกลเลอรี/สี/ไซซ์/ตัวแปร/ของเสริม) ไว้นับเลขไฟล์ถัดไป ไม่ให้ชื่อชนกัน
function pdEveryImagePath(){
  const out = [];
  const row = o => { if(o){ if(o.image) out.push(String(o.image)); (o.images || []).forEach(x => x && out.push(String(x))); } };
  row(draft);
  [draft.colors, draft.sizes, draft.variants, draft.addons].forEach(arr => (arr || []).forEach(o => { row(o); (o.addons || []).forEach(row); }));
  return out;
}
function pdReportHtml(r, total){
  const rows = [];
  if(r.added.length) rows.push(`<p class="rv-add-ok">✓ เพิ่มแล้ว ${r.added.length} รูป — กดบันทึกสินค้าด้านบนเพื่อให้หน้าร้านเห็น แล้วอย่าลืมลากโฟลเดอร์ <b>images/products</b> ขึ้น GitHub</p>`);
  if(r.reused.length) rows.push(`<p class="rv-add-note">${r.reused.length} รูปเคยอัปโหลดแล้ว ใช้ไฟล์เดิมให้: ${r.reused.map(esc).join(', ')}</p>`);
  if(r.already.length) rows.push(`<p class="rv-add-note">ข้าม ${r.already.length} รูปที่มีอยู่แล้ว: ${r.already.map(esc).join(', ')}</p>`);
  if(r.fails.length) rows.push(`<p class="rv-add-err">อ่านรูปไม่ได้ ${r.fails.length} รูป: ${r.fails.map(esc).join(', ')}</p>`);
  if(r.nonImage) rows.push(`<p class="rv-add-note">ข้ามไฟล์ที่ไม่ใช่รูป ${r.nonImage} ไฟล์</p>`);
  return rows.join('');
}
// สรุปสั้นๆ ด้วย toast สำหรับจุดที่วาดใหม่ทั้งแผง (สี/ไซซ์/ของเสริม/หน้าต่างรูปเพิ่มเติม)
function pdToastResult(r, extra){
  if(r.added.length) toast(`เพิ่มแล้ว ${r.added.length} รูป${extra || ''} — กดบันทึกสินค้า และลากโฟลเดอร์ images/products ขึ้น GitHub`);
  else if(r.already.length) toast('รูปนี้มีอยู่แล้ว ไม่ได้เพิ่มซ้ำ');
  if(r.fails.length) toast('อ่านรูปไม่ได้: ' + r.fails.join(', '), true);
}
async function pdUploadFiles(list){
  const all = Array.from(list || []);
  if(!draft || !all.length) return;
  const drop = document.querySelector('#panelMedia .pd-drop'), out = $('pdOut');
  if(drop) drop.classList.add('is-busy');
  try{
    const r = await pdProcess(all, pdAll(), (i, n) => { if(out) out.innerHTML = `<p class="rv-add-note">กำลังจัดการรูป ${i}/${n} …</p>`; });
    if(!r) return;
    if(r.added.length){
      const cur = pdAll();
      r.added.forEach(pth => { if(!cur.includes(pth)) cur.push(pth); });
      pdSetAll(cur);
    }
    pdRefresh();
    const o2 = $('pdOut'); if(o2) o2.innerHTML = pdReportHtml(r);
  }catch(e){
    toast('เพิ่มรูปไม่สำเร็จ: ' + (e.message || e), true);
  }finally{
    const d2 = document.querySelector('#panelMedia .pd-drop'); if(d2) d2.classList.remove('is-busy');
  }
}
/* ── รอบ 2: ช่องลากรูปของแต่ละสี / ไซซ์ / ของเสริม (data-pd-row = เส้นทางในสินค้า เช่น colors.0, sizes.1, addons.0) ── */
function pdRowDropHtml(path, single){
  return `<div class="pd-rowdrop" tabindex="0" role="button" data-pd-row="${esc(path)}"${single ? ' data-pd-single="1"' : ''}>📷 ลากรูปมาวาง หรือคลิกเลือกรูป<small>${single ? 'ใช้เป็นรูปของเสริมนี้ (ถ้าเลือกหลายรูปจะใช้รูปแรก)' : 'รูปแรกเป็นรูปหลักถ้ายังว่าง ที่เหลือเข้ารูปเพิ่มเติม'}</small></div>`;
}
async function pdUploadToRow(path, list, single){
  if(!draft) return;
  const row = getPath(draft, path);
  if(!row) return;
  const zoneSel = `.pd-rowdrop[data-pd-row="${path}"]`;
  const zone = document.querySelector(zoneSel);
  if(zone) zone.classList.add('is-busy');
  try{
    const r = await pdProcess(Array.from(list || []), imgsOf(row), null);
    if(!r) return;
    if(r.added.length){
      if(single){
        row.image = r.added[0];
      }else{
        const cur = imgsOf(row);
        r.added.forEach(pth => { if(!cur.includes(pth)) cur.push(pth); });
        row.image = cur[0] || '';
        if(cur.length > 1) row.images = cur.slice(1); else delete row.images;
      }
      if(path.startsWith('addons')) renderAddonsPanel(); else renderPricePanel();
      renderMediaPanel(); // ให้กล่องเตือน "ยังไม่ได้อัปโหลดขึ้น GitHub" อัปเดต
      updateSummaries();
    }
    pdToastResult(r, single && r.added.length > 1 ? ' (ใช้รูปแรกเป็นรูปของเสริม)' : '');
  }catch(e){
    toast('เพิ่มรูปไม่สำเร็จ: ' + (e.message || e), true);
  }finally{
    const z2 = document.querySelector(zoneSel); if(z2) z2.classList.remove('is-busy');
  }
}
// หน้าต่าง "รูปเพิ่มเติม" ของตัวแปร: รูปแรกเป็นรูปหลักถ้ายังว่าง ที่เหลือต่อท้ายรูปเพิ่มเติม
async function pdUploadToModal(list){
  if(!draft || !im) return;
  const zone = document.querySelector('#imgBody .pd-rowdrop');
  if(zone) zone.classList.add('is-busy');
  try{
    const have = [im.main, ...im.list].map(x => String(x || '').trim()).filter(Boolean);
    const r = await pdProcess(Array.from(list || []), have, null);
    if(!r || !im) return;
    im.list = im.list.filter(x => String(x || '').trim());
    r.added.forEach(pth => {
      if(!String(im.main || '').trim()){ im.main = pth; im.mainChanged = true; }
      else if(!im.list.includes(pth) && pth !== im.main) im.list.push(pth);
    });
    renderImgModal();
    renderMediaPanel();
    pdToastResult(r);
  }catch(e){
    toast('เพิ่มรูปไม่สำเร็จ: ' + (e.message || e), true);
  }finally{
    const z2 = document.querySelector('#imgBody .pd-rowdrop'); if(z2) z2.classList.remove('is-busy');
  }
}
function pdPendingHtml(){
  const a = pdPendingGet();
  if(!a.length) return '';
  const short = a.slice(0, 12).map(x => esc(x.replace(PD_DIR, ''))).join(', ') + (a.length > 12 ? ' …' : '');
  return `<div class="rv-pending"><b>ยังไม่ได้อัปโหลดขึ้น GitHub: ${a.length} รูป</b><br>ลากโฟลเดอร์ <code>images/products</code> ไปวางใน GitHub แล้วกดปุ่มด้านล่าง${a.length > 100 ? '<br>⚠ GitHub รับลากไฟล์ได้ไม่เกิน 100 ไฟล์ต่อครั้ง — ให้ลากเป็นชุดๆ' : ''}<br><small>${short}</small><br><button type="button" class="btn btn-ghost btn-sm" data-act="pd-pending-done">อัปโหลดขึ้น GitHub แล้ว (ล้างรายการ)</button></div>`;
}
async function rvSha(file){
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function rvResize(file){
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, RV_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  if(bmp.close) bmp.close();
  return new Promise(res => cv.toBlob(res, 'image/jpeg', RV_QUALITY));
}
async function rvUploadFiles(list){
  const all = Array.from(list || []);
  if(!rvm || !all.length) return;
  const files = all.filter(f => /^image\//.test(f.type) || REVIEW_IMG_RE.test(f.name));
  if(!files.length){ toast('ไม่พบไฟล์รูป ลากไฟล์ .jpg .png .webp มาวาง', true); return; }
  const drop = $('revDrop'), out = $('revAddOut');
  drop.classList.add('is-busy');
  try{
    const dir = await rvGetDir(false);
    if(!dir) return;
    // เลขถัดไป = เลขสูงสุดที่มีอยู่ทั้งในโฟลเดอร์และในรายการ + 1
    let next = 0;
    const bump = n => { const m = /review(\d+)/i.exec(String(n)); if(m) next = Math.max(next, +m[1]); };
    for await (const name of dir.keys()) bump(name);
    [...rvm.files, ...Object.keys(rvm.tags)].forEach(bump);
    const seen = new Set((await rvKvGet('rvHashes')) || []);
    const hmap = (await rvKvGet('rvHashMap')) || {};
    const added = [], dups = [], fails = [];
    for(let i = 0; i < files.length; i++){
      const f = files[i];
      out.innerHTML = `<p class="rv-add-note">กำลังจัดการรูป ${i + 1}/${files.length} …</p>`;
      try{
        const sha = await rvSha(f);
        if(seen.has(sha)){ dups.push(f.name); continue; }
        const blob = await rvResize(f);
        if(!blob) throw new Error('resize');
        const name = `review${++next}.jpg`;
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(blob); await w.close();
        seen.add(sha); hmap[name] = sha; added.push(name);
      }catch(e){ fails.push(f.name); }
    }
    await rvKvSet('rvHashes', [...seen]); await rvKvSet('rvHashMap', hmap);
    added.forEach(name => { const key = REVIEW_DIR + name; rvm.tags[key] = rvm.tags[key] || []; rvm.hidden.delete(key); rvm.files = rvm.files.filter(x => x !== key); });
    added.slice().reverse().forEach(name => rvm.files.unshift(REVIEW_DIR + name)); // ใหม่สุดอยู่หน้า
    if(added.length){
      rvPendingSet([...new Set([...rvPendingGet(), ...added])]);
      rvm.history = [];
      rvm.dirty = true; rvm.filter = 'all'; rvm.q = ''; $('revSearch').value = '';
    }
    const rows = [];
    if(added.length) rows.push(`<p class="rv-add-ok">✓ เพิ่มแล้ว ${added.length} รูป (${esc(added[0])}${added.length > 1 ? ' – ' + esc(added[added.length - 1]) : ''}) — กดบันทึกด้านล่างเพื่อให้หน้าร้านเห็น แล้วอย่าลืมลากโฟลเดอร์ขึ้น GitHub</p>`);
    if(dups.length) rows.push(`<p class="rv-add-note">ข้าม ${dups.length} รูปที่เคยอัปโหลดแล้ว: ${dups.map(esc).join(', ')}</p>`);
    if(fails.length) rows.push(`<p class="rv-add-err">อ่านรูปไม่ได้ ${fails.length} รูป: ${fails.map(esc).join(', ')}</p>`);
    if(all.length > files.length) rows.push(`<p class="rv-add-note">ข้ามไฟล์ที่ไม่ใช่รูป ${all.length - files.length} ไฟล์</p>`);
    out.innerHTML = rows.join('');
    rvRenderPending();
    renderReviewsModal();
  }catch(e){
    toast('เพิ่มรูปไม่สำเร็จ: ' + (e.message || e), true);
  }finally{
    drop.classList.remove('is-busy');
  }
}
// ลบไฟล์จริง: ใช้ได้เฉพาะรูปที่ซ่อนอยู่แล้ว · ลบไฟล์ในโฟลเดอร์เว็บในเครื่อง + เอาออกจากรายการ · ส่วนบน GitHub ต้องลบเอง (ขึ้นในรายการเตือน)
async function rvPurge(k){
  if(!rvm || !rvm.hidden.has(k)) return;
  const full = k.includes('/') ? k : REVIEW_DIR + k;
  const name = reviewShortName(k);
  const ok = await askConfirm('ลบไฟล์รูปนี้จริง', `ลบ “${name}” ถาวร กู้คืนไม่ได้ · ไฟล์ในโฟลเดอร์เว็บจะถูกลบทันที และต้องลบบน GitHub ตามด้วย`, 'ลบไฟล์จริง');
  if(!ok || !rvm || !rvm.hidden.has(k)) return;
  const plain = full.startsWith(REVIEW_DIR) && !full.slice(REVIEW_DIR.length).includes('/') ? full.slice(REVIEW_DIR.length) : null;
  if(plain){
    let done = false;
    try{
      const dir = await rvGetDir(false);
      if(dir){ await dir.removeEntry(plain); done = true; }
    }catch(e){ if(e && e.name === 'NotFoundError') done = true; } // ไม่มีในเครื่อง (มีแต่บน GitHub) ถือว่าลบฝั่งเครื่องแล้ว
    if(!done){ toast('ลบไฟล์ในโฟลเดอร์เว็บไม่ได้ — กด "เลือกโฟลเดอร์เว็บ" แล้วลองใหม่ (ยังไม่มีอะไรถูกลบ)', true); return; }
  }
  if(!rvm) return;
  delete rvm.tags[k]; rvm.hidden.delete(k); rvm.files = rvm.files.filter(x => x !== k);
  rvm.history = [];
  rvm.dirty = true;
  rvPendingSet(rvPendingGet().filter(x => x !== plain));
  rvPendingDelSet([...new Set([...rvPendingDelGet(), plain || full])]);
  const map = (await rvKvGet('rvHashMap')) || {};
  if(plain && map[plain]){ // ให้อัปโหลดรูปเดิมซ้ำได้อีก ไม่ถูกข้ามว่าซ้ำ
    const seen = ((await rvKvGet('rvHashes')) || []).filter(x => x !== map[plain]);
    await rvKvSet('rvHashes', seen); delete map[plain]; await rvKvSet('rvHashMap', map);
  }
  rvRenderPending();
  renderReviewsModal();
  toast('ลบไฟล์ในเครื่องแล้ว — กดบันทึก และอย่าลืมลบบน GitHub (ดูรายการใน “＋ เพิ่มรูปรีวิวใหม่”)');
}
// เลิกทำ: เก็บภาพก่อนแก้ของป้ายสินค้า/สถานะซ่อน (ล้างทิ้งเมื่อเพิ่มรูปใหม่หรือลบไฟล์จริง เพราะย้อนไฟล์ไม่ได้)
function rvSnap(label, key){ return { tags: clone(rvm.tags), hidden: [...rvm.hidden], dirty: rvm.dirty, label: label || '', key: key || '' }; }
function rvPushSnap(s){ if(!rvm || !s) return; rvm.history.push(s); if(rvm.history.length > 30) rvm.history.shift(); }
function rvUndo(){
  if(!rvm || !rvm.history || !rvm.history.length) return;
  const s = rvm.history.pop();
  rvm.tags = s.tags; rvm.hidden = new Set(s.hidden); rvm.dirty = s.dirty;
  renderReviewsModal();
  toast('เลิกทำ: ' + (s.label || 'การแก้ไขล่าสุด'));
  if(s.key){ // เลื่อนไปที่รูปนั้นและกะพริบกรอบ ให้เห็นว่าอะไรเปลี่ยนกลับ
    const el = [...document.querySelectorAll('#revGrid [data-rv-key]')].find(x => x.dataset.rvKey === s.key);
    if(el){ el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 1600); }
  }
}
// ตัวอย่างแกลเลอรีหน้าร้าน: รูปสินค้า แล้วต่อด้วยรูปรีวิวที่ผูกกับสินค้า (นับตามที่ยังไม่ได้บันทึกด้วย)
let rvPrevState = null;
function rvOpenPreview(pid){
  const p = catalog.find(x => x.id === pid);
  if(!rvm || !p) return;
  const base = [...new Set([p.image, ...(Array.isArray(p.images) ? p.images : [])].map(v => String(v || '').trim()).filter(Boolean))];
  if(!base.length){ const m = mainImageOf(p); if(m) base.push(m); }
  const rv = Object.keys(rvm.tags).filter(k => (rvm.tags[k] || []).includes(pid) && !rvm.hidden.has(k)).sort((a, b) => reviewNum(b) - reviewNum(a)).map(reviewSrc).filter(s => !base.includes(s));
  rvPrevState = { title: p.id + ' · ' + (p.name || ''), nBase: base.length, list: [...base.map(src => ({ src, review: false })), ...rv.map(src => ({ src, review: true }))], i: 0 };
  $('revPrev').hidden = false;
  rvRenderPreview();
}
function rvRenderPreview(){
  const st = rvPrevState; if(!st) return;
  $('revPrevTitle').textContent = st.title;
  const cur = st.list[st.i];
  $('revPrevMain').innerHTML = cur ? `<img src="${esc(cur.src)}" alt="">` : '<p class="rv-pick-empty">สินค้านี้ยังไม่มีรูป</p>';
  $('revPrevThumbs').innerHTML = st.list.map((o, i) => `<button type="button" class="rv-prev-thumb${i === st.i ? ' is-on' : ''}${o.review ? ' is-review' : ''}" data-i="${i}"><img src="${esc(o.src)}" alt="" loading="lazy"></button>`).join('')
    + `<span class="rv-prev-count">รูปสินค้า ${st.nBase} · รูปรีวิว ${st.list.length - st.nBase}</span>`;
}
function rvClosePreview(){ rvPrevState = null; $('revPrev').hidden = true; }
// เลือกสินค้าให้รูป: แตะรูป → เลือกสินค้า → เสร็จ (ใช้เมื่อเปิดจากเมนู "รีวิวลูกค้า" ไม่ได้เลือกสินค้าไว้)
let rvPickKey = null;
function rvOpenPick(k){
  if(!rvm) return;
  rvPickKey = k;
  const ids = rvm.tags[k] || [];
  $('revPickImg').src = reviewSrc(k);
  $('revPickCur').textContent = ids.length ? 'ตอนนี้ผูกกับ ' + ids.join(', ') : 'ยังไม่ผูกสินค้า — พิมพ์ค้นหาแล้วแตะสินค้าที่ต้องการ';
  const pb = $('revPickPrev'); pb.hidden = !ids.length; pb.dataset.rvPrev = ids[0] || ''; pb.textContent = ids.length ? '👁 ดูตัวอย่างหน้าร้านของ ' + ids[0] : '';
  $('revPickQ').value = '';
  $('revPick').hidden = false;
  rvRenderPick();
  setTimeout(() => $('revPickQ').focus(), 0);
}
function rvClosePick(){ rvPickKey = null; $('revPick').hidden = true; }
function rvRenderPick(){
  if(!rvm || !rvPickKey) return;
  const q = $('revPickQ').value.trim().toLowerCase();
  const cur = rvm.tags[rvPickKey] || [];
  const hit = catalog.filter(p => !q || (String(p.id) + ' ' + String(p.name || '')).toLowerCase().includes(q));
  const rows = hit.slice(0, 40).map(p => `<button type="button" class="rv-pick-item${cur.includes(p.id) ? ' is-on' : ''}" data-pid="${esc(p.id)}">${thumbHtml(mainImageOf(p), 'rv-opt-img')}<span><b>${esc(p.id)}</b> ${esc(p.name || '')}</span></button>`);
  if(cur.length && !q) rows.unshift('<button type="button" class="rv-pick-item is-remove" data-pid="">เอารูปนี้ออกจากสินค้า (ไม่ผูกสินค้า)</button>');
  $('revPickList').innerHTML = rows.length ? rows.join('') + (hit.length > 40 ? '<p class="rv-pick-empty">แสดง 40 รายการแรก — พิมพ์เพิ่มเพื่อกรอง</p>' : '') : '<p class="rv-pick-empty">ไม่พบสินค้าที่ตรงกับคำค้น</p>';
}
function rvPickChoose(pid){
  const k = rvPickKey;
  if(!rvm || !k) return;
  const nm = reviewShortName(k);
  const before = JSON.stringify(rvm.tags[k] || []);
  const snap = rvSnap(pid ? `ผูก ${nm} กับ ${pid}` : `เอา ${nm} ออกจากสินค้า`, k);
  if(pid) rvm.tags[k] = [pid];
  else if(k.includes('/')) rvm.tags[k] = [];
  else delete rvm.tags[k];
  const same = before === JSON.stringify(rvm.tags[k] || []); // เลือกค่าเดิม = ไม่มีอะไรเปลี่ยน ไม่เก็บเป็นขั้นเลิกทำ
  if(!same){ rvPushSnap(snap); rvm.dirty = true; }
  rvClosePick();
  renderReviewsModal();
  toast(same ? 'รูปนี้ผูกกับ ' + pid + ' อยู่แล้ว — ไม่มีอะไรเปลี่ยน' : (pid ? 'ผูก ' + nm + ' กับ ' + pid + ' แล้ว · ถ้าผิดกด “เลิกทำ”' : 'เอารูปออกจากสินค้าแล้ว · ถ้าผิดกด “เลิกทำ”'));
}
async function persistReviewTags(next, hidden){
  const hide = hidden || reviewHidden;
  const clean = {};
  Object.keys(next).sort((a, b) => reviewNum(a) - reviewNum(b)).forEach(k => { if(k !== REVIEW_HIDDEN_KEY && next[k] && (next[k].length || k.includes('/'))) clean[k] = next[k]; });
  const doc = Object.assign({}, clean);
  if(hide.size) doc[REVIEW_HIDDEN_KEY] = [...hide].sort();
  setSaveState('กำลังบันทึก…', 'is-saving');
  try{
    await fb.dbApi.setDoc(catalogRef(), {
      reviewsJson: JSON.stringify(doc),
      reviewsUpdatedAt: new Date().toISOString()
    }, { merge: true });
    reviewTags = clean;
    reviewHidden = new Set(hide);
    setSaveState('บันทึกแล้ว · หน้าร้านอัปเดตทันที');
    return true;
  } catch(err){
    setSaveState('บันทึกไม่สำเร็จ', 'is-error');
    toast(err.code === 'permission-denied'
      ? 'บันทึกไม่ได้: กฎความปลอดภัยของ Firestore ยังไม่อนุญาตให้เพิ่มช่อง reviewsJson / reviewsUpdatedAt'
      : 'บันทึกไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
    return false;
  }
}

// หน้าต่างรูปรีวิว = กริดรูปเดียว · เปิดจากหน้าแก้ไขสินค้า (มีรหัสสินค้า) = กดรูปเพื่อเลือก/เอาออกจากสินค้านั้น
// หน้าร้านเห็นรูปนี้เองไหม: path เต็ม (เพิ่มจากหลังบ้าน) = เห็น · ชื่อไฟล์เฉยๆ = ต้องอยู่ใน list.json (ถ้าไม่มี list.json หน้าร้านเดา review1..200.jpg)
function reviewIsLive(k){
  if(String(k).includes('/')) return true;
  if(scanListedNames.size) return scanListedNames.has(k);
  return /^review\d{1,3}\.jpg$/.test(k);
}

async function openReviewsModal(productId){
  rvm = { files: [], tags: clone(reviewTags), hidden: new Set(reviewHidden), filter: 'all', q: '', ctx: null, loading: true, dirty: false, history: [] };
  const prod = productId ? catalog.find(p => p.id === productId) : null;
  if(prod){ rvm.ctx = prod.id; rvm.filter = 'prod'; } // เปิดจากหน้าแก้ไขสินค้า → เลือกรูปให้สินค้านั้น
  $('revSearch').value = '';
  $('revAddPanel').hidden = true; $('revAddOut').innerHTML = ''; $('revAddText').value = '';
  $('revScrim').hidden = false;
  renderReviewsModal();
  rvm.files = await scanReviewFiles();
  if(!rvm) return; // ปิดหน้าต่างไปก่อนสแกนเสร็จ
  // ป้ายสินค้าที่ผูกไว้กับชื่อเฉยๆ ของไฟล์ที่ตอนนี้อยู่เป็น path เต็มแล้ว → รวมเข้าไปที่ path เต็ม
  Object.keys(rvm.tags).forEach(k => {
    if(k.includes('/')) return;
    const f = REVIEW_DIR + k;
    if(rvm.tags[f]){ rvm.tags[f] = [...new Set([...rvm.tags[f], ...rvm.tags[k]])]; delete rvm.tags[k]; }
  });
  rvm.loading = false;
  if(!rvm.ctx && rvm.files.some(k => !rvm.hidden.has(k) && !(rvm.tags[k] || []).length)) rvm.filter = 'none'; // เปิดจากเมนู → เริ่มที่รูปที่ยังไม่ผูกสินค้า
  renderReviewsModal();
}

async function closeReviewsModal(force){
  if(!rvm) return;
  if(rvm.dirty && !force){
    const ok = await askConfirm('ยังไม่ได้บันทึก', 'การเปลี่ยนแปลงรูปรีวิวที่แก้ไว้จะหายไป ปิดเลยไหม?', 'ปิดโดยไม่บันทึก');
    if(!ok) return;
  }
  $('revScrim').hidden = true;
  rvClosePick(); rvClosePreview();
  rvm = null;
}

// ลบออกจากเว็บ = ซ่อนรูป (ไม่ลบไฟล์จริง กู้คืนได้) · ป้ายสินค้าที่ผูกไว้ยังอยู่ ถ้ากู้คืนจะกลับมาเหมือนเดิม
function rvHide(k){
  if(!rvm || !k || rvm.hidden.has(k)) return;
  rvPushSnap(rvSnap('ลบ ' + reviewShortName(k), k));
  rvm.hidden.add(k); rvm.dirty = true;
}
function rvRestore(k){
  if(!rvm || !rvm.hidden.has(k)) return;
  rvPushSnap(rvSnap('กู้คืน ' + reviewShortName(k), k));
  rvm.hidden.delete(k); rvm.dirty = true;
  renderReviewsModal();
}
// รูปที่ระบบเจอในโฟลเดอร์แต่หน้าร้านยังไม่เห็น → ย้ายเป็น path เต็ม (พร้อมป้ายสินค้าเดิม) หน้าร้านจะเห็นหลังกดบันทึก
function rvGoLive(){
  if(!rvm) return;
  rvm.history = [];
  const todo = rvm.files.filter(k => !rvm.hidden.has(k) && !reviewIsLive(k));
  if(!todo.length) return;
  const keys = todo.map(k => REVIEW_DIR + k);
  todo.forEach(k => {
    const key = REVIEW_DIR + k;
    rvm.tags[key] = [...new Set([...(rvm.tags[key] || []), ...(rvm.tags[k] || [])])];
    delete rvm.tags[k];
  });
  rvm.files = [...keys, ...rvm.files.filter(x => !todo.includes(x) && !keys.includes(x))];
  rvm.dirty = true;
  toast(`เพิ่มเข้าหน้าร้าน ${todo.length} รูป — กดบันทึกเพื่อให้หน้าร้านเห็น`);
  renderReviewsModal();
}

// ───── กริดรูปทั้งหมด ─────
function reviewVisibleKeys(){
  const q = (rvm.q || '').trim().toLowerCase();
  return rvm.files.filter(k => {
    const ids = rvm.tags[k] || [];
    if(q && !k.toLowerCase().includes(q)) return false;
    if(rvm.filter === 'hidden') return rvm.hidden.has(k);
    if(rvm.hidden.has(k)) return false;
    if(rvm.filter === 'notlive') return !reviewIsLive(k);
    if(rvm.filter === 'none') return !ids.length;
    if(rvm.filter === 'tagged') return ids.length > 0;
    if(rvm.filter === 'prod') return !!rvm.ctx && ids.includes(rvm.ctx);
    return true;
  });
}

function renderReviewAll(){
  const ctxP = rvm.ctx ? catalog.find(p => p.id === rvm.ctx) : null;
  const live = rvm.files.filter(k => !rvm.hidden.has(k));
  const nHidden = rvm.files.length - live.length;
  const notLive = live.filter(k => !reviewIsLive(k));
  if(rvm.filter === 'hidden' && !nHidden) rvm.filter = 'all';
  if(rvm.filter === 'notlive' && !notLive.length) rvm.filter = 'all';
  const nNoneAll = live.filter(k => !(rvm.tags[k] || []).length).length;
  const nMine = ctxP ? live.filter(k => (rvm.tags[k] || []).includes(ctxP.id)).length : 0;

  $('revSummary').innerHTML = rvm.loading ? '' :
    `<span><b>${live.length}</b> รูปในระบบ</span>
     <span class="is-ok">ขึ้นหน้าร้านแล้ว <b>${live.length - notLive.length}</b></span>
     ${!ctxP && nNoneAll ? `<span class="is-warn">ยังไม่ผูกสินค้า <b>${nNoneAll}</b> รูป — แตะรูปเพื่อเลือกสินค้า</span>` : ''}
     ${notLive.length ? `<span class="is-warn">ยังไม่ขึ้นหน้าร้าน <b>${notLive.length}</b></span>` : ''}
     ${nHidden ? `<span>ลบแล้ว <b>${nHidden}</b></span>` : ''}
     ${notLive.length ? `<button type="button" class="btn btn-primary btn-sm" data-rv-golive>เพิ่มรูปที่ยังไม่ขึ้นทั้งหมด (${notLive.length})</button>` : ''}`;

  $('revCtx').innerHTML = ctxP
    ? `<div class="rv-ctx">${thumbHtml(mainImageOf(ctxP), 'rv-opt-img')}<div><b>${esc(ctxP.id)} · ${esc(ctxP.name || '')}</b><span>กดรูปที่เป็นสินค้านี้เพื่อเลือก (กดซ้ำเพื่อเอาออก) · เลือกแล้ว ${nMine} รูป</span></div><button type="button" class="btn btn-ghost btn-sm" data-rv-prev="${esc(ctxP.id)}">👁 ดูตัวอย่างหน้าร้าน</button></div>`
    : '';
  const nNone = live.filter(k => !(rvm.tags[k] || []).length).length;
  const chips = [['all', `ทั้งหมด (${live.length})`], ['none', `ยังไม่ผูกสินค้า (${nNone})`], ['tagged', `ผูกสินค้าแล้ว (${live.length - nNone})`]];
  if(ctxP) chips.push(['prod', `ของ ${ctxP.id} (${nMine})`]);
  if(notLive.length) chips.push(['notlive', `ยังไม่ขึ้นหน้าร้าน (${notLive.length})`]);
  if(nHidden) chips.push(['hidden', `ลบแล้ว (${nHidden})`]);
  $('revFilter').innerHTML = chips.map(([k, t]) => `<button type="button" class="rv-chip${rvm.filter === k ? ' is-on' : ''}" data-rv-filter="${k}">${esc(t)}</button>`).join('');

  const keys = reviewVisibleKeys();
  $('revGrid').innerHTML = rvm.loading
    ? '<p class="rv-empty">กำลังค้นหารูปรีวิว …</p>'
    : keys.length ? keys.map(k => {
        const ids = rvm.tags[k] || [];
        const bad = ids.filter(id => !catalog.some(p => p.id === id));
        const isHid = rvm.hidden.has(k);
        const mine = !isHid && !!(ctxP && ids.includes(ctxP.id));
        const idTxt = !ids.length ? 'ยังไม่ผูกสินค้า' : esc(ids.join(', ')) + (bad.length ? ' (ไม่พบสินค้า)' : '');
        const label = `<span class="rv-label${!ids.length ? ' is-none' : ''}${bad.length ? ' is-bad' : ''}"><span class="rv-fn">${esc(reviewShortName(k))}</span><small>${isHid ? 'ลบแล้ว' : idTxt}</small></span>`;
        const badge = (!isHid && !reviewIsLive(k)) ? '<span class="rv-badge" title="หน้าร้านยังไม่เห็นรูปนี้ — กดปุ่ม “เพิ่มรูปที่ยังไม่ขึ้นทั้งหมด” แล้วบันทึก">⚠ ยังไม่ขึ้นหน้าร้าน</span>' : '';
        return `<button type="button" class="rv-tile${mine ? ' is-sel' : ''}${isHid ? ' is-hidden' : ''}${ctxP && ids.length && !mine && !isHid ? ' is-other' : ''}" data-rv-key="${esc(k)}" title="${esc(k)}">
          <img src="${esc(reviewSrc(k))}" alt="" loading="lazy" decoding="async">
          ${mine ? '<span class="rv-check">✓</span>' : ''}
          ${badge}
          <a class="rv-zoom" href="${esc(reviewSrc(k))}" target="_blank" rel="noopener" title="เปิดดูรูปใหญ่" data-rv-zoom>⤢</a>
          ${isHid ? '<span class="rv-restore" role="button" data-rv-restore>↩ กู้คืน</span><span class="rv-purge" role="button" data-rv-purge title="ลบไฟล์รูปนี้จริง กู้คืนไม่ได้">🗑 ลบไฟล์จริง</span>' : '<span class="rv-del" role="button" data-rv-del title="ลบออกจากเว็บ (ซ่อน ไม่ลบไฟล์จริง กู้คืนได้)">🗑</span>'}
          ${label}
        </button>`;
      }).join('')
    : `<p class="rv-empty">${rvm.files.length ? (rvm.filter === 'none' && !rvm.q ? '🎉 ผูกสินค้าครบทุกรูปแล้ว — กด “ทั้งหมด” เพื่อดูรูปทั้งหมด' : 'ไม่มีรูปที่ตรงกับตัวกรอง/คำค้นนี้') : 'ไม่พบรูปรีวิวใน images/reviews/ — เอารูปไปวางในโฟลเดอร์ แล้วกด “＋ เพิ่มรูปรีวิวใหม่” ด้านบน'}</p>`;
}

function renderReviewsModal(){
  if(!rvm) return;
  renderReviewAll();
  $('revSave').disabled = !rvm.dirty;
  const lastU = rvm.history && rvm.history.length ? rvm.history[rvm.history.length - 1] : null;
  $('revUndo').hidden = !lastU; $('revUndo').disabled = !lastU; // ไม่มีอะไรให้เลิกทำ = ซ่อนปุ่ม
  $('revUndo').title = lastU ? 'เลิกทำ: ' + lastU.label : '';
  $('revHint').textContent = rvm.dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก' + (lastU && lastU.label ? ' · ล่าสุด: ' + lastU.label : '') : '';
  $('revHint').classList.toggle('is-info', rvm.dirty);
}

async function saveReviewsModal(){
  if(!rvm || !rvm.dirty) return;
  $('revSave').disabled = true;
  const ok = await persistReviewTags(rvm.tags, rvm.hidden);
  if(!ok){ $('revSave').disabled = false; return; }
  toast('บันทึกรูปรีวิวแล้ว');
  closeReviewsModal(true);
  if(draft){ reviewPanelFor = null; renderReviewsPanel(); updateSummaries(); }
}

// การ์ด "รูปรีวิวลูกค้า" ในหน้าแก้ไขสินค้า
function renderReviewsPanel(){
  const box = $('panelReviews');
  if(!box || !draft) return;
  const id = String(draft.id || '').trim();
  reviewPanelFor = String(draft.id || '');
  const keys = reviewKeysOf(id);
  box.innerHTML = `
    <div class="rv-panel">
      ${keys.slice(0, 8).map(k => `<img class="rv-mini" src="${esc(reviewSrc(k))}" alt="" loading="lazy">`).join('')}
      ${keys.length > 8 ? `<span class="field-hint" style="margin:0">+${keys.length - 8}</span>` : ''}
      <button type="button" class="btn btn-ghost" data-act="manage-reviews"${id ? '' : ' disabled'}>${keys.length ? 'จัดการรูปรีวิวของสินค้านี้' : 'เลือกรูปรีวิวให้สินค้านี้'}</button>
      <p class="rv-panel-note">${id
        ? 'รูปรีวิวจะต่อท้ายแกลเลอรีของสินค้านี้บนหน้าร้าน (ไม่เป็นรูปปกและไม่อยู่ในภาพแคตตาล็อก) · บันทึกแยกจากปุ่ม “บันทึกสินค้า”'
        : 'ใส่รหัสสินค้าในการ์ด “ข้อมูลสินค้า” ก่อน จึงจะเลือกรูปรีวิวได้'}</p>
    </div>`;
}

/* ───────────────── จัดการหมวดหมู่ / ชนิดดอกไม้ / ขนาด ─────────────────
   เก็บในเอกสารเดียวกับสินค้า (ช่อง optionsJson) หน้าร้านอ่านชุดเดียวกัน
   แก้ชื่อ = แก้ชื่อในสินค้าที่ใช้ค่านั้นให้ด้วย · ลบได้เฉพาะรายการที่ไม่มีสินค้าใช้อยู่ (รวมสินค้าที่ซ่อนไว้) */

let om = null;   // { tab:'cats'|'flowers'|'sizes', sizeCat:int, cats:[{orig,name,sizes:[{orig,name}]}], flowers:[{orig,name}] }

// ป้ายขนาดทั้งหมดของสินค้า (ระดับสินค้า + ไซซ์ + คู่ผสม)
function allTagsOf(p){
  return [
    ...sizeTagsOf(p),
    ...(p.sizes || []).map(s => s && s.tag),
    ...(p.variants || []).map(v => v && v.tag),
  ].flatMap(v => String(v ?? '').split(',')).map(v => v.trim()).filter(Boolean);
}

function useCount(kind, name, cat){
  const n = String(name ?? '').trim();
  if(!n) return 0;
  if(kind === 'cats') return catalog.filter(p => String(p.cat ?? '').trim() === n).length;
  if(kind === 'flowers') return catalog.filter(p => String(p.flowerType ?? '').trim() === n).length;
  if(!cat) return 0;
  return catalog.filter(p => String(p.cat ?? '').trim() === cat && allTagsOf(p).includes(n)).length;
}

function openOptionsModal(){
  const used = [...new Set(catalog.map(p => String(p.cat ?? '').trim()).filter(Boolean))];
  const names = [...SHOP_CATS, ...used.filter(c => !SHOP_CATS.includes(c))];
  om = {
    tab: 'cats',
    sizeCat: 0,
    cats: names.map(n => ({ orig: n, name: n, sizes: (CATEGORY_SIZE_TAGS[n] || []).map(s => ({ orig: s, name: s })) })),
    flowers: FLOWER_TYPE_TAGS.map(n => ({ orig: n, name: n }))
  };
  $('optScrim').hidden = false;
  renderOptionsModal();
}

function closeOptionsModal(){
  $('optScrim').hidden = true;
  om = null;
}

function omList(){
  if(om.tab === 'cats') return om.cats;
  if(om.tab === 'flowers') return om.flowers;
  const c = om.cats[om.sizeCat];
  return c ? c.sizes : [];
}

function renderOptionsModal(focusIdx){
  document.querySelectorAll('#optTabs .om-tab').forEach(b => {
    const on = b.dataset.tab === om.tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const kind = om.tab;
  let head = '';
  if(kind === 'cats'){
    $('optAddLabel').textContent = 'เพิ่มหมวดหมู่';
    head = '<p class="om-note">ลำดับในรายการนี้ = ลำดับแท็บหมวดบนหน้าร้าน · หมวดใหม่ยังไม่มีตัวกรองขนาด (ไปเพิ่มที่แท็บ “ขนาด”)</p>';
  } else if(kind === 'flowers'){
    $('optAddLabel').textContent = 'เพิ่มชนิดดอกไม้';
    head = '<p class="om-note">ตัวกรองบนหน้าร้านและหลังบ้านเรียงตามจำนวนสินค้า มากไปน้อย · ช่องเลือกในหน้าแก้ไขสินค้าเรียงตามรายการนี้</p>';
  } else {
    $('optAddLabel').textContent = 'เพิ่มขนาด';
    if(om.sizeCat >= om.cats.length) om.sizeCat = 0;
    head = `<select class="bulk-select om-catpick" id="optSizeCat" aria-label="เลือกหมวดหมู่">${om.cats.map((c, i) =>
      `<option value="${i}"${i === om.sizeCat ? ' selected' : ''}>${esc(c.name.trim() || '(หมวดใหม่ยังไม่ตั้งชื่อ)')}</option>`).join('')}</select>`;
  }
  const list = omList();
  const catOrig = kind === 'sizes' ? (om.cats[om.sizeCat] || {}).orig : null;
  const rows = list.map((r, i) => {
    const n = r.orig == null ? 0 : useCount(kind, r.orig, catOrig);
    const core = kind === 'cats' && r.orig === CORE_CAT;
    const delOff = core || n > 0;
    const delTip = core ? 'หมวดหลักของร้าน ลบไม่ได้' : n ? `มีสินค้าใช้อยู่ ${n} ชิ้น ลบไม่ได้` : 'ลบ';
    return `<div class="om-row" data-i="${i}">
      <input type="text" value="${esc(r.name)}" maxlength="60" placeholder="ชื่อ" aria-label="ชื่อ"${core ? ' readonly title="หมวดหลักของร้าน แก้ชื่อไม่ได้"' : ''}>
      ${r.orig != null ? `<span class="om-use">${n ? `ใช้อยู่ ${n} ชิ้น` : 'ยังไม่มีสินค้าใช้'}</span>` : ''}
      <button type="button" class="om-ico" data-act="up" title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น"${i === 0 ? ' disabled' : ''}>▲</button>
      <button type="button" class="om-ico" data-act="down" title="เลื่อนลง" aria-label="เลื่อนลง"${i === list.length - 1 ? ' disabled' : ''}>▼</button>
      <button type="button" class="om-ico om-del" data-act="del" title="${esc(delTip)}" aria-label="ลบ"${delOff ? ' disabled' : ''}>✕</button>
    </div>`;
  }).join('');
  $('optBody').innerHTML = head + (rows || '<p class="om-empty">ยังไม่มีรายการ กด “เพิ่ม” ด้านล่าง</p>');
  omValidateUI();
  if(focusIdx != null){
    const inp = $('optBody').querySelectorAll('.om-row input')[focusIdx];
    if(inp){ inp.focus(); inp.select(); }
  }
}

// คืนข้อความปัญหาแรกที่พบ (ว่าง = บันทึกได้)
function omProblem(){
  const check = (arr, label) => {
    const seen = new Set();
    for(const r of arr){
      const n = r.name.trim();
      if(!n){
        if(r.orig != null) return `${label}: มีชื่อที่เว้นว่าง — พิมพ์ชื่อ หรือกด ✕ ลบแถวนั้น`;
        continue;
      }
      if(n === 'ทั้งหมด') return `${label}: ใช้ชื่อ “ทั้งหมด” ไม่ได้ (เป็นปุ่มของระบบ)`;
      if(n.includes(',')) return `${label}: ห้ามมีเครื่องหมายจุลภาค (,) ในชื่อ “${n}”`;
      if(seen.has(n)) return `${label}: ชื่อ “${n}” ซ้ำกัน`;
      seen.add(n);
    }
    return '';
  };
  if(!om.cats.some(c => c.name.trim())) return 'ต้องมีหมวดหมู่อย่างน้อย 1 หมวด';
  return check(om.cats, 'หมวดหมู่')
    || check(om.flowers, 'ชนิดดอกไม้')
    || om.cats.map(c => check(c.sizes, `ขนาดของ “${c.name.trim() || 'หมวดใหม่'}”`)).find(Boolean)
    || '';
}

function omValidateUI(){
  const msg = omProblem();
  $('optHint').textContent = msg;
  $('optSave').disabled = !!msg;
}

function optAddRow(){
  if(!om) return;
  if(om.tab === 'sizes' && !om.cats[om.sizeCat]){
    toast('ยังไม่มีหมวดหมู่ ไปเพิ่มที่แท็บ “หมวดหมู่” ก่อน', true);
    return;
  }
  const list = omList();
  list.push(om.tab === 'cats' ? { orig: null, name: '', sizes: [] } : { orig: null, name: '' });
  renderOptionsModal(list.length - 1);
  $('optBody').scrollTop = $('optBody').scrollHeight;
}

// เปลี่ยนชื่อในสินค้า (แก้พร้อมกันทีเดียว ไม่ไล่ต่อเป็นทอด จึงสลับชื่อกันได้) คืนจำนวนสินค้าที่ถูกแก้
function applyRenames(list, catMap, flowerMap, sizeMaps){
  let changed = 0;
  list.forEach(p => {
    let touched = false;
    const oldCat = String(p.cat ?? '').trim();
    const m = sizeMaps.get(oldCat);
    if(m){
      const ren = s => {
        const parts = String(s ?? '').split(',').map(x => x.trim());
        if(!parts.some(x => m.has(x))) return s;
        touched = true;
        return parts.map(x => (m.has(x) ? m.get(x) : x)).filter(Boolean).join(', ');
      };
      if(Array.isArray(p.size)) p.size = p.size.map(ren);
      else if(p.size) p.size = ren(p.size);
      (p.sizes || []).forEach(s => { if(s && s.tag) s.tag = ren(s.tag); });
      (p.variants || []).forEach(v => { if(v && v.tag) v.tag = ren(v.tag); });
    }
    if(catMap.has(oldCat)){ p.cat = catMap.get(oldCat); touched = true; }
    const f = String(p.flowerType ?? '').trim();
    if(flowerMap.has(f)){ p.flowerType = flowerMap.get(f); touched = true; }
    if(touched) changed++;
  });
  return changed;
}

// เขียนตัวเลือกร้าน (และสินค้าที่ถูกแก้ชื่อตาม ถ้ามี) ลง Firestore ในคำสั่งเดียว — สำเร็จพร้อมกันหรือไม่สำเร็จพร้อมกัน
async function saveOptionsToCloud(opts, nextCatalog){
  const now = new Date().toISOString();
  const payload = { optionsJson: JSON.stringify(opts), optionsUpdatedAt: now };
  if(nextCatalog){
    const json = JSON.stringify(nextCatalog);
    if(new Blob([json]).size > FIRESTORE_DOC_LIMIT * 0.9){
      toast('ข้อมูลสินค้าใหญ่เกินกว่าที่ Firestore เก็บได้ในเอกสารเดียว ยังบันทึกไม่ได้', true);
      return false;
    }
    Object.assign(payload, {
      json, count: nextCatalog.length, updatedAt: now,
      updatedBy: fb.auth.currentUser ? fb.auth.currentUser.email : ''
    });
  }
  setSaveState('กำลังบันทึก…', 'is-saving');
  try{
    await fb.dbApi.setDoc(catalogRef(), payload, { merge: true });
    setSaveState('บันทึกแล้ว · หน้าร้านอัปเดตทันที');
    return true;
  } catch(err){
    setSaveState('บันทึกไม่สำเร็จ', 'is-error');
    toast(err.code === 'permission-denied'
      ? 'บันทึกไม่ได้: กฎความปลอดภัยของ Firestore ยังไม่อนุญาตให้เพิ่มช่อง optionsJson / optionsUpdatedAt'
      : 'บันทึกไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
    return false;
  }
}

async function saveOptionsModal(){
  if(!om || omProblem()) return;
  const clean = arr => arr.map(r => ({ orig: r.orig, name: r.name.trim() })).filter(r => r.name);
  const cats = om.cats.map(c => ({ orig: c.orig, name: c.name.trim(), sizes: clean(c.sizes) })).filter(c => c.name);
  const flowers = clean(om.flowers);

  const catMap = new Map(), flowerMap = new Map(), sizeMaps = new Map();
  cats.forEach(c => {
    if(c.orig != null && c.orig !== c.name) catMap.set(c.orig, c.name);
    if(c.orig == null) return;
    const m = new Map();
    c.sizes.forEach(s => { if(s.orig != null && s.orig !== s.name) m.set(s.orig, s.name); });
    if(m.size) sizeMaps.set(c.orig, m);
  });
  flowers.forEach(f => { if(f.orig != null && f.orig !== f.name) flowerMap.set(f.orig, f.name); });

  const next = clone(catalog);
  const changed = applyRenames(next, catMap, flowerMap, sizeMaps);
  if(changed){
    const parts = [];
    catMap.forEach((n, o) => parts.push(`หมวด “${o}” → “${n}”`));
    flowerMap.forEach((n, o) => parts.push(`ชนิด “${o}” → “${n}”`));
    sizeMaps.forEach(m => m.forEach((n, o) => parts.push(`ขนาด “${o}” → “${n}”`)));
    const ok = await askConfirm('แก้ชื่อสินค้าตามด้วย?',
      `สินค้า ${changed} ชิ้นที่ใช้ชื่อเดิมจะถูกแก้เป็นชื่อใหม่ให้อัตโนมัติ (${parts.join(' · ')})`, 'บันทึก');
    if(!ok) return;
  }

  const opts = {
    cats: cats.map(c => c.name),
    flowers: flowers.map(f => f.name),
    sizes: Object.fromEntries(cats.filter(c => c.sizes.length).map(c => [c.name, c.sizes.map(s => s.name)]))
  };
  const btn = $('optSave');
  btn.disabled = true;
  const ok = await saveOptionsToCloud(opts, changed ? next : null);
  if(!ok){ btn.disabled = false; return; }
  applyShopOptions(opts);
  if(changed) catalog = next;
  closeOptionsModal();
  renderList();
  toast('บันทึกตัวเลือกร้านแล้ว หน้าร้านอัปเดตทันที');
}

/* ───────────────── ต่อสายเหตุการณ์ทั้งหมด ───────────────── */

$('loginBtn').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
$('loginUser').addEventListener('keydown', e => { if(e.key === 'Enter') $('loginPass').focus(); });

$('logoutBtn').addEventListener('click', async () => {
  const ok = await askConfirm('ออกจากระบบ', 'ต้องล็อกอินใหม่เพื่อกลับเข้ามาจัดการสินค้า', 'ออกจากระบบ');
  if(ok) fb.authApi.signOut(fb.auth);
});

$('searchBox').addEventListener('input', e => { searchTerm = e.target.value; renderList(); });
$('flowerFilter').addEventListener('change', e => { filterFlower = e.target.value; renderList(); });

$('catChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if(!chip) return;
  filterCat = chip.dataset.cat;
  renderList();
});

$('addBtn').addEventListener('click', () => openEditor(-1));
$('hidePricesBtn').addEventListener('click', togglePricesHidden);
$('catalogBtn').addEventListener('click', () => {
  const list = catalogTargets();
  const stamp = new Date().toISOString().slice(0, 10);
  exportPosters(list, `catalog-${stamp}`);
});
$('posterOneBtn').addEventListener('click', () => {
  if(!draft) return;
  exportPosters([draft], `${String(draft.id || 'product').replace(/[\\/:*?"<>|\s]+/g, '-')}_catalog`);
});
$('progressCancel').addEventListener('click', () => { posterCancel = true; });
$('optionsBtn').addEventListener('click', openOptionsModal);
$('reviewsBtn').addEventListener('click', () => openReviewsModal());
$('panelReviews').addEventListener('click', e => {
  if(e.target.closest('[data-act="manage-reviews"]') && draft && String(draft.id || '').trim()) openReviewsModal(String(draft.id).trim());
});
$('revFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-rv-filter]');
  if(b && rvm){ rvm.filter = b.dataset.rvFilter; renderReviewsModal(); }
});
$('revSearch').addEventListener('input', e => { if(rvm){ rvm.q = e.target.value; renderReviewAll(); } });
$('revAllView').addEventListener('click', e => {
  if(rvm && e.target.closest('[data-rv-golive]')) rvGoLive();
});
$('revGrid').addEventListener('click', async e => {
  if(e.target.closest('[data-rv-zoom]')) return; // ลิงก์เปิดรูปใหญ่
  const t = e.target.closest('[data-rv-key]');
  if(!t || !rvm) return;
  const k = t.dataset.rvKey;
  if(e.target.closest('[data-rv-del]')){ rvHide(k); renderReviewsModal(); return; }
  if(e.target.closest('[data-rv-purge]')){ rvPurge(k); return; }
  if(e.target.closest('[data-rv-restore]')){ rvRestore(k); return; }
  if(rvm.hidden.has(k)) return; // รูปที่ลบแล้ว: กู้คืนได้อย่างเดียว
  if(rvm.ctx){
    // เปิดมาจากหน้าแก้ไขสินค้า: กดรูป = เลือก/เอาออกจากสินค้านี้
    const ids = rvm.tags[k] || [];
    const snap = rvSnap(ids.includes(rvm.ctx) ? `เอา ${reviewShortName(k)} ออกจาก ${rvm.ctx}` : `เลือก ${reviewShortName(k)} ให้ ${rvm.ctx}`, k);
    if(ids.includes(rvm.ctx)){
      if(k.includes('/')) rvm.tags[k] = []; else delete rvm.tags[k];
    } else {
      if(ids.length && !(await askConfirm('รูปนี้ผูกกับสินค้าอื่นอยู่', `ตอนนี้ผูกกับ ${ids.join(', ')} · ย้ายมาที่ ${rvm.ctx} ไหม?`, 'ย้ายมาสินค้านี้')) ) return;
      if(!rvm) return;
      rvm.tags[k] = [rvm.ctx];
    }
    rvPushSnap(snap);
    rvm.dirty = true;
    renderReviewsModal();
  } else {
    rvOpenPick(k); // ไม่ได้เลือกสินค้าไว้: แตะรูป = เลือกสินค้าให้รูปนี้ (ดูรูปใหญ่ใช้ปุ่ม ⤢)
  }
});
$('revCancel').addEventListener('click', () => closeReviewsModal());
$('revUndo').addEventListener('click', rvUndo);
$('revPrevClose').addEventListener('click', rvClosePreview);
$('revPrevThumbs').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if(b && rvPrevState){ rvPrevState.i = +b.dataset.i; rvRenderPreview(); } });
$('revScrim').addEventListener('click', e => { const b = e.target.closest('[data-rv-prev]'); if(b && b.dataset.rvPrev) rvOpenPreview(b.dataset.rvPrev); });
document.addEventListener('keydown', e => {
  if(!rvm || $('revScrim').hidden || !$('revPick').hidden || !$('revPrev').hidden) return;
  if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')){ e.preventDefault(); rvUndo(); }
});
$('revPickClose').addEventListener('click', rvClosePick);
$('revPickQ').addEventListener('input', rvRenderPick);
$('revPickList').addEventListener('click', e => { const b = e.target.closest('[data-pid]'); if(b) rvPickChoose(b.dataset.pid); });
$('revSave').addEventListener('click', saveReviewsModal);
$('revAddOpen').addEventListener('click', () => { const p = $('revAddPanel'); p.hidden = !p.hidden; if(!p.hidden) $('revAddText').focus(); });
$('revAddClose').addEventListener('click', () => { $('revAddPanel').hidden = true; });
$('revAddGo').addEventListener('click', reviewAddMany);
$('revAddOpen').addEventListener('click', rvRenderPending);
$('revDrop').addEventListener('click', () => $('revFile').click());
$('revDrop').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('revFile').click(); } });
$('revDrop').addEventListener('dragover', e => { e.preventDefault(); $('revDrop').classList.add('is-over'); });
$('revDrop').addEventListener('dragleave', () => $('revDrop').classList.remove('is-over'));
$('revDrop').addEventListener('drop', e => { e.preventDefault(); $('revDrop').classList.remove('is-over'); rvUploadFiles(e.dataTransfer.files); });
$('revFile').addEventListener('change', e => { const f = Array.from(e.target.files); e.target.value = ''; rvUploadFiles(f); });
$('revPickDir').addEventListener('click', () => rvGetDir(true));
$('revScrim').addEventListener('click', e => { if(e.target === $('revScrim')) closeReviewsModal(); });
$('optTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if(!b || !om) return;
  om.tab = b.dataset.tab;
  renderOptionsModal();
});
$('optBody').addEventListener('input', e => {
  const row = e.target.closest('.om-row');
  if(!row || !om) return;
  omList()[+row.dataset.i].name = e.target.value;
  omValidateUI();
});
$('optBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if(!btn || !om || btn.disabled) return;
  const i = +btn.closest('.om-row').dataset.i;
  const list = omList();
  if(btn.dataset.act === 'del') list.splice(i, 1);
  else {
    const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
    if(j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }
  renderOptionsModal();
});
$('optBody').addEventListener('change', e => {
  if(e.target.id === 'optSizeCat' && om){ om.sizeCat = +e.target.value; renderOptionsModal(); }
});
$('optBody').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.matches('.om-row input')){
    e.preventDefault();
    if(e.target.value.trim()) optAddRow();
  }
});
$('optAddRow').addEventListener('click', optAddRow);
$('optCancel').addEventListener('click', closeOptionsModal);
$('optSave').addEventListener('click', saveOptionsModal);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if(f) importFromFile(f);
  e.target.value = '';
});
$('backupBtn').addEventListener('click', downloadBackup);

$('productList').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if(!btn){
    // กดที่ตัวแถวตรงไหนก็ได้ = เปิดแก้ไข (ยกเว้นเมนู/ที่จับลาก/สวิตช์)
    const row = e.target.closest('.tr, .pcard');
    if(row && !e.target.closest('.menu, .drag-handle, .sel-cell, .variant-panel')) openEditor(+row.dataset.i);
    return;
  }
  if(btn.disabled || btn.dataset.act === 'ready') return;
  const i = +btn.dataset.i;
  if(btn.dataset.act === 'toggle-variants'){
    // กาง/พับในตำแหน่งเดิม ไม่ต้องวาดทั้งรายการใหม่ (เลื่อนหน้าจอไม่กระโดด)
    const row = btn.closest('.tr');
    const p = catalog[i];
    const key = expandKey(p, i);
    const open = !expanded.has(key);
    if(open) expanded.add(key); else expanded.delete(key);
    row.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    const old = row.querySelector('.variant-panel');
    if(old) old.remove();
    if(open) row.insertAdjacentHTML('beforeend', variantPanelHtml(p, i));
    return;
  }
  if(btn.dataset.act === 'edit') openEditor(i);
  if(btn.dataset.act === 'copy') duplicateProduct(i);
  if(btn.dataset.act === 'hide-toggle') toggleHidden(i);
  if(btn.dataset.act === 'del') deleteProduct(i);
  if(btn.dataset.act === 'ready-toggle'){
    const p = catalog[i];
    if(p.ready) delete p.ready; else p.ready = true;
    renderList();
    saveCatalog(p.ready ? 'ตั้งเป็นพร้อมส่งแล้ว' : 'ยกเลิกพร้อมส่งแล้ว');
  }
  if(btn.dataset.act === 'up') moveProduct(i, -1);
  if(btn.dataset.act === 'down') moveProduct(i, 1);
});

$('productList').addEventListener('change', async e => {
  const el = e.target;
  if(el.dataset.act !== 'ready') return;
  const p = catalog[+el.dataset.i];
  if(el.checked) p.ready = true; else delete p.ready;
  await saveCatalog(el.checked ? 'ตั้งเป็นพร้อมส่งแล้ว' : 'ยกเลิกพร้อมส่งแล้ว');
});

$('productList').addEventListener('change', e => {
  const el = e.target;
  if(!el.classList.contains('sel')) return;
  const i = +el.dataset.i;
  if(el.checked) selected.add(i); else selected.delete(i);
  const holder = el.closest('.tr, .pcard');
  if(holder) holder.classList.toggle('is-selected', el.checked);
  renderBulk(visibleProducts());
});
['selAll', 'selAll2'].forEach(id => $(id).addEventListener('change', e => {
  visibleProducts().forEach(({ i }) => { if(e.target.checked) selected.add(i); else selected.delete(i); });
  renderList();
}));

// สลับมุมมอง การ์ด / รายการ (จำไว้ครั้งหน้า)
document.querySelectorAll('.vs-btn').forEach(b => b.addEventListener('click', () => {
  if(viewMode === b.dataset.view) return;
  viewMode = b.dataset.view;
  try{ localStorage.setItem('sfb_admin_view', viewMode); }catch(_){}
  renderList();
}));
$('bulkClear').addEventListener('click', () => { selected.clear(); renderList(); });
$('bulkReady').addEventListener('click', () => bulkApply(p => { p.ready = true; }, 'ตั้งพร้อมส่ง'));
$('bulkUnready').addEventListener('click', () => bulkApply(p => { delete p.ready; }, 'ยกเลิกพร้อมส่ง'));
$('bulkHide').addEventListener('click', () => bulkApply(p => { p.hidden = true; }, 'ซ่อนจากหน้าร้าน'));
$('bulkUnhide').addEventListener('click', () => bulkApply(p => { delete p.hidden; }, 'เลิกซ่อน'));
$('bulkCat').addEventListener('change', e => {
  const cat = e.target.value;
  if(cat) bulkApply(p => { p.cat = cat; }, `ย้ายไปหมวด “${cat}”`);
});
$('bulkDel').addEventListener('click', async () => {
  const n = selected.size;
  if(!n) return;
  const ok = await askConfirm('ลบสินค้าที่เลือก', `ลบสินค้า ${n} รายการออกจากหน้าร้านถาวร กู้คืนไม่ได้`, `ลบ ${n} รายการ`);
  if(!ok) return;
  catalog = catalog.filter((_, i) => !selected.has(i));
  selected.clear();
  renderList();
  await saveCatalog(`ลบ ${n} รายการแล้ว`);
});

// ปิดเมนู ⋯ เมื่อกดที่อื่นหรือเลือกรายการในเมนูแล้ว
document.addEventListener('click', e => {
  document.querySelectorAll('details.menu[open]').forEach(d => {
    if(!d.contains(e.target) || e.target.closest('.menu-pop button')) d.open = false;
  });
});

/* ───────────────── ลากเพื่อเรียงลำดับ (ไอคอน ⠿) — เดสก์ท็อป ───────────────── */
let dragFromIndex = null;
function clearDragTargetClasses(){
  $('productList').querySelectorAll('.tr.drag-target-before, .tr.drag-target-after, .pcard.drag-target-before, .pcard.drag-target-after')
    .forEach(r => r.classList.remove('drag-target-before', 'drag-target-after'));
}
$('productList').addEventListener('dragstart', e => {
  const handle = e.target.closest('.drag-handle');
  if(!handle || handle.classList.contains('is-disabled')){ e.preventDefault(); return; }
  dragFromIndex = +handle.dataset.i;
  const row = handle.closest('.tr, .pcard');
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragFromIndex)); // จำเป็นสำหรับบางเบราว์เซอร์ (Firefox) ถึงจะยอมให้ลากได้
  if(row) e.dataTransfer.setDragImage(row, 16, row.classList.contains('pcard') ? 16 : row.offsetHeight / 2);
});
$('productList').addEventListener('dragover', e => {
  if(dragFromIndex == null) return;
  const row = e.target.closest('.tr, .pcard');
  if(!row) return;
  e.preventDefault(); // จำเป็น ไม่งั้นเบราว์เซอร์จะไม่ยอมให้ drop
  e.dataTransfer.dropEffect = 'move';
  const rect = row.getBoundingClientRect();
  const before = row.classList.contains('pcard')
    ? e.clientX < rect.left + rect.width / 2
    : e.clientY < rect.top + rect.height / 2;
  clearDragTargetClasses();
  row.classList.add(before ? 'drag-target-before' : 'drag-target-after');
});
$('productList').addEventListener('drop', e => {
  if(dragFromIndex == null) return;
  const row = e.target.closest('.tr, .pcard');
  e.preventDefault();
  if(row){
    const overIndex = +row.dataset.i;
    const rect = row.getBoundingClientRect();
    const before = row.classList.contains('pcard')
      ? e.clientX < rect.left + rect.width / 2
      : e.clientY < rect.top + rect.height / 2;
    let to = before ? overIndex : overIndex + 1;
    if(to > dragFromIndex) to -= 1; // ลบตัวเดิมออกก่อนแล้วค่อยแทรก ตำแหน่งท้ายๆ เลยขยับลง 1
    reorderProduct(dragFromIndex, to);
  }
  clearDragTargetClasses();
  dragFromIndex = null;
});
$('productList').addEventListener('dragend', () => {
  $('productList').querySelectorAll('.tr.is-dragging, .pcard.is-dragging').forEach(r => r.classList.remove('is-dragging'));
  clearDragTargetClasses();
  dragFromIndex = null;
});


const drawerBody = $('editorBody');
drawerBody.addEventListener('input', onDraftInput);
drawerBody.addEventListener('change', e => {
  if(e.target.dataset.act === 'toggle-combo') onComboToggle(e);
  else if(e.target.dataset.sizeTag != null) onSizeTagToggle();
  else onDraftInput(e);
});
(function(){
  const pm = $('panelMedia');
  pm.addEventListener('click', e => { if(e.target.closest('.pd-drop')){ const f = pm.querySelector('.pd-file'); if(f) f.click(); } });
  pm.addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pd-drop')){ e.preventDefault(); const f = pm.querySelector('.pd-file'); if(f) f.click(); } });
  pm.addEventListener('dragover', e => { const d = e.target.closest('.pd-drop'); if(d){ e.preventDefault(); d.classList.add('is-over'); } });
  pm.addEventListener('dragleave', e => { const d = e.target.closest('.pd-drop'); if(d) d.classList.remove('is-over'); });
  pm.addEventListener('drop', e => { const d = e.target.closest('.pd-drop'); if(d){ e.preventDefault(); d.classList.remove('is-over'); pdUploadFiles(e.dataTransfer.files); } });
  pm.addEventListener('change', e => { if(e.target.classList.contains('pd-file')){ e.stopPropagation(); const f = Array.from(e.target.files); e.target.value = ''; pdUploadFiles(f); } });
})();
(function(){
  // ช่องลากรูปรายแถว (สี/ไซซ์/ของเสริม ในหน้าแก้ไข + หน้าต่างรูปเพิ่มเติมของตัวแปร) ใช้ไฟล์เลือกรูปตัวเดียวร่วมกัน
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true;
  document.body.appendChild(inp);
  let target = null; // { kind:'row', path, single } | { kind:'im' }
  const targetOf = z => z.dataset.pdRow === 'im' ? { kind: 'im' } : { kind: 'row', path: z.dataset.pdRow, single: !!z.dataset.pdSingle };
  const run = (t, files) => { if(!t || !files.length) return; if(t.kind === 'im') pdUploadToModal(files); else pdUploadToRow(t.path, files, t.single); };
  inp.addEventListener('change', () => { const f = Array.from(inp.files); inp.value = ''; run(target, f); });
  [$('editorBody'), $('imgBody')].forEach(host => {
    host.addEventListener('click', e => { const z = e.target.closest('.pd-rowdrop'); if(z){ target = targetOf(z); inp.click(); } });
    host.addEventListener('keydown', e => { const z = e.target.closest('.pd-rowdrop'); if(z && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); target = targetOf(z); inp.click(); } });
    host.addEventListener('dragover', e => { const z = e.target.closest('.pd-rowdrop'); if(z){ e.preventDefault(); z.classList.add('is-over'); } });
    host.addEventListener('dragleave', e => { const z = e.target.closest('.pd-rowdrop'); if(z) z.classList.remove('is-over'); });
    host.addEventListener('drop', e => { const z = e.target.closest('.pd-rowdrop'); if(z){ e.preventDefault(); z.classList.remove('is-over'); run(targetOf(z), Array.from(e.dataTransfer.files)); } });
  });
})();
drawerBody.addEventListener('click', onDraftClick);
drawerBody.addEventListener('click', e => { const b = e.target.closest('[data-combo-more]'); if(b && !b.disabled) openImgModal(+b.dataset.comboMore); });
drawerBody.addEventListener('click', e => {
  const p = e.target.closest('[data-combo-path]');
  if(p && !p.disabled){
    const row = p.closest('tbody').querySelector('.combo-imgrow');
    row.hidden = !row.hidden;
    if(!row.hidden) row.querySelector('input').focus();
    return;
  }
  const cb = e.target.closest('[data-cb]');
  if(cb) comboBulk(cb.dataset.cb);
});
drawerBody.addEventListener('input', e => {
  if(e.target.id !== 'comboSearch') return;
  comboQueryFor = draft; comboQuery = e.target.value;
  applyComboFilter();
});
drawerBody.addEventListener('click', updateSummaries);
drawerBody.addEventListener('input', updateSummaries);
drawerBody.addEventListener('change', updateSummaries);

$('editorClose').addEventListener('click', closeEditor);
$('cancelBtn').addEventListener('click', closeEditor);
$('saveBtn').addEventListener('click', saveDraft);

$('confirmYes').addEventListener('click', () => closeConfirm(true));
$('confirmNo').addEventListener('click', () => closeConfirm(false));
$('confirmScrim').addEventListener('click', e => { if(e.target === $('confirmScrim')) closeConfirm(false); });

document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!$('confirmScrim').hidden) closeConfirm(false);
  else if(!$('revScrim').hidden) closeReviewsModal();
  else if(!$('siteScrim').hidden) closeSiteModal();
  else if(!$('optScrim').hidden) closeOptionsModal();
  else if(!$('imgScrim').hidden) closeImgModal();
  else if(!$('varScrim').hidden) closeVarModal();
  else if(!$('editorPage').hidden) closeEditor();
});

/* ───── เมนูซ้าย: เปิด/ปิดบนจอแคบ ───── */
(function(){
  const app = $('app');
  const close = () => app.classList.remove('nav-open');
  $('menuBtn').addEventListener('click', () => app.classList.add('nav-open'));
  $('sbScrim').addEventListener('click', close);
  $('sidebar').addEventListener('click', e => { if(e.target.closest('.sb-item')) close(); });
  $('navProducts').addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top:0, behavior:'smooth' }); });
})();

/* =========================================================
   แต่งหน้าร้าน — แบนเนอร์ / ป๊อปอัป / ข้อความ / ชื่อ โลโก้ สี / FAQ / รีวิว
   เก็บเป็นข้อความ JSON ก้อนเล็ก ในช่อง siteJson ของเอกสารเดียวกับสินค้า (catalog/products)
   หน้าร้านอ่านพร้อมสินค้า (ไม่เพิ่มจำนวนครั้งที่อ่าน) · ไม่มีค่า = หน้าร้านใช้ค่าเดิมในโค้ด
   รูปที่อัปโหลดเขียนลงโฟลเดอร์เว็บในเครื่อง (Chrome/Edge บนคอม) แล้วต้องลากโฟลเดอร์ขึ้น GitHub เหมือนรูปรีวิว
   ========================================================= */
const SITE_DEFAULT_COLOR = '#F62188';
const SITE_DEFAULT_FAQ = [{"q": "S.Flower Bloom มีหน้าร้านไหม", "a": "ปัจจุบันเรายังไม่มีหน้าร้าน แต่สามารถนัดรับได้ในเมืองนครสวรรค์ และอำเภอพยุหะคีรี"}, {"q": "บริการจัดส่งจาก S.Flower Bloom", "a": "ทางร้านของเรามีบริการนัดรับในตัวเมืองนครสวรรค์และอำเภอพยุหะคีรี เพื่อให้มั่นใจว่าสินค้าจะถูกส่งถึงมือผู้รับอย่างปลอดภัยและไม่เกิดความเสียหาย สำหรับการจัดส่งพัสดุ เรามีบริการส่ง EMS ผ่านไปรษณีย์ไทย โดยทำการแพ็กสินค้าอย่างดีรัดกุม เพื่อลดความเสี่ยงของการชำรุดหรือเสียหายในระหว่างการขนส่งจนถึงมือผู้รับ"}, {"q": "ดอกไม้สามารถเก็บได้นานเท่าไหร่?", "a": "ดอกไม้ลวดกำมะหยี่ของเราสามารถคงความสวยงามได้นาน 3–5 ปี หรือยาวนานกว่านั้น เนื่องจากเป็นวัสดุทนทาน ไม่เหี่ยว ไม่ต้องรดน้ำ เพื่อรักษาความงดงามของดอกไม้ แนะนำให้หลีกเลี่ยงบริเวณที่มีฝุ่นเยอะ เพราะฝุ่นอาจเกาะบนผิวกำมะหยี่ทำให้ดูหมองลงได้ค่ะ"}, {"q": "ใช้เวลาทำกี่วัน?", "a": "โดยทั่วไปประมาณ 3–5 วัน (สามารถแจ้งเวลาประมาณการให้ลูกค้าทราบเป็นกรณีไป)"}];
let siteCfgSaved = null;   // ค่าที่บันทึกไว้ใน Firestore (null = ยังไม่เคยตั้ง)
let site = null;           // { tab, cfg, dirty, uploaded }
const siteBlobUrls = {};   // path → blob URL ไว้ดูตัวอย่างรูปที่เพิ่งอัปโหลด (ไฟล์ยังไม่ขึ้นเว็บ)

function parseSiteCfg(raw){
  try{ const o = typeof raw === 'string' ? JSON.parse(raw) : null; return (o && typeof o === 'object') ? o : null; }catch(_){ return null; }
}
function siteDefaults(){
  return {
    shop: { name: 'S.Flower Bloom', tagline: 'เลือกสินค้า แล้วสั่งซื้อผ่านแชทได้เลย' },
    logo: '',
    footer: '',
    theme: { main: SITE_DEFAULT_COLOR },
    banners: null, // null = ยังไม่เคยตั้ง → หน้าร้านใช้ promotions.png, promotions1.png ... เดิม
    popup: { on: true, slides: [{ src: 'images/orderprocess.png', on: true }] },
    hero: {
      title: 'ช่อดอกไม้กำมะหยี่\nสำหรับโอกาสพิเศษ',
      text: 'เลือกสินค้าที่ชอบ กดใส่ตะกร้า แล้วกดปุ่มเดียวเพื่อส่งรายการสั่งซื้อมาที่แชทเพจของเราได้ทันที ไม่ต้องพิมพ์เอง',
      textOff: 'เลือกดูสินค้าที่ชอบ แล้วแคปหน้าจอสินค้านั้นส่งให้เพจเพื่อสอบถามราคาและสั่งทำได้เลย',
      chips: ['🚚 ส่งพัสดุทั่วประเทศ', '📅 สั่งล่วงหน้า 3–5 วัน', '💬 ทักแชตเพื่อจองล่วงหน้า', ''],
      cta: 'เลือกดูสินค้า ↓'
    },
    reviews: { on: true, title: 'รีวิวจากลูกค้า' },
    faq: { on: true, title: 'คำถามที่พบบ่อย (FAQ)', items: clone(SITE_DEFAULT_FAQ) }
  };
}
function siteMerge(saved){
  const d = siteDefaults();
  if(!saved) return d;
  const pick = (a, b) => Object.assign({}, a, (b && typeof b === 'object' && !Array.isArray(b)) ? b : {});
  d.shop = pick(d.shop, saved.shop); d.hero = pick(d.hero, saved.hero);
  d.reviews = pick(d.reviews, saved.reviews); d.faq = pick(d.faq, saved.faq); d.popup = pick(d.popup, saved.popup);
  d.logo = typeof saved.logo === 'string' ? saved.logo : '';
  d.footer = typeof saved.footer === 'string' ? saved.footer : '';
  if(saved.theme && /^#[0-9a-f]{6}$/i.test(String(saved.theme.main || ''))) d.theme.main = saved.theme.main;
  const cleanList = a => a.map(b => ({ src: String((b && b.src) || '').trim(), on: !(b && b.on === false) })).filter(b => b.src);
  d.banners = Array.isArray(saved.banners) ? cleanList(saved.banners) : null;
  d.popup.slides = Array.isArray(saved.popup && saved.popup.slides) ? cleanList(saved.popup.slides) : d.popup.slides;
  const ch = Array.isArray(d.hero.chips) ? d.hero.chips.map(x => String(x || '')) : [];
  while(ch.length < 4) ch.push('');
  d.hero.chips = ch.slice(0, 4);
  d.faq.items = Array.isArray(d.faq.items) ? d.faq.items.map(i => ({ q: String((i && i.q) || ''), a: String((i && i.a) || '') })) : clone(SITE_DEFAULT_FAQ);
  return d;
}

/* ───── สีธีม: คำนวณชุดสีทั้งหมดจากสีหลักสีเดียว ───── */
function siteHexToHsl(hex){
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if(d){
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
}
function siteHslToHex(h, s, l){
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function siteDerivePalette(main){
  const [h, s, l] = siteHexToHsl(main);
  const n = parseInt(main.slice(1), 16);
  return {
    sage: main.toUpperCase(),
    sageDark: siteHslToHex(h, s, Math.max(l - 14, 8)),
    rose: siteHslToHex(h, Math.max(60, s), 78),
    roseDark: siteHslToHex(h, s * 0.8, l),
    peach: siteHslToHex(h - 12, 100, 88),
    cream: siteHslToHex(h, 100, 98),
    sageLight: siteHslToHex(h, 100, Math.min(l + 14, 78)),
    tint1: siteHslToHex(h, 100, 97.5),
    tint2: siteHslToHex(h, 100, 94.5),
    tint3: siteHslToHex(h, 67, 93),
    tint4: siteHslToHex(h, 62, 90),
    rgb: [n >> 16 & 255, n >> 8 & 255, n & 255].join(',')
  };
}
const SITE_SWATCHES = [['#F62188', 'ชมพูเดิม'], ['#E53935', 'แดง'], ['#FB6F2E', 'ส้ม'], ['#E6A700', 'เหลืองทอง'], ['#2E9E6B', 'เขียว'], ['#1E88E5', 'ฟ้า'], ['#7E57C2', 'ม่วง'], ['#B05BD6', 'ม่วงอ่อน']];

/* ───── อัปโหลดรูปลงโฟลเดอร์เว็บ (ใช้โฟลเดอร์เดียวกับรูปรีวิว) ───── */
async function siteDir(sub){
  if(!window.showDirectoryPicker){ toast('อัปโหลดรูปได้เฉพาะ Chrome หรือ Edge บนคอมพิวเตอร์ (หรือใช้ช่อง "เพิ่มจากชื่อไฟล์" แทน)', true); return null; }
  let h = rvDirHandle || await rvKvGet('webDir');
  if(h){
    try{
      let p = await h.queryPermission({ mode: 'readwrite' });
      if(p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
      if(p !== 'granted') h = null;
    }catch(e){ h = null; }
  }
  if(!h){
    try{ h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'sfb-web' }); }catch(e){ return null; }
    try{ await h.getFileHandle('index.html'); }catch(e){ toast('โฟลเดอร์นี้ไม่ใช่โฟลเดอร์เว็บ (ไม่พบ index.html) — เลือกโฟลเดอร์ที่มี index.html อยู่ข้างใน', true); return null; }
    await rvKvSet('webDir', h);
  }
  rvDirHandle = h;
  const imgs = await h.getDirectoryHandle('images', { create: true });
  return imgs.getDirectoryHandle(sub, { create: true });
}
async function siteDrawBlob(file, maxSide, mode){
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height, big = Math.max(w, h);
  let cw, ch, padded = false;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d');
  if(mode === 'square'){
    const ratio = w / h, side = Math.min(maxSide, big);
    cw = ch = side; cv.width = cv.height = side;
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, side, side);
    if(ratio > 0.97 && ratio < 1.03) cx.drawImage(bmp, 0, 0, side, side);
    else { const sc = side / big; cx.drawImage(bmp, (side - w * sc) / 2, (side - h * sc) / 2, w * sc, h * sc); padded = true; }
  } else {
    const sc = Math.min(1, maxSide / big); cw = Math.round(w * sc); ch = Math.round(h * sc);
    cv.width = cw; cv.height = ch;
    if(mode === 'jpg'){ cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); }
    cx.drawImage(bmp, 0, 0, cw, ch);
  }
  if(bmp.close) bmp.close();
  const blob = await new Promise(res => cv.toBlob(res, mode === 'png' ? 'image/png' : 'image/jpeg', 0.86));
  if(!blob) throw new Error('resize');
  return { blob, padded };
}
async function siteWrite(dir, name, blob){
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(blob); await w.close();
}
function siteProbe(src){ return new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = src; }); }
function siteThumbSrc(src){ return siteBlobUrls[src] || src; }

/* ───── เปิด / ปิด / แท็บ ───── */
const SITE_TABS = [['banners', 'แบนเนอร์'], ['popup', 'ป๊อปอัป'], ['hero', 'ข้อความ'], ['brand', 'ชื่อ · โลโก้ · สี'], ['faq', 'FAQ'], ['reviews', 'รีวิว']];
function openSiteModal(){
  site = { tab: 'banners', cfg: siteMerge(siteCfgSaved), dirty: false, uploaded: false, legacyChecked: false,
    bannersEdited: Array.isArray(siteCfgSaved && siteCfgSaved.banners) };
  $('siteScrim').hidden = false;
  siteHint('');
  renderSiteModal();
}
async function closeSiteModal(force){
  if(!site) return;
  if(!force && site.dirty && !(await askConfirm('ทิ้งการเปลี่ยนแปลง?', 'มีการแก้ไขที่ยังไม่ได้บันทึก ถ้าปิดตอนนี้การแก้ไขจะหายไป', 'ปิดโดยไม่บันทึก'))) return;
  $('siteScrim').hidden = true;
  site = null;
}
function siteHint(msg, isErr){
  const el = $('siteHint');
  el.textContent = msg || '';
  el.classList.toggle('is-info', !isErr);
}
function siteTouch(key){ if(key === 'banners') site.bannersEdited = true; site.dirty = true; if(!$('siteHint').textContent) siteHint('มีการแก้ไขที่ยังไม่ได้บันทึก'); }
function siteListRef(key){ return key === 'banners' ? site.cfg.banners : site.cfg.popup.slides; }

function renderSiteModal(){
  if(!site) return;
  $('siteTabs').innerHTML = SITE_TABS.map(([k, n]) => `<button type="button" class="om-tab${site.tab === k ? ' is-active' : ''}" data-tab="${k}" role="tab">${n}</button>`).join('');
  const body = $('siteBody'), top = body.scrollTop;
  const fn = { banners: siteTabBanners, popup: siteTabPopup, hero: siteTabHero, brand: siteTabBrand, faq: siteTabFaq, reviews: siteTabReviews }[site.tab];
  body.innerHTML = fn();
  body.scrollTop = top;
  if(site.tab === 'banners' && site.cfg.banners === null && !site.legacyChecked) siteLoadLegacyBanners();
}
const stInput = (path, val, ph) => `<input type="text" data-path="${path}" value="${esc(val)}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`;
const stField = (label, inner, note) => `<label class="st-field"><span>${label}</span>${inner}${note ? `<small>${note}</small>` : ''}</label>`;
const stCheck = (path, on, label) => `<label class="st-check"><input type="checkbox" data-path="${path}"${on ? ' checked' : ''}> ${label}</label>`;

/* รายการรูป (ใช้ทั้งแบนเนอร์และป๊อปอัป) */
function siteListHtml(key){
  const list = siteListRef(key);
  const rows = list.map((b, i) => `<div class="st-row${b.on ? '' : ' is-off'}" data-i="${i}">
    ${thumbHtml(siteThumbSrc(b.src), 'st-thumb')}
    <div class="st-path"><b>${key === 'banners' ? 'แบนเนอร์' : 'รูป'} ${i + 1}</b><code>${esc(b.src)}</code></div>
    <div class="st-acts">
      <label class="st-check"><input type="checkbox" data-on="${key}" data-i="${i}"${b.on ? ' checked' : ''}> แสดง</label>
      <button type="button" class="st-ico" data-act="up" data-key="${key}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น">↑</button>
      <button type="button" class="st-ico" data-act="down" data-key="${key}" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''} title="เลื่อนลง" aria-label="เลื่อนลง">↓</button>
      <button type="button" class="st-ico is-del" data-act="del" data-key="${key}" data-i="${i}" title="เอาออกจากรายการ" aria-label="เอาออกจากรายการ">✕</button>
    </div></div>`).join('');
  return `<div class="st-list">${rows || '<p class="st-empty">ยังไม่มีรูปในรายการ</p>'}</div>
    <div class="rv-drop" id="siteDrop" data-key="${key}" tabindex="0" role="button"><b>ลากรูปมาวางที่นี่</b><span>หรือคลิกเพื่อเลือกรูป (เลือกได้หลายรูป)</span></div>
    <div class="st-addpath"><input type="text" id="siteAddPath" data-key="${key}" placeholder="หรือพิมพ์ชื่อไฟล์ที่มีอยู่แล้ว เช่น images/promotions2.png"><button type="button" class="btn btn-ghost btn-sm" data-act="addpath" data-key="${key}">เพิ่มจากชื่อไฟล์</button></div>`;
}
function siteTabBanners(){
  const loading = site.cfg.banners === null;
  return `<p class="st-note">แบนเนอร์เลื่อนได้ใต้แถบค้นหา — แนะนำรูปสี่เหลี่ยมจัตุรัส 1:1 (เช่น 1080×1080) ระบบย่อรูปและแปลงเป็น JPG ให้ ถ้ารูปไม่จัตุรัสจะเติมขอบขาวให้แทนการตัดรูป
    ใช้ลูกศรเรียงลำดับ ติ๊ก "แสดง" ออกเพื่อซ่อนชั่วคราว · ถ้าซ่อนทุกรูป แบนเนอร์และข้อความข้างแบนเนอร์จะหายไปทั้งแผง</p>
    ${loading ? '<p class="st-empty">กำลังดึงรายการแบนเนอร์เดิม (promotions.png ...) มาให้…</p>' : siteListHtml('banners')}`;
}
function siteTabPopup(){
  return `<p class="st-note">รูปที่เด้งขึ้นตอนเปิดเว็บ (เช่น ขั้นตอนการสั่งซื้อ) · มือถือเด้งวันละครั้ง คอมเด้งทุกครั้ง</p>
    ${stCheck('popup.on', site.cfg.popup.on, 'แสดงป๊อปอัปตอนเปิดเว็บ')}
    ${siteListHtml('popup')}`;
}
function siteTabHero(){
  const h = site.cfg.hero;
  return `<p class="st-note">ข้อความในแผงข้างแบนเนอร์ — แสดงเฉพาะบนจอคอม (มือถือซ่อนแผงนี้)</p>
    ${stField('หัวข้อ (ขึ้นบรรทัดใหม่ได้)', `<textarea rows="2" data-path="hero.title">${esc(h.title)}</textarea>`)}
    ${stField('คำอธิบาย (ตอนร้านแสดงราคา)', `<textarea rows="3" data-path="hero.text">${esc(h.text)}</textarea>`)}
    ${stField('คำอธิบาย (ตอนร้านซ่อนราคา)', `<textarea rows="3" data-path="hero.textOff">${esc(h.textOff)}</textarea>`, 'ใช้แทนข้อความด้านบนเมื่อเปิดสวิตช์ "ซ่อนราคาบนหน้าร้าน"')}
    <div class="st-field"><span>ป้ายสั้น ๆ (ว่าง = ไม่แสดง)</span>${h.chips.map((c, i) => stInput('hero.chips.' + i, c, 'เช่น 🚚 ส่งพัสดุทั่วประเทศ')).join('')}</div>
    ${stField('ข้อความบนปุ่ม', stInput('hero.cta', h.cta))}`;
}
function siteTabBrand(){
  const c = site.cfg, pal = siteDerivePalette(c.theme.main), l = siteHexToHsl(c.theme.main)[2];
  const logo = c.logo || 'images/logo.png?v=2';
  const sw = SITE_SWATCHES.map(([hex, name]) => `<button type="button" class="st-sw${hex.toLowerCase() === c.theme.main.toLowerCase() ? ' is-on' : ''}" data-color="${hex}" style="background:${hex}" title="${name}" aria-label="${name}"></button>`).join('');
  return `${stField('ชื่อร้าน', stInput('shop.name', c.shop.name), 'แสดงที่หัวเว็บ ท้ายเว็บ และบนภาพแคตตาล็อก · ชื่อที่แท็บเบราว์เซอร์และตัวอย่างลิงก์ที่แชร์ยังเป็นค่าเดิม')}
    ${stField('ประโยคใต้ชื่อร้าน', stInput('shop.tagline', c.shop.tagline), 'แสดงใต้ชื่อร้านบนจอเล็กเท่านั้น')}
    ${stField('ข้อความท้ายเว็บ', stInput('footer', c.footer, '© ' + c.shop.name), 'ว่าง = ใช้ "© ชื่อร้าน"')}
    <div class="st-sec"><h4>โลโก้ที่หัวเว็บ</h4>
      <div class="st-logo">${thumbHtml(siteThumbSrc(logo), 'st-logo-img')}
        <div><button type="button" class="btn btn-ghost btn-sm" data-act="logo">เลือกรูปโลโก้ใหม่</button>
        ${c.logo ? '<button type="button" class="btn btn-ghost btn-sm" data-act="logo-reset">กลับไปใช้โลโก้เดิม</button>' : ''}
        <small class="st-small">PNG พื้นโปร่งใสสวยที่สุด · ระบบย่อให้ไม่เกิน 512px · ไอคอนแท็บเบราว์เซอร์ยังเป็นรูปเดิม</small></div></div></div>
    <div class="st-sec"><h4>สีหลักของร้าน</h4>
      <div class="st-swatches">${sw}<label class="st-pick" title="เลือกสีอื่น"><input type="color" id="siteColor" value="${c.theme.main.toLowerCase()}"><span>เลือกสีเอง</span></label></div>
      <div class="st-pal" aria-hidden="true">${['sage', 'sageDark', 'rose', 'roseDark', 'peach', 'cream'].map(k => `<i style="background:${pal[k]}"></i>`).join('')}</div>
      <small class="st-small">ระบบคำนวณสีเข้ม/อ่อนให้เองจากสีหลัก (ปุ่ม หัวข้อ ขอบ เงา)${c.theme.main.toLowerCase() === SITE_DEFAULT_COLOR.toLowerCase() ? ' · ตอนนี้ใช้สีชมพูเดิมของร้าน' : ''}</small>
      ${l > 66 ? '<p class="st-warn">สีนี้อ่อนมาก ตัวหนังสือสีขาวบนปุ่มอาจอ่านยาก แนะนำเลือกสีเข้มกว่านี้</p>' : ''}
    </div>`;
}
function siteTabFaq(){
  const f = site.cfg.faq;
  const rows = f.items.map((it, i) => `<div class="st-faq" data-i="${i}">
    <div class="st-faq-head"><b>คำถาม ${i + 1}</b><span class="st-acts">
      <button type="button" class="st-ico" data-act="faq-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
      <button type="button" class="st-ico" data-act="faq-down" data-i="${i}" ${i === f.items.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
      <button type="button" class="st-ico is-del" data-act="faq-del" data-i="${i}" aria-label="ลบคำถามนี้">✕</button></span></div>
    ${stInput('faq.items.' + i + '.q', it.q, 'คำถาม')}
    <textarea rows="3" data-path="faq.items.${i}.a" placeholder="คำตอบ">${esc(it.a)}</textarea></div>`).join('');
  return `${stCheck('faq.on', f.on, 'แสดงส่วนคำถามที่พบบ่อยบนหน้าร้าน')}
    ${stField('หัวข้อส่วน FAQ', stInput('faq.title', f.title))}
    ${rows || '<p class="st-empty">ยังไม่มีคำถาม (ถ้าไม่มีคำถามเลย ส่วน FAQ จะซ่อนบนหน้าร้าน)</p>'}
    <button type="button" class="vm-add" data-act="faq-add"><span>＋</span> เพิ่มคำถาม</button>`;
}
function siteTabReviews(){
  const r = site.cfg.reviews;
  return `<p class="st-note">แถบรีวิวจากลูกค้าบนหน้าแรก — เพิ่มรูป ผูกกับสินค้า หรือซ่อนรูปรายใบ ทำได้ในหน้าจัดการรูปรีวิว</p>
    ${stCheck('reviews.on', r.on, 'แสดงแถบรีวิวบนหน้าร้าน')}
    ${stField('หัวข้อแถบรีวิว', stInput('reviews.title', r.title))}
    <button type="button" class="btn btn-ghost" data-act="open-reviews">เปิดหน้าจัดการรูปรีวิว</button>`;
}

/* ดึงรายชื่อแบนเนอร์เดิม (promotions.png, promotions1.png ...) มาเป็นรายการตั้งต้น เพื่อไม่ให้ของเดิมหาย */
async function siteLoadLegacyBanners(){
  const s = site; s.legacyChecked = true;
  const found = [];
  for(let i = 0; i < 20; i++){
    const src = 'images/promotions' + (i === 0 ? '' : i) + '.png';
    if(!(await siteProbe(src))) break;
    found.push({ src, on: true });
  }
  if(site !== s) return;
  if(s.cfg.banners === null) s.cfg.banners = found;
  if(found.length){ s.dirty = true; s.bannersEdited = true; }
  renderSiteModal();
}

/* ───── อัปโหลด / เพิ่มรูป ───── */
async function siteUploadFiles(list, key){
  const files = Array.from(list || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name));
  if(!site || !files.length){ if(list && list.length) toast('ไม่พบไฟล์รูป ลากไฟล์ .jpg .png .webp มาวาง', true); return; }
  const drop = $('siteDrop'); if(drop) drop.classList.add('is-busy');
  try{
    const sub = key === 'banners' ? 'banners' : 'popup';
    const dir = await siteDir(sub);
    if(!dir) return;
    const tag = Date.now().toString(36);
    let added = 0, padded = 0; const fails = [];
    for(const f of files){
      try{
        const r = await siteDrawBlob(f, key === 'banners' ? 1080 : 1600, key === 'banners' ? 'square' : 'jpg');
        const name = `${key === 'banners' ? 'banner' : 'popup'}-${tag}${added}.jpg`;
        await siteWrite(dir, name, r.blob);
        const path = `images/${sub}/${name}`;
        siteBlobUrls[path] = URL.createObjectURL(r.blob);
        siteListRef(key).push({ src: path, on: true });
        added++; if(r.padded) padded++;
      }catch(e){ fails.push(f.name); }
    }
    if(added){ site.uploaded = true; siteTouch(key); }
    renderSiteModal();
    if(added) toast(`เพิ่มแล้ว ${added} รูป${padded ? ` (เติมขอบขาวให้ ${padded} รูปที่ไม่จัตุรัส)` : ''} — กดบันทึก แล้วลากโฟลเดอร์ images ขึ้น GitHub`);
    if(fails.length) toast('อ่านรูปไม่ได้: ' + fails.join(', '), true);
  } finally { const d = $('siteDrop'); if(d) d.classList.remove('is-busy'); }
}
async function siteAddByPath(key){
  const inp = $('siteAddPath'); if(!inp || !site) return;
  let p = inp.value.trim().replace(/^\.?\//, '');
  if(!p) return;
  if(!/^images\//i.test(p)) p = 'images/' + p;
  if(p.includes('..') || /[\s"'<>\\]/.test(p)){ toast('ชื่อไฟล์ไม่ถูกต้อง (ห้ามมีช่องว่างหรืออักขระพิเศษ)', true); return; }
  if(!(await siteProbe(p))){ toast('ไม่พบไฟล์นี้บนเว็บ: ' + p + ' — ถ้าเพิ่งวางไฟล์ ต้องลากขึ้น GitHub ก่อน', true); return; }
  if(siteListRef(key).some(b => b.src === p)){ toast('มีรูปนี้ในรายการแล้ว', true); return; }
  siteListRef(key).push({ src: p, on: true });
  siteTouch(key); renderSiteModal();
}
async function siteUploadLogo(file){
  if(!file || !site) return;
  const dir = await siteDir('site');
  if(!dir) return;
  try{
    const r = await siteDrawBlob(file, 512, 'png');
    const name = 'logo-' + Date.now().toString(36) + '.png';
    await siteWrite(dir, name, r.blob);
    const path = 'images/site/' + name;
    siteBlobUrls[path] = URL.createObjectURL(r.blob);
    site.cfg.logo = path; site.uploaded = true;
    siteTouch(); renderSiteModal();
    toast('เปลี่ยนโลโก้แล้ว — กดบันทึก แล้วลากโฟลเดอร์ images ขึ้น GitHub');
  }catch(e){ toast('อ่านรูปโลโก้ไม่ได้', true); }
}

/* ───── บันทึก ───── */
function siteClean(c, bannersEdited){
  const out = {};
  const name = String(c.shop.name || '').trim() || 'S.Flower Bloom';
  out.shop = { name, tagline: String(c.shop.tagline || '').trim() };
  if(c.logo) out.logo = c.logo;
  if(String(c.footer || '').trim()) out.footer = String(c.footer).trim();
  if(c.theme.main.toLowerCase() !== SITE_DEFAULT_COLOR.toLowerCase()) out.theme = { main: c.theme.main.toUpperCase(), vars: siteDerivePalette(c.theme.main) };
  if(Array.isArray(c.banners) && (c.banners.length || bannersEdited)) out.banners = c.banners.map(b => ({ src: b.src, on: b.on !== false }));
  out.popup = { on: c.popup.on !== false, slides: c.popup.slides.map(b => ({ src: b.src, on: b.on !== false })) };
  out.hero = {
    title: String(c.hero.title || '').trim(), text: String(c.hero.text || '').trim(), textOff: String(c.hero.textOff || '').trim(),
    chips: c.hero.chips.map(x => String(x || '').trim()).filter(Boolean), cta: String(c.hero.cta || '').trim()
  };
  out.reviews = { on: c.reviews.on !== false, title: String(c.reviews.title || '').trim() };
  out.faq = {
    on: c.faq.on !== false, title: String(c.faq.title || '').trim(),
    items: c.faq.items.map(i => ({ q: String(i.q || '').trim(), a: String(i.a || '').trim() })).filter(i => i.q && i.a)
  };
  return out;
}
async function saveSite(){
  if(!site) return;
  const cfg = siteClean(site.cfg, site.bannersEdited);
  const json = JSON.stringify(cfg);
  if(new Blob([json]).size > 60000){ siteHint('ข้อมูลแต่งหน้าร้านใหญ่เกินไป ลองลดข้อความ FAQ', true); return; }
  const btn = $('siteSave'); btn.disabled = true;
  setSaveState('กำลังบันทึก…', 'is-saving');
  try{
    await fb.dbApi.setDoc(catalogRef(), { siteJson: json, siteUpdatedAt: new Date().toISOString() }, { merge: true });
    siteCfgSaved = cfg;
    setSaveState('บันทึกแล้ว · หน้าร้านอัปเดตทันที');
    const up = site.uploaded;
    site.dirty = false;
    closeSiteModal(true);
    toast('บันทึกแต่งหน้าร้านแล้ว' + (up ? ' · อย่าลืมลากโฟลเดอร์ images ขึ้น GitHub เพื่อให้รูปใหม่ขึ้นหน้าร้าน' : ''));
  }catch(err){
    setSaveState('บันทึกไม่สำเร็จ', 'is-error');
    siteHint(err.code === 'permission-denied'
      ? 'บันทึกไม่ได้: กฎความปลอดภัยของ Firestore ยังไม่อนุญาตให้เพิ่มช่อง siteJson / siteUpdatedAt'
      : 'บันทึกไม่สำเร็จ: ' + (err.code || err.message), true);
    console.error(err);
  } finally { btn.disabled = false; }
}

/* ───── เหตุการณ์ ───── */
$('siteBtn').addEventListener('click', openSiteModal);
$('siteCancel').addEventListener('click', () => closeSiteModal());
$('siteSave').addEventListener('click', saveSite);
$('siteTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if(b && site){ site.tab = b.dataset.tab; renderSiteModal(); } });
$('siteBody').addEventListener('input', e => {
  const el = e.target; if(!site) return;
  if(el.id === 'siteColor'){ site.cfg.theme.main = el.value; siteTouch(); const pal = siteDerivePalette(el.value), box = document.querySelector('#siteBody .st-pal'); if(box) box.innerHTML = ['sage', 'sageDark', 'rose', 'roseDark', 'peach', 'cream'].map(k => `<i style="background:${pal[k]}"></i>`).join(''); return; }
  if(el.dataset.path && el.type !== 'checkbox'){ setPath(site.cfg, el.dataset.path, el.value); siteTouch(); }
});
$('siteBody').addEventListener('change', e => {
  const el = e.target; if(!site) return;
  if(el.dataset.path && el.type === 'checkbox'){ setPath(site.cfg, el.dataset.path, el.checked); siteTouch(); return; }
  if(el.dataset.on){ const it = siteListRef(el.dataset.on)[+el.dataset.i]; if(it){ it.on = el.checked; siteTouch(el.dataset.on); renderSiteModal(); } return; }
  if(el.id === 'siteColor'){ renderSiteModal(); return; }
});
$('siteBody').addEventListener('click', e => {
  if(!site) return;
  const sw = e.target.closest('[data-color]');
  if(sw){ site.cfg.theme.main = sw.dataset.color; siteTouch(); renderSiteModal(); return; }
  if(e.target.closest('#siteDrop')){ const f = $('siteFile'); f.dataset.key = $('siteDrop').dataset.key; f.click(); return; }
  const b = e.target.closest('[data-act]'); if(!b) return;
  const act = b.dataset.act, i = +b.dataset.i, key = b.dataset.key;
  if(act === 'up' || act === 'down'){
    const list = siteListRef(key), j = act === 'up' ? i - 1 : i + 1;
    if(j >= 0 && j < list.length){ [list[i], list[j]] = [list[j], list[i]]; siteTouch(key); renderSiteModal(); }
  } else if(act === 'del'){ siteListRef(key).splice(i, 1); siteTouch(key); renderSiteModal(); }
  else if(act === 'addpath') siteAddByPath(key);
  else if(act === 'logo'){ $('siteLogoFile').click(); }
  else if(act === 'logo-reset'){ site.cfg.logo = ''; siteTouch(); renderSiteModal(); }
  else if(act === 'faq-add'){ site.cfg.faq.items.push({ q: '', a: '' }); siteTouch(); renderSiteModal(); const bd = $('siteBody'); bd.scrollTop = bd.scrollHeight; }
  else if(act === 'faq-del'){ site.cfg.faq.items.splice(i, 1); siteTouch(); renderSiteModal(); }
  else if(act === 'faq-up' || act === 'faq-down'){
    const l = site.cfg.faq.items, j = act === 'faq-up' ? i - 1 : i + 1;
    if(j >= 0 && j < l.length){ [l[i], l[j]] = [l[j], l[i]]; siteTouch(); renderSiteModal(); }
  } else if(act === 'open-reviews') openReviewsModal();
});
$('siteBody').addEventListener('keydown', e => {
  if(e.target.id === 'siteDrop' && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); e.target.click(); }
  if(e.target.id === 'siteAddPath' && e.key === 'Enter'){ e.preventDefault(); siteAddByPath(e.target.dataset.key); }
});
['dragover', 'dragenter'].forEach(ev => $('siteBody').addEventListener(ev, e => { const d = e.target.closest('#siteDrop'); if(d){ e.preventDefault(); d.classList.add('is-over'); } }));
['dragleave', 'drop'].forEach(ev => $('siteBody').addEventListener(ev, e => { const d = e.target.closest('#siteDrop'); if(d) d.classList.remove('is-over'); }));
$('siteBody').addEventListener('drop', e => { const d = e.target.closest('#siteDrop'); if(d){ e.preventDefault(); siteUploadFiles(e.dataTransfer.files, d.dataset.key); } });
$('siteFile').addEventListener('change', e => { const el = e.target, k = (site && site.tab === 'popup') ? 'popup' : 'banners'; siteUploadFiles(el.files, k).then(() => { el.value = ''; }); });
$('siteLogoFile').addEventListener('change', e => { const f = e.target.files[0]; siteUploadLogo(f).then(() => { e.target.value = ''; }); });

boot();