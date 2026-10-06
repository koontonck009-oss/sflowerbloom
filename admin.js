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
let pricesHidden = false; // สวิตช์ "ซ่อนราคาบนหน้าร้าน" (เก็บในเอกสาร catalog/products ช่อง hidePrices)
let draft = null;        // สินค้าที่กำลังแก้ไขอยู่
let draftIndex = -1;     // -1 = สินค้าใหม่
let filterCat = 'ทั้งหมด';
let filterFlower = '';   // '' = ทุกชนิด · '__none__' = ช่อดอกไม้ที่ยังไม่ระบุชนิด · '__off__' = ชนิดนอกรายการหน้าร้าน · อื่นๆ = ชื่อชนิด
let searchTerm = '';
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
// ชนิดดอกไม้ที่หน้าร้านกรองได้ — ต้องตรงกับ FLOWER_TYPES ใน script.js (ไม่รวมปุ่ม "ทั้งหมด") แก้ฝั่งใดฝั่งหนึ่งต้องแก้อีกฝั่งด้วย
// ใช้ได้กับทุกหมวด — หน้าร้านจะโชว์ตัวกรองชนิดดอกไม้ให้หมวดที่มีสินค้าตั้งค่านี้ไว้ (ช่อดอกไม้โชว์เสมอ)
const FLOWER_TYPE_TAGS = ['ดอกไม้คละชนิด', 'กุหลาบ', 'ทานตะวัน', 'ทิวลิป', 'ไฮเดรนเยีย', 'เดซี่', 'ลิลลี่', 'เยอบีร่า'];
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
// ตัวเลือก "ขนาด/ป้ายกำกับ" ของแต่ละหมวด — ต้องตรงกับ CATEGORY_SIZES ใน script.js ของหน้าร้านทุกตัวอักษร
// (ไม่รวมปุ่ม "ทั้งหมด") ถ้าแก้ฝั่งใดฝั่งหนึ่ง ต้องแก้อีกฝั่งให้ตรงกันด้วย ไม่งั้นสินค้าจะหลุดจากตัวกรอง
const CATEGORY_SIZE_TAGS = {
  'ช่อดอกไม้': ['เล็ก', 'กลาง', 'ใหญ่', 'ใส่เงิน'],
  'กรอบรูป': ['A5', 'A4'],
  'กระถาง': ['3 นิ้ว', '5 นิ้ว', '9 นิ้ว'],
  'อื่นๆ': ['กลิตเตอร์', 'กล่องดอกไม้', 'ดอกไม้เจ้าสาว', 'ตุ๊กตา', 'มงกุฎ'],
};
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
    } else {
      catalog = [];
      pricesHidden = false;
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

function priceInfo(p){
  if(Array.isArray(p.variants) && p.variants.length){
    const prices = p.variants.map(v => num(v.price)).filter(Boolean);
    if(prices.length) return { text: baht(Math.min(...prices)) + '–' + baht(Math.max(...prices)), note: 'ตามตัวเลือก' };
  }
  if(Array.isArray(p.sizes) && p.sizes.length){
    const prices = p.sizes.map(s => num(s.price)).filter(Boolean);
    if(prices.length) return { text: baht(Math.min(...prices)) + '–' + baht(Math.max(...prices)), note: 'ตามไซซ์' };
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
  const set = new Set(catalog.map(p => p.cat).filter(Boolean));
  return ['ทั้งหมด', ...[...set].sort()];
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

function needsFix(p){ return priceInfo(p).text === '—' || !mainImageOf(p); }

function visibleProducts(){
  const q = searchTerm.trim().toLowerCase();
  return catalog
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => filterCat === 'ทั้งหมด' ||
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
  $('selAll').checked = all;
  $('selAll').indeterminate = !all && vis.some(i => selected.has(i));
  updateCatalogBtn(rows);
}

function renderList(){
  selected.forEach(i => { if(i >= catalog.length) selected.delete(i); });
  const fixCount = catalog.filter(needsFix).length;
  const multiCount = catalog.filter(isMulti).length;
  if(filterCat === '__fix__' && !fixCount) filterCat = 'ทั้งหมด';
  if(filterCat === '__multi__' && !multiCount) filterCat = 'ทั้งหมด';

  const tabs = [['ทั้งหมด', 'ทั้งหมด']];
  if(fixCount) tabs.push(['__fix__', `ต้องแก้ไข ${fixCount}`]);
  if(multiCount) tabs.push(['__multi__', `มีหลายแบบ ${multiCount}`]);
  allCats().slice(1).forEach(c => tabs.push([c, c]));
  $('catChips').innerHTML = tabs.map(([k, l]) =>
    `<button class="chip${k === filterCat ? ' is-active' : ''}${k === '__fix__' ? ' is-fix' : ''}" data-cat="${esc(k)}">${esc(l)}</button>`
  ).join('');

  const cats = [...new Set([...catalog.map(p => p.cat), 'ช่อดอกไม้', 'กระถาง', 'กรอบรูป', 'อื่นๆ'])].filter(Boolean).sort();
  $('bulkCat').innerHTML = '<option value="">เปลี่ยนหมวดหมู่เป็น…</option>' +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  // ตัวกรองชนิดดอกไม้ — นับจากสินค้าทั้งหมด (ไม่ขึ้นกับแท็บหมวด) ตัวเลือกที่ไม่มีสินค้าเลยจะไม่แสดง
  const fCount = f => catalog.filter(p => flowerMatchesFilter(p, f)).length;
  const noneCount = fCount('__none__'), offCount = fCount('__off__');
  if(filterFlower === '__none__' && !noneCount) filterFlower = '';
  if(filterFlower === '__off__' && !offCount) filterFlower = '';
  if(filterFlower && !['__none__', '__off__'].includes(filterFlower) && !fCount(filterFlower)) filterFlower = '';
  const flowerOpts = [['', 'ชนิดดอกไม้: ทั้งหมด']];
  FLOWER_TYPE_TAGS.forEach(t => { const n = fCount(t); if(n) flowerOpts.push([t, `${t} (${n})`]); });
  if(noneCount) flowerOpts.push(['__none__', `⚠ ยังไม่ระบุชนิด (${noneCount})`]);
  if(offCount) flowerOpts.push(['__off__', `⚠ ชนิดนอกรายการ (${offCount})`]);
  $('flowerFilter').innerHTML = flowerOpts.map(([v, l]) => `<option value="${esc(v)}"${v === filterFlower ? ' selected' : ''}>${esc(l)}</option>`).join('');
  $('flowerFilter').classList.toggle('is-active', !!filterFlower);

  const rows = visibleProducts();
  const filtering = filterCat !== 'ทั้งหมด' || !!searchTerm.trim() || !!filterFlower;

  $('emptyState').hidden = catalog.length > 0;
  $('listCard').hidden = !catalog.length;
  $('listMeta').textContent = filtering ? `แสดง ${rows.length} จาก ${catalog.length} รายการ` : `ทั้งหมด ${catalog.length} รายการ`;

  if(!catalog.length){ $('productList').innerHTML = ''; return; }
  if(!rows.length){
    $('productList').innerHTML =
      '<div class="empty"><p class="empty-title">ไม่พบสินค้าที่ค้นหา</p><p>ลองเปลี่ยนคำค้นหรือเลือกแท็บอื่น</p></div>';
    renderBulk(rows);
    return;
  }

  $('productList').innerHTML = rows.map(({ p, i }) => {
    const pi = priceInfo(p);
    const warns = [];
    if(pi.text === '—') warns.push('<span class="tag tag-warn">ยังไม่มีราคา</span>');
    if(!mainImageOf(p)) warns.push('<span class="tag tag-warn">ยังไม่มีรูป</span>');
    const fs = flowerStateOf(p);
    const flowerHtml = fs === 'ok' ? `<span class="row-flower">🌸 ${esc(String(p.flowerType).trim())}</span>`
      : fs === 'off' ? `<span class="tag tag-warn">⚠ ${esc(String(p.flowerType).trim())} (หน้าร้านกรองไม่ได้)</span>`
      : fs === 'none' ? '<span class="tag tag-warn">ยังไม่ระบุชนิดดอกไม้</span>' : '';
    const vinfo = variantInfoOf(p);
    const isOpen = !!vinfo && expanded.has(expandKey(p, i));
    return `
      <div class="tr${selected.has(i) ? ' is-selected' : ''}${isOpen ? ' is-open' : ''}" data-i="${i}">
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
            <button data-act="up" data-i="${i}" ${filtering || i === 0 ? 'disabled' : ''}>เลื่อนขึ้น</button>
            <button data-act="down" data-i="${i}" ${filtering || i === catalog.length - 1 ? 'disabled' : ''}>เลื่อนลง</button>
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

async function moveProduct(i, delta){
  selected.clear();
  const j = i + delta;
  if(j < 0 || j >= catalog.length) return;
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
  return { id:nextId(), cat:'ช่อดอกไม้', flowerType:'', size:'', name:'', price:0, desc:'', image:'' };
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
  const cats = [...new Set([...catalog.map(p => p.cat), 'ช่อดอกไม้', 'กระถาง', 'กรอบรูป', 'อื่นๆ'])].filter(Boolean).sort();
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
  $('panelMedia').innerHTML = `
    <div class="group">
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
        <div class="combo-scroll">
          <table class="combo-table">
            <thead>
              <tr>
                <th style="width:34px">ขาย</th>
                <th style="width:80px">พร้อมส่ง</th>
                <th>ค่าตัวเลือก</th>
                <th style="width:104px">ราคา</th>
                <th style="width:200px">รูปสินค้า</th>
                <th style="width:130px">ตัวกรองขนาด</th>
              </tr>
            </thead>
            <tbody>
              ${combos.map((c, ci) => {
                const v = variantFor(c);
                return `
                <tr class="${v ? '' : 'is-off'}">
                  <td><input type="checkbox" data-act="toggle-combo" data-ci="${ci}"${v ? ' checked' : ''}></td>
                  <td style="text-align:center"><input type="checkbox" data-combo-ready="${ci}"${v && v.ready ? ' checked' : ''}${v ? '' : ' disabled'}></td>
                  <td class="combo-combo">${c.map(esc).join(' · ')}</td>
                  <td><input type="number" min="0" step="1" data-combo-price="${ci}" value="${v ? (num(v.price) || '') : ''}"${v ? '' : ' disabled'}></td>
                  <td><input type="text" data-combo-image="${ci}" value="${v ? esc(v.image || '') : ''}" placeholder="รูปหลัก images/…"${v ? '' : ' disabled'}>
                    <button type="button" class="btn btn-ghost btn-sm combo-more" data-combo-more="${ci}"${v ? '' : ' disabled'}>${v && (v.images || []).length ? 'รูปเพิ่มเติม ' + v.images.length : '+ รูปเพิ่มเติม'}</button></td>
                  <td><select data-combo-tag="${ci}"${v ? '' : ' disabled'}>${comboTagChoices(draft.cat, v && v.tag).map(([val, label]) => `<option value="${esc(val)}"${(v && v.tag || '') === val ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
      <div class="group var-foot">
        <button class="btn btn-ghost btn-sm is-danger" data-act="clear-vars">เลิกใช้ตัวแปร</button>
      </div>`;
  }

  $('panelPrice').innerHTML = body;
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
    const v = variantFor(combo);
    if(v) v.price = num(el.value);
    return;
  }

  if(el.dataset.comboImage != null){
    const combo = comboList(draft.options)[+el.dataset.comboImage];
    const v = variantFor(combo);
    if(v) v.image = el.value;
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
          ${r.values.map((v, vi) => `<span class="vm-chip">${esc(v)}<button type="button" data-vm-rmval="${i}" data-vi="${vi}" aria-label="ลบ ${esc(v)}">✕</button></span>`).join('')}
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
      <span class="vm-label">รูปหลัก (แก้ในตารางด้านหลัง)</span>
      <div class="im-row">${thumbHtml(im.main, 'im-thumb')}<span class="im-path">${esc(im.main) || '— ยังไม่ได้ใส่ —'}</span></div>
    </div>
    <span class="vm-label" style="margin-top:14px">รูปเพิ่มเติม (ลูกค้าเห็นต่อจากรูปหลัก ตามลำดับนี้)</span>
    ${im.list.length ? im.list.map((src, i) => `
      <div class="im-row">
        ${thumbHtml(src, 'im-thumb')}
        <input type="text" data-im-i="${i}" value="${esc(src)}" placeholder="images/…" autocomplete="off">
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
  const tr = el.closest('tr');
  const priceInput = tr.querySelector('input[type="number"]');
  const imageInput = tr.querySelector('input[type="text"]');
  const readyInput = tr.querySelector('[data-combo-ready]');
  const tagSelect = tr.querySelector('[data-combo-tag]');
  const moreBtn = tr.querySelector('[data-combo-more]');
  if(moreBtn){ moreBtn.disabled = !el.checked; if(!el.checked) moreBtn.textContent = '+ รูปเพิ่มเติม'; }
  tr.classList.toggle('is-off', !el.checked);
  priceInput.disabled = imageInput.disabled = readyInput.disabled = tagSelect.disabled = !el.checked;
  if(!el.checked){ priceInput.value = ''; imageInput.value = ''; readyInput.checked = false; tagSelect.value = ''; }
  const counter = $('comboCount');
  if(counter) counter.textContent = draft.variants.length;
  if(el.checked) priceInput.focus();
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
      { const all = imgsOf(v); if(all.length) o.image = all[0]; if(all.length > 1) o.images = all; }
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
  if(draftIndex < 0) catalog.push(cleaned);
  else catalog[draftIndex] = cleaned;

  renderList();
  const ok = await saveCatalog(draftIndex < 0 ? 'เพิ่มสินค้าแล้ว' : 'บันทึกการแก้ไขแล้ว');
  if(ok) closeEditor();
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

function downloadBackup(){
  const stamp = new Date().toISOString().slice(0, 10);
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
  if(selected.size) return [...selected].sort((a, b) => a - b).map(i => catalog[i]).filter(Boolean);
  return visibleProducts().map(r => r.p);
}

function updateCatalogBtn(rows){
  const btn = $('catalogBtn');
  if(!btn) return;
  const n = selected.size || rows.length;
  btn.textContent = `ดาวน์โหลดแคตตาล็อก (JPG) · ${selected.size ? 'ที่เลือก ' : ''}${n} สินค้า`;
  btn.disabled = !n;
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
    const row = e.target.closest('.tr');
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
  el.closest('.tr').classList.toggle('is-selected', el.checked);
  renderBulk(visibleProducts());
});
$('selAll').addEventListener('change', e => {
  visibleProducts().forEach(({ i }) => { if(e.target.checked) selected.add(i); else selected.delete(i); });
  renderList();
});
$('bulkClear').addEventListener('click', () => { selected.clear(); renderList(); });
$('bulkReady').addEventListener('click', () => bulkApply(p => { p.ready = true; }, 'ตั้งพร้อมส่ง'));
$('bulkUnready').addEventListener('click', () => bulkApply(p => { delete p.ready; }, 'ยกเลิกพร้อมส่ง'));
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
  $('productList').querySelectorAll('.tr.drag-target-before, .tr.drag-target-after')
    .forEach(r => r.classList.remove('drag-target-before', 'drag-target-after'));
}
$('productList').addEventListener('dragstart', e => {
  const handle = e.target.closest('.drag-handle');
  if(!handle || handle.classList.contains('is-disabled')){ e.preventDefault(); return; }
  dragFromIndex = +handle.dataset.i;
  const row = handle.closest('.tr');
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragFromIndex)); // จำเป็นสำหรับบางเบราว์เซอร์ (Firefox) ถึงจะยอมให้ลากได้
  if(row) e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
});
$('productList').addEventListener('dragover', e => {
  if(dragFromIndex == null) return;
  const row = e.target.closest('.tr');
  if(!row) return;
  e.preventDefault(); // จำเป็น ไม่งั้นเบราว์เซอร์จะไม่ยอมให้ drop
  e.dataTransfer.dropEffect = 'move';
  const rect = row.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  clearDragTargetClasses();
  row.classList.add(before ? 'drag-target-before' : 'drag-target-after');
});
$('productList').addEventListener('drop', e => {
  if(dragFromIndex == null) return;
  const row = e.target.closest('.tr');
  e.preventDefault();
  if(row){
    const overIndex = +row.dataset.i;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    let to = before ? overIndex : overIndex + 1;
    if(to > dragFromIndex) to -= 1; // ลบตัวเดิมออกก่อนแล้วค่อยแทรก ตำแหน่งท้ายๆ เลยขยับลง 1
    reorderProduct(dragFromIndex, to);
  }
  clearDragTargetClasses();
  dragFromIndex = null;
});
$('productList').addEventListener('dragend', () => {
  $('productList').querySelectorAll('.tr.is-dragging').forEach(r => r.classList.remove('is-dragging'));
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
drawerBody.addEventListener('click', onDraftClick);
drawerBody.addEventListener('click', e => { const b = e.target.closest('[data-combo-more]'); if(b && !b.disabled) openImgModal(+b.dataset.comboMore); });
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
  else if(!$('imgScrim').hidden) closeImgModal();
  else if(!$('varScrim').hidden) closeVarModal();
  else if(!$('editorPage').hidden) closeEditor();
});

boot();