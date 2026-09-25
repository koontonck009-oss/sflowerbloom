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
let draft = null;        // สินค้าที่กำลังแก้ไขอยู่
let draftIndex = -1;     // -1 = สินค้าใหม่
let filterCat = 'ทั้งหมด';
let searchTerm = '';
let confirmResolve = null;

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
    } else {
      catalog = [];
    }
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
    await fb.dbApi.setDoc(catalogRef(), {
      json,
      count: catalog.length,
      updatedAt: new Date().toISOString(),
      updatedBy: fb.auth.currentUser ? fb.auth.currentUser.email : ''
    });
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

function visibleProducts(){
  const q = searchTerm.trim().toLowerCase();
  return catalog
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => filterCat === 'ทั้งหมด' || p.cat === filterCat)
    .filter(({ p }) => !q ||
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.id || '').toLowerCase().includes(q) ||
      String(p.flowerType || '').toLowerCase().includes(q));
}

function renderList(){
  // ปุ่มหมวดหมู่
  $('catChips').innerHTML = allCats().map(c =>
    `<button class="chip${c === filterCat ? ' is-active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join('');

  const rows = visibleProducts();
  const filtering = filterCat !== 'ทั้งหมด' || !!searchTerm.trim();

  $('emptyState').hidden = catalog.length > 0;
  $('listMeta').textContent = catalog.length
    ? (filtering ? `แสดง ${rows.length} จาก ${catalog.length} รายการ` : `ทั้งหมด ${catalog.length} รายการ`)
    : '';

  if(!catalog.length){ $('productList').innerHTML = ''; return; }

  if(!rows.length){
    $('productList').innerHTML =
      '<div class="empty"><p class="empty-title">ไม่พบสินค้าที่ค้นหา</p><p>ลองเปลี่ยนคำค้นหรือเลือกหมวดหมู่อื่น</p></div>';
    return;
  }

  $('productList').innerHTML = rows.map(({ p, i }) => {
    const pi = priceInfo(p);
    const tags = [];
    if(p.ready) tags.push('<span class="tag tag-ready">พร้อมส่ง</span>');
    if(p.colors && p.colors.length) tags.push(`<span class="tag">${p.colors.length} สี</span>`);
    if(p.sizes && p.sizes.length) tags.push(`<span class="tag">${p.sizes.length} ไซซ์</span>`);
    if(p.variants && p.variants.length) tags.push(`<span class="tag">${p.variants.length} ตัวเลือก</span>`);
    const addonCount = (p.addons || []).length + (p.colors || []).reduce((a, c) => a + (c.addons || []).length, 0);
    if(addonCount) tags.push('<span class="tag">มีของเสริม</span>');
    if(pi.text === '—') tags.push('<span class="tag tag-warn">ยังไม่มีราคา</span>');
    if(!mainImageOf(p)) tags.push('<span class="tag tag-warn">ยังไม่มีรูป</span>');

    return `
      <div class="row" data-i="${i}">
        <span class="drag-handle${filtering ? ' is-disabled' : ''}" draggable="${filtering ? 'false' : 'true'}" data-i="${i}" title="ลากเพื่อเรียงลำดับใหม่">⠿</span>
        ${thumbHtml(mainImageOf(p), 'row-thumb')}
        <div class="row-main">
          <p class="row-name">${esc(p.name || '(ยังไม่ตั้งชื่อ)')}</p>
          <p class="row-sub"><span>${esc(p.id || '—')}</span><span>${esc(p.cat || '—')}</span>${sizeTagText(p) ? `<span>${esc(sizeTagText(p))}</span>` : ''}</p>
          <div class="row-tags">${tags.join('')}</div>
        </div>
        <div class="row-price">${pi.text}<small>${pi.note}</small></div>
        <div class="row-actions">
          <button class="icon-btn" data-act="up" data-i="${i}" title="เลื่อนขึ้น" ${filtering || i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-act="down" data-i="${i}" title="เลื่อนลง" ${filtering || i === catalog.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-i="${i}">แก้ไข</button>
          <button class="btn btn-ghost btn-sm" data-act="copy" data-i="${i}">ทำสำเนา</button>
          <button class="btn btn-ghost btn-sm" data-act="del" data-i="${i}">ลบ</button>
        </div>
      </div>`;
  }).join('');
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
  const copy = clone(catalog[i]);
  copy.id = uniqueId(copy.id || 'สินค้า');
  copy.name = (copy.name || '') + ' (สำเนา)';
  catalog.splice(i + 1, 0, copy);
  renderList();
  await saveCatalog('ทำสำเนาแล้ว');
}

async function deleteProduct(i){
  const p = catalog[i];
  const ok = await askConfirm('ลบสินค้า', `ลบ “${p.name || p.id}” ออกจากหน้าร้านถาวร กู้คืนไม่ได้`, 'ลบสินค้า');
  if(!ok) return;
  catalog.splice(i, 1);
  renderList();
  await saveCatalog('ลบแล้ว');
}

async function moveProduct(i, delta){
  const j = i + delta;
  if(j < 0 || j >= catalog.length) return;
  [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
  renderList();
  await saveCatalog();
}

// ลากการ์ดสินค้าไปวางตรงตำแหน่งใหม่ (คลิกที่ไอคอน ⠿ แล้วลาก — เดสก์ท็อปเท่านั้น มือถือใช้ปุ่ม ↑/↓ แทน)
async function reorderProduct(from, to){
  if(from === to || from < 0 || to < 0 || from >= catalog.length || to >= catalog.length) return;
  const [item] = catalog.splice(from, 1);
  catalog.splice(to, 0, item);
  renderList();
  await saveCatalog();
}

/* ───────────────── ตัวแก้ไขสินค้า ───────────────── */

function blankProduct(){
  return { id:'', cat:'ช่อดอกไม้', flowerType:'', size:'', name:'', price:0, desc:'', image:'' };
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
  switchTab('main');
  renderAllPanels();
  $('drawerScrim').hidden = false;
  $('editorDrawer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEditor(){
  $('drawerScrim').hidden = true;
  $('editorDrawer').hidden = true;
  document.body.style.overflow = '';
  draft = null;
  draftIndex = -1;
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
  $('editorDrawer').querySelector('.drawer-body').scrollTop = 0;
}

function renderAllPanels(){
  renderMainPanel();
  renderMediaPanel();
  renderPricePanel();
  renderAddonsPanel();
}

/* --- แท็บ 1: ข้อมูลสินค้า --- */

function renderMainPanel(){
  const cats = [...new Set([...catalog.map(p => p.cat), 'ช่อดอกไม้', 'กระถาง', 'กรอบรูป', 'อื่นๆ'])].filter(Boolean).sort();
  const flowerTypes = [...new Set(catalog.map(p => p.flowerType).filter(Boolean))].sort();
  const sizes = [...new Set(catalog.flatMap(p => sizeTagsOf(p)))].sort();

  $('panelMain').innerHTML = `
    <div class="group">
      <div class="field-row">
        <label class="field">
          <span>รหัสสินค้า</span>
          <input type="text" data-bind="id" value="${esc(draft.id)}" placeholder="เช่น s16">
        </label>
        <label class="field">
          <span>หมวดหมู่</span>
          <select data-bind="cat">
            ${cats.map(c => `<option value="${esc(c)}"${c === draft.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="field-hint" style="margin-top:-10px">รหัสห้ามซ้ำกับสินค้าอื่น ใช้เป็นตัวอ้างอิงในตะกร้าและใบสั่งซื้อ</p>

      <label class="field" style="margin-top:14px">
        <span>ชื่อสินค้า</span>
        <input type="text" data-bind="name" value="${esc(draft.name)}" placeholder="เช่น ช่อดอกทานตะวัน - S16">
      </label>

      <div class="field-row">
        <label class="field">
          <span>ชนิดดอกไม้</span>
          <input type="text" data-bind="flowerType" list="dlFlower" value="${esc(draft.flowerType || '')}" placeholder="เช่น ทานตะวัน">
          <datalist id="dlFlower">${flowerTypes.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
        </label>
        <label class="field">
          <span>ขนาด/ป้ายกำกับ</span>
          <input type="text" data-bind="size" list="dlSize" value="${esc(sizeTagText(draft))}" placeholder="เช่น กลาง, ใส่เงิน">
          <datalist id="dlSize">${sizes.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        </label>
      </div>
      <p class="field-hint" style="margin-top:-10px">สองช่องนี้ใช้เป็นตัวกรองในหน้าร้าน เว้นว่างได้ถ้าไม่เกี่ยว — ช่อง "ขนาด/ป้ายกำกับ" ใส่ได้มากกว่า 1 ค่า คั่นด้วยจุลภาค เช่น สินค้าที่ปกติเป็นไซซ์กลางแต่มีตัวเลือกใส่เงินด้วย ให้พิมพ์ "กลาง, ใส่เงิน" (สินค้าจะโผล่ทั้งตอนกรอง "กลาง" และ "ใส่เงิน")</p>

      <label class="field" style="margin-top:14px">
        <span>รายละเอียด</span>
        <textarea data-bind="desc" placeholder="อธิบายสิ่งที่ลูกค้าจะได้รับ เช่น จำนวนดอก สีกระดาษห่อ">${esc(draft.desc || '')}</textarea>
      </label>

      <label class="check">
        <input type="checkbox" data-bind="ready" data-type="bool"${draft.ready ? ' checked' : ''}>
        <span>ทำไว้แล้ว พร้อมส่งทันที (ขึ้นป้าย “พร้อมส่ง” ในหน้าร้าน)</span>
      </label>
    </div>`;
}

/* --- แท็บ 2: รูปภาพและสี --- */

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
  const colors = draft.colors || [];
  $('panelMedia').innerHTML = `
    <div class="group">
      <div class="group-head"><h3>รูปหลัก</h3></div>
      <p class="group-note">ใส่เป็นที่อยู่ไฟล์ในโฟลเดอร์ images เช่น images/bouquet/ช่อทานตะวัน/เล็ก.jpg — ต้องอัปโหลดไฟล์รูปขึ้นเว็บแยกต่างหากก่อน</p>
      <div class="img-field">
        <label class="field">
          <span>ที่อยู่รูป</span>
          <input type="text" data-bind="image" value="${esc(draft.image || '')}" placeholder="images/…">
        </label>
        ${thumbHtml(draft.image)}
      </div>
      <div style="margin-top:14px">
        <span class="field" style="margin:0"><span>รูปเพิ่มเติม (แกลเลอรี)</span></span>
        ${imageListHtml(draft.images, 'images')}
      </div>
    </div>

    <div class="group">
      <div class="group-head">
        <h3>สีให้เลือก</h3>
        <button class="btn btn-ghost btn-sm" data-act="add-color">+ เพิ่มสี</button>
      </div>
      <p class="group-note">แต่ละสีมีรูปของตัวเอง ลูกค้ากดเลือกแล้วรูปในหน้าสินค้าจะเปลี่ยนตาม ถ้าสินค้าชิ้นนี้มีแบบเดียว ไม่ต้องใส่อะไรตรงนี้</p>
      ${colors.length ? colors.map((c, k) => `
        <div class="item-card">
          <div class="item-card-head">
            <span class="item-no">สีที่ ${k + 1}</span>
            <span class="spacer"></span>
            <button class="icon-btn" data-act="move-color" data-k="${k}" data-d="-1" ${k === 0 ? 'disabled' : ''} title="เลื่อนขึ้น">↑</button>
            <button class="icon-btn" data-act="move-color" data-k="${k}" data-d="1" ${k === colors.length - 1 ? 'disabled' : ''} title="เลื่อนลง">↓</button>
            <button class="icon-btn" data-act="rm-color" data-k="${k}" title="ลบสีนี้">✕</button>
          </div>
          <label class="field">
            <span>ชื่อสี</span>
            <input type="text" data-bind="colors.${k}.name" value="${esc(c.name || '')}" placeholder="เช่น ขาว, แบบที่ 1">
          </label>
          <div class="img-field">
            <label class="field">
              <span>รูปของสีนี้</span>
              <input type="text" data-bind="colors.${k}.image" value="${esc(c.image || '')}" placeholder="images/…">
            </label>
            ${thumbHtml(c.image)}
          </div>
          <div style="margin-top:12px">
            <span class="field" style="margin:0"><span>รูปเพิ่มเติมของสีนี้</span></span>
            ${imageListHtml(c.images, `colors.${k}.images`)}
          </div>
          <label class="check" style="margin:12px 0 0">
            <input type="checkbox" data-bind="colors.${k}.ready" data-type="bool"${c.ready ? ' checked' : ''}>
            <span>สีนี้ทำไว้แล้ว พร้อมส่ง</span>
          </label>
          <div style="margin-top:12px">
            <span class="field" style="margin:0"><span>ของเสริมเฉพาะสีนี้</span></span>
            ${addonsEditorHtml(c.addons, `colors.${k}.addons`, 'color-addon', k)}
          </div>
        </div>`).join('')
      : '<p class="field-hint" style="margin:0">ยังไม่มีสี — สินค้าจะใช้รูปหลักด้านบนอย่างเดียว</p>'}
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

function renderPricePanel(){
  const mode = priceMode(draft);
  const modes = [
    ['single', 'ราคาเดียว', 'สินค้ามีราคาเดียวจบ'],
    ['sizes', 'หลายไซซ์', 'เล็ก/ใหญ่ ราคาต่างกัน'],
    ['options', 'ตัวเลือกหลายชั้น', 'เช่น สีช่อ × จำนวนซอง']
  ];

  let body = '';

  if(mode === 'single'){
    body = `
      <div class="group">
        <label class="field" style="margin:0">
          <span>ราคา (บาท)</span>
          <input type="number" min="0" step="1" data-bind="price" data-type="number" value="${num(draft.price) || ''}">
        </label>
      </div>`;
  }

  if(mode === 'sizes'){
    const sizes = draft.sizes || [];
    body = `
      <div class="group">
        <div class="group-head">
          <h3>ไซซ์และราคา</h3>
          <button class="btn btn-ghost btn-sm" data-act="add-size">+ เพิ่มไซซ์</button>
        </div>
        <p class="group-note">ราคาที่ถูกที่สุดจะถูกใช้เป็นราคาเริ่มต้นที่โชว์บนการ์ดสินค้าในหน้าร้าน</p>
        ${sizes.length ? sizes.map((s, k) => `
          <div class="item-card">
            <div class="item-card-head">
              <span class="item-no">ไซซ์ที่ ${k + 1}</span>
              <span class="spacer"></span>
              <button class="icon-btn" data-act="rm-size" data-k="${k}" title="ลบไซซ์นี้">✕</button>
            </div>
            <div class="field-row">
              <label class="field">
                <span>ชื่อไซซ์</span>
                <input type="text" data-bind="sizes.${k}.name" value="${esc(s.name || '')}" placeholder="เช่น ดอกใหญ่">
              </label>
              <label class="field">
                <span>ราคา (บาท)</span>
                <input type="number" min="0" step="1" data-bind="sizes.${k}.price" data-type="number" value="${num(s.price) || ''}">
              </label>
            </div>
            <div class="img-field">
              <label class="field">
                <span>รูปของไซซ์นี้</span>
                <input type="text" data-bind="sizes.${k}.image" value="${esc(s.image || '')}" placeholder="images/…">
              </label>
              ${thumbHtml(s.image)}
            </div>
            <label class="check" style="margin:12px 0 0">
              <input type="checkbox" data-bind="sizes.${k}.ready" data-type="bool"${s.ready ? ' checked' : ''}>
              <span>ไซซ์นี้ทำไว้แล้ว พร้อมส่ง</span>
            </label>
          </div>`).join('')
        : '<p class="field-hint" style="margin:0">ยังไม่มีไซซ์ กด “เพิ่มไซซ์” เพื่อเริ่ม</p>'}
      </div>`;
  }

  if(mode === 'options'){
    const options = draft.options || [];
    const combos = comboList(options);
    const sellable = combos.filter(c => variantFor(c)).length;

    body = `
      <div class="group">
        <div class="group-head">
          <h3>ชั้นตัวเลือก</h3>
          <button class="btn btn-ghost btn-sm" data-act="add-option">+ เพิ่มชั้น</button>
        </div>
        <p class="group-note">เช่น ชั้นที่ 1 คือ “สีช่อ” มีค่า เขียว/น้ำเงิน/กะปิ ชั้นที่ 2 คือ “แบบ” มีค่า 5 ใบ/10 ใบ</p>
        ${options.length ? options.map((o, k) => `
          <div class="item-card">
            <div class="item-card-head">
              <span class="item-no">ชั้นที่ ${k + 1}</span>
              <span class="spacer"></span>
              <button class="icon-btn" data-act="rm-option" data-k="${k}" title="ลบชั้นนี้">✕</button>
            </div>
            <label class="field" style="margin-bottom:10px">
              <span>ชื่อชั้น</span>
              <input type="text" data-bind="options.${k}.name" value="${esc(o.name || '')}" placeholder="เช่น สีช่อ">
            </label>
            <span class="field" style="margin:0"><span>ค่าที่เลือกได้</span></span>
            <div class="value-chips">
              ${(o.values || []).map((v, vi) => `
                <span class="value-chip">${esc(v)}
                  <button data-act="rm-value" data-k="${k}" data-vi="${vi}" title="ลบ">✕</button>
                </span>`).join('')}
            </div>
            <div class="img-list-row" style="margin-top:10px">
              <input type="text" data-new-value="${k}" placeholder="พิมพ์ค่าใหม่ แล้วกด Enter">
              <button class="btn btn-ghost btn-sm" data-act="add-value" data-k="${k}">เพิ่ม</button>
            </div>
          </div>`).join('')
        : '<p class="field-hint" style="margin:0">ยังไม่มีชั้นตัวเลือก กด “เพิ่มชั้น” เพื่อเริ่ม</p>'}
      </div>

      ${combos.length && combos[0].length ? `
      <div class="group">
        <div class="group-head"><h3>คู่ผสมที่เปิดขาย</h3></div>
        <p class="group-note">ติ๊กเฉพาะคู่ผสมที่ทำขายจริง คู่ที่ไม่ติ๊กจะถูกปิดไม่ให้ลูกค้ากดเลือกในหน้าร้าน — เปิดขายอยู่ <span id="comboCount">${sellable}</span> จาก ${combos.length} คู่</p>
        <div class="combo-scroll">
          <table class="combo-table">
            <thead>
              <tr>
                <th style="width:34px">ขาย</th>
                <th>คู่ผสม</th>
                <th style="width:104px">ราคา</th>
                <th style="width:170px">รูป</th>
                <th style="width:80px">พร้อมส่ง</th>
              </tr>
            </thead>
            <tbody>
              ${combos.map((c, ci) => {
                const v = variantFor(c);
                return `
                <tr class="${v ? '' : 'is-off'}">
                  <td><input type="checkbox" data-act="toggle-combo" data-ci="${ci}"${v ? ' checked' : ''}></td>
                  <td class="combo-combo">${c.map(esc).join(' · ')}</td>
                  <td><input type="number" min="0" step="1" data-combo-price="${ci}" value="${v ? (num(v.price) || '') : ''}"${v ? '' : ' disabled'}></td>
                  <td><input type="text" data-combo-image="${ci}" value="${v ? esc(v.image || '') : ''}" placeholder="images/…"${v ? '' : ' disabled'}></td>
                  <td style="text-align:center"><input type="checkbox" data-combo-ready="${ci}"${v && v.ready ? ' checked' : ''}${v ? '' : ' disabled'}></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}`;
  }

  $('panelPrice').innerHTML = `
    <div class="mode-picker">
      ${modes.map(([key, title, sub]) => `
        <button class="mode-option${key === mode ? ' is-active' : ''}" data-act="set-mode" data-mode="${key}">
          <b>${title}</b><span>${sub}</span>
        </button>`).join('')}
    </div>
    ${body}`;
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
          ? ' — สินค้าชิ้นนี้มีสีให้เลือก ถ้าของเสริมมีเฉพาะบางสี ให้ไปใส่ในแท็บ “รูปภาพและสี” แทน'
          : ''}</p>
      ${addonsEditorHtml(draft.addons, 'addons', 'add-addon')}
      ${usedOnColors ? '<p class="field-hint">หมายเหตุ: ตอนนี้มีของเสริมที่ผูกกับสีอยู่แล้วในแท็บ “รูปภาพและสี”</p>' : ''}
    </div>`;
}

/* ───────────────── ผูกค่าจากช่องกรอกเข้ากับ draft ───────────────── */

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
    case 'set-mode': {
      const mode = btn.dataset.mode;
      if(mode === priceMode(draft)) return;
      delete draft.sizes; delete draft.options; delete draft.variants;
      if(mode === 'sizes'){ draft.sizes = [{ name:'', price:num(draft.price) || 0, image:'' }]; }
      if(mode === 'options'){ draft.options = [{ name:'', values:[] }]; draft.variants = []; delete draft.price; }
      if(mode === 'single' && draft.price == null) draft.price = 0;
      renderPricePanel();
      return;
    }

    case 'add-img': {
      const arr = getPath(draft, path) || [];
      arr.push('');
      setPath(draft, path, arr);
      renderMediaPanel();
      return;
    }
    case 'rm-img': {
      const arr = getPath(draft, path) || [];
      arr.splice(+btn.dataset.k, 1);
      if(!arr.length) setPath(draft, path, undefined);
      renderMediaPanel();
      return;
    }

    case 'add-color':
      draft.colors = draft.colors || [];
      draft.colors.push({ name:'', image:'' });
      renderMediaPanel();
      return;
    case 'rm-color':
      draft.colors.splice(k, 1);
      if(!draft.colors.length) delete draft.colors;
      renderMediaPanel();
      renderAddonsPanel();
      return;
    case 'move-color': {
      const d = +btn.dataset.d, j = k + d;
      if(j < 0 || j >= draft.colors.length) return;
      [draft.colors[k], draft.colors[j]] = [draft.colors[j], draft.colors[k]];
      renderMediaPanel();
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

    case 'add-option':
      draft.options = draft.options || [];
      draft.options.push({ name:'', values:[] });
      renderPricePanel();
      return;
    case 'rm-option':
      draft.options.splice(k, 1);
      draft.variants = [];            // คู่ผสมเดิมใช้ไม่ได้แล้วเมื่อจำนวนชั้นเปลี่ยน
      renderPricePanel();
      return;
    case 'add-value': {
      const input = $('panelPrice').querySelector(`[data-new-value="${k}"]`);
      const v = input.value.trim();
      if(!v) return;
      draft.options[k].values = draft.options[k].values || [];
      if(draft.options[k].values.includes(v)){ toast('มีค่านี้อยู่แล้ว', true); return; }
      draft.options[k].values.push(v);
      renderPricePanel();
      return;
    }
    case 'rm-value': {
      const vi = +btn.dataset.vi;
      const removed = draft.options[k].values[vi];
      draft.options[k].values.splice(vi, 1);
      // คู่ผสมที่อ้างถึงค่าที่เพิ่งลบ ต้องถูกลบตามไปด้วย ไม่งั้นจะเป็นคู่ผีค้างในระบบ
      draft.variants = (draft.variants || []).filter(v => !(v.match || []).includes(removed));
      renderPricePanel();
      return;
    }

    case 'add-addon':
      draft.addons = draft.addons || [];
      draft.addons.push({ name:'', price:0, image:'' });
      renderAddonsPanel();
      return;
    case 'color-addon':
      draft.colors[k].addons = draft.colors[k].addons || [];
      draft.colors[k].addons.push({ name:'', price:0, image:'' });
      renderMediaPanel();
      return;
    case 'rm-addon': {
      const arr = getPath(draft, path) || [];
      arr.splice(k, 1);
      if(!arr.length) setPath(draft, path, undefined);
      if(path.startsWith('colors.')) renderMediaPanel(); else renderAddonsPanel();
      return;
    }
  }
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
  tr.classList.toggle('is-off', !el.checked);
  priceInput.disabled = imageInput.disabled = readyInput.disabled = !el.checked;
  if(!el.checked){ priceInput.value = ''; imageInput.value = ''; readyInput.checked = false; }
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
    const sizeParts = sizeTagsOf(p).flatMap(v => str(v).split(',')).map(v => v.trim()).filter(Boolean);
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
      if(str(s.image)) o.image = str(s.image);
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
    out.variants = (p.variants || []).map(v => {
      const o = { match: (v.match || []).map(str), price: num(v.price) };
      if(str(v.image)) o.image = str(v.image);
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

/* ───────────────── ต่อสายเหตุการณ์ทั้งหมด ───────────────── */

$('loginBtn').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
$('loginUser').addEventListener('keydown', e => { if(e.key === 'Enter') $('loginPass').focus(); });

$('logoutBtn').addEventListener('click', async () => {
  const ok = await askConfirm('ออกจากระบบ', 'ต้องล็อกอินใหม่เพื่อกลับเข้ามาจัดการสินค้า', 'ออกจากระบบ');
  if(ok) fb.authApi.signOut(fb.auth);
});

$('searchBox').addEventListener('input', e => { searchTerm = e.target.value; renderList(); });

$('catChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if(!chip) return;
  filterCat = chip.dataset.cat;
  renderList();
});

$('addBtn').addEventListener('click', () => openEditor(-1));
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if(f) importFromFile(f);
  e.target.value = '';
});
$('backupBtn').addEventListener('click', downloadBackup);

$('productList').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if(!btn || btn.disabled) return;
  const i = +btn.dataset.i;
  if(btn.dataset.act === 'edit') openEditor(i);
  if(btn.dataset.act === 'copy') duplicateProduct(i);
  if(btn.dataset.act === 'del') deleteProduct(i);
  if(btn.dataset.act === 'up') moveProduct(i, -1);
  if(btn.dataset.act === 'down') moveProduct(i, 1);
});

/* ───────────────── ลากเพื่อเรียงลำดับ (ไอคอน ⠿) — เดสก์ท็อป ───────────────── */
let dragFromIndex = null;
function clearDragTargetClasses(){
  $('productList').querySelectorAll('.row.drag-target-before, .row.drag-target-after')
    .forEach(r => r.classList.remove('drag-target-before', 'drag-target-after'));
}
$('productList').addEventListener('dragstart', e => {
  const handle = e.target.closest('.drag-handle');
  if(!handle || handle.classList.contains('is-disabled')){ e.preventDefault(); return; }
  dragFromIndex = +handle.dataset.i;
  const row = handle.closest('.row');
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragFromIndex)); // จำเป็นสำหรับบางเบราว์เซอร์ (Firefox) ถึงจะยอมให้ลากได้
  if(row) e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
});
$('productList').addEventListener('dragover', e => {
  if(dragFromIndex == null) return;
  const row = e.target.closest('.row');
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
  const row = e.target.closest('.row');
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
  $('productList').querySelectorAll('.row.is-dragging').forEach(r => r.classList.remove('is-dragging'));
  clearDragTargetClasses();
  dragFromIndex = null;
});

