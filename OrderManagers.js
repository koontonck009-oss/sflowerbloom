// 🔥 ตั้งค่า Firebase ตรงนี้ — เอาค่ามาจาก Firebase Console
        // Project settings (รูปเฟือง) > General > Your apps > SDK setup and configuration
        const firebaseConfig = {
            apiKey: "AIzaSyAKFvEnppUTj2iW8UXsh4-fCnMBvtF1UP8",
            authDomain: "sflowerbloomordermanager.firebaseapp.com",
            databaseURL: "https://sflowerbloomordermanager-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "sflowerbloomordermanager",
            storageBucket: "sflowerbloomordermanager.firebasestorage.app",
            messagingSenderId: "135079797740",
            appId: "1:135079797740:web:5d3113074955f0ce3c16c9"
        };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        // แคชข้อมูลไว้ในเครื่อง: เปิดครั้งถัดไปแสดงออเดอร์ทันทีจากเครื่อง แล้วดึงเฉพาะส่วนที่เปลี่ยนจากเซิร์ฟเวอร์
        // (ต้องเรียกก่อนใช้ Firestore อย่างอื่น) ถ้าเบราว์เซอร์ไม่รองรับ จะทำงานแบบเดิมโดยไม่แคช
        try {
            db.settings({ cacheSizeBytes: 200 * 1024 * 1024 });
            db.enablePersistence({ synchronizeTabs: true })
                .catch((err) => console.warn('Firestore offline cache unavailable:', err && err.code));
        } catch (err) {
            console.warn('Firestore offline cache setup failed:', err);
        }
        const auth = firebase.auth();

        // Login screen accepts a plain "admin" id, but the real password check happens
        // on Firebase's servers (via this fixed account), not in this file's JS —
        // so the password is never sitting in readable page source.
        const ADMIN_LOGIN_EMAIL = 'admin@sflowerbloom.local';

        const { createApp, ref, reactive, computed, onMounted, nextTick, watch } = Vue;

        createApp({
            setup() {
                const orders = ref([]);
                const searchQuery = ref('');
                const filterType = ref('all');
                const statusFilter = ref('active'); // default: hide completed/cancelled orders
                const unpaidOnly = ref(false); // show only orders with an outstanding balance (any status except cancelled)
                const datePreset = ref('all');
                const sortOptions = [
                    { v: 'delivery_asc', t: '🚨 ด่วนสุด (กำหนดส่งใกล้สุด)' },
                    { v: 'order_desc', t: '🆕 วันที่สั่ง (ใหม่ → เก่า)' },
                    { v: 'order_asc', t: '📆 วันที่สั่ง (เก่า → ใหม่)' },
                    { v: 'remaining_desc', t: '💰 ยอดค้างชำระ (มากไปน้อย)' }
                ];
                const SORT_KEY = 'orderManagers.sortBy';
                const sortBy = ref((() => {
                    try { const v = localStorage.getItem(SORT_KEY); if (sortOptions.some(o => o.v === v)) return v; } catch (e) {}
                    return 'delivery_asc';
                })());
                watch(sortBy, v => { try { localStorage.setItem(SORT_KEY, v); } catch (e) {} });
                const currentView = ref('grid');
                const isFilterSheetOpen = ref(false);
                const isMobileMenuOpen = ref(false);
                // Mobile order cards start collapsed; expanded state is per order id (desktop always shows everything via md: classes)
                const expandedIds = ref({});
                function isExpanded(order) { return !!expandedIds.value[order.id]; }
                function toggleExpand(order) { expandedIds.value = { ...expandedIds.value, [order.id]: !expandedIds.value[order.id] }; }
                const cardMenuOrder = ref(null);
                function runCardMenu(action) {
                    const o = cardMenuOrder.value;
                    cardMenuOrder.value = null;
                    if (!o) return;
                    if (action === 'print') printSingleWorkOrder(o);
                    else if (action === 'tracking') openTrackingModal(o);
                    else if (action === 'delete') confirmDelete(o);
                    else if (action === 'addItem') openQuickEdit('addItem', o);
                }

                // ---------- Quick edit (fill in a single missing detail from the card) ----------
                const quickEdit = ref(null); // { type, id }
                const quickForm = ref({ text: '', date: '', time: '', amount: '', mode: 'add', details: '', price: '', unit: 'ช่อ', image: '', payDate: '', payMethod: 'โอน', payNote: '', payEditId: '' });
                const quickInput = ref(null);
                // เฟส 4: ค้นสินค้า/เลือกแบบ ในหน้าต่างเพิ่มสินค้าแบบด่วน
                const quickSuggest = ref(false);
                const quickSuggestIndex = ref(-1);
                const quickChoiceFor = ref(null);
                const quickSuggestions = computed(() => quickSuggest.value ? searchCatalog(quickForm.value.details) : []);
                function onQuickInput() { quickSuggest.value = true; quickSuggestIndex.value = -1; quickChoiceFor.value = null; }
                function onQuickKeydown(e) {
                    if (e.isComposing || e.ctrlKey || e.metaKey) return;
                    const list = quickSuggestions.value;
                    if (!list.length) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); quickSuggestIndex.value = (quickSuggestIndex.value + 1) % list.length; }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); quickSuggestIndex.value = quickSuggestIndex.value <= 0 ? list.length - 1 : quickSuggestIndex.value - 1; }
                    else if (e.key === 'Enter' && quickSuggestIndex.value >= 0 && list[quickSuggestIndex.value]) { e.preventDefault(); pickQuickProduct(list[quickSuggestIndex.value]); }
                    else if (e.key === 'Escape') { e.stopPropagation(); quickSuggest.value = false; }
                }
                function pickQuickProduct(p) {
                    const f = quickForm.value;
                    f.details = p.name;
                    f.price = p.price != null ? p.price : (p.samePrice != null ? p.samePrice : '');
                    f.unit = p.unit || f.unit || 'ช่อ';
                    f.image = p.image || '';
                    quickSuggest.value = false; quickSuggestIndex.value = -1;
                    quickChoiceFor.value = (p.choices && p.choices.length) ? p : null;
                }
                function pickQuickChoice(p, v) {
                    const f = quickForm.value;
                    f.details = v.label ? p.name + ' (' + v.label + ')' : p.name;
                    if (v.price != null) f.price = v.price;
                    f.image = v.image || p.image || '';
                    quickChoiceFor.value = null;
                }
                const quickOrder = computed(() => quickEdit.value ? (orders.value.find(o => o.id === quickEdit.value.id) || null) : null);
                const quickTitle = computed(() => {
                    const q = quickEdit.value, o = quickOrder.value;
                    if (!q || !o) return '';
                    return ({ phone: 'เบอร์โทรศัพท์', date: 'กำหนดส่ง / นัดรับ', payment: 'บันทึกการชำระเงิน', addItem: 'เพิ่มสินค้า' })[q.type]
                        || (o.deliveryType === 'shipping' ? 'ที่อยู่จัดส่งพัสดุ' : 'สถานที่นัดรับ');
                });
                const quickPay = computed(() => {
                    const o = quickOrder.value;
                    const total = o ? (Number(o.totalAmount) || 0) : 0;
                    const cur = o ? (Number(o.depositAmount) || 0) : 0;
                    const f = quickForm.value;
                    const editing = o && f.payEditId ? effectivePayments(o).find(p => p.id === f.payEditId) : null;
                    const base = roundMoney(cur - (editing ? (Number(editing.amount) || 0) : 0));
                    const n = Number(f.amount);
                    const hasAmount = f.amount !== '' && f.amount !== null && !isNaN(n);
                    const next = roundMoney(base + (hasAmount ? n : 0));
                    return { total, cur, curRemaining: Math.max(0, total - cur), baseRemaining: Math.max(0, roundMoney(total - base)), next, remaining: Math.max(0, roundMoney(total - next)), hasAmount, valid: hasAmount && n > 0, over: hasAmount && total > 0 && next > total, editing: !!editing };
                });
                const paymentHistory = computed(() => effectivePayments(quickOrder.value)
                    .map(p => ({ ...p }))
                    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))));
                function quickItemsTotalOf(o) {
                    const ship = o.deliveryType === 'shipping' ? (Number(o.shippingFee) || 0) : 0;
                    return (o.items || []).reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.price) || 0), 0) + ship;
                }
                const quickNewTotal = computed(() => {
                    const o = quickOrder.value;
                    if (!o) return 0;
                    const add = Number(quickForm.value.price) || 0;
                    if (o.items && o.items.length) return quickItemsTotalOf({ ...o, items: [...o.items, { qty: 1, price: add }] });
                    return (Number(o.totalAmount) || 0) + add;
                });
                function openQuickEdit(type, order) {
                    quickEdit.value = { type, id: order.id };
                    quickSuggest.value = false; quickSuggestIndex.value = -1; quickChoiceFor.value = null;
                    quickForm.value = {
                        text: type === 'phone' ? (order.customerPhone || '') : (type === 'address' ? (order.location || '') : ''),
                        mapLink: order.mapLink || '',
                        date: order.deliveryDate || '', time: order.deliveryTime || '', amount: '', mode: 'add', details: '', price: '', unit: 'ช่อ', image: '',
                        payDate: localDateString(), payMethod: 'โอน', payNote: '', payEditId: ''
                    };
                    setTimeout(() => { if (quickInput.value && quickInput.value.focus) quickInput.value.focus(); }, 120);
                }
                function closeQuickEdit() { quickEdit.value = null; }
                watch(quickEdit, (v) => { document.body.style.overflow = v ? 'hidden' : ''; });
                function resetPayForm() {
                    Object.assign(quickForm.value, { amount: '', payDate: localDateString(), payMethod: 'โอน', payNote: '', payEditId: '' });
                }
                function quickPayFull() {
                    quickForm.value.amount = String(quickPay.value.baseRemaining);
                }
                function cancelPaymentEdit() { resetPayForm(); }
                function editPaymentEntry(p) {
                    Object.assign(quickForm.value, { amount: String(p.amount), payDate: String(p.date || localDateString()).slice(0, 10), payMethod: p.method || 'โอน', payNote: p.note || '', payEditId: p.id });
                    setTimeout(() => { if (quickInput.value && quickInput.value.focus) quickInput.value.focus(); }, 60);
                }
                function deletePaymentEntry(p) {
                    const o = quickOrder.value;
                    if (!o) return;
                    if (!window.confirm(`ลบรายการรับเงิน ฿${formatNumber(p.amount)} (${formatDate(p.date)}) ?`)) return;
                    if (quickForm.value.payEditId === p.id) resetPayForm();
                    mutatePayments(o.id, list => list.filter(x => x.id !== p.id))
                        .then(() => showToast('ลบรายการรับเงินแล้ว'))
                        .catch(() => showToast('ลบไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                }
                function savePaymentEntry(o) {
                    const p = quickPay.value, f = quickForm.value;
                    if (!p.hasAmount) { showToast('กรุณากรอกจำนวนเงิน'); return; }
                    if (!p.valid) { showToast('จำนวนเงินต้องมากกว่า 0'); return; }
                    if (!f.payDate) { showToast('กรุณาเลือกวันที่รับเงิน'); return; }
                    const editId = f.payEditId;
                    const entry = { id: editId || newPaymentId(), date: f.payDate, amount: roundMoney(f.amount), method: f.payMethod || '', note: (f.payNote || '').trim() };
                    mutatePayments(o.id, list => {
                        const i = editId ? list.findIndex(x => x.id === editId) : -1;
                        if (i >= 0) list[i] = entry; else list.push(entry);
                    }).then(() => {
                        if (editId) { showToast('แก้ไขรายการรับเงินแล้ว'); return; }
                        showToast('บันทึกการรับเงินแล้ว', () => {
                            mutatePayments(o.id, list => list.filter(x => x.id !== entry.id))
                                .then(() => showToast('ยกเลิกรายการรับเงินแล้ว'))
                                .catch(() => showToast('ย้อนกลับไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                        });
                    }).catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    closeQuickEdit();
                }
                function saveQuickEdit() {
                    const q = quickEdit.value, o = quickOrder.value;
                    if (!q || !o) return;
                    const inc = (n) => firebase.firestore.FieldValue.increment(n);
                    let patch = null, msg = 'บันทึกเรียบร้อย';
                    if (q.type === 'phone') { patch = { customerPhone: (quickForm.value.text || '').trim() }; msg = 'บันทึกเบอร์โทรแล้ว'; }
                    else if (q.type === 'address') {
                        patch = { location: (quickForm.value.text || '').trim() };
                        if (o.deliveryType !== 'shipping') {
                            const ml = (quickForm.value.mapLink || '').trim();
                            if (ml && !isGoogleMapsLink(ml)) { showToast('ลิงก์ไม่ใช่ Google Maps'); return; }
                            patch.mapLink = normalizeMapLink(ml);
                        }
                        msg = o.deliveryType === 'shipping' ? 'บันทึกที่อยู่จัดส่งแล้ว' : 'บันทึกสถานที่นัดรับแล้ว';
                    }
                    else if (q.type === 'date') { patch = { deliveryDate: quickForm.value.date || '' }; if (o.deliveryType === 'pickup') patch.deliveryTime = quickForm.value.date ? (quickForm.value.time || '') : ''; msg = quickForm.value.date ? 'บันทึกวันส่งแล้ว' : 'ล้างวันส่งแล้ว'; }
                    else if (q.type === 'payment') { savePaymentEntry(o); return; }
                    else if (q.type === 'addItem') {
                        const details = (quickForm.value.details || '').trim();
                        if (!details) { showToast('กรุณากรอกรายการสินค้าที่เพิ่ม'); return; }
                        const price = Number(quickForm.value.price) || 0;
                        if (o.items && o.items.length) {
                            // itemized order: append a row, then rebuild the product text + total exactly like the full form does
                            const items = [...o.items.map(i => ({ ...i })), { id: Date.now() + Math.random(), details, qty: 1, unit: (quickForm.value.unit || '').trim() || 'ช่อ', price }];
                            const products = items.map(item => {
                                const label = (item.details || '').trim();
                                if (!label) return null;
                                const qty = Number(item.qty) || 0;
                                return qty > 1 ? `${label} (x${qty} ${item.unit || ''})`.trim() : label;
                            }).filter(Boolean).join('\n');
                            patch = { items, products, totalAmount: quickItemsTotalOf({ ...o, items }) };
                        } else {
                            const base = (o.products || '').replace(/\s+$/, '');
                            patch = { products: base ? base + '\n' + details : details };
                            if (price) patch.totalAmount = inc(price);
                        }
                        // ใส่รูปสินค้าที่เลือกเข้ารูปตัวอย่างของออเดอร์ (ไม่ซ้ำ ไม่เกิน MAX_ORDER_IMAGES)
                        const pickedImg = quickForm.value.image;
                        if (pickedImg && patch) {
                            const cur = getOrderImages(o).map(im => ({ ...im }));
                            if (!cur.some(im => im && im.url === pickedImg) && cur.length < MAX_ORDER_IMAGES) patch.images = [...cur, { url: pickedImg, rotation: 0 }];
                        }
                        msg = 'เพิ่มสินค้าเรียบร้อย';
                    }
                    if (!patch) return;
                    db.collection('orders').doc(o.id).update(patch)
                        .then(() => showToast(msg))
                        .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    closeQuickEdit();
                }
                // Inline tracking-number entry on the order card
                const TRACK_CARRIERS = ['ไปรษณีย์ไทย (EMS)', 'Flash Express', 'J&T Express', 'Kerry Express', 'อื่นๆ'];
                const trackDraft = ref({});
                const trackEditing = ref({});
                function startTrackEdit(o) {
                    trackDraft.value = { ...trackDraft.value, [o.id]: o.trackingNumber || '' };
                    trackEditing.value = { ...trackEditing.value, [o.id]: true };
                }
                function cancelTrackEdit(o) {
                    trackEditing.value = { ...trackEditing.value, [o.id]: false };
                    trackDraft.value = { ...trackDraft.value, [o.id]: '' };
                }
                function saveInlineTracking(o) {
                    const n = String(trackDraft.value[o.id] || '').replace(/\s+/g, '').toUpperCase();
                    if (!n) { showToast('กรุณากรอกเลขพัสดุก่อนนะครับ'); return; }
                    const patch = { trackingNumber: n };
                    if (!o.expressCompany) patch.expressCompany = TRACK_CARRIERS[0];
                    db.collection('orders').doc(o.id).update(patch)
                        .then(() => showToast('บันทึกเลขพัสดุแล้ว ✅'))
                        .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    cancelTrackEdit(o);
                }
                function saveCarrier(o, company) {
                    if (!company || company === o.expressCompany) return;
                    db.collection('orders').doc(o.id).update({ expressCompany: company })
                        .then(() => showToast('เปลี่ยนขนส่งเป็น ' + company + ' แล้ว'))
                        .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                }
                function urgencyChip(order) {
                    const u = getDeliveryUrgency(order);
                    if (!u.text) return null; // finished orders have no urgency
                    if (u.type === 'overdue') return { text: u.text.replace('!', ''), cls: 'bg-rose-600 text-white' };
                    if (u.type === 'today') return { text: '⚡️ วันนี้', cls: 'bg-amber-400 text-slate-900' };
                    return { text: u.text, cls: 'bg-slate-100 text-slate-600' };
                }
                const activeFilterCount = computed(() =>
                    (filterType.value !== 'all' ? 1 : 0) + (datePreset.value !== 'all' ? 1 : 0) + (sortBy.value !== 'delivery_asc' ? 1 : 0));
                function resetFilters() { filterType.value = 'all'; datePreset.value = 'all'; sortBy.value = 'delivery_asc'; }
                watch(isFilterSheetOpen, (open) => { document.body.style.overflow = open ? 'hidden' : ''; });
                
                const isModalOpen = ref(false);
                const showMoreFields = ref(false);
                const formStep = ref(1);
                const formStepTitles = ['ข้อมูลลูกค้า & สินค้า', 'วันที่ & การจัดส่ง', 'การชำระเงิน'];
                const formScroll = ref(null);
                const isMobileForm = () => window.matchMedia('(max-width: 639px)').matches;
                function goToStep(n) {
                    formStep.value = n;
                    nextTick(() => {
                        if (formScroll.value) formScroll.value.scrollTop = 0;
                    });
                }
                const formErrors = ref({});
                function validateForm(onlyStep) {
                    const e = {};
                    if (!onlyStep || onlyStep === 1) {
                        if (!String(form.value.customerName || '').trim()) e.customerName = 'กรุณากรอกชื่อลูกค้า';
                        if (!(form.value.items || []).some(i => String(i.details || '').trim())) e.items = 'กรุณากรอกรายละเอียดสินค้าอย่างน้อย 1 รายการ';
                    }
                    if (!onlyStep || onlyStep === 2) {
                        if (!form.value.orderDate) e.orderDate = 'กรุณาเลือกวันที่สั่ง';
                        if (form.value.deliveryType === 'pickup' && String(form.value.mapLink || '').trim() && !isGoogleMapsLink(form.value.mapLink)) e.mapLink = 'ลิงก์ไม่ใช่ Google Maps (เช่น maps.app.goo.gl/... หรือ google.com/maps/...)';
                    }
                    formErrors.value = e;
                    const firstKey = ['customerName', 'items', 'orderDate', 'mapLink'].find(k => e[k]);
                    if (!firstKey) return true;
                    const targetStep = (firstKey === 'orderDate' || firstKey === 'mapLink') ? 2 : 1;
                    const targetId = { customerName: 'f-customerName', items: 'f-item-first', orderDate: 'f-orderDate', mapLink: 'f-mapLink' }[firstKey];
                    const focusIt = () => {
                        const el = document.getElementById(targetId);
                        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
                    };
                    if (isMobileForm() && formStep.value !== targetStep) { goToStep(targetStep); nextTick(focusIt); } else { focusIt(); }
                    return false;
                }
                function nextStep() {
                    // validate only the fields on the current step (other steps are hidden on mobile)
                    if (!validateForm(formStep.value)) return;
                    if (formStep.value < 3) goToStep(formStep.value + 1);
                }
                function prevStep() { if (formStep.value > 1) goToStep(formStep.value - 1); }
                function onFormSubmit() {
                    // On mobile, pressing Enter / submit before the last step just moves to the next step
                    if (isMobileForm() && formStep.value < 3) { nextStep(); return; }
                    if (!validateForm()) return;
                    saveOrder();
                }
                function focusNextField(el) {
                    const formEl = el.closest('form');
                    if (!formEl) return;
                    const list = Array.from(formEl.querySelectorAll('input, select, textarea')).filter(f =>
                        !f.disabled && !f.readOnly && f.type !== 'hidden' && f.type !== 'file' && f.type !== 'radio' && f.offsetParent !== null);
                    const i = list.indexOf(el);
                    if (i > -1 && list[i + 1]) list[i + 1].focus();
                }
                // Enter = go to next field (never saves by accident); Ctrl/Cmd+Enter = save
                function onFormKeydown(e) {
                    if (e.key !== 'Enter' || e.isComposing) return;
                    const el = e.target;
                    if (e.ctrlKey || e.metaKey) { e.preventDefault(); onFormSubmit(); return; }
                    if (!el || el.tagName !== 'INPUT' || ['button', 'submit', 'checkbox', 'radio', 'file'].includes(el.type)) return;
                    e.preventDefault();
                    const items = form.value.items || [];
                    const last = items[items.length - 1];
                    if (el.dataset.itemPrice !== undefined && last && String(last.id) === el.dataset.itemPrice && String(last.details || '').trim()) {
                        addFormItem();
                        return;
                    }
                    focusNextField(el);
                }
                const isEditing = ref(false);
                const editingId = ref(null);
                const toastMessage = ref('');
                const toastUndo = ref(null);
                let toastTimer = null;
                const deleteTarget = ref(null);
                const receiptTarget = ref(null);
                const galleryTarget = ref(null);
                const galleryIndex = ref(0);
                const selectedForPrint = ref([]);
                const ordersToPrint = ref([]);
                const printScaleMap = ref({});
                const isMeasuringPrint = ref(false);

                // Customer Notification Message Modal
                // Login / Auth
                const authChecked = ref(false);
                const isLoggedIn = ref(false);
                const loginForm = ref({ username: '', password: '' });
                const loginError = ref('');
                const isLoggingIn = ref(false);

                const isMessageModalOpen = ref(false);
                const messageMobileTab = ref('form');

                // Tracking Number Notification Modal
                const trackingTarget = ref(null);
                const trackingNumberInput = ref('');
                const trackingSaveToOrder = ref(true);
                const trackingInputEl = ref(null);
                const messageSourceOrder = ref(null);
                const messageItems = ref([{ id: Date.now(), details: '', qty: 1, unit: 'ช่อ', price: 0 }]);
                const messageForm = ref({
                    shippingMethod: 'shipping',
                    shippingFee: 0,
                    pickupLocation: '',
                    deliveryDateText: '',
                    paymentMode: 'default',
                    fullPay: 0,
                    deposit: 0,
                    includeNote: true
                });


                // ───────── ระยะเวลาส่งพัสดุตามจังหวัด (ข้อมูลภายในร้าน เก็บที่ shopPrivate/shippingDays) ─────────
                // ค่าเริ่มต้นเป็นแค่ค่าประมาณตั้งต้นรายภาค — แก้เป็นของจริงได้ที่เมนู "ตารางระยะเวลาส่ง"
                const PROVINCE_GROUPS = [
                    { region: 'กรุงเทพฯและปริมณฑล', min: 1, max: 2, provinces: ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'นครปฐม', 'สมุทรสาคร'] },
                    { region: 'ภาคกลาง', min: 1, max: 2, provinces: ['นครสวรรค์', 'อุทัยธานี', 'ชัยนาท', 'สิงห์บุรี', 'ลพบุรี', 'อ่างทอง', 'พระนครศรีอยุธยา', 'สระบุรี', 'สุพรรณบุรี', 'นครนายก'] },
                    { region: 'ภาคเหนือ', min: 2, max: 3, provinces: ['เชียงใหม่', 'เชียงราย', 'ลำปาง', 'ลำพูน', 'แม่ฮ่องสอน', 'น่าน', 'พะเยา', 'แพร่', 'อุตรดิตถ์', 'ตาก', 'สุโขทัย', 'พิษณุโลก', 'พิจิตร', 'กำแพงเพชร', 'เพชรบูรณ์'] },
                    { region: 'ภาคตะวันออก', min: 2, max: 3, provinces: ['ชลบุรี', 'ระยอง', 'จันทบุรี', 'ตราด', 'ฉะเชิงเทรา', 'ปราจีนบุรี', 'สระแก้ว'] },
                    { region: 'ภาคตะวันตก', min: 2, max: 3, provinces: ['กาญจนบุรี', 'ราชบุรี', 'เพชรบุรี', 'ประจวบคีรีขันธ์', 'สมุทรสงคราม'] },
                    { region: 'ภาคตะวันออกเฉียงเหนือ', min: 2, max: 3, provinces: ['กาฬสินธุ์', 'ขอนแก่น', 'ชัยภูมิ', 'นครพนม', 'นครราชสีมา', 'บึงกาฬ', 'บุรีรัมย์', 'มหาสารคาม', 'มุกดาหาร', 'ยโสธร', 'ร้อยเอ็ด', 'เลย', 'สกลนคร', 'สุรินทร์', 'ศรีสะเกษ', 'หนองคาย', 'หนองบัวลำภู', 'อุดรธานี', 'อุบลราชธานี', 'อำนาจเจริญ'] },
                    { region: 'ภาคใต้', min: 3, max: 4, provinces: ['กระบี่', 'ชุมพร', 'ตรัง', 'นครศรีธรรมราช', 'นราธิวาส', 'ปัตตานี', 'พังงา', 'พัทลุง', 'ภูเก็ต', 'ระนอง', 'สงขลา', 'สตูล', 'สุราษฎร์ธานี', 'ยะลา'] }
                ];
                const ALL_PROVINCES = PROVINCE_GROUPS.flatMap(g => g.provinces);

                // ───────── ตรวจจับจังหวัดจากที่อยู่ BEGIN ─────────
                const PROVINCE_ALIASES = { 'กทม': 'กรุงเทพมหานคร', 'ก.ท.ม': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร', 'โคราช': 'นครราชสีมา', 'อยุธยา': 'พระนครศรีอยุธยา' };
                const RISKY_PROVINCES = ['ตาก', 'เลย', 'ตรัง', 'น่าน', 'แพร่']; // ชื่อสั้นที่ซ้ำกับคำทั่วไป/ชื่ออำเภอ ต้องมีขอบเขตชัดเจนถึงจะนับ
                const PROVINCE_NAME_LIST = ALL_PROVINCES.map(p => [p, p]).concat(Object.entries(PROVINCE_ALIASES)).sort((a, b) => b[0].length - a[0].length);
                // รหัสไปรษณีย์ 2 หลักแรก → จังหวัด (ใช้เป็นตัวสำรองเท่านั้น และเฉพาะกลุ่มที่ชี้จังหวัดเดียวชัดเจน)
                const POSTCODE_PREFIX = {
                    '11': 'นนทบุรี', '12': 'ปทุมธานี', '20': 'ชลบุรี', '21': 'ระยอง', '22': 'จันทบุรี', '23': 'ตราด', '24': 'ฉะเชิงเทรา', '25': 'ปราจีนบุรี', '26': 'นครนายก', '27': 'สระแก้ว',
                    '30': 'นครราชสีมา', '31': 'บุรีรัมย์', '32': 'สุรินทร์', '33': 'ศรีสะเกษ', '34': 'อุบลราชธานี', '35': 'ยโสธร', '36': 'ชัยภูมิ', '37': 'อำนาจเจริญ', '39': 'หนองบัวลำภู',
                    '40': 'ขอนแก่น', '41': 'อุดรธานี', '42': 'เลย', '43': 'หนองคาย', '44': 'มหาสารคาม', '45': 'ร้อยเอ็ด', '46': 'กาฬสินธุ์', '47': 'สกลนคร', '48': 'นครพนม', '49': 'มุกดาหาร',
                    '50': 'เชียงใหม่', '51': 'ลำพูน', '52': 'ลำปาง', '53': 'อุตรดิตถ์', '54': 'แพร่', '55': 'น่าน', '56': 'พะเยา', '57': 'เชียงราย', '58': 'แม่ฮ่องสอน',
                    '60': 'นครสวรรค์', '61': 'อุทัยธานี', '62': 'กำแพงเพชร', '63': 'ตาก', '64': 'สุโขทัย', '65': 'พิษณุโลก', '66': 'พิจิตร', '67': 'เพชรบูรณ์',
                    '70': 'ราชบุรี', '71': 'กาญจนบุรี', '72': 'สุพรรณบุรี', '73': 'นครปฐม', '74': 'สมุทรสาคร', '75': 'สมุทรสงคราม', '76': 'เพชรบุรี', '77': 'ประจวบคีรีขันธ์',
                    '80': 'นครศรีธรรมราช', '81': 'กระบี่', '82': 'พังงา', '83': 'ภูเก็ต', '84': 'สุราษฎร์ธานี', '85': 'ระนอง', '86': 'ชุมพร',
                    '90': 'สงขลา', '91': 'สตูล', '92': 'ตรัง', '93': 'พัทลุง', '94': 'ปัตตานี', '95': 'ยะลา', '96': 'นราธิวาส'
                };
                // คืน { province, via: 'name' | 'postcode' } หรือ null ถ้าจับไม่ได้
                function detectProvince(text) {
                    const s = String(text || '').replace(/ฏ/g, 'ฎ');
                    if (!s.trim()) return null;
                    const LETTER = /[\u0E01-\u0E4E]/;
                    const hits = [];
                    for (const [name, prov] of PROVINCE_NAME_LIST) {
                        let i = -1;
                        while ((i = s.indexOf(name, i + 1)) !== -1) {
                            const after = s[i + name.length];
                            if (after && LETTER.test(after) && after !== 'ฯ') continue;   // ชื่อต้องจบคำ (กัน ตากใบ / ตากฟ้า / ตากสิน)
                            const head = s.slice(0, i);
                            const explicit = /(?:จังหวัด|จ\.)\s*$/.test(head);
                            if (!explicit && /(?:ถนน|ถ\.|ซอย|ซ\.|แยก)\s*$/.test(head)) continue;   // ชื่อถนน เช่น ถนนเพชรบุรี
                            if (!explicit && RISKY_PROVINCES.includes(prov)) {
                                const left = s[i - 1];
                                if (left && LETTER.test(left) && !/เมือง$/.test(head)) continue;
                            }
                            hits.push({ pos: i, prov, explicit });
                        }
                    }
                    if (hits.length) {
                        const ex = hits.filter(x => x.explicit);
                        const pool = ex.length ? ex : hits;
                        const best = pool.reduce((a, b) => (b.pos >= a.pos ? b : a));
                        return { province: best.prov, via: 'name' };
                    }
                    const pcs = s.match(/(?<!\d)\d{5}(?!\d)/g);
                    if (pcs) {
                        const p = POSTCODE_PREFIX[pcs[pcs.length - 1].slice(0, 2)];
                        if (p) return { province: p, via: 'postcode' };
                    }
                    return null;
                }
                // ───────── ตรวจจับจังหวัดจากที่อยู่ END ─────────
                const shippingDays = ref({});      // ค่าที่บันทึกไว้ { จังหวัด: {min, max} } (ว่าง = ใช้ค่าเริ่มต้นรายภาค)
                const daysModal = ref(null);       // { draft, region, q, busy }

                function defaultDaysFor(province) {
                    const g = PROVINCE_GROUPS.find(x => x.provinces.includes(province));
                    return g ? { min: g.min, max: g.max } : null;
                }
                function daysFor(province) {
                    if (!province) return null;
                    const s = shippingDays.value[province];
                    if (s && Number.isFinite(Number(s.min)) && Number.isFinite(Number(s.max))) return { min: Number(s.min), max: Number(s.max) };
                    return defaultDaysFor(province);
                }
                function daysText(province) {
                    const d = daysFor(province);
                    if (!d) return '';
                    return d.min === d.max ? d.min + ' วัน' : d.min + '–' + d.max + ' วัน';
                }
                function openDaysModal() {
                    const draft = {};
                    ALL_PROVINCES.forEach(p => { const d = daysFor(p); draft[p] = { min: d.min, max: d.max }; });
                    const region = {};
                    PROVINCE_GROUPS.forEach(g => { region[g.region] = { min: g.min, max: g.max }; });
                    daysModal.value = { draft, region, q: '', busy: false };
                }
                function closeDaysModal() { daysModal.value = null; }
                const daysModalGroups = computed(() => {
                    if (!daysModal.value) return [];
                    const q = String(daysModal.value.q || '').trim();
                    return PROVINCE_GROUPS
                        .map(g => ({ region: g.region, provinces: q ? g.provinces.filter(p => p.includes(q)) : g.provinces }))
                        .filter(g => g.provinces.length);
                });
                function applyRegionDays(region) {
                    const m = daysModal.value;
                    if (!m) return;
                    const g = PROVINCE_GROUPS.find(x => x.region === region);
                    const v = m.region[region];
                    const min = Math.max(0, Math.round(Number(v.min)));
                    const max = Math.max(min, Math.round(Number(v.max)));
                    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
                    g.provinces.forEach(p => { m.draft[p] = { min, max }; });
                }
                function saveDaysModal() {
                    const m = daysModal.value;
                    if (!m || m.busy) return;
                    const out = {};
                    for (const p of ALL_PROVINCES) {
                        const min = Math.round(Number(m.draft[p].min));
                        const max = Math.round(Number(m.draft[p].max));
                        if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) { showToast('ตัวเลขวันของ ' + p + ' ไม่ถูกต้อง'); return; }
                        if (max < min) { showToast(p + ': จำนวนวันมากสุดต้องไม่น้อยกว่าน้อยสุด'); return; }
                        out[p] = { min, max };
                    }
                    m.busy = true;
                    db.collection('shopPrivate').doc('shippingDays').set({ json: JSON.stringify(out), updatedAt: new Date().toISOString() })
                        .then(() => { shippingDays.value = out; showToast('บันทึกตารางระยะเวลาส่งแล้ว'); closeDaysModal(); })
                        .catch((err) => {
                            m.busy = false;
                            showToast(err && err.code === 'permission-denied' ? 'บันทึกไม่ได้ ต้องเพิ่มกฎ Firestore ให้ shopPrivate ก่อน' : 'บันทึกตารางไม่สำเร็จ ตรวจสอบการเชื่อมต่อ');
                        });
                }


                // ───────── เติมจังหวัดให้ออเดอร์เก่า (ดูตัวอย่างก่อนยืนยัน) ─────────
                const provinceAuto = ref(false);      // จังหวัดในฟอร์มตอนนี้ถูกเติมอัตโนมัติ (ยังไม่ได้เลือกเอง)
                const provinceVia = ref('');
                const fillProv = ref(null);           // { rows:[{id,name,address,province,via,checked}], skipped, busy }
                function openFillProvince() {
                    const rows = [];
                    let skipped = 0;
                    orders.value.forEach(o => {
                        if (o.deliveryType !== 'shipping' || o.province || !String(o.location || '').trim()) return;
                        const d = detectProvince(o.location);
                        if (!d) { skipped++; return; }
                        rows.push({ id: o.id, name: o.customerName || '(ไม่มีชื่อ)', address: String(o.location).replace(/\s+/g, ' ').trim(), province: d.province, via: d.via, checked: d.via === 'name' });
                    });
                    fillProv.value = { rows, skipped, busy: false };
                }
                function closeFillProvince() { fillProv.value = null; }
                async function confirmFillProvince() {
                    const f = fillProv.value;
                    if (!f || f.busy) return;
                    const picked = f.rows.filter(r => r.checked && r.province);
                    if (!picked.length) { showToast('ยังไม่ได้เลือกออเดอร์ที่จะเติม'); return; }
                    f.busy = true;
                    try {
                        for (let i = 0; i < picked.length; i += 400) {
                            const batch = db.batch();
                            picked.slice(i, i + 400).forEach(r => batch.update(db.collection('orders').doc(r.id), { province: r.province }));
                            await batch.commit();
                        }
                        showToast('เติมจังหวัดให้ ' + picked.length + ' ออเดอร์แล้ว');
                        closeFillProvince();
                    } catch (err) {
                        f.busy = false;
                        console.error(err);
                        showToast('เติมจังหวัดไม่สำเร็จ ตรวจสอบการเชื่อมต่อ');
                    }
                }

                // ชื่อเดือนไทยเต็ม ใช้สร้างค่า "ประจำเดือน" ให้ตรงกับวันที่จริง
                const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
                const monthLabelOf = (dateStr) => {
                    const m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ''));
                    if (!m || +m[2] < 1 || +m[2] > 12) return '';
                    return THAI_MONTHS_FULL[+m[2] - 1] + ' ' + m[1];
                };

                const form = ref({
                    customerName: '',
                    customerPhone: '',
                    orderNo: '01',
                    queueNo: '01',
                    orderMonth: monthLabelOf(localDateString()),
                    products: '',
                    items: [],
                    notes: '',
                    images: [],
                    orderDate: localDateString(),
                    deliveryDate: '',
                    deliveryTime: '',
                    deliveryType: 'shipping',
                    expressCompany: 'ไปรษณีย์ไทย (EMS)',
                    trackingNumber: '',
                    shippingFee: 0,
                    province: '',
                    location: '',
                    mapLink: '',
                    totalAmount: 1500,
                    depositAmount: 500,
                    paymentMode: 'default',
                    status: 'pending'
                });
                const formItemizedMode = ref(false);
                const imageUrlInput = ref('');
                const MAX_ORDER_IMAGES = 5;


                const getTodayString = (offsetDays = 0) => {
                    const d = new Date();
                    d.setDate(d.getDate() + offsetDays);
                    return d.toISOString().split('T')[0];
                };

                const initialOrders = [
                    {
                        id: 'ORD-' + Date.now() + '-1',
                        customerName: 'คุณณัฐมน บุญมา',
                        customerPhone: '089-123-4567',
                        orderNo: '01',
                        queueNo: '01',
                        orderMonth: monthLabelOf(getTodayString(-1)),
                        products: 'ช่อดอกกุหลาบแดงพรีเมียม 9 ดอก โทนกระดาษสีดำขอบทอง',
                        items: [],
                        notes: 'ขอริบบิ้นสีแดงเข้ม',
                        images: [],
                        orderDate: getTodayString(-1),
                        deliveryDate: getTodayString(0),
                        deliveryType: 'shipping',
                        expressCompany: 'Flash Express',
                        trackingNumber: 'TH0192837465',
                        shippingFee: 50,
                        location: '123/45 ถนนสุขุมวิท แขวงคลองเตย เขตวัฒนา กรุงเทพฯ 10110',
                        totalAmount: 1850,
                        depositAmount: 1850,
                        paymentMode: 'transfer_only',
                        status: 'in_progress'
                    },
                    {
                        id: 'ORD-' + Date.now() + '-2',
                        customerName: 'คุณภัทรพล สุขเสริฐ',
                        customerPhone: '081-999-8877',
                        orderNo: '02',
                        queueNo: '02',
                        orderMonth: monthLabelOf(getTodayString(-2)),
                        products: 'ช่อดอกไม้แห้งขนาดใหญ่ โทนสีพาสเทล พร้อมการ์ดอวยพรวันเกิด',
                        items: [],
                        notes: 'ลูกค้ามารับเองหน้าร้าน',
                        images: [],
                        orderDate: getTodayString(-2),
                        deliveryDate: getTodayString(1),
                        deliveryType: 'pickup',
                        expressCompany: '',
                        trackingNumber: '',
                        shippingFee: 0,
                        location: 'หน้าร้านหลัก S.FLOWER BLOOM',
                        totalAmount: 1200,
                        depositAmount: 500,
                        paymentMode: 'default',
                        status: 'ready'
                    }
                ];

                // ---------- ประวัติรับเงิน (payments) ----------
                // ออเดอร์เก็บ payments: [{id, date, amount, method, note}] และ depositAmount = ผลรวมเสมอ
                // ออเดอร์เก่าที่ไม่มี payments จะแสดงเป็นรายการ "ยอดเดิม" โดยอัตโนมัติ (ไม่ต้อง migrate)
                const PAY_METHODS = ['โอน', 'เงินสด', 'อื่นๆ'];
                function newPaymentId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
                function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }
                function sumPayments(list) { return roundMoney((list || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)); }
                function legacyPaymentsOf(o) {
                    const amt = Number(o && o.depositAmount) || 0;
                    if (amt <= 0) return [];
                    const date = (o.status === 'completed' ? (o.completedAt || o.deliveryDate || o.orderDate) : o.orderDate) || localDateString();
                    return [{ id: 'legacy', date: String(date).slice(0, 10), amount: amt, method: '', note: 'ยอดเดิม' }];
                }
                function effectivePayments(o) {
                    if (!o) return [];
                    return Array.isArray(o.payments) ? o.payments : legacyPaymentsOf(o);
                }
                function paymentDateOf(o, p) { return String((p && p.date) || (o && o.orderDate) || '').slice(0, 10); }
                // แก้ประวัติรับเงินแบบอะตอมิก (ธุรกรรม) กันสองเครื่องบันทึกพร้อมกันแล้วยอดหาย; extra = ฟิลด์อื่นที่ต้องเขียนพร้อมกัน
                function mutatePayments(orderId, mutate, extra) {
                    const ref = db.collection('orders').doc(orderId);
                    return db.runTransaction(async (tx) => {
                        const snap = await tx.get(ref);
                        if (!snap.exists) throw new Error('order-missing');
                        const d = snap.data();
                        const cur = Array.isArray(d.payments) ? d.payments.map(p => ({ ...p })) : legacyPaymentsOf(d);
                        const out = mutate(cur, d);
                        const next = Array.isArray(out) ? out : cur;
                        tx.update(ref, { ...(extra || {}), payments: next, depositAmount: sumPayments(next) });
                    });
                }

                function getRemainingBalance(order) {
                    if (!order || order.status === 'cancelled') return 0; // cancelled orders carry no outstanding balance
                    return Math.max(0, (Number(order.totalAmount) || 0) - (Number(order.depositAmount) || 0));
                }

                function getDeliveryUrgency(order) {
                    if (!order || !order.deliveryDate || order.status === 'completed' || order.status === 'cancelled') {
                        return { type: 'normal', text: '', cardClass: 'bg-white border-slate-300' };
                    }
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const delivery = new Date(order.deliveryDate); delivery.setHours(0, 0, 0, 0);
                    const diffDays = Math.round((delivery.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        return { type: 'overdue', text: `🚨 เกินกำหนด ${Math.abs(diffDays)} วัน!`, cardClass: 'bg-rose-50/80 border-rose-400 border-l-8 border-l-rose-600' };
                    } else if (diffDays === 0) {
                        return { type: 'today', text: '⚡️ กำหนดจัดส่ง / นัดรับวันนี้!', cardClass: 'bg-amber-50/80 border-amber-400 border-l-8 border-l-amber-500' };
                    }
                    return { type: 'normal', text: `อีก ${diffDays} วัน`, cardClass: 'bg-white border-slate-300' };
                }

                function isFinishedStatus(status) { return status === 'completed' || status === 'cancelled'; }
                const activeOrdersCount = computed(() => orders.value.filter(o => !isFinishedStatus(o.status)).length);
                const statusCounts = computed(() => {
                    const c = { pending: 0, in_progress: 0, ready: 0 };
                    orders.value.forEach(o => { if (c[o.status] !== undefined) c[o.status]++; });
                    return c;
                });
                const completedCount = computed(() => orders.value.filter(o => o.status === 'completed').length);
                const cancelledCount = computed(() => orders.value.filter(o => o.status === 'cancelled').length);
                // Order counting: all-time, this month, and a custom month range (by order date; cancelled shown separately)
                const monthKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                const orderMonthOf = (o) => String(o.orderDate || '').slice(0, 7);
                const fmtMonth = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' }); };
                const totalOrderCount = computed(() => orders.value.length - cancelledCount.value);
                const thisMonthCount = computed(() => {
                    const k = monthKey(new Date());
                    return orders.value.filter(o => o.status !== 'cancelled' && orderMonthOf(o) === k).length;
                });
                // เลขออเดอร์ใหม่: ออเดอร์ที่ = ลำดับทั้งหมด / คิวที่ = ลำดับในเดือนของวันที่สั่ง
                // ใช้ค่าที่มากกว่าระหว่าง "จำนวนที่มี" กับ "เลขสูงสุดที่มี" แล้ว +1 กันเลขซ้ำเวลามีการลบออเดอร์กลางทาง (ออเดอร์ที่ยกเลิกยังนับรวม)
                const padNo = (n) => String(n).padStart(2, '0');
                const maxNumeric = (list, key) => list.reduce((mx, o) => { const v = String(o[key] == null ? '' : o[key]).trim(); return /^\d+$/.test(v) ? Math.max(mx, Number(v)) : mx; }, 0);
                const nextOrderNo = () => padNo(Math.max(orders.value.length, maxNumeric(orders.value, 'orderNo')) + 1);
                const nextQueueNo = (dateStr) => {
                    const k = String(dateStr || '').slice(0, 7);
                    const inMonth = orders.value.filter(o => orderMonthOf(o) === k);
                    return padNo(Math.max(inMonth.length, maxNumeric(inMonth, 'queueNo')) + 1);
                };
                const queueManual = ref(false);
                watch(() => form.value.orderDate, (d) => {
                    if (!isModalOpen.value || isEditing.value || queueManual.value || !d) return;
                    form.value.queueNo = nextQueueNo(d);
                });
                const desktopStatusTabs = computed(() => [
                    { k: 'active', t: 'ที่ต้องทำ', count: activeOrdersCount.value, dot: '' },
                    { k: 'pending', t: 'รอดำเนินการ', count: statusCounts.value.pending, dot: 'bg-amber-400' },
                    { k: 'in_progress', t: 'กำลังทำ', count: statusCounts.value.in_progress, dot: 'bg-sky-500' },
                    { k: 'ready', t: 'พร้อมส่ง/รับ', count: statusCounts.value.ready, dot: 'bg-indigo-500' },
                    { k: 'completed', t: 'ส่งสำเร็จ', count: completedCount.value, dot: 'bg-emerald-500' },
                    { k: 'cancelled', t: 'ยกเลิก', count: cancelledCount.value, dot: 'bg-rose-500' },
                    { k: 'all', t: 'รวมที่ยกเลิก', count: orders.value.length, dot: '' }
                ]);
                const typeTabs = [{ k: 'all', t: 'ทุกประเภท' }, { k: 'shipping', t: 'จัดส่งพัสดุ' }, { k: 'pickup', t: 'นัดรับหน้าร้าน' }];
                const hasActiveFilters = computed(() => filterType.value !== 'all' || datePreset.value !== 'all' || statusFilter.value !== 'active' || searchQuery.value.trim() !== '' || unpaidOnly.value);
                function clearAllFilters() { filterType.value = 'all'; datePreset.value = 'all'; statusFilter.value = 'active'; searchQuery.value = ''; unpaidOnly.value = false; }
                function paymentBadge(o) {
                    if (!o || o.status === 'cancelled') return null;
                    const total = Number(o.totalAmount) || 0, paid = Number(o.depositAmount) || 0;
                    if (total <= 0) return null;
                    if (paid >= total) return { text: 'ชำระครบ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
                    if (paid > 0) return { text: 'มัดจำแล้ว', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
                    return { text: 'ยังไม่ชำระ', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
                }
                function statusLabelOf(st) { return ({ pending: 'รอดำเนินการ', in_progress: 'กำลังทำ', ready: 'พร้อมส่ง/รับ', completed: 'ส่งสำเร็จ', cancelled: 'ยกเลิก' })[st] || st; }

                // ===== หน้าปกประจำเดือน =====
                const monthlyCover = ref(null);
                const isMonthlyCoverOpen = ref(false);
                const monthlyCoverKey = ref('');
                const monthlyCoverWithOrders = ref(false);
                const MC_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
                const MC_EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const MC_ROWS_PER_PAGE = 26;
                const MC_ROWS_FIRST_PAGE = 16;
                const mcBE = (y) => Number(y) + 543;
                const mcShortDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m || +m[2] < 1 || +m[2] > 12) return '-'; return (+m[3]) + ' ' + MC_SHORT_MONTHS[+m[2] - 1] + ' ' + String(mcBE(m[1])).slice(-2); };
                const mcSort = (a, b) => (Number(a.queueNo) || 0) - (Number(b.queueNo) || 0) || String(a.orderDate || '').localeCompare(String(b.orderDate || '')) || String(a.id).localeCompare(String(b.id));
                const monthlyCoverOptions = computed(() => {
                    const map = {};
                    orders.value.forEach(o => { const k = orderMonthOf(o); if (/^\d{4}-\d{2}$/.test(k)) map[k] = (map[k] || 0) + 1; });
                    return Object.keys(map).sort().reverse().map(k => {
                        const [y, m] = k.split('-');
                        return { key: k, count: map[k], short: THAI_MONTHS_FULL[+m - 1] + '/' + String(mcBE(y)).slice(-2), label: 'พ.ศ. ' + mcBE(y) };
                    });
                });
                const monthlyCoverData = computed(() => {
                    const key = monthlyCover.value;
                    if (!key) return null;
                    const [y, m] = key.split('-');
                    const list = orders.value.filter(o => orderMonthOf(o) === key).slice().sort(mcSort);
                    const live = list.filter(o => o.status !== 'cancelled');
                    const sum = (arr, f) => arr.reduce((t, o) => t + (Number(f(o)) || 0), 0);
                    const byStatus = { pending: 0, in_progress: 0, ready: 0, completed: 0, cancelled: 0 };
                    list.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });
                    const range = (vals) => vals.length ? (Math.min(...vals) === Math.max(...vals) ? padNo(vals[0]) : padNo(Math.min(...vals)) + ' – ' + padNo(Math.max(...vals))) : '-';
                    const nums = (k) => list.map(o => parseInt(o[k], 10)).filter(n => !isNaN(n));
                    const dates = list.map(o => o.orderDate).filter(Boolean).sort();
                    const rows = list.map(o => ({
                        id: o.id, queue: o.queueNo || '-', no: o.orderNo || '-', date: mcShortDate(o.orderDate),
                        customer: o.customerName || '-', type: o.deliveryType === 'shipping' ? 'พัสดุ' : 'หน้าร้าน', due: mcShortDate(o.deliveryDate),
                        total: o.totalAmount, paid: o.depositAmount, remain: getRemainingBalance(o), status: statusLabelOf(o.status), cancelled: o.status === 'cancelled'
                    }));
                    const pages = [];
                    pages.push(rows.slice(0, MC_ROWS_FIRST_PAGE));
                    for (let i = MC_ROWS_FIRST_PAGE; i < rows.length; i += MC_ROWS_PER_PAGE) pages.push(rows.slice(i, i + MC_ROWS_PER_PAGE));
                    const mName = THAI_MONTHS_FULL[+m - 1];
                    const adv = mName.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
                    const monthPt = adv <= 5 ? 92 : adv <= 6 ? 84 : adv <= 7 ? 74 : 66;
                    const period = '1 – ' + new Date(+y, +m, 0).getDate() + ' ' + mName + ' ' + mcBE(y);
                    return {
                        monthPt, period,
                        docNo: 'WO-' + mcBE(y) + '-' + m, monthName: THAI_MONTHS_FULL[+m - 1], monthEn: MC_EN_MONTHS[+m - 1],
                        be: mcBE(y), ce: y, yy: String(mcBE(y)).slice(-2), printDate: mcShortDate(localDateString()),
                        total: list.length, byStatus, sales: sum(live, o => o.totalAmount), paid: sum(live, o => o.depositAmount), due: sum(live, o => getRemainingBalance(o)),
                        shipping: list.filter(o => o.deliveryType === 'shipping').length, pickup: list.filter(o => o.deliveryType !== 'shipping').length,
                        noRange: range(nums('orderNo')), queueRange: range(nums('queueNo')),
                        dateRange: dates.length ? (dates[0] === dates[dates.length - 1] ? mcShortDate(dates[0]) : mcShortDate(dates[0]) + ' – ' + mcShortDate(dates[dates.length - 1])) : '-',
                        pages
                    };
                });
                function openMonthlyCoverModal() {
                    const opts = monthlyCoverOptions.value;
                    if (!opts.some(o => o.key === monthlyCoverKey.value)) {
                        const cur = monthKey(new Date());
                        monthlyCoverKey.value = (opts.find(o => o.key === cur) || opts[0] || { key: '' }).key;
                    }
                    isMonthlyCoverOpen.value = true;
                }
                function printMonthlyCover() {
                    const key = monthlyCoverKey.value;
                    if (!key) { showToast('กรุณาเลือกเดือนก่อนครับ'); return; }
                    monthlyCover.value = key;
                    ordersToPrint.value = monthlyCoverWithOrders.value
                        ? orders.value.filter(o => orderMonthOf(o) === key && o.status !== 'cancelled').slice().sort(mcSort)
                        : [];
                    isMonthlyCoverOpen.value = false;
                    computePrintScales().then(() => { window.print(); });
                }
                const queueOpen = ref(true);
                const todayQueue = computed(() => {
                    const t = getTodayString(0);
                    return orders.value
                        .filter(o => !isFinishedStatus(o.status) && o.deliveryDate === t)
                        .sort((a, b) => (a.deliveryTime || '99:99').localeCompare(b.deliveryTime || '99:99') || String(a.queueNo || '').localeCompare(String(b.queueNo || '')));
                });
                const overdueCount = computed(() => orders.value.filter(o => !isFinishedStatus(o.status) && getDeliveryUrgency(o).type === 'overdue').length);
                function jumpToOrder(o) {
                    if (!filteredOrders.value.some(x => x.id === o.id)) clearAllFilters();
                    nextTick(() => {
                        const el = document.getElementById('order-row-' + o.id);
                        if (!el) return;
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('flash-highlight');
                        setTimeout(() => el.classList.remove('flash-highlight'), 1800);
                    });
                }
                const isMoreMenuOpen = ref(false);
                const cardMoreId = ref(null); // which order card's "⋯" menu is open (desktop)
                document.addEventListener('click', () => { isMoreMenuOpen.value = false; cardMoreId.value = null; });
                document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { isMoreMenuOpen.value = false; cardMoreId.value = null; } });
                const isRangeOpen = ref(false);
                watch(isRangeOpen, (open) => { document.body.style.overflow = open ? 'hidden' : ''; });
                const rangeFrom = ref('');
                const rangeTo = ref('');
                const effectiveRange = computed(() => {
                    let a = rangeFrom.value, b = rangeTo.value;
                    if (!a && !b) return null;
                    if (!a) a = b;
                    if (!b) b = a; // only one end picked -> that single month
                    return a <= b ? { from: a, to: b } : { from: b, to: a }; // swapped ends are fixed automatically
                });
                const rangeLabel = computed(() => {
                    const r = effectiveRange.value;
                    if (!r) return '';
                    return r.from === r.to ? fmtMonth(r.from) : fmtMonth(r.from) + ' – ' + fmtMonth(r.to);
                });
                const rangeStats = computed(() => {
                    const r = effectiveRange.value;
                    if (!r) return null;
                    const inRange = orders.value.filter(o => { const m = orderMonthOf(o); return m && m >= r.from && m <= r.to; });
                    const cancelled = inRange.filter(o => o.status === 'cancelled').length;
                    const completed = inRange.filter(o => o.status === 'completed').length;
                    return { count: inRange.length - cancelled, completed, cancelled };
                });
                function setRangePreset(kind) {
                    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
                    if (kind === 'thisMonth') { rangeFrom.value = rangeTo.value = monthKey(now); }
                    else if (kind === 'lastMonth') { rangeFrom.value = rangeTo.value = monthKey(new Date(y, m - 1, 1)); }
                    else if (kind === 'last3') { rangeFrom.value = monthKey(new Date(y, m - 2, 1)); rangeTo.value = monthKey(now); }
                    else if (kind === 'year') { rangeFrom.value = y + '-01'; rangeTo.value = y + '-12'; }
                    else if (kind === 'all') {
                        const ms = orders.value.map(orderMonthOf).filter(Boolean).sort();
                        if (!ms.length) return;
                        rangeFrom.value = ms[0]; rangeTo.value = ms[ms.length - 1];
                    }
                }
                function clearRange() { rangeFrom.value = ''; rangeTo.value = ''; }
                const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending' || o.status === 'in_progress').length);
                const pickupCount = computed(() => orders.value.filter(o => o.deliveryType === 'pickup' && o.status !== 'cancelled').length);
                const shippingCount = computed(() => orders.value.filter(o => o.deliveryType === 'shipping' && o.status !== 'cancelled').length);
                const totalDepositSum = computed(() => orders.value.reduce((sum, o) => sum + (o.status === 'cancelled' ? 0 : (Number(o.depositAmount) || 0)), 0));
                const totalRemainingSum = computed(() => orders.value.reduce((sum, o) => sum + getRemainingBalance(o), 0));
                const formRemainingAmount = computed(() => {
                    const total = formItemizedMode.value ? formItemsGrandTotal.value : (Number(form.value.totalAmount) || 0);
                    return Math.max(0, total - (Number(form.value.depositAmount) || 0));
                });
                const formHasPayments = computed(() => isEditing.value && Array.isArray(form.value.payments) && form.value.payments.length > 0);

                const formItemsTotal = computed(() => {
                    return (form.value.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
                });

                const formItemsGrandTotal = computed(() => {
                    const shippingFee = form.value.deliveryType === 'shipping' ? (Number(form.value.shippingFee) || 0) : 0;
                    return formItemsTotal.value + shippingFee;
                });

                function toggleFormItemizedMode() {
                    formItemizedMode.value = !formItemizedMode.value;
                    if (formItemizedMode.value && (!form.value.items || form.value.items.length === 0)) {
                        // Seed with one row from whatever's already in the free-text products field
                        form.value.items = [{ id: Date.now(), details: form.value.products || '', qty: 1, unit: 'ช่อ', price: form.value.totalAmount || 0 }];
                    }
                }

                // ===== เติมสินค้าจากหน้าร้าน (เฟส 1: ค้นแล้วเลือก เติมชื่อ/ราคา/หน่วยให้) =====
                // สินค้าที่มีหลายแบบ (หลายราคา) เติมแค่ชื่อ แล้วให้กรอกราคาเอง — เฟส 2 จะเพิ่มตัวเลือกแบบ
                const productCatalog = ref([]);
                const suggestForId = ref(null);
                const suggestIndex = ref(-1);
                const UNIT_BY_CAT = { 'ช่อดอกไม้': 'ช่อ', 'กรอบรูป': 'กรอบ', 'กระถาง': 'กระถาง' };

                function toOrderProduct(p) {
                    if (!p || typeof p !== 'object') return null;
                    const name = String(p.name || '').trim();
                    if (!name) return null;
                    const prices = (Array.isArray(p.variants) ? p.variants : []).map(v => Number(v && v.price)).filter(n => n > 0);
                    const single = Number(p.price) > 0 ? Number(p.price) : null;
                    let price = null, priceLabel = 'ใส่ราคาเอง';
                    if (prices.length) {
                        const lo = Math.min(...prices), hi = Math.max(...prices);
                        priceLabel = lo === hi ? '฿' + formatNumber(lo) + ' (หลายแบบ)' : '฿' + formatNumber(lo) + '–' + formatNumber(hi) + ' (หลายแบบ)';
                    } else if (single != null) {
                        price = single; priceLabel = '฿' + formatNumber(single);
                    }
                    // รูปหลักของสินค้า (เฉพาะสินค้าที่มีรูปที่ตัวสินค้าเอง — สินค้าหลายแบบรูปขึ้นกับแบบ ไว้เฟส 2)
                    // หารูปตามลำดับ: image → images[0] → รูปแรกในรายการสี/แบบ (colors) → รูปของตัวเลือกหลายราคา (variants) แบบราคาถูกสุด
                    const imgOf = (o) => !o ? '' : (typeof o.image === 'string' && o.image.trim()) ? o.image.trim()
                        : (Array.isArray(o.images) && typeof o.images[0] === 'string' ? o.images[0].trim() : '');
                    let rawImg = imgOf(p);
                    if (!rawImg && Array.isArray(p.colors)) {
                        for (const c of p.colors) { rawImg = imgOf(c); if (rawImg) break; }
                    }
                    if (!rawImg && Array.isArray(p.variants)) {
                        const withImg = p.variants.filter(v => imgOf(v)).sort((a, b) => (Number(a.price) || 1e12) - (Number(b.price) || 1e12));
                        if (withImg.length) rawImg = imgOf(withImg[0]);
                    }
                    const image = (rawImg && !/^(https?:|data:)/i.test(rawImg)) ? encodeURI(rawImg.replace(/\\/g, '/')) : rawImg; // บางรายการเก็บ path แบบ \\ ต้องแปลงเป็น /
                    const fixPath = (r) => (r && !/^(https?:|data:)/i.test(r)) ? encodeURI(r.replace(/\\/g, '/')) : r;
                    const variants = (Array.isArray(p.variants) ? p.variants : [])
                        .filter(v => v && Number(v.price) > 0)
                        .map(v => ({
                            label: (Array.isArray(v.match) && v.match.length ? v.match.join(', ') : String(v.tag || '')).trim(),
                            price: Number(v.price),
                            image: fixPath(imgOf(v))
                        }))
                        .sort((a, b) => a.price - b.price);
                    const samePrice = variants.length && variants.every(v => v.price === variants[0].price) ? variants[0].price : null;
                    const normAddons = (arr) => (Array.isArray(arr) ? arr : [])
                        .filter(a => a && String(a.name || '').trim())
                        .map(a => ({ name: String(a.name).trim(), price: Number(a.price) || 0 }));
                    // ตัวเลือกให้กดเลือก: แบบหลายราคา (variants) ก่อน ถ้าไม่มีใช้รายการสี/แบบ (colors) ที่ราคาเดียวกัน
                    let choices = variants;
                    if (!choices.length && Array.isArray(p.colors) && p.colors.length > 1) {
                        choices = p.colors.filter(c => c && String(c.name || '').trim()).map(c => ({
                            label: String(c.name).trim(), price: null, image: fixPath(imgOf(c)), addons: normAddons(c.addons)
                        }));
                    }
                    return {
                        id: String(p.id || name), name, price, priceLabel, image, variants, samePrice,
                        choices, addons: normAddons(p.addons), cat: String(p.cat || ''), flowerType: String(p.flowerType || ''),
                        unit: UNIT_BY_CAT[p.cat] || '',
                        hay: [p.id, name, p.flowerType, p.cat].filter(Boolean).join(' ').toLowerCase()
                    };
                }

                async function loadProductCatalog() {
                    let list = null;
                    try {
                        const snap = await db.collection('catalog').doc('products').get();
                        if (snap.exists) {
                            const d = snap.data() || {};
                            list = typeof d.json === 'string' ? JSON.parse(d.json) : d.list;
                        }
                    } catch (err) { console.warn('โหลดสินค้าจาก Firestore ไม่ได้ จะลองใช้ products.json', err); }
                    if (!Array.isArray(list) || !list.length) {
                        try {
                            const r = await fetch('products.json', { cache: 'no-cache' });
                            if (r.ok) list = await r.json();
                        } catch (err) { console.warn('โหลด products.json ไม่ได้', err); }
                    }
                    const products = (Array.isArray(list) ? list : []).map(toOrderProduct).filter(Boolean);
                    // ของเสริม (เช่น กล่องใส่กรอบรูป) ให้ค้นหา/เลือกได้เองด้วย — รวมชื่อ+ราคาที่ซ้ำกัน
                    const addonSeen = new Set();
                    products.slice().forEach(pr => {
                        const all = [...(pr.addons || [])];
                        (pr.choices || []).forEach(ch => (ch.addons || []).forEach(a => all.push(a)));
                        all.forEach(a => {
                            const key = a.name + '|' + a.price;
                            if (addonSeen.has(key)) return;
                            addonSeen.add(key);
                            products.push({
                                id: 'addon:' + key, name: a.name, price: a.price, priceLabel: '฿' + formatNumber(a.price) + ' (ของเสริม)',
                                image: '', variants: [], samePrice: null, choices: [], addons: [], cat: 'ของเสริม', flowerType: '',
                                unit: 'ชิ้น', hay: (a.name + ' ของเสริม').toLowerCase()
                            });
                        });
                    });
                    productCatalog.value = products;
                }

                function suggestionsFor(item) { return searchCatalog(item.details); }
                function searchCatalog(text) {
                    const q = String(text || '').toLowerCase().trim();
                    if (!q) return [];
                    const tokens = q.split(/\s+/);
                    const all = productCatalog.value;
                    if (all.some(p => p.name.toLowerCase() === q)) return []; // เลือกไปแล้ว ไม่ต้องเสนออีก
                    const score = (p) => (p.id.toLowerCase() === q ? 3 : p.id.toLowerCase().startsWith(q) ? 2 : p.name.toLowerCase().startsWith(q) ? 1 : 0);
                    return all.filter(p => tokens.every(t => p.hay.includes(t)))
                        .sort((a, b) => score(b) - score(a))
                        .slice(0, 8);
                }

                function onItemInput(item) {
                    formErrors.value.items = '';
                    suggestForId.value = item.id;
                    suggestIndex.value = -1;
                }
                function onItemFocus(item) {
                    if (String(item.details || '').trim()) { suggestForId.value = item.id; suggestIndex.value = -1; }
                }
                function onItemKeydown(e, item) {
                    if (e.isComposing || e.ctrlKey || e.metaKey) return;
                    if (suggestForId.value !== item.id) return;
                    const list = suggestionsFor(item);
                    if (!list.length) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); suggestIndex.value = (suggestIndex.value + 1) % list.length; }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIndex.value = suggestIndex.value <= 0 ? list.length - 1 : suggestIndex.value - 1; }
                    else if (e.key === 'Enter' && suggestIndex.value >= 0 && list[suggestIndex.value]) {
                        // เลือกรายการที่ไฮไลต์ไว้ (ถ้ายังไม่ได้กดลูกศรลง Enter จะทำงานตามเดิม = ไปช่องถัดไป)
                        e.preventDefault(); e.stopPropagation();
                        pickProduct(item, list[suggestIndex.value]);
                    }
                    else if (e.key === 'Escape') { e.stopPropagation(); suggestForId.value = null; }
                }
                // ใส่รูปสินค้าที่เลือกลงช่อง "รูปภาพตัวอย่าง" (เก็บเป็น path ของรูปบนเว็บ ไม่ซ้ำ ไม่เกิน MAX_ORDER_IMAGES)
                // ===== เฟส 3: ของเสริม + เลือกจากหน้าร้านตามหมวด =====
                const itemMeta = ref({}); // item.id -> { pid, choice } หรือ { addonOf, name } (แถวที่เพิ่มจากของเสริม)
                function setItemMeta(id, meta) { itemMeta.value = { ...itemMeta.value, [id]: meta }; }
                function newFormItemRow(props) {
                    form.value.items.push({ id: Date.now() + Math.random(), details: '', qty: 1, unit: 'ช่อ', price: '', ...props });
                    return form.value.items[form.value.items.length - 1];
                }
                function addonsFor(item) {
                    const m = itemMeta.value[item.id];
                    if (!m || !m.pid) return [];
                    const p = productCatalog.value.find(x => x.id === m.pid);
                    if (!p) return [];
                    let list = p.addons;
                    if (p.choices && p.choices.length) {
                        const c = m.choice ? p.choices.find(x => x.label === m.choice) : null;
                        if (c && c.addons && c.addons.length) list = c.addons;
                        else if (!list.length) { // ยังไม่ได้เลือกสี: ใช้ของเสริมที่พบในสีต่างๆ (ไม่ซ้ำชื่อ)
                            const seen = new Set(); list = [];
                            p.choices.forEach(ch => (ch.addons || []).forEach(a => { if (!seen.has(a.name)) { seen.add(a.name); list.push(a); } }));
                        }
                    }
                    return list.filter(a => !form.value.items.some(r => { const rm = itemMeta.value[r.id]; return rm && rm.addonOf === item.id && rm.name === a.name; }));
                }
                function addAddon(item, a) {
                    const idx = form.value.items.findIndex(r => r.id === item.id);
                    if (idx === -1) return;
                    const id = Date.now() + Math.random();
                    form.value.items.splice(idx + 1, 0, { id, details: a.name, qty: Number(item.qty) > 0 ? item.qty : 1, unit: 'ชิ้น', price: a.price });
                    setItemMeta(id, { addonOf: item.id, name: a.name });
                    formErrors.value.items = '';
                }
                const quick = ref({ cat: '', type: '' });
                const QUICK_CAT_ORDER = ['ช่อดอกไม้', 'กรอบรูป', 'กระถาง', 'อื่นๆ'];
                const quickCats = computed(() => {
                    const have = [...new Set(productCatalog.value.map(p => p.cat).filter(Boolean))];
                    return have.sort((a, b) => {
                        const ia = QUICK_CAT_ORDER.indexOf(a), ib = QUICK_CAT_ORDER.indexOf(b);
                        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                    });
                });
                const quickTypes = computed(() => {
                    if (!quick.value.cat) return [];
                    const count = {};
                    productCatalog.value.filter(p => p.cat === quick.value.cat && p.flowerType).forEach(p => { count[p.flowerType] = (count[p.flowerType] || 0) + 1; });
                    return Object.keys(count).sort((a, b) => count[b] - count[a]);
                });
                const quickList = computed(() => productCatalog.value.filter(p => p.cat === quick.value.cat && (!quick.value.type || p.flowerType === quick.value.type)));
                function toggleQuickCat(c) { quick.value = quick.value.cat === c ? { cat: '', type: '' } : { cat: c, type: '' }; }
                function pickFromQuick(p) {
                    const last = form.value.items[form.value.items.length - 1];
                    const target = (last && !String(last.details || '').trim() && !(Number(last.price) > 0)) ? last : newFormItemRow({});
                    quick.value = { cat: '', type: '' };
                    pickProduct(target, p);
                    nextTick(() => {
                        const el = document.querySelector('[data-item-details="' + target.id + '"]');
                        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    });
                }

                // ===== เฟส 2: เลือกแบบ/ราคา สำหรับสินค้าที่มีหลายแบบ =====
                const variantPanel = ref({ itemId: null, p: null });
                function closeVariantPanel() { variantPanel.value = { itemId: null, p: null }; }
                document.addEventListener('mousedown', (e) => {
                    if (variantPanel.value.itemId && !(e.target.closest && e.target.closest('[data-variant-panel]'))) closeVariantPanel();
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && variantPanel.value.itemId) { e.stopPropagation(); closeVariantPanel(); }
                }, true);
                function pickVariant(item, p, v) {
                    item.details = v.label ? p.name + ' (' + v.label + ')' : p.name;
                    if (v.price != null) item.price = v.price;
                    if (p.unit) item.unit = p.unit;
                    setItemMeta(item.id, { pid: p.id, choice: v.label });
                    addProductImageToForm(item, { image: v.image || p.image });
                    closeVariantPanel();
                    formErrors.value.items = '';
                    nextTick(() => {
                        const el = document.querySelector('[data-item-qty="' + item.id + '"]');
                        if (el) { el.focus(); try { el.select(); } catch (_) {} }
                    });
                }

                // จำว่ารูปไหนระบบเติมให้แถวสินค้าแถวไหน (item.id -> url) เพื่อเปลี่ยน/ลบรูปตามเมื่อแถวเปลี่ยนสินค้าหรือถูกลบ
                // รูปที่แนบเอง หรือรูปที่ผู้ใช้หมุนแล้ว จะไม่ถูกแตะ
                const autoImageByItem = new Map();
                function releaseAutoImage(itemId) {
                    const url = autoImageByItem.get(itemId);
                    if (url === undefined) return;
                    autoImageByItem.delete(itemId);
                    for (const u of autoImageByItem.values()) { if (u === url) return; } // แถวอื่นยังใช้รูปนี้อยู่
                    const imgs = form.value.images || [];
                    const idx = imgs.findIndex(im => im && im.url === url && !im.rotation);
                    if (idx !== -1) imgs.splice(idx, 1);
                }
                function addProductImageToForm(item, p) {
                    if (!Array.isArray(form.value.images)) form.value.images = [];
                    const imgs = form.value.images;
                    // เลือกสินค้าเดิมซ้ำ และรูปยังอยู่ — ไม่ต้องทำอะไร
                    if (p && p.image && autoImageByItem.get(item.id) === p.image && imgs.some(im => im && im.url === p.image)) return;
                    releaseAutoImage(item.id); // เปลี่ยนสินค้าในแถวนี้ — เอารูปเก่าที่ระบบเติมให้ออกก่อน
                    if (!p || !p.image) return;
                    if (imgs.some(im => im && im.url === p.image)) {
                        // มีรูปนี้อยู่แล้ว: ถ้าเป็นรูปที่แถวอื่นเติมไว้ ให้ผูกกับแถวนี้ด้วย (ถ้าแนบเอง ไม่ผูก จะได้ไม่ถูกลบ)
                        for (const u of autoImageByItem.values()) { if (u === p.image) { autoImageByItem.set(item.id, p.image); break; } }
                        return;
                    }
                    if (imgs.length >= MAX_ORDER_IMAGES) {
                        showToast(`รูปตัวอย่างเต็ม ${MAX_ORDER_IMAGES} รูปแล้ว ไม่ได้เพิ่มรูปสินค้านี้ให้ครับ`);
                        return;
                    }
                    imgs.push({ url: p.image, rotation: 0 });
                    autoImageByItem.set(item.id, p.image);
                }
                function pickProduct(item, p) {
                    item.details = p.name;
                    const hasChoices = !!(p.choices && p.choices.length);
                    // เปลี่ยนสินค้าในแถวนี้ — แถวของเสริมที่เคยเพิ่มไว้ของสินค้าเก่า ยังอยู่ (ลบเองได้) แต่ไม่ผูกกับแถวนี้แล้ว เพื่อให้ปุ่มของเสริมของสินค้าใหม่ขึ้นครบ
                    if (Object.values(itemMeta.value).some(m => m && m.addonOf === item.id)) {
                        const nm = {};
                        for (const [k, m] of Object.entries(itemMeta.value)) { if (!(m && m.addonOf === item.id)) nm[k] = m; }
                        itemMeta.value = nm;
                    }
                    setItemMeta(item.id, { pid: p.id, choice: '' });
                    if (p.price != null) item.price = p.price;
                    else item.price = (p.samePrice != null) ? p.samePrice : ''; // ไม่ให้ราคาเก่าของสินค้าก่อนหน้าค้างอยู่
                    if (p.unit) item.unit = p.unit;
                    suggestForId.value = null;
                    suggestIndex.value = -1;
                    formErrors.value.items = '';
                    addProductImageToForm(item, p);
                    if (hasChoices) { variantPanel.value = { itemId: item.id, p }; return; } // เปิดตัวเลือกแบบ/สีให้กดเลือก
                    closeVariantPanel();
                    nextTick(() => {
                        const el = document.querySelector('[data-item-' + (p.price != null ? 'qty' : 'price') + '="' + item.id + '"]');
                        if (el) { el.focus(); try { el.select(); } catch (_) {} }
                    });
                }

                function addFormItem() {
                    const id = Date.now() + Math.random();
                    form.value.items.push({ id, details: '', qty: 1, unit: 'ช่อ', price: '' });
                    nextTick(() => {
                        const el = document.querySelector('[data-item-details="' + id + '"]');
                        if (el) el.focus();
                    });
                }

                // Old orders saved as free text (no item rows): split the text into rows and keep the total unchanged
                function seedItemsFromOrder(order) {
                    const ship = order.deliveryType === 'shipping' ? (Number(order.shippingFee) || 0) : 0;
                    const base = Math.max(0, (Number(order.totalAmount) || 0) - ship);
                    const lines = String(order.products || '').split('\n').map(t => t.trim()).filter(Boolean);
                    if (!lines.length) lines.push('');
                    return lines.map((t, idx) => ({ id: Date.now() + idx + Math.random(), details: t, qty: 1, unit: 'ช่อ', price: idx === 0 && base ? base : '' }));
                }

                function removeFormItem(id) {
                    if (form.value.items.length <= 1) return;
                    releaseAutoImage(id);
                    if (variantPanel.value.itemId === id) closeVariantPanel();
                    if (itemMeta.value[id]) { const m = { ...itemMeta.value }; delete m[id]; itemMeta.value = m; }
                    form.value.items = form.value.items.filter(i => i.id !== id);
                }

                const filteredOrders = computed(() => {
                    const todayStr = getTodayString(0);
                    const tomorrowStr = getTodayString(1);

                    return orders.value.filter(order => {
                        const q = searchQuery.value.toLowerCase().trim();
                        const matchesSearch = !q || order.customerName.toLowerCase().includes(q) || order.products.toLowerCase().includes(q) || (order.customerPhone && order.customerPhone.includes(q)) || (order.trackingNumber && order.trackingNumber.toLowerCase().includes(q));
                        let matchesFilter = filterType.value === 'all' || order.deliveryType === filterType.value;
                        // 'active' = everything not completed/cancelled. While searching, look across every status
                        // so an older (hidden) order can still be found by name/phone/tracking number.
                        let matchesStatus = statusFilter.value === 'all'
                            || (statusFilter.value === 'active' && unpaidOnly.value && getRemainingBalance(order) > 0) // unpaid view also lists completed-but-unpaid orders
                            || (statusFilter.value === 'active'
                                ? (q !== '' || !isFinishedStatus(order.status))
                                : order.status === statusFilter.value);
                        let matchesDate = datePreset.value === 'all' || (datePreset.value === 'today' && order.deliveryDate === todayStr) || (datePreset.value === 'tomorrow' && order.deliveryDate === tomorrowStr) || (datePreset.value === 'overdue' && getDeliveryUrgency(order).type === 'overdue');
                        return matchesSearch && matchesFilter && matchesStatus && matchesDate && (!unpaidOnly.value || getRemainingBalance(order) > 0);
                    }).sort((a, b) => {
                        // Finished orders (completed/cancelled) always sink to the bottom, regardless of
                        // sort mode, so the active work stays uncluttered at the top of the list.
                        const aDone = (a.status === 'completed' || a.status === 'cancelled') ? 1 : 0;
                        const bDone = (b.status === 'completed' || b.status === 'cancelled') ? 1 : 0;
                        if (aDone !== bDone) return aDone - bDone;

                        if (sortBy.value === 'delivery_asc') {
                            const ad = a.deliveryDate ? new Date(a.deliveryDate).getTime() : Infinity;
                            const bd = b.deliveryDate ? new Date(b.deliveryDate).getTime() : Infinity;
                            if (ad !== bd) return ad < bd ? -1 : 1;
                            const at = a.deliveryTime || '99:99', bt = b.deliveryTime || '99:99';
                            return at === bt ? 0 : (at < bt ? -1 : 1);
                        }
                        if (sortBy.value === 'order_desc' || sortBy.value === 'order_asc') {
                            // เรียงตามวันที่สั่ง (ถ้าวันเดียวกันใช้ id ตัดสิน) ออเดอร์ที่ไม่มีวันที่สั่งไปท้ายสุด
                            const ao = String(a.orderDate || ''), bo = String(b.orderDate || '');
                            if (!ao !== !bo) return ao ? -1 : 1;
                            const dir = sortBy.value === 'order_desc' ? -1 : 1;
                            if (ao !== bo) return (ao < bo ? -1 : 1) * dir;
                            return String(a.id).localeCompare(String(b.id)) * dir;
                        }
                        if (sortBy.value === 'remaining_desc') return getRemainingBalance(b) - getRemainingBalance(a);
                        return 0;
                    });
                });

                // ---------- ลิงก์ Google Maps จุดนัดรับ ----------
                function normalizeMapLink(v) {
                    v = String(v || '').trim();
                    if (!v) return '';
                    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
                    return v;
                }
                function isGoogleMapsLink(v) {
                    try {
                        const u = new URL(normalizeMapLink(v));
                        const h = u.hostname.toLowerCase();
                        const p = u.pathname.toLowerCase();
                        if (h === 'maps.app.goo.gl' || h === 'maps.google.com') return true;
                        if (h === 'goo.gl' || h === 'www.goo.gl') return p.startsWith('/maps');
                        return /^(www\.)?google\.[a-z.]+$/.test(h) && p.startsWith('/maps');
                    } catch (e) { return false; }
                }
                // ลิงก์ที่ใช้เปิดแผนที่: ใช้ mapLink ก่อน ออเดอร์เก่าที่มีแต่พิกัด lat/lng ยังเปิดได้
                function mapUrlOf(order) {
                    if (!order) return '';
                    const link = normalizeMapLink(order.mapLink);
                    if (link) return link;
                    if (order.lat && order.lng) return `https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lng}`;
                    return '';
                }

                function formatNumber(num) { return new Intl.NumberFormat('th-TH').format(num || 0); }
                function deliveryLabel(d) { return d ? formatDate(d) : 'ยังไม่กำหนดวัน'; }
                function timeSuffix(o) { return (o && o.deliveryType === 'pickup' && o.deliveryDate && o.deliveryTime) ? ' · ' + o.deliveryTime + ' น.' : ''; }
                function formatDate(dateStr) {
                    if (!dateStr) return '-';
                    return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
                }

                function getStatusClass(status) {
                    switch (status) {
                        case 'pending': return 'bg-amber-50 text-amber-800 border-amber-300';
                        case 'in_progress': return 'bg-sky-50 text-sky-800 border-sky-300';
                        case 'ready': return 'bg-indigo-50 text-indigo-800 border-indigo-300';
                        case 'completed': return 'bg-emerald-50 text-emerald-800 border-emerald-300';
                        case 'cancelled': return 'bg-slate-100 text-slate-500 border-slate-300';
                        default: return 'bg-slate-50 text-slate-700 border-slate-200';
                    }
                }

                function getProgressWidth(status) {
                    return status === 'pending' ? 0 : status === 'in_progress' ? 33 : status === 'ready' ? 66 : 100;
                }
                function isStepActive(currentStatus, step) {
                    const steps = ['pending', 'in_progress', 'ready', 'completed'];
                    return steps.indexOf(step) <= steps.indexOf(currentStatus);
                }
                function getProgressColor(status) { return status === 'completed' ? 'bg-emerald-400' : 'bg-pink-400'; }
                function getProgressDotColor(status) { return status === 'completed' ? 'bg-emerald-500 border-emerald-500' : 'bg-pink-500 border-pink-500'; }

                const unpaidConfirm = ref(null);
                function handleStatusChange(order, event) {
                    const newStatus = event.target.value;
                    // Marking as completed while money is still owed: ask first, and snap the dropdown back until the user decides
                    if (newStatus === 'completed' && order.status !== 'completed' && getRemainingBalance(order) > 0) {
                        event.target.value = order.status;
                        unpaidConfirm.value = {
                            id: order.id, name: order.customerName || '',
                            total: Number(order.totalAmount) || 0,
                            paid: Number(order.depositAmount) || 0,
                            remaining: getRemainingBalance(order)
                        };
                        return;
                    }
                    applyStatusChange(order, newStatus);
                }
                function resolveUnpaid(choice) {
                    const u = unpaidConfirm.value;
                    unpaidConfirm.value = null;
                    if (!u || choice === 'cancel') return;
                    const order = orders.value.find(o => o.id === u.id);
                    if (!order) return;
                    applyStatusChange(order, 'completed', choice === 'paid' ? { payRemaining: true } : null);
                }
                function applyStatusChange(order, newStatus, opts) {
                    const payRemaining = !!(opts && opts.payRemaining);
                    const prev = { status: order.status, completedAt: order.completedAt || '' };
                    order.status = newStatus;
                    const statusUpdate = { status: newStatus };
                    if (newStatus === 'completed') {
                        statusUpdate.completedAt = localDateString();
                    } else if (order.completedAt) {
                        statusUpdate.completedAt = '';
                    }
                    order.completedAt = statusUpdate.completedAt !== undefined ? statusUpdate.completedAt : order.completedAt;
                    let doneMsg = 'อัปเดตสถานะเรียบร้อย';
                    if (statusFilter.value === 'active' && isFinishedStatus(newStatus)) {
                        // The card is about to leave this view — drop it from the print selection and tell the user where it went
                        selectedForPrint.value = selectedForPrint.value.filter(id => id !== order.id);
                        doneMsg = newStatus === 'completed' ? 'ย้ายไปที่ \"ส่งสำเร็จ\" แล้ว' : 'ย้ายไปที่ \"ยกเลิก\" แล้ว';
                    }
                    const back = { status: prev.status, completedAt: prev.completedAt };
                    let write, undoWrite;
                    if (payRemaining) {
                        // รับชำระส่วนที่เหลือ = เพิ่มรายการรับเงินวันนี้ พร้อมเปลี่ยนสถานะในธุรกรรมเดียว
                        const entryId = newPaymentId(), today = localDateString();
                        write = () => mutatePayments(order.id, (list, d) => {
                            const rest = roundMoney((Number(d.totalAmount) || 0) - sumPayments(list));
                            if (rest > 0) list.push({ id: entryId, date: today, amount: rest, method: '', note: 'ชำระส่วนที่เหลือตอนส่งมอบ' });
                        }, statusUpdate);
                        undoWrite = () => mutatePayments(order.id, list => list.filter(p => p.id !== entryId), back);
                    } else {
                        write = () => db.collection('orders').doc(order.id).update(statusUpdate);
                        undoWrite = () => db.collection('orders').doc(order.id).update(back);
                    }
                    write().catch(() => showToast('อัปเดตสถานะไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    showToast(doneMsg, () => {
                        Object.assign(order, back);
                        undoWrite().catch(() => showToast('ย้อนกลับไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                        showToast('ย้อนกลับแล้ว');
                    });
                }

                function showToast(msg, undoFn) {
                    clearTimeout(toastTimer);
                    toastMessage.value = msg;
                    toastUndo.value = undoFn || null;
                    toastTimer = setTimeout(() => { toastMessage.value = ''; toastUndo.value = null; }, undoFn ? 6000 : 3000);
                }
                function runToastUndo() {
                    const fn = toastUndo.value;
                    clearTimeout(toastTimer);
                    toastMessage.value = ''; toastUndo.value = null;
                    if (fn) fn();
                }

                // Work Order Print Functions
                //
                // Each work order must fit on exactly one A4 page even when the product list is long.
                // Rather than letting long content get clipped (the old bug), we briefly render the
                // order off-screen at natural size, measure how tall it really is, and — if it's taller
                // than one page's usable area — shrink it down (uniform scale + compensating width, so
                // text/images stay proportional, not squashed) until it fits exactly one page.
                function computePrintScales() {
                    return new Promise((resolve) => {
                        printScaleMap.value = {};
                        isMeasuringPrint.value = true;
                        nextTick(() => waitForPrintImages().then(() => {
                            const PX_PER_MM = 96 / 25.4;
                            const PAGE_PADDING_PX = 64; // Tailwind p-8 (2rem top + 2rem bottom) on .print-page
                            const budgetPx = (272 * PX_PER_MM) - PAGE_PADDING_PX;
                            const newScales = {};
                            ordersToPrint.value.forEach(order => {
                                const el = document.querySelector(`#printable-work-orders [data-print-order-id="${order.id}"]`);
                                if (!el) return;
                                const naturalHeight = el.scrollHeight;
                                if (naturalHeight > budgetPx) {
                                    newScales[order.id] = budgetPx / naturalHeight;
                                }
                            });
                            printScaleMap.value = newScales;
                            isMeasuringPrint.value = false;
                            // wait for the scaled layout to be applied before the caller opens the print dialog
                            nextTick(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        }));
                    });
                }

                // Wait (max ~3s) until every image in the work-order print area has loaded, so the
                // measured height is the real one even the first time a photo is used.
                function waitForPrintImages() {
                    const imgs = Array.from(document.querySelectorAll('#printable-work-orders img'));
                    const pending = imgs.filter(img => !img.complete);
                    const loaded = Promise.all(pending.map(img => new Promise(res => {
                        img.addEventListener('load', res, { once: true });
                        img.addEventListener('error', res, { once: true });
                    })));
                    const timeout = new Promise(res => setTimeout(res, 3000));
                    return Promise.race([loaded, timeout]).then(() => new Promise(res => requestAnimationFrame(() => res())));
                }

                function getPrintScaleStyle(orderId) {
                    const scale = printScaleMap.value[orderId];
                    if (!scale || scale >= 1) return {};
                    // Widen first, then scale down by the same factor: net width stays 100%,
                    // net height shrinks to fit — content shrinks proportionally, no distortion.
                    return {
                        transform: `scale(${scale})`,
                        width: `${100 / scale}%`
                    };
                }

                function printSingleWorkOrder(order) {
                    monthlyCover.value = null;
                    ordersToPrint.value = [order];
                    computePrintScales().then(() => {
                        window.print();
                    });
                }

                function openBatchPrintModal() {
                    if (selectedForPrint.value.length === 0) {
                        showToast('กรุณาติ๊กเลือกออเดอร์ที่ต้องการพิมพ์ใบสั่งงานก่อนครับ');
                        return;
                    }
                    monthlyCover.value = null;
                    ordersToPrint.value = orders.value.filter(o => selectedForPrint.value.includes(o.id));
                    computePrintScales().then(() => {
                        window.print();
                    });
                }

                function openReceiptModal(order) { receiptTarget.value = order; }
                function triggerPrintReceipt() { window.print(); }

                // Customer Notification Message Functions
                function openMessageModal(order) {
                    messageSourceOrder.value = order;

                    if (order.items && order.items.length > 0) {
                        // Order already has a proper itemized breakdown set at creation time — use it as-is
                        messageItems.value = order.items.map((item, idx) => ({
                            id: Date.now() + idx,
                            details: item.details || '',
                            qty: item.qty || 1,
                            unit: item.unit || 'ช่อ',
                            price: item.price || 0
                        }));
                    } else {
                        const lines = (order.products || '').split('\n').map(l => l.trim()).filter(Boolean);
                        if (lines.length > 1) {
                            // Multiple lines in the order's product description → one item row per line,
                            // price left blank for staff to fill in per item (can't guess how the total splits)
                            messageItems.value = lines.map((line, idx) => ({
                                id: Date.now() + idx,
                                details: line,
                                qty: 1,
                                unit: 'ช่อ',
                                price: 0
                            }));
                        } else {
                            // Single line (or empty) → keep the convenient default of using the order's total as-is
                            messageItems.value = [{
                                id: Date.now(),
                                details: lines[0] || order.products || '',
                                qty: 1,
                                unit: 'ช่อ',
                                price: order.totalAmount || 0
                            }];
                        }
                    }

                    messageForm.value = {
                        shippingMethod: order.deliveryType === 'pickup' ? 'pickup' : 'shipping',
                        shippingFee: order.shippingFee || 0,
                        pickupLocation: order.deliveryType === 'pickup' ? (order.location || '') : '',
                        deliveryDateText: order.deliveryDate ? deliveryLabel(order.deliveryDate) + (order.deliveryType === 'pickup' && order.deliveryTime ? ' เวลา ' + order.deliveryTime + ' น.' : '') : '',
                        paymentMode: order.paymentMode || 'default',
                        fullPay: order.totalAmount || 0,
                        deposit: order.depositAmount || 0,
                        includeNote: true
                    };
                    isMessageModalOpen.value = true;
                    messageMobileTab.value = 'form';
                }

                function closeMessageModal() {
                    isMessageModalOpen.value = false;
                    messageSourceOrder.value = null;
                }

                function addMessageItem() {
                    messageItems.value.push({ id: Date.now() + Math.random(), details: '', qty: 1, unit: 'ช่อ', price: 0 });
                }

                function removeMessageItem(id) {
                    if (messageItems.value.length <= 1) return;
                    messageItems.value = messageItems.value.filter(i => i.id !== id);
                }

                const messageTotal = computed(() => {
                    const subtotal = messageItems.value.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
                    const fee = messageForm.value.shippingMethod === 'shipping' ? (Number(messageForm.value.shippingFee) || 0) : 0;
                    return subtotal + fee;
                });

                // Flags a mismatch between the itemized total (items + shipping) and the order's
                // original totalAmount — most often a sign of shipping being double-counted or an
                // item price left unfilled. null when there's nothing to compare or they already match.
                const messageTotalMismatch = computed(() => {
                    if (!messageSourceOrder.value) return null;
                    const orig = Number(messageSourceOrder.value.totalAmount) || 0;
                    const current = messageTotal.value;
                    if (current === orig) return null;
                    return { orig, current };
                });

                function useComputedTotalAsFullPay() {
                    messageForm.value.fullPay = messageTotal.value;
                }

                async function saveMessageTotalsToOrder() {
                    if (!messageSourceOrder.value || !messageSourceOrder.value.id) return;
                    const newProducts = messageItems.value
                        .map(item => {
                            const label = (item.details || '').trim();
                            if (!label) return null;
                            const qty = Number(item.qty) || 0;
                            return qty > 1 ? `${label} (x${qty} ${item.unit || ''})`.trim() : label;
                        })
                        .filter(Boolean)
                        .join('\n');

                    const itemsToSave = messageItems.value
                        .filter(item => (item.details || '').trim())
                        .map(item => ({ details: item.details, qty: Number(item.qty) || 0, unit: item.unit || '', price: Number(item.price) || 0 }));

                    try {
                        await db.collection('orders').doc(messageSourceOrder.value.id).update({
                            products: newProducts || messageSourceOrder.value.products,
                            items: itemsToSave,
                            totalAmount: messageTotal.value,
                            shippingFee: messageForm.value.shippingMethod === 'shipping' ? (Number(messageForm.value.shippingFee) || 0) : 0,
                            paymentMode: messageForm.value.paymentMode
                        });
                        showToast('บันทึกรายการ/ยอดรวมกลับเข้าออเดอร์แล้ว ✅');
                    } catch (err) {
                        console.error('Save totals to order error:', err);
                        showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ');
                    }
                }

                watch(() => messageForm.value.paymentMode, (mode) => {
                    if (mode === 'cod') {
                        messageForm.value.fullPay = messageTotal.value;
                    }
                });

                const generatedMessage = computed(() => {
                    const totalStr = messageTotal.value.toLocaleString();

                    let itemsText = '';
                    messageItems.value.forEach(item => {
                        const qty = Number(item.qty) || 0;
                        const price = Number(item.price) || 0;
                        const itemTotal = qty * price;
                        itemsText += `🌻💐 ${item.details || ' - '}\n`;
                        if (qty > 1) {
                            itemsText += `จำนวน ${qty} ${item.unit || ''} x ${price.toLocaleString()} บ. = ${itemTotal.toLocaleString()} บาท\n`;
                        } else {
                            itemsText += `จำนวน ${qty} ${item.unit || ''} = ${itemTotal.toLocaleString()} บาท\n`;
                        }
                    });

                    const deliveryDateText = messageForm.value.deliveryDateText || ' - ';
                    let shippingText = '', transportNotice = '', dateText = '';
                    if (messageForm.value.shippingMethod === 'shipping') {
                        const fee = Number(messageForm.value.shippingFee) || 0;
                        const feeText = fee === 0 ? 'ส่งฟรี' : `${fee.toLocaleString()} บาท`;
                        shippingText = `📦 รอบจัดส่งพัสดุ (ค่าส่ง ${feeText})`;
                        dateText = `📅 ${deliveryDateText} (หรืออาจไวกว่านี้ได้ตามคิวค่ะ)`;
                        transportNotice = `⏳ ขนส่งใช้เวลา 2–3 วันในการจัดส่ง ถึงมือลูกค้า`;
                    } else {
                        shippingText = `📦 นัดรับ (นครสวรรค์ส่งฟรี)`;
                        dateText = `📅 ${deliveryDateText}`;
                        transportNotice = `📍 ${messageForm.value.pickupLocation || ' - '}`;
                    }

                    const fullPay = Number(messageForm.value.fullPay);
                    const fullPayStr = isNaN(fullPay) ? ' - ' : fullPay.toLocaleString();
                    const deposit = Number(messageForm.value.deposit);
                    const depositStr = (isNaN(deposit) || deposit === 0) ? ' - ' : deposit.toLocaleString();

                    let paymentMessage = '';
                    if (messageForm.value.paymentMode === 'default') {
                        paymentMessage = `💖 การชำระเงิน 💖\nคุณลูกค้าสามารถเลือกได้ 2 แบบค่ะ \n1.โอนเต็มยอด ${fullPayStr} บาท\n2.มัดจำ ${depositStr} บาท (ส่วนที่เหลือชำระตอนผลงานเสร็จ)\n\nคุณลูกค้าสามารถโอนชำระยอดได้เลยตามรายละเอียดที่ทางร้านแจ้งไว้นะคะ 💖`;
                    } else if (messageForm.value.paymentMode === 'transfer_only') {
                        paymentMessage = `💖 การชำระเงิน 💖\nคุณลูกค้าสามารถโอนชำระยอดเต็มจำนวน ${fullPayStr} บาท\nตามรายละเอียดที่ทางร้านแจ้งไว้นะคะ 💖`;
                    } else {
                        paymentMessage = `🚚 การชำระเงิน 🚚\nรายการนี้เป็นการชำระเงินแบบเก็บเงินปลายทางนะคะ\nยอดรวมที่ต้องชำระคือ ${fullPayStr} บาท ค่ะ 💖`;
                    }

                    let noteContent = '';
                    if (messageForm.value.includeNote) {
                        noteContent = `\n**หมายเหตุ**\nหากลูกค้าอยากใส่การ์ด สามารถแจ้งทางร้านได้เลยค่ะ 💌 จะใส่ข้อความหรือรูปภาพที่ต้องการก็ได้ ไม่มีค่าใช้จ่ายเพิ่มเติมค่ะ 😊`;
                    }

                    return `🌻 ทางร้านขอแจ้งรายละเอียดนะคะ 🌻\n${itemsText}\n${shippingText}\n${dateText} \n${transportNotice} \n\nยอดรวมทั้งสิ้น ${totalStr} บาท\n\n${paymentMessage}\n\nเมื่อเสร็จแล้วทางร้านจะถ่ายรูปให้ดูนะคะ 🥰${noteContent}`;
                });

                function selectMessageText(event) {
                    const range = document.createRange();
                    range.selectNodeContents(event.currentTarget);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }

                async function copyMessageToClipboard() {
                    const text = generatedMessage.value;
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(text);
                        } else {
                            const textArea = document.createElement('textarea');
                            textArea.value = text;
                            textArea.style.position = 'fixed';
                            textArea.style.left = '-9999px';
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                        }
                        showToast('คัดลอกข้อความสำเร็จแล้ว! ✅');
                    } catch (err) {
                        showToast('คัดลอกไม่สำเร็จ ลองแตะเลือกข้อความแล้วคัดลอกเองครับ');
                    }
                }

                // Tracking Number Notification Functions
                const TRACKING_URL_BASE = 'https://track.thailandpost.co.th/?trackNumber=';

                function trackingUrl(order) {
                    const n = String((order && order.trackingNumber) || '').replace(/\s+/g, '').toUpperCase();
                    return TRACKING_URL_BASE + encodeURIComponent(n);
                }

                function openTrackingModal(order) {
                    trackingTarget.value = order;
                    trackingNumberInput.value = order.trackingNumber || '';
                    trackingSaveToOrder.value = true;
                    nextTick(() => { if (!order.trackingNumber && trackingInputEl.value) trackingInputEl.value.focus(); });
                }

                function closeTrackingModal() {
                    trackingTarget.value = null;
                }

                // Strip whitespace (incl. pasted line breaks) and force upper-case: Thailand Post codes like JC013496084TH
                const cleanTrackingNumber = computed(() => (trackingNumberInput.value || '').replace(/\s+/g, '').toUpperCase());

                const generatedTrackingMessage = computed(() => {
                    const n = cleanTrackingNumber.value || '(เลขพัสดุ)';
                    return `ทางร้านจัดส่งสินค้าเรียบร้อยแล้วนะคะ\n` +
                        `เลขพัสดุ: ${n}\n` +
                        `ติดตามพัสดุได้ที่\n` +
                        `${TRACKING_URL_BASE}${n}\n\n` +
                        `หากได้รับสินค้าแล้ว รบกวนส่งรูปรีวิวให้ทางร้านได้นะคะ\n` +
                        `ทางร้านดีใจมากๆ ที่ได้เป็นส่วนหนึ่งในความสุขของคุณลูกค้าค่ะ\n` +
                        `ขอบพระคุณมากค่ะ`;
                });

                async function copyTrackingMessage() {
                    const number = cleanTrackingNumber.value;
                    if (!number) {
                        showToast('กรุณากรอกเลขพัสดุก่อนคัดลอกนะครับ');
                        if (trackingInputEl.value) trackingInputEl.value.focus();
                        return;
                    }
                    const text = generatedTrackingMessage.value;
                    let copied = false;
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(text);
                        } else {
                            const textArea = document.createElement('textarea');
                            textArea.value = text;
                            textArea.style.position = 'fixed';
                            textArea.style.left = '-9999px';
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                        }
                        copied = true;
                    } catch (err) {
                        showToast('คัดลอกไม่สำเร็จ ลองแตะเลือกข้อความแล้วคัดลอกเองครับ');
                        return;
                    }

                    const order = trackingTarget.value;
                    if (copied && trackingSaveToOrder.value && order && order.trackingNumber !== number) {
                        order.trackingNumber = number;
                        db.collection('orders').doc(order.id).update({ trackingNumber: number })
                            .catch(() => showToast('คัดลอกแล้ว แต่บันทึกเลขพัสดุไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                        showToast('คัดลอกข้อความและบันทึกเลขพัสดุแล้ว! ✅');
                    } else {
                        showToast('คัดลอกข้อความสำเร็จแล้ว! ✅');
                    }
                }

                function copyShippingAddress(order) {
                    const address = (order.location || '').trim();
                    if (!address) {
                        showToast('ยังไม่ได้กรอกที่อยู่จัดส่งในออเดอร์นี้');
                        return;
                    }
                    const dummy = document.createElement("textarea");
                    document.body.appendChild(dummy);
                    dummy.value = address;
                    dummy.select();
                    document.execCommand("copy");
                    document.body.removeChild(dummy);
                    showToast('คัดลอกที่อยู่จัดส่งเรียบร้อย!');
                }

                // พิมพ์/วางที่อยู่ผู้รับ → เติมจังหวัดให้อัตโนมัติ (ไม่ทับค่าที่เลือกเอง)
                let provinceTimer = null;
                watch(() => form.value.location, (addr) => {
                    clearTimeout(provinceTimer);
                    provinceTimer = setTimeout(() => {
                        if (!isModalOpen.value || form.value.deliveryType !== 'shipping') return;
                        if (form.value.province && !provinceAuto.value) return;
                        const d = detectProvince(addr);
                        if (d) { form.value.province = d.province; provinceAuto.value = true; provinceVia.value = d.via; }
                        else if (provinceAuto.value) { form.value.province = ''; provinceAuto.value = false; provinceVia.value = ''; }
                    }, 400);
                });

                function openModal(order = null) {
                    provinceAuto.value = false;
                    provinceVia.value = '';
                    if (order) {
                        isEditing.value = true;
                        editingId.value = order.id;
                        form.value = {
                            ...order,
                            expressCompany: order.expressCompany || (order.deliveryType === 'shipping' ? 'ไปรษณีย์ไทย (EMS)' : ''),
                            items: (order.items && order.items.length ? order.items.map(i => ({ ...i })) : seedItemsFromOrder(order)),
                            images: getOrderImages(order).map(img => ({ ...img }))
                        };
                        formItemizedMode.value = true;
                        showMoreFields.value = false;
                    } else {
                        showMoreFields.value = false;
                        isEditing.value = false;
                        editingId.value = null;
                        formItemizedMode.value = true;
                        queueManual.value = false;
                        
                        // Remember last customer phone/location or defaults to make entry faster
                        const lastOrder = orders.value.length > 0 ? orders.value[0] : null;

                        form.value = {
                            customerName: '',
                            customerPhone: '',
                            orderNo: nextOrderNo(),
                            queueNo: nextQueueNo(localDateString()),
                            orderMonth: monthLabelOf(localDateString()),
                            products: '',
                            items: [{ id: Date.now() + Math.random(), details: '', qty: 1, unit: 'ช่อ', price: '' }],
                            notes: '',
                            images: [],
                            orderDate: localDateString(),
                            deliveryDate: '',
                            deliveryTime: '',
                            deliveryType: lastOrder ? lastOrder.deliveryType : 'shipping',
                            expressCompany: 'ไปรษณีย์ไทย (EMS)',
                            trackingNumber: '',
                            shippingFee: lastOrder ? (lastOrder.shippingFee || 0) : 0,
                            province: '',
                            location: lastOrder && lastOrder.deliveryType === 'pickup' ? lastOrder.location : '',
                            mapLink: lastOrder && lastOrder.deliveryType === 'pickup' ? (lastOrder.mapLink || '') : '',
                            totalAmount: '',
                            depositAmount: '',
                            paymentMode: lastOrder ? (lastOrder.paymentMode || 'default') : 'default',
                            status: 'pending'
                        };
                    }
                    formStep.value = 1;
                    formErrors.value = {};
                    isModalOpen.value = true;
                }

                function closeModal() {
                    isModalOpen.value = false;
                }

                const isCompressingImage = ref(false);

                function handleFormImageUpload(event) {
                    const files = Array.from(event.target.files || []);
                    if (!files.length) return;

                    const slotsLeft = MAX_ORDER_IMAGES - form.value.images.length;
                    if (slotsLeft <= 0) {
                        showToast(`แนบรูปได้สูงสุด ${MAX_ORDER_IMAGES} รูปต่อออเดอร์`);
                        event.target.value = '';
                        return;
                    }
                    const filesToProcess = files.slice(0, slotsLeft);
                    if (files.length > slotsLeft) {
                        showToast(`แนบรูปได้สูงสุด ${MAX_ORDER_IMAGES} รูปต่อออเดอร์ — เลือกไว้ให้ ${slotsLeft} รูปแรก`);
                    }

                    const invalidFile = filesToProcess.find(f => !f.type.startsWith('image/'));
                    if (invalidFile) {
                        showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
                        event.target.value = '';
                        return;
                    }
                    // Sanity cap on the raw file only — actual size stored is controlled by compression below
                    const oversizedFile = filesToProcess.find(f => f.size > 25 * 1024 * 1024);
                    if (oversizedFile) {
                        showToast('ไฟล์รูปภาพใหญ่เกินไป (เกิน 25MB) กรุณาเลือกไฟล์อื่น');
                        event.target.value = '';
                        return;
                    }

                    isCompressingImage.value = true;

                    const readAndCompress = (file) => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const img = new Image();
                            img.onload = () => {
                                compressImageToDataURL(img).then(resolve).catch(reject);
                            };
                            img.onerror = () => reject(new Error('unreadable image'));
                            img.src = e.target.result;
                        };
                        reader.onerror = () => reject(new Error('file read failed'));
                        reader.readAsDataURL(file);
                    });

                    Promise.allSettled(filesToProcess.map(readAndCompress))
                        .then(results => {
                            let failCount = 0;
                            results.forEach(r => {
                                if (r.status === 'fulfilled') {
                                    form.value.images.push({ url: r.value, rotation: 0 });
                                } else {
                                    failCount++;
                                }
                            });
                            if (failCount > 0) {
                                showToast('บางรูปมีรายละเอียดเยอะเกินไปหรืออ่านไม่ได้ ลองรูปอื่นดูครับ');
                            }
                        })
                        .finally(() => {
                            isCompressingImage.value = false;
                            event.target.value = '';
                        });
                }

                function addFormImageFromUrl() {
                    const url = (imageUrlInput.value || '').trim();
                    if (!url) return;
                    if (form.value.images.length >= MAX_ORDER_IMAGES) {
                        showToast(`แนบรูปได้สูงสุด ${MAX_ORDER_IMAGES} รูปต่อออเดอร์`);
                        return;
                    }
                    form.value.images.push({ url, rotation: 0 });
                    imageUrlInput.value = '';
                }

                // Resize + re-encode as JPEG so the stored base64 stays safely under Firestore's 1MB/document limit.
                // Budget is divided across MAX_ORDER_IMAGES so multiple attached photos on one order still fit
                // comfortably under the 1MB/doc cap alongside the order's other fields.
                function compressImageToDataURL(img) {
                    return new Promise((resolve, reject) => {
                        const MAX_DIMENSION = 1280;
                        const TARGET_CHARS = Math.floor((700 * 1024) / MAX_ORDER_IMAGES); // ~140KB/image at MAX_ORDER_IMAGES=5
                        let width = img.naturalWidth || img.width;
                        let height = img.naturalHeight || img.height;

                        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                            if (width >= height) {
                                height = Math.round(height * (MAX_DIMENSION / width));
                                width = MAX_DIMENSION;
                            } else {
                                width = Math.round(width * (MAX_DIMENSION / height));
                                height = MAX_DIMENSION;
                            }
                        }

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        let quality = 0.85;
                        let dataUrl = '';
                        let attempts = 0;

                        while (attempts < 12) {
                            canvas.width = width;
                            canvas.height = height;
                            ctx.clearRect(0, 0, width, height);
                            ctx.drawImage(img, 0, 0, width, height);
                            dataUrl = canvas.toDataURL('image/jpeg', quality);

                            if (dataUrl.length <= TARGET_CHARS) {
                                resolve(dataUrl);
                                return;
                            }

                            if (quality > 0.45) {
                                quality -= 0.1;
                            } else {
                                // Quality floor reached — shrink dimensions further and reset quality
                                width = Math.round(width * 0.8);
                                height = Math.round(height * 0.8);
                                quality = 0.75;
                            }
                            attempts++;
                        }

                        if (dataUrl && dataUrl.length <= TARGET_CHARS * 1.15) {
                            // Close enough — accept the last attempt rather than fail outright
                            resolve(dataUrl);
                        } else {
                            reject(new Error('Image too large even after compression'));
                        }
                    });
                }

                function rotateFormImage(index) {
                    const img = form.value.images[index];
                    if (!img) return;
                    img.rotation = ((img.rotation || 0) + 90) % 360;
                }

                function removeFormImage(index) {
                    form.value.images.splice(index, 1);
                }

                // Backward-compatible reader: returns an order's photos as an [{url, rotation}] array
                // whether it was saved with the new `images[]` field or the old single `imageUrl` field.
                function getOrderImages(order) {
                    if (!order) return [];
                    if (Array.isArray(order.images) && order.images.length) return order.images;
                    if (order.imageUrl) return [{ url: order.imageUrl, rotation: order.imageRotation || 0 }];
                    return [];
                }

                function openGallery(order, index) {
                    galleryTarget.value = order;
                    galleryIndex.value = index || 0;
                }

                function closeGallery() {
                    galleryTarget.value = null;
                    galleryIndex.value = 0;
                }

                function galleryImages() {
                    return getOrderImages(galleryTarget.value);
                }

                function nextGalleryImage() {
                    const imgs = galleryImages();
                    if (!imgs.length) return;
                    galleryIndex.value = (galleryIndex.value + 1) % imgs.length;
                }

                function prevGalleryImage() {
                    const imgs = galleryImages();
                    if (!imgs.length) return;
                    galleryIndex.value = (galleryIndex.value - 1 + imgs.length) % imgs.length;
                }

                function printImageGridClass(count) {
                    if (count <= 1) return 'print-img-grid-1';
                    if (count <= 4) return 'print-img-grid-2';
                    return 'print-img-grid-3';
                }

                function printImageMaxHeightClass(count) {
                    if (count <= 1) return 'print-img-h-1';
                    if (count <= 2) return 'print-img-h-2';
                    if (count <= 4) return 'print-img-h-4';
                    return 'print-img-h-6';
                }

                function saveOrder() {
                    // drop untouched blank rows and make qty/price real numbers
                    form.value.items = (form.value.items || [])
                        .filter(i => String(i.details || '').trim() || Number(i.price))
                        .map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
                    if (formItemizedMode.value && form.value.items && form.value.items.length > 0) {
                        // Itemized mode: products text + totalAmount are derived from the item rows (+ shipping fee)
                        form.value.products = form.value.items
                            .map(item => {
                                const label = (item.details || '').trim();
                                if (!label) return null;
                                const qty = Number(item.qty) || 0;
                                return qty > 1 ? `${label} (x${qty} ${item.unit || ''})`.trim() : label;
                            })
                            .filter(Boolean)
                            .join('\n') || form.value.products;
                        form.value.totalAmount = formItemsGrandTotal.value;
                    } else {
                        form.value.items = [];
                    }

                    // ช่องเงินที่เว้นว่างไว้ ให้บันทึกเป็น 0 (กันค่าว่างไปทำให้การคำนวณที่อื่นพัง)
                    form.value.totalAmount = Number(form.value.totalAmount) || 0;
                    form.value.depositAmount = Number(form.value.depositAmount) || 0;
                    // เงินมัดจำเก็บเป็นประวัติรับเงิน (payments) และ depositAmount ต้องเท่ากับผลรวมเสมอ
                    if (Array.isArray(form.value.payments)) {
                        if (!form.value.payments.length && form.value.depositAmount > 0) {
                            form.value.payments = [{ id: newPaymentId(), date: localDateString(), amount: form.value.depositAmount, method: '', note: '' }];
                        }
                        form.value.depositAmount = sumPayments(form.value.payments);
                    } else if (!isEditing.value && form.value.depositAmount > 0) {
                        form.value.payments = [{ id: newPaymentId(), date: String(form.value.orderDate || localDateString()).slice(0, 10), amount: form.value.depositAmount, method: '', note: 'มัดจำ' }];
                    }

                    form.value.mapLink = form.value.deliveryType === 'pickup' ? normalizeMapLink(form.value.mapLink) : '';
                    if (form.value.deliveryType !== 'pickup' || !form.value.deliveryDate) form.value.deliveryTime = '';
                    if (isEditing.value) {
                        const updated = { ...form.value, id: editingId.value };
                        db.collection('orders').doc(editingId.value).set(updated)
                            .then(() => showToast('อัปเดตข้อมูลออเดอร์เรียบร้อย'))
                            .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    } else {
                        const newOrder = { ...form.value, id: 'ORD-' + Date.now() };
                        db.collection('orders').doc(newOrder.id).set(newOrder)
                            .then(() => showToast('สร้างออเดอร์ใหม่สำเร็จ'))
                            .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                    }
                    closeModal();
                }

                function confirmDelete(order) { deleteTarget.value = order; }
                function executeDelete() {
                    if (deleteTarget.value) {
                        db.collection('orders').doc(deleteTarget.value.id).delete()
                            .then(() => showToast('ลบออเดอร์เรียบร้อย'))
                            .catch(() => showToast('ลบไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                        deleteTarget.value = null;
                    }
                }

                function exportDataJSON() {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(orders.value, null, 2));
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute("download", `flower_orders_${new Date().toISOString().split('T')[0]}.json`);
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                    showToast('ส่งออกไฟล์ข้อมูลสำเร็จ');
                }

                function importDataJSON(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const imported = JSON.parse(e.target.result);
                            if (Array.isArray(imported)) {
                                const batch = db.batch();
                                imported.forEach(o => {
                                    const id = o.id || ('ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
                                    batch.set(db.collection('orders').doc(id), { ...o, id });
                                });
                                await batch.commit();
                                showToast('นำเข้าข้อมูลสำเร็จ!');
                            }
                        } catch (err) { showToast('รูปแบบไฟล์ไม่ถูกต้อง'); }
                    };
                    reader.readAsText(file);
                }


                // ===== นำเข้าข้อมูลเก่าจาก Excel/CSV =====
                const imp = reactive({ open: false, busy: false, orders: [], errors: [], badRows: [], dupes: 0, delBatch: '' });
                const IMP_COLS = ['เลขออเดอร์', 'คิว', 'วันที่สั่ง', 'วันที่รับ', 'ชื่อลูกค้า', 'เบอร์', 'สินค้า', 'จำนวน', 'ราคาต่อชิ้น', 'ค่าส่ง', 'ยอดรวม', 'รับเงินแล้ว', 'สถานะ', 'วิธีรับ', 'ขนส่ง', 'หมายเหตุ'];
                function openImportModal() { imp.open = true; imp.orders = []; imp.errors = []; imp.badRows = []; imp.dupes = 0; imp.delBatch = ''; }
                function closeImportModal() { if (!imp.busy) imp.open = false; }
                const IMP_TEMPLATE_B64 = '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';
                async function downloadImportTemplate() {
                    // แม่แบบจริง (มีดรอปดาวน์สถานะ/วิธีรับ + ชีตตัวอย่าง) ฝังอยู่ในหน้านี้เลย ไม่ต้องมีไฟล์แยก
                    try {
                        const bin = atob(IMP_TEMPLATE_B64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = 'แม่แบบนำเข้าออเดอร์เก่า.xlsx';
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 5000);
                        return;
                    } catch (err) { /* ถอดรหัสไม่ได้ → สร้างแบบพื้นฐานให้แทน (ไม่มีดรอปดาวน์) */ }
                    const ws = XLSX.utils.aoa_to_sheet([IMP_COLS]);
                    ws['!cols'] = IMP_COLS.map(() => ({ wch: 16 }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'ออเดอร์เก่า');
                    XLSX.writeFile(wb, 'แม่แบบนำเข้าออเดอร์เก่า.xlsx');
                    showToast('สร้างแม่แบบแบบไม่มีดรอปดาวน์ให้แทน');
                }
                function impDate(v) {
                    if (v instanceof Date && !isNaN(v)) v = localDateString(v);
                    const t = String(v == null ? '' : v).trim();
                    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t), y, mo, d;
                    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
                    else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
                    else return '';
                    if (y > 2400) y -= 543;
                    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
                    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                }
                const impNum = (v) => { const t = String(v == null ? '' : v).replace(/[,฿\s]/g, ''); return t === '' ? null : (isNaN(Number(t)) ? NaN : Number(t)); };
                const IMP_STATUS = { 'เสร็จแล้ว': 'completed', 'เสร็จ': 'completed', 'completed': 'completed', 'ยกเลิก': 'cancelled', 'cancelled': 'cancelled', 'รอดำเนินการ': 'pending', 'รอ': 'pending', 'pending': 'pending', 'กำลังทำ': 'in_progress', 'in_progress': 'in_progress', 'พร้อมส่ง': 'ready', 'ready': 'ready' };
                function onImportFile(event) {
                    const file = event.target.files && event.target.files[0];
                    event.target.value = '';
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
                            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
                            buildImportPreview(rows);
                        } catch (err) { imp.orders = []; imp.errors = ['อ่านไฟล์ไม่ได้ ตรวจสอบว่าเป็น .xlsx หรือ .csv']; }
                    };
                    reader.readAsArrayBuffer(file);
                }
                function buildImportPreview(rows) {
                    const errors = [], badRows = [], groups = [], byKey = {};
                    rows.forEach((r, i) => {
                        const line = i + 2;
                        const bad = (msg) => { errors.push(msg); badRows.push({ 'แถวที่': line, 'ปัญหา': msg, ...r }); };
                        if (IMP_COLS.every(c => String(r[c] == null ? '' : r[c]).trim() === '')) return;
                        const date = impDate(r['วันที่สั่ง']);
                        const name = String(r['ชื่อลูกค้า'] || '').trim();
                        const detail = String(r['สินค้า'] || '').trim();
                        const price = impNum(r['ราคาต่อชิ้น']), qty = impNum(r['จำนวน']);
                        const recvRaw = String(r['วันที่รับ'] == null ? '' : r['วันที่รับ']).trim();
                        const recv = recvRaw === '' ? '' : impDate(r['วันที่รับ']);
                        if (!date) return bad(`แถว ${line}: วันที่สั่งไม่ถูกต้อง`);
                        if (recvRaw !== '' && !recv) return bad(`แถว ${line}: วันที่รับไม่ถูกต้อง`);
                        if (!name) return bad(`แถว ${line}: ไม่มีชื่อลูกค้า`);
                        if (!detail) return bad(`แถว ${line}: ไม่มีสินค้า`);
                        if (price === null || isNaN(price)) return bad(`แถว ${line}: ราคาต่อชิ้นไม่ใช่ตัวเลข`);
                        if (qty !== null && isNaN(qty)) return bad(`แถว ${line}: จำนวนไม่ใช่ตัวเลข`);
                        const st = String(r['สถานะ'] || '').trim();
                        if (st && !IMP_STATUS[st]) return bad(`แถว ${line}: สถานะ "${st}" ไม่รู้จัก`);
                        const no = String(r['เลขออเดอร์'] || '').trim();
                        const key = no ? no + '|' + date : '';
                        let g = key ? byKey[key] : null;
                        if (!g) { g = { no, date, name, recv, rows: [] }; groups.push(g); if (key) byKey[key] = g; }
                        g.rows.push({ r, detail, price, qty: qty === null ? 1 : qty });
                    });
                    const batch = 'IMP' + Date.now().toString(36);
                    const existing = new Set(orders.value.map(o => [o.customerName, String(o.orderDate || '').slice(0, 10), Number(o.totalAmount) || 0].join('|')));
                    const out = []; let dupes = 0;
                    groups.sort((a, b) => a.date.localeCompare(b.date)).forEach((g, gi) => {
                        const first = g.rows[0].r;
                        const items = g.rows.map((x, k) => ({ id: Date.now() + gi * 100 + k + Math.random(), details: x.detail, qty: x.qty, unit: 'ชิ้น', price: x.price }));
                        const ship = g.rows.map(x => impNum(x.r['ค่าส่ง'])).find(v => v) || 0;
                        const typedTotal = g.rows.map(x => impNum(x.r['ยอดรวม'])).find(v => v);
                        const total = roundMoney(typedTotal || (items.reduce((a, i) => a + i.qty * i.price, 0) + ship));
                        const status = IMP_STATUS[String(first['สถานะ'] || '').trim()] || 'completed';
                        const paidTyped = g.rows.map(x => impNum(x.r['รับเงินแล้ว'])).find(v => v !== null && !isNaN(v));
                        const paid = status === 'cancelled' ? 0 : roundMoney(paidTyped === undefined ? total : paidTyped);
                        if (existing.has([g.name, g.date, total].join('|'))) { dupes++; return; }
                        const numOf = (v) => { const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? padNo(t) : t; };
                        const pickup = String(first['วิธีรับ'] || '').indexOf('รับ') === 0;
                        const o = {
                            id: `ORD-${batch}-${out.length + 1}`, importBatch: batch,
                            customerName: g.name, customerPhone: String(first['เบอร์'] || '').trim(),
                            orderNo: numOf(first['เลขออเดอร์']), queueNo: numOf(first['คิว']), orderMonth: monthLabelOf(g.date),
                            products: items.map(i => i.qty > 1 ? `${i.details} (x${i.qty} ${i.unit})` : i.details).join('\n'),
                            items, notes: String(first['หมายเหตุ'] || '').trim(), images: [],
                            orderDate: g.date, deliveryDate: g.recv || (status === 'completed' ? g.date : ''), deliveryTime: '',
                            deliveryType: pickup ? 'pickup' : 'shipping',
                            expressCompany: pickup ? '' : String(first['ขนส่ง'] || 'ไปรษณีย์ไทย (EMS)').trim(),
                            trackingNumber: '',
                            shippingFee: ship, location: '', mapLink: '', totalAmount: total, depositAmount: paid,
                            paymentMode: 'default', status,
                            payments: paid > 0 ? [{ id: newPaymentId(), date: g.date, amount: paid, method: '', note: 'นำเข้าข้อมูลเก่า' }] : []
                        };
                        out.push(o);
                    });
                    imp.orders = out; imp.errors = errors; imp.badRows = badRows; imp.dupes = dupes;
                    if (!out.length && !errors.length) imp.errors = [dupes ? 'ออเดอร์ทั้งหมดในไฟล์มีอยู่ในระบบแล้ว' : 'ไม่พบข้อมูลในไฟล์'];
                }

                // ----- เฟส 2: ลบชุดที่นำเข้า + รายงานแถวที่ผิด -----
                const importBatches = computed(() => {
                    const m = {};
                    orders.value.forEach(o => {
                        if (!o.importBatch) return;
                        const b = m[o.importBatch] || (m[o.importBatch] = { id: o.importBatch, count: 0, total: 0, ids: [], at: parseInt(String(o.importBatch).slice(3), 36) || 0 });
                        b.count++; b.total += Number(o.totalAmount) || 0; b.ids.push(o.id);
                    });
                    return Object.values(m).sort((a, b) => b.at - a.at);
                });
                const fmtBatchTime = (at) => at ? new Date(at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
                async function deleteImportBatch(b) {
                    if (imp.busy) return;
                    imp.busy = true;
                    try {
                        for (let i = 0; i < b.ids.length; i += 400) {
                            const batch = db.batch();
                            b.ids.slice(i, i + 400).forEach(id => batch.delete(db.collection('orders').doc(id)));
                            await batch.commit();
                        }
                        showToast(`ลบชุดที่นำเข้า ${b.count} ออเดอร์แล้ว`);
                    } catch (err) { console.error(err); showToast('ลบไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'); }
                    imp.busy = false; imp.delBatch = '';
                }
                function downloadImportErrors() {
                    if (!imp.badRows.length) return;
                    const ws = XLSX.utils.json_to_sheet(imp.badRows, { header: ['แถวที่', 'ปัญหา', ...IMP_COLS] });
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'แถวที่ผิด');
                    XLSX.writeFile(wb, 'รายงานแถวที่นำเข้าไม่ได้.xlsx');
                }
                async function confirmImport() {
                    if (!imp.orders.length || imp.busy) return;
                    imp.busy = true;
                    try {
                        for (let i = 0; i < imp.orders.length; i += 400) {
                            const batch = db.batch();
                            imp.orders.slice(i, i + 400).forEach(o => batch.set(db.collection('orders').doc(o.id), o));
                            await batch.commit();
                        }
                        showToast(`นำเข้าข้อมูลเก่า ${imp.orders.length} ออเดอร์สำเร็จ`);
                        imp.orders = []; imp.open = false;
                    } catch (err) { console.error(err); showToast('นำเข้าไม่สำเร็จ ตรวจสอบการเชื่อมต่อ / Firestore rules'); }
                    imp.busy = false;
                }

                let isFirstOrdersLoad = true;
                const ordersLoaded = ref(false);
                // ===== บัญชีรายรับ-รายจ่าย =====
                const ACC_INCOME_CATEGORIES = ['ขายหน้าร้าน', 'รายรับอื่นๆ'];
                const ACC_EXPENSE_CATEGORIES = ['วัสดุ/ดอกไม้', 'บรรจุภัณฑ์', 'ค่าจัดส่ง', 'ค่าโฆษณา', 'ค่าเดินทาง/น้ำมัน', 'ค่าธรรมเนียม', 'อื่นๆ'];
                const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

                function localDateString(d = new Date()) {
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }

                const mainTab = ref('orders');
                const transactions = ref([]);
                const accMonth = ref(localDateString().slice(0, 7));
                const accAllMonths = ref(false);
                const accTypeFilter = ref('all');
                const accDateFrom = ref('');
                const accDateTo = ref('');
                const accRangeActive = computed(() => !!(accDateFrom.value || accDateTo.value));
                const isTxModalOpen = ref(false);
                const editingTxId = ref(null);
                const txForm = ref({ type: 'expense', date: '', category: ACC_EXPENSE_CATEGORIES[0], amount: '', note: '' });

                // รายรับจากออเดอร์ = เงินที่รับจริงแต่ละรายการ ตามวันที่รับเงิน (ออเดอร์ที่ยกเลิกไม่นับ)
                const accOrderEntries = computed(() => orders.value
                    .filter(o => o.status !== 'cancelled')
                    .flatMap(o => {
                        const firstLine = String(o.products || '').split('\n')[0].trim();
                        return effectivePayments(o)
                            .filter(p => (Number(p.amount) || 0) > 0)
                            .map(p => ({
                                key: 'o-' + o.id + '-' + p.id, source: 'order', type: 'income',
                                date: paymentDateOf(o, p),
                                category: 'ออเดอร์', amount: Number(p.amount) || 0,
                                note: [o.customerName, firstLine, [p.note, p.method].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')
                            }));
                    }));
                const accManualEntries = computed(() => transactions.value.map(t => ({
                    key: 't-' + t.id, source: 'manual', id: t.id, type: t.type,
                    date: String(t.date || '').slice(0, 10), category: t.category || '',
                    amount: Number(t.amount) || 0, note: t.note || ''
                })));
                const accAllEntries = computed(() => [...accOrderEntries.value, ...accManualEntries.value]
                    .sort((a, b) => b.date.localeCompare(a.date)));
                const accPeriodEntries = computed(() => {
                    if (accRangeActive.value) {
                        let lo = accDateFrom.value, hi = accDateTo.value;
                        if (lo && hi && lo > hi) { const t = lo; lo = hi; hi = t; }
                        return accAllEntries.value.filter(e => (!lo || e.date >= lo) && (!hi || e.date <= hi));
                    }
                    return accAllMonths.value
                        ? accAllEntries.value
                        : accAllEntries.value.filter(e => e.date.slice(0, 7) === accMonth.value);
                });
                const accLedger = computed(() => accTypeFilter.value === 'all'
                    ? accPeriodEntries.value
                    : accPeriodEntries.value.filter(e => e.type === accTypeFilter.value));

                const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
                const accLedgerByDay = computed(() => {
                    const groups = [];
                    const map = {};
                    accLedger.value.forEach(e => {
                        let g = map[e.date];
                        if (!g) { g = map[e.date] = { date: e.date, weekday: THAI_WEEKDAYS[new Date(e.date + 'T00:00:00').getDay()] || '', items: [], income: 0, expense: 0 }; groups.push(g); }
                        g.items.push(e);
                        if (e.type === 'income') g.income += e.amount; else g.expense += e.amount;
                    });
                    return groups;
                });

                function accSum(list, type) {
                    return list.filter(e => e.type === type).reduce((sum, e) => sum + e.amount, 0);
                }
                const accIncome = computed(() => accSum(accPeriodEntries.value, 'income'));
                const accExpense = computed(() => accSum(accPeriodEntries.value, 'expense'));
                const accProfit = computed(() => accIncome.value - accExpense.value);
                const accIncomeFromOrders = computed(() => accPeriodEntries.value
                    .filter(e => e.source === 'order').reduce((sum, e) => sum + e.amount, 0));
                const accExpenseCount = computed(() => accPeriodEntries.value.filter(e => e.type === 'expense').length);


                const accExpenseBreakdown = computed(() => {
                    const map = {};
                    accPeriodEntries.value.filter(e => e.type === 'expense').forEach(e => {
                        const k = e.category || 'อื่นๆ';
                        map[k] = (map[k] || 0) + e.amount;
                    });
                    const total = accExpense.value || 1;
                    return Object.entries(map)
                        .map(([name, amount]) => ({ name, amount, pct: Math.round(amount / total * 100) }))
                        .sort((a, b) => b.amount - a.amount);
                });

                const accChart = computed(() => {
                    // ปักกราฟไว้ที่เดือนปัจจุบัน เลื่อนเฉพาะเมื่อเดือนที่เลือกอยู่นอกช่วง 6 เดือน
                    const idx = (ym) => { const [yy, mm] = ym.split('-').map(Number); return yy * 12 + (mm - 1); };
                    const nowKey = localDateString().slice(0, 7);
                    let endIdx = idx(nowKey);
                    if (!accAllMonths.value && !accRangeActive.value && /^\d{4}-\d{2}$/.test(accMonth.value || '')) {
                        const sel = idx(accMonth.value);
                        if (sel > endIdx) endIdx = sel;
                        else if (sel < endIdx - 5) endIdx = sel + 5;
                    }
                    const base = `${Math.floor(endIdx / 12)}-${String(endIdx % 12 + 1).padStart(2, '0')}`;
                    const [y, m] = base.split('-').map(Number);
                    const months = [];
                    for (let i = 5; i >= 0; i--) {
                        const d = new Date(y, m - 1 - i, 1);
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        const list = accAllEntries.value.filter(e => e.date.slice(0, 7) === key);
                        months.push({
                            key,
                            label: `${THAI_MONTHS_SHORT[d.getMonth()]} ${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`,
                            income: accSum(list, 'income'),
                            expense: accSum(list, 'expense')
                        });
                    }
                    const max = Math.max(1, ...months.flatMap(x => [x.income, x.expense]));
                    const h = v => v > 0 ? Math.max(3, Math.round(v / max * 104)) : 0;
                    return months.map(x => ({ ...x, incomeH: h(x.income), expenseH: h(x.expense) }));
                });

                function shiftAccMonth(delta) {
                    const base = accMonth.value || localDateString().slice(0, 7);
                    const [y, m] = base.split('-').map(Number);
                    const d = new Date(y, m - 1 + delta, 1);
                    accMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                }

                const ACC_PRESETS = [
                    { k: 'today', t: 'วันนี้' },
                    { k: 'yesterday', t: 'เมื่อวาน' },
                    { k: '7d', t: '7 วันล่าสุด' },
                    { k: '30d', t: '30 วันล่าสุด' },
                    { k: 'month', t: 'เดือนนี้' }
                ];
                const accShowCustom = ref(false);
                function accQuickRange(k) {
                    const today = new Date();
                    const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return localDateString(d); };
                    if (k === 'today') return [day(0), day(0)];
                    if (k === 'yesterday') return [day(-1), day(-1)];
                    if (k === '30d') return [day(-29), day(0)];
                    if (k === 'month') return [localDateString(new Date(today.getFullYear(), today.getMonth(), 1)), day(0)];
                    return [day(-6), day(0)];
                }
                function accQuickActive(k) {
                    const [f, t] = accQuickRange(k);
                    return accDateFrom.value === f && accDateTo.value === t;
                }
                function accQuick(k) {
                    if (accQuickActive(k)) { clearAccRange(); return; }
                    const [f, t] = accQuickRange(k);
                    accDateFrom.value = f; accDateTo.value = t;
                    accShowCustom.value = false;
                }
                function clearAccRange() { accDateFrom.value = ''; accDateTo.value = ''; accShowCustom.value = false; }
                const accCustomActive = computed(() => accShowCustom.value
                    || (accRangeActive.value && !ACC_PRESETS.some(p => accQuickActive(p.k))));
                function accToggleCustom() { accShowCustom.value = !accShowCustom.value; }
                function accFocusTo() {
                    const el = document.getElementById('acc-date-to');
                    if (!el) return;
                    el.focus();
                    try { if (!accDateTo.value && el.showPicker) el.showPicker(); } catch (e) { /* ignore */ }
                }
                const accRangeLabel = computed(() => {
                    const f = accDateFrom.value, t = accDateTo.value;
                    if (f && t) return f === t ? formatDate(f) : `${formatDate(f)} – ${formatDate(t)}`;
                    if (f) return `ตั้งแต่ ${formatDate(f)}`;
                    if (t) return `ถึง ${formatDate(t)}`;
                    return '';
                });
                function accSelectMonth(key) { clearAccRange(); accAllMonths.value = false; accMonth.value = key; }

                const txCategoryOptions = computed(() =>
                    txForm.value.type === 'income' ? ACC_INCOME_CATEGORIES : ACC_EXPENSE_CATEGORIES);

                function setTxType(type) {
                    txForm.value.type = type;
                    const list = type === 'income' ? ACC_INCOME_CATEGORIES : ACC_EXPENSE_CATEGORIES;
                    if (!list.includes(txForm.value.category)) txForm.value.category = list[0];
                }

                function openTxModal(type = 'expense', entry = null) {
                    if (entry) {
                        editingTxId.value = entry.id;
                        txForm.value = { type: entry.type, date: entry.date, category: entry.category, amount: entry.amount, note: entry.note };
                    } else {
                        editingTxId.value = null;
                        const list = type === 'income' ? ACC_INCOME_CATEGORIES : ACC_EXPENSE_CATEGORIES;
                        txForm.value = { type, date: localDateString(), category: list[0], amount: '', note: '' };
                    }
                    isTxModalOpen.value = true;
                }
                function closeTxModal() { isTxModalOpen.value = false; editingTxId.value = null; }

                function saveTx() {
                    const amount = Number(txForm.value.amount);
                    if (!(amount > 0)) { showToast('กรุณากรอกจำนวนเงินให้มากกว่า 0'); return; }
                    if (!txForm.value.date) { showToast('กรุณาเลือกวันที่'); return; }
                    const id = editingTxId.value || ('TX-' + Date.now());
                    const data = {
                        id, type: txForm.value.type, date: txForm.value.date,
                        category: txForm.value.category, amount,
                        note: (txForm.value.note || '').trim()
                    };
                    db.collection('transactions').doc(id).set(data)
                        .then(() => showToast(editingTxId.value ? 'แก้ไขรายการเรียบร้อย' : 'บันทึกรายการเรียบร้อย'))
                        .catch(() => showToast('บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ / Firestore rules'));
                    // ย้ายมุมมองไปเดือนของรายการที่เพิ่งบันทึก เพื่อให้เห็นรายการทันที
                    if (accRangeActive.value) {
                        const lo = [accDateFrom.value, accDateTo.value].filter(Boolean).sort()[0];
                        const hi = [accDateFrom.value, accDateTo.value].filter(Boolean).sort().slice(-1)[0];
                        if (data.date < lo || data.date > hi) clearAccRange();
                    }
                    if (!accRangeActive.value && !accAllMonths.value) accMonth.value = data.date.slice(0, 7);
                    closeTxModal();
                }

                function deleteTx(entry) {
                    const label = `${entry.category}${entry.note ? ' - ' + entry.note : ''}`;
                    if (!window.confirm(`ลบรายการ "${label}" จำนวน ฿${formatNumber(entry.amount)} ?`)) return;
                    db.collection('transactions').doc(entry.id).delete()
                        .then(() => showToast('ลบรายการเรียบร้อย'))
                        .catch(() => showToast('ลบไม่สำเร็จ ตรวจสอบการเชื่อมต่อ'));
                }

                function exportAccountingCSV() {
                    const esc = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
                    const rows = [['วันที่', 'ประเภท', 'หมวดหมู่', 'รายละเอียด', 'จำนวนเงิน (บาท)']];
                    [...accPeriodEntries.value].sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
                        rows.push([e.date, e.type === 'income' ? 'รายรับ' : 'รายจ่าย', e.category, e.note, e.amount]);
                    });
                    rows.push([]);
                    rows.push(['', '', '', 'รวมรายรับ', accIncome.value]);
                    rows.push(['', '', '', 'รวมรายจ่าย', accExpense.value]);
                    rows.push(['', '', '', 'กำไรสุทธิ', accProfit.value]);
                    const csv = '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
                    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `accounting_${accRangeActive.value ? ((accDateFrom.value || '') + '_' + (accDateTo.value || '')) : (accAllMonths.value ? 'all' : accMonth.value)}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    showToast('ส่งออกไฟล์บัญชีสำเร็จ');
                }

                // แก้ "ประจำเดือน" ของออเดอร์เก่าให้ตรงกับเดือนของวันที่สั่ง (ทำครั้งเดียวต่อการเปิดหน้า)
                // แตะเฉพาะค่าที่เป็นรูปแบบ "ชื่อเดือน ปี" ที่ไม่ตรง ส่วนข้อความอื่นเช่น "วาเลนไทน์" หรือค่าว่างจะไม่แก้
                let orderMonthFixed = false;
                const STD_MONTH_RE = new RegExp('^(' + THAI_MONTHS_FULL.join('|') + ') \\d{4}$');
                function fixOldOrderMonths(list) {
                    if (orderMonthFixed) return;
                    orderMonthFixed = true;
                    const fixes = [];
                    list.forEach(o => {
                        const want = monthLabelOf(o.orderDate);
                        const cur = String(o.orderMonth || '').trim();
                        if (want && o.id && STD_MONTH_RE.test(cur) && cur !== want) fixes.push({ id: o.id, orderMonth: want });
                    });
                    if (!fixes.length) return;
                    const chunks = [];
                    for (let i = 0; i < fixes.length; i += 400) chunks.push(fixes.slice(i, i + 400));
                    Promise.all(chunks.map(chunk => {
                        const batch = db.batch();
                        chunk.forEach(f => batch.update(db.collection('orders').doc(f.id), { orderMonth: f.orderMonth }));
                        return batch.commit();
                    }))
                        .then(() => showToast('แก้เดือนของออเดอร์เก่า ' + fixes.length + ' ใบให้ตรงแล้ว'))
                        .catch((err) => { orderMonthFixed = false; console.error('fixOldOrderMonths failed:', err); });
                }

                // ใส่ "ออเดอร์ที่" ให้ออเดอร์เก่า (ใช้เลขคิวเดิมที่เป็นตัวเลข ไม่งั้นนับตามลำดับเวลาสร้าง) และคำนวณ "คิวที่" ประจำเดือนใหม่
                // ทำครั้งเดียวต่อการเปิดหน้า เฉพาะออเดอร์ที่ยังไม่มี orderNo เก็บคิวเดิมไว้ใน legacyQueueNo เผื่อย้อนกลับ
                let orderNumbersMigrated = false;
                function migrateOrderNumbers(list) {
                    if (orderNumbersMigrated) return;
                    orderNumbersMigrated = true;
                    const hasNo = (o) => o.orderNo !== undefined && o.orderNo !== null && String(o.orderNo).trim() !== '';
                    const missing = list.filter(o => o.id && !hasNo(o));
                    if (!missing.length) return;
                    const tsOf = (o) => { const m = /^ORD-(\d+)/.exec(String(o.id)); return m ? Number(m[1]) : 0; };
                    const sorted = list.filter(o => o.id).sort((a, b) => tsOf(a) - tsOf(b) || String(a.orderDate || '').localeCompare(String(b.orderDate || '')));
                    const seqOf = new Map(); const monthRank = new Map(); const monthCount = {};
                    sorted.forEach((o, i) => {
                        seqOf.set(o.id, i + 1);
                        const k = orderMonthOf(o);
                        monthCount[k] = (monthCount[k] || 0) + 1;
                        monthRank.set(o.id, monthCount[k]);
                    });
                    const fixes = missing.map(o => {
                        const q = String(o.queueNo == null ? '' : o.queueNo).trim();
                        const f = { id: o.id, orderNo: padNo(/^\d+$/.test(q) ? Number(q) : seqOf.get(o.id)), queueNo: padNo(monthRank.get(o.id)) };
                        if (q) f.legacyQueueNo = q;
                        return f;
                    });
                    const chunks = [];
                    for (let i = 0; i < fixes.length; i += 400) chunks.push(fixes.slice(i, i + 400));
                    Promise.all(chunks.map(chunk => {
                        const batch = db.batch();
                        chunk.forEach(f => { const { id, ...data } = f; batch.update(db.collection('orders').doc(id), data); });
                        return batch.commit();
                    }))
                        .then(() => showToast('ใส่ออเดอร์ที่/คิวที่ประจำเดือนให้ออเดอร์เก่า ' + fixes.length + ' ใบแล้ว'))
                        .catch((err) => { orderNumbersMigrated = false; console.error('migrateOrderNumbers failed:', err); });
                }

                let listenersStarted = false;

                function startFirestoreListeners() {
                    if (listenersStarted) return;
                    listenersStarted = true;

                    // ออเดอร์ทั้งหมด ซิงค์แบบเรียลไทม์ระหว่างทุกเครื่องที่เปิดหน้านี้
                    db.collection('orders').onSnapshot((snapshot) => {
                        // snapshot ที่มาจากแคชในเครื่อง (ยังไม่ได้คุยกับเซิร์ฟเวอร์) อาจว่างเปล่าได้ ห้ามเอาไปตัดสินว่าฐานข้อมูลว่าง
                        const fromCache = !!(snapshot.metadata && snapshot.metadata.fromCache);
                        if (snapshot.empty && isFirstOrdersLoad && !fromCache) {
                            // ฐานข้อมูลว่างในครั้งแรก ใส่ข้อมูลตัวอย่างเริ่มต้นให้
                            initialOrders.forEach(o => db.collection('orders').doc(o.id).set(o));
                        } else {
                            orders.value = snapshot.docs.map(d => d.data());
                            if (!fromCache) { fixOldOrderMonths(orders.value); migrateOrderNumbers(orders.value); }
                        }
                        if (!fromCache) isFirstOrdersLoad = false;
                        if (!fromCache || !snapshot.empty) ordersLoaded.value = true;
                    }, (err) => {
                        ordersLoaded.value = true;
                        console.error('Firestore (orders) error:', err);
                        showToast('เชื่อมต่อฐานข้อมูลไม่สำเร็จ ตรวจสอบ Firebase config');
                    });

                    // รายรับ-รายจ่ายที่กรอกเอง
                    db.collection('transactions').onSnapshot((snapshot) => {
                        transactions.value = snapshot.docs.map(d => d.data());
                    }, (err) => {
                        console.error('Firestore (transactions) error:', err);
                        showToast('โหลดข้อมูลบัญชีไม่สำเร็จ ตรวจสอบ Firestore rules ของ transactions');
                    });

                    // ตารางระยะเวลาส่งตามจังหวัด — อ่านไม่ได้ (ยังไม่ตั้งกฎ) ก็ใช้ค่าเริ่มต้นรายภาคไปก่อน ไม่กระทบส่วนอื่น
                    db.collection('shopPrivate').doc('shippingDays').onSnapshot((snap) => {
                        let map = {};
                        if (snap.exists) {
                            try { map = JSON.parse((snap.data() || {}).json || '{}') || {}; } catch (_) { map = {}; }
                        }
                        shippingDays.value = map;
                    }, (err) => {
                        console.error('Firestore (shopPrivate/shippingDays) error:', err);
                    });
                }

                function handleLogin() {
                    loginError.value = '';
                    const username = (loginForm.value.username || '').trim().toLowerCase();
                    if (username !== 'admin') {
                        loginError.value = 'ไม่พบชื่อผู้ใช้นี้';
                        return;
                    }
                    if (!loginForm.value.password) {
                        loginError.value = 'กรุณากรอกรหัสผ่าน';
                        return;
                    }
                    isLoggingIn.value = true;
                    auth.signInWithEmailAndPassword(ADMIN_LOGIN_EMAIL, loginForm.value.password)
                        .catch((err) => {
                            if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code)) {
                                loginError.value = 'รหัสผ่านไม่ถูกต้อง';
                            } else if (err.code === 'auth/user-not-found') {
                                loginError.value = 'ยังไม่ได้ตั้งค่าบัญชีนี้ใน Firebase Console';
                            } else if (err.code === 'auth/too-many-requests') {
                                loginError.value = 'ลองผิดพลาดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
                            } else if (err.code === 'auth/operation-not-allowed') {
                                loginError.value = 'ยังไม่ได้เปิดใช้ระบบ Email/Password ใน Firebase Console';
                            } else {
                                loginError.value = 'เข้าสู่ระบบไม่สำเร็จ: ' + err.message;
                            }
                        })
                        .finally(() => { isLoggingIn.value = false; });
                }

                function handleLogout() {
                    auth.signOut();
                    loginForm.value = { username: '', password: '' };
                    mainTab.value = 'orders';
                }

                onMounted(() => {
                    window.addEventListener('afterprint', () => { monthlyCover.value = null; });
                    auth.onAuthStateChanged((user) => {
                        isLoggedIn.value = !!user;
                        authChecked.value = true;
                        if (user) {
                            loadProductCatalog();
                            startFirestoreListeners();
                        }
                    });

                    window.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape' && isTxModalOpen.value) { closeTxModal(); return; }
                        if (e.key === 'Escape' && trackingTarget.value && !galleryTarget.value) { closeTrackingModal(); return; }
                        if (!galleryTarget.value) return;
                        if (e.key === 'Escape') closeGallery();
                        else if (e.key === 'ArrowRight') nextGalleryImage();
                        else if (e.key === 'ArrowLeft') prevGalleryImage();
                    });
                });

                return {
                    orders, ordersLoaded, searchQuery, filterType, statusFilter, datePreset, sortBy, sortOptions, currentView,
                    isFilterSheetOpen, isMobileMenuOpen, activeFilterCount, resetFilters,
                    detectProvince, provinceAuto, provinceVia, fillProv, openFillProvince, closeFillProvince, confirmFillProvince,
                    PROVINCE_GROUPS, ALL_PROVINCES, daysFor, daysText, daysModal, daysModalGroups, openDaysModal, closeDaysModal, applyRegionDays, saveDaysModal,
                    TRACK_CARRIERS, trackDraft, trackEditing, startTrackEdit, cancelTrackEdit, saveInlineTracking, saveCarrier,
                    isExpanded, toggleExpand, cardMenuOrder, runCardMenu, urgencyChip, deliveryLabel, timeSuffix, isFinishedStatus,
                    quickEdit, quickForm, quickInput, quickSuggestions, quickSuggestIndex, quickSuggest, quickChoiceFor, onQuickInput, onQuickKeydown, pickQuickProduct, pickQuickChoice, quickOrder, quickTitle, quickPay, quickNewTotal, openQuickEdit, closeQuickEdit, saveQuickEdit, quickPayFull,
                    isModalOpen, showMoreFields, formStep, formStepTitles, formScroll, nextStep, prevStep, onFormSubmit, formErrors, onFormKeydown, isEditing, form, formRemainingAmount,
                    formItemizedMode, formItemsTotal, formItemsGrandTotal, toggleFormItemizedMode, addFormItem, removeFormItem,
                    suggestForId, suggestIndex, suggestionsFor, onItemInput, onItemFocus, onItemKeydown, pickProduct, variantPanel, pickVariant, closeVariantPanel, quick, quickCats, quickTypes, quickList, toggleQuickCat, pickFromQuick, addonsFor, addAddon,
                    filteredOrders, activeOrdersCount, statusCounts, completedCount, cancelledCount, totalOrderCount, thisMonthCount, desktopStatusTabs, typeTabs, hasActiveFilters, clearAllFilters, isMoreMenuOpen, cardMoreId, isRangeOpen, rangeFrom, rangeTo, rangeLabel, rangeStats, setRangePreset, clearRange, pendingCount, pickupCount, shippingCount, totalDepositSum, totalRemainingSum,
                    toastMessage, deleteTarget, receiptTarget, selectedForPrint, ordersToPrint,
                    openModal, closeModal, saveOrder, confirmDelete, executeDelete, queueManual,
                    getRemainingBalance, getDeliveryUrgency, mapUrlOf, formatNumber, formatDate, getStatusClass,
                    getProgressWidth, isStepActive, getProgressColor, getProgressDotColor, handleStatusChange, unpaidConfirm, resolveUnpaid, unpaidOnly, paymentBadge, statusLabelOf, queueOpen, todayQueue, overdueCount, jumpToOrder, toastUndo, runToastUndo,
                    printSingleWorkOrder, openBatchPrintModal, openReceiptModal, triggerPrintReceipt,
                    copyShippingAddress, exportDataJSON, importDataJSON, imp, openImportModal, closeImportModal, downloadImportTemplate, onImportFile, confirmImport, importBatches, fmtBatchTime, deleteImportBatch, downloadImportErrors,
                    handleFormImageUpload, rotateFormImage, removeFormImage, isCompressingImage,
                    imageUrlInput, MAX_ORDER_IMAGES, addFormImageFromUrl, getOrderImages,
                    galleryTarget, galleryIndex, openGallery, closeGallery, galleryImages, nextGalleryImage, prevGalleryImage,
                    monthlyCover, monthlyCoverData, monthlyCoverOptions, isMonthlyCoverOpen, monthlyCoverKey, monthlyCoverWithOrders, openMonthlyCoverModal, printMonthlyCover,
                    printImageGridClass, printImageMaxHeightClass, printScaleMap, isMeasuringPrint, getPrintScaleStyle,
                    isMessageModalOpen, messageItems, messageForm, generatedMessage, messageMobileTab,
                    messageSourceOrder, messageTotalMismatch, useComputedTotalAsFullPay, saveMessageTotalsToOrder,
                    authChecked, isLoggedIn, loginForm, loginError, isLoggingIn, handleLogin, handleLogout,
                    openMessageModal, closeMessageModal, addMessageItem, removeMessageItem,
                    selectMessageText, copyMessageToClipboard,
                    trackingTarget, trackingNumberInput, trackingSaveToOrder, trackingInputEl,
                    openTrackingModal, closeTrackingModal, generatedTrackingMessage, copyTrackingMessage, trackingUrl,
                    mainTab, transactions, accMonth, accAllMonths, accTypeFilter, isTxModalOpen, editingTxId, txForm,
                    accLedger, accLedgerByDay, accDateFrom, accDateTo, accRangeActive, accQuick, accQuickActive, clearAccRange, ACC_PRESETS, accShowCustom, accCustomActive, accToggleCustom, accFocusTo, accRangeLabel, accIncome, accExpense, accProfit, accIncomeFromOrders, accExpenseCount,
                    accExpenseBreakdown, accChart, shiftAccMonth, txCategoryOptions, setTxType,
                    openTxModal, closeTxModal, saveTx, deleteTx, exportAccountingCSV,
                    accSelectMonth,
                    effectivePayments, formHasPayments, paymentHistory, editPaymentEntry, cancelPaymentEdit, deletePaymentEntry, PAY_METHODS
                };
            }
        }).mount('#app');