$('editorTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab');
  if(t) switchTab(t.dataset.tab);
});

const drawerBody = $('editorDrawer').querySelector('.drawer-body');
drawerBody.addEventListener('input', onDraftInput);
drawerBody.addEventListener('change', e => {
  if(e.target.dataset.act === 'toggle-combo') onComboToggle(e);
  else onDraftInput(e);
});
drawerBody.addEventListener('click', onDraftClick);
drawerBody.addEventListener('keydown', e => {
  // กด Enter ในช่อง "ค่าใหม่" ให้เพิ่มค่าเลย จะได้พิมพ์รัวๆ ได้
  if(e.key === 'Enter' && e.target.dataset.newValue != null){
    e.preventDefault();
    const k = e.target.dataset.newValue;
    $('panelPrice').querySelector(`[data-act="add-value"][data-k="${k}"]`).click();
  }
});

$('editorClose').addEventListener('click', closeEditor);
$('cancelBtn').addEventListener('click', closeEditor);
$('drawerScrim').addEventListener('click', closeEditor);
$('saveBtn').addEventListener('click', saveDraft);

$('confirmYes').addEventListener('click', () => closeConfirm(true));
$('confirmNo').addEventListener('click', () => closeConfirm(false));
$('confirmScrim').addEventListener('click', e => { if(e.target === $('confirmScrim')) closeConfirm(false); });

document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!$('confirmScrim').hidden) closeConfirm(false);
  else if(!$('editorDrawer').hidden) closeEditor();
});

boot();
