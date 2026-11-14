/* =========================================================
   S.Flower Bloom — OrderData.js
   ตัวแทน "Firebase" สำหรับระบบออเดอร์ (รอบ 3 ช่วง 4ก) — ทำให้ OrderManagers.js
   ทำงานบน Supabase ได้โดยไม่ต้องแก้โค้ดในไฟล์นั้นเลย

   ทำงานเฉพาะเมื่อ window.ORDERS_SOURCE === 'supabase' (ตั้งใน firebase-config.js)
   ไฟล์นี้ถูกโหลดก่อน OrderManagers.js แล้วแทนที่ตัวแปร global "firebase" ด้วยตัวแทนที่มี
   หน้าตา API เหมือนเดิม (firestore / auth / batch / runTransaction / onSnapshot)
   แต่ข้างหลังอ่าน-เขียนตาราง orders / transactions ใน Supabase

   - ล็อกอิน: Supabase Auth (อีเมลแอดมินเดียวกับรอบ 2)
   - อัปเดตสดข้ามเครื่อง: Supabase Realtime
   - แคชในเครื่อง (IndexedDB): เปิดครั้งถัดไปเห็นออเดอร์ทันที แล้วโหลดเฉพาะที่เปลี่ยน
   - ย้อนกลับ Firebase ได้ทุกเมื่อ: ตั้ง ORDERS_SOURCE = 'firebase' ใน firebase-config.js
   ========================================================= */
(function () {
    'use strict';
    if (window.ORDERS_SOURCE !== 'supabase') return;

    if (!window.supabase || !window.supabase.createClient) {
        alert('โหลดไลบรารี Supabase ไม่สำเร็จ (เช็กอินเทอร์เน็ต แล้วรีเฟรชหน้า)');
        return;
    }

    const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sfb-orders-auth' }
    });

    /* ---------- เครื่องมือเล็กๆ ---------- */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // ก๊อปแบบลึก (สตริงไม่ถูกก๊อป จึงเร็ว แม้ออเดอร์มีรูป base64)
    function clone(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(clone);
        const o = {};
        for (const k in v) o[k] = clone(v[k]);
        return o;
    }
    // ตัดค่า undefined ทิ้ง, NaN/Infinity → null, Date → ข้อความ ISO
    function clean(v) {
        if (v === undefined) return undefined;
        if (v === null) return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v !== 'object') return v;
        if (v instanceof Date) return v.toISOString();
        if (Array.isArray(v)) return v.map((x) => { const c = clean(x); return c === undefined ? null : c; });
        const o = {};
        Object.keys(v).forEach((k) => { const c = clean(v[k]); if (c !== undefined) o[k] = c; });
        return o;
    }
    // รวม patch เข้ากับเอกสารเดิม (เหมือน Firestore update: รองรับ increment / delete / คีย์แบบ a.b)
    function applyPatch(base, patch) {
        const out = clone(base || {});
        Object.keys(patch || {}).forEach((k) => {
            const v = patch[k];
            const path = k.split('.');
            let cur = out;
            for (let i = 0; i < path.length - 1; i++) {
                if (!cur[path[i]] || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
                cur = cur[path[i]];
            }
            const last = path[path.length - 1];
            if (v && v.__sfb === 'inc') cur[last] = (Number(cur[last]) || 0) + v.n;
            else if (v && v.__sfb === 'del') delete cur[last];
            else { const c = clean(v); if (c === undefined) delete cur[last]; else cur[last] = c; }
        });
        return out;
    }
    function wrapErr(e) {
        const err = new Error(e && e.message ? e.message : String(e));
        const c = e && e.code, st = e && e.status;
        if (c === '42501' || c === 'PGRST301' || c === 'PGRST303' || st === 401 || st === 403) err.code = 'permission-denied';
        else if (c === 'not-found') err.code = 'not-found';
        else if (c === 'aborted') err.code = 'aborted';
        else err.code = 'unavailable';
        err.cause = e;
        return err;
    }

    /* ---------- แคชในเครื่อง (IndexedDB) ---------- */
    function idb() {
        return new Promise((res, rej) => {
            try {
                const r = indexedDB.open('sfb-orders-cache', 1);
                r.onupgradeneeded = () => r.result.createObjectStore('kv');
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            } catch (e) { rej(e); }
        });
    }
    const cacheKey = (name) => name + '@' + String(window.SUPABASE_URL || '');
    async function cacheGet(k) {
        try {
            const db = await idb();
            return await new Promise((res) => {
                const q = db.transaction('kv').objectStore('kv').get(k);
                q.onsuccess = () => res(q.result || null);
                q.onerror = () => res(null);
            });
        } catch (e) { return null; }
    }
    async function cacheSet(k, v) {
        try {
            const db = await idb();
            await new Promise((res) => {
                const t = db.transaction('kv', 'readwrite');
                t.objectStore('kv').put(v, k);
                t.oncomplete = res; t.onerror = res; t.onabort = res;
            });
        } catch (e) { /* ไม่มีแคชก็ยังใช้งานได้ */ }
    }

    /* ---------- สถานะต่อ 1 ตาราง ---------- */
    const T = {};
    function tstate(name) {
        return T[name] || (T[name] = {
            name, map: new Map(), listeners: new Set(),
            started: false, ready: false, loaded: false, ch: null, wasSub: false,
            lastSync: 0, syncing: null, saveT: null
        });
    }
    function snap(st, fromCache) {
        const ids = Array.from(st.map.keys()).sort();
        const docs = ids.map((id) => {
            const v = st.map.get(id);
            return { id, exists: true, ref: docRef(st.name, id), data: () => clone(v.data) };
        });
        // empty เป็น false เสมอ: กันโค้ดเดิมที่ "ใส่ออเดอร์ตัวอย่างอัตโนมัติเมื่อฐานข้อมูลว่าง" ไม่ให้เขียนข้อมูลปลอมลงฐานจริง
        return { docs, size: docs.length, empty: false, metadata: { fromCache: !!fromCache, hasPendingWrites: false }, forEach: (f) => docs.forEach(f) };
    }
    function emit(st, fromCache) {
        if (!st.ready) return;
        st.listeners.forEach((l) => { try { l.cb(snap(st, fromCache)); } catch (e) { console.error(e); } });
    }
    function saveCache(st) {
        clearTimeout(st.saveT);
        st.saveT = setTimeout(() => cacheSet(cacheKey(st.name), { at: Date.now(), rows: Array.from(st.map.entries()) }), 800);
    }

    /* ---------- อ่านจาก Supabase ---------- */
    async function fetchIndex(name) {
        const out = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from(name).select('id,updated_at').order('id').range(from, from + 999);
            if (error) throw error;
            out.push(...data);
            if (data.length < 1000) break;
        }
        return out;
    }
    async function fetchRows(name, ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 8) {
            const { data, error } = await sb.from(name).select('id,data,updated_at').in('id', ids.slice(i, i + 8));
            if (error) throw error;
            out.push(...data);
        }
        return out;
    }
    async function fetchRow(name, id) {
        const { data, error } = await sb.from(name).select('id,data,updated_at').eq('id', id).maybeSingle();
        if (error) throw wrapErr(error);
        return data || null;
    }
    // ซิงก์แบบประหยัด: ดึงรายการ id + เวลาแก้ไขก่อน แล้วโหลดเฉพาะแถวที่ใหม่/เปลี่ยน และลบที่หายไป
    function sync(st) {
        if (st.syncing) return st.syncing;
        st.syncing = (async () => {
            try {
                const idx = await fetchIndex(st.name);
                const seen = new Set(), need = [];
                idx.forEach((r) => {
                    seen.add(r.id);
                    const c = st.map.get(r.id);
                    if (!c || c.updated_at !== r.updated_at) need.push(r.id);
                });
                Array.from(st.map.keys()).forEach((id) => { if (!seen.has(id)) st.map.delete(id); });
                const rows = await fetchRows(st.name, need);
                rows.forEach((r) => st.map.set(r.id, { data: r.data, updated_at: r.updated_at }));
                st.loaded = true; st.ready = true; st.lastSync = Date.now();
                emit(st, false);
                saveCache(st);
            } finally { st.syncing = null; }
        })();
        return st.syncing;
    }

    /* ---------- อัปเดตสด (Realtime) ---------- */
    function onChange(st, p) {
        try {
            if (p.eventType === 'DELETE') {
                const id = p.old && p.old.id;
                if (id !== undefined && st.map.delete(id)) { emit(st, false); saveCache(st); }
                return;
            }
            const n = p.new || {};
            if (n.id === undefined) { sync(st).catch(() => {}); return; }
            const c = st.map.get(n.id);
            if (c && c.updated_at === n.updated_at) return; // เสียงสะท้อนของสิ่งที่เราเพิ่งเขียนเอง
            if (n.data === undefined || (p.errors && p.errors.length)) {
                // แถวใหญ่เกินที่ Realtime ส่งมาให้ได้ → ดึงแถวนั้นเอง
                fetchRow(st.name, n.id).then((r) => {
                    if (r) { st.map.set(r.id, { data: r.data, updated_at: r.updated_at }); emit(st, false); saveCache(st); }
                }).catch(() => {});
                return;
            }
            st.map.set(n.id, { data: n.data, updated_at: n.updated_at });
            emit(st, false); saveCache(st);
        } catch (e) { console.error(e); }
    }
    function startRealtime(st) {
        try {
            st.ch = sb.channel('sfb-' + st.name)
                .on('postgres_changes', { event: '*', schema: 'public', table: st.name }, (p) => onChange(st, p))
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        if (st.wasSub) sync(st).catch(() => {}); // เชื่อมต่อใหม่หลังหลุด → เก็บตกสิ่งที่พลาดไป
                        st.wasSub = true;
                    }
                });
        } catch (e) { console.warn('เปิดอัปเดตสดไม่ได้ (ยังใช้งานได้ แต่ต้องรีเฟรชเพื่อเห็นของเครื่องอื่น):', e); }
    }
    async function startTable(st) {
        const cached = await cacheGet(cacheKey(st.name));
        if (cached && Array.isArray(cached.rows) && cached.rows.length && !st.loaded) {
            cached.rows.forEach((r) => st.map.set(r[0], r[1]));
            st.ready = true;
            emit(st, true); // โชว์ของในเครื่องก่อน แล้วค่อยอัปเดตจากเซิร์ฟเวอร์
        }
        try { await sync(st); }
        catch (e) {
            console.warn('โหลดข้อมูล ' + st.name + ' จาก Supabase ไม่สำเร็จ:', e);
            if (!st.ready) st.listeners.forEach((l) => { if (l.errCb) { try { l.errCb(wrapErr(e)); } catch (x) { console.error(x); } } });
        }
        startRealtime(st);
    }
    function onSnapshot(name, cb, errCb) {
        const st = tstate(name);
        const l = { cb, errCb };
        st.listeners.add(l);
        if (st.ready) { try { cb(snap(st, !st.loaded)); } catch (e) { console.error(e); } }
        if (!st.started) { st.started = true; startTable(st); }
        return () => st.listeners.delete(l);
    }

    /* ---------- เขียนลง Supabase ---------- */
    function localPut(name, id, data, ts) {
        const st = tstate(name);
        st.map.set(id, { data, updated_at: ts || null });
        emit(st, false); saveCache(st);
    }
    function localDel(name, id) {
        const st = tstate(name);
        if (st.map.delete(id)) { emit(st, false); saveCache(st); }
    }
    function docSnap(name, id, row) {
        return { id, exists: !!row, ref: docRef(name, id), data: () => (row ? clone(row.data) : undefined) };
    }
    async function getDoc(name, id) {
        if (name !== 'orders' && name !== 'transactions') return docSnap(name, id, null); // เช่น catalog (ไม่ได้ใช้ในโหมดนี้)
        return docSnap(name, id, await fetchRow(name, id));
    }
    async function setDoc(name, id, data, opts) {
        if (opts && opts.merge) {
            const row = await fetchRow(name, id);
            data = applyPatch(row ? row.data : {}, data);
        } else {
            data = clean(data) || {};
        }
        const { data: res, error } = await sb.from(name).upsert({ id, data }, { onConflict: 'id' }).select('id,updated_at');
        if (error) throw wrapErr(error);
        localPut(name, id, data, res && res[0] && res[0].updated_at);
    }
    async function updateDoc(name, id, patch) {
        for (let i = 0; i < 6; i++) {
            const row = await fetchRow(name, id);
            if (!row) { const e = new Error('ไม่พบเอกสาร ' + name + '/' + id); e.code = 'not-found'; throw wrapErr(e); }
            const next = applyPatch(row.data, patch);
            // เขียนได้ก็ต่อเมื่อแถวยังไม่ถูกเครื่องอื่นแก้ระหว่างนี้ (กันทับกัน)
            const { data: res, error } = await sb.from(name).update({ data: next }).eq('id', id).eq('updated_at', row.updated_at).select('id,updated_at');
            if (error) throw wrapErr(error);
            if (res && res.length) { localPut(name, id, next, res[0].updated_at); return; }
            await sleep(60 * (i + 1));
        }
        const e = new Error('write-conflict'); e.code = 'aborted'; throw wrapErr(e);
    }
    async function deleteDoc(name, id) {
        const { error } = await sb.from(name).delete().eq('id', id);
        if (error) throw wrapErr(error);
        localDel(name, id);
    }
    function docRef(name, id) {
        return {
            __sfbRef: true, id, path: name + '/' + id, name,
            get: () => getDoc(name, id),
            set: (d, o) => setDoc(name, id, d, o),
            update: (p) => updateDoc(name, id, p),
            delete: () => deleteDoc(name, id)
        };
    }
    function chunkBySize(rows, maxRows, maxBytes) {
        const chunks = []; let cur = [], size = 0;
        rows.forEach((r) => {
            const s = JSON.stringify(r).length;
            if (cur.length && (cur.length >= maxRows || size + s > maxBytes)) { chunks.push(cur); cur = []; size = 0; }
            cur.push(r); size += s;
        });
        if (cur.length) chunks.push(cur);
        return chunks;
    }
    async function upsertRows(name, rows) {
        for (const ch of chunkBySize(rows, 100, 2 * 1024 * 1024)) {
            const { data: res, error } = await sb.from(name).upsert(ch, { onConflict: 'id' }).select('id,updated_at');
            if (error) throw wrapErr(error);
            const ts = new Map((res || []).map((r) => [r.id, r.updated_at]));
            ch.forEach((r) => localPut(name, r.id, r.data, ts.get(r.id)));
        }
    }
    function batch() {
        const ops = [];
        const b = {
            set(r, d, o) { ops.push({ t: 'set', r, d, o }); return b; },
            update(r, p) { ops.push({ t: 'update', r, p }); return b; },
            delete(r) { ops.push({ t: 'del', r }); return b; },
            async commit() {
                const by = {};
                ops.forEach((op) => { (by[op.r.name] = by[op.r.name] || { set: [], update: [], del: [] })[op.t].push(op); });
                for (const name of Object.keys(by)) {
                    const g = by[name];
                    // set
                    const sets = [];
                    for (const op of g.set) {
                        if (op.o && op.o.merge) { await setDoc(name, op.r.id, op.d, op.o); continue; }
                        sets.push({ id: op.r.id, data: clean(op.d) || {} });
                    }
                    if (sets.length) await upsertRows(name, sets);
                    // update: อ่านแถวเดิมเป็นก้อน → รวม patch → เขียนกลับ
                    if (g.update.length) {
                        const ids = g.update.map((op) => op.r.id);
                        let fetched;
                        try { fetched = await fetchRows(name, ids); } catch (e) { throw wrapErr(e); }
                        const rows = new Map(fetched.map((r) => [r.id, r]));
                        const out = [];
                        g.update.forEach((op) => {
                            const row = rows.get(op.r.id);
                            if (!row) { console.warn('ข้าม (ไม่พบเอกสาร):', name, op.r.id); return; }
                            out.push({ id: op.r.id, data: applyPatch(row.data, op.p) });
                        });
                        if (out.length) await upsertRows(name, out);
                    }
                    // delete
                    const dids = g.del.map((op) => op.r.id);
                    for (let i = 0; i < dids.length; i += 100) {
                        const part = dids.slice(i, i + 100);
                        const { error } = await sb.from(name).delete().in('id', part);
                        if (error) throw wrapErr(error);
                        part.forEach((id) => localDel(name, id));
                    }
                }
            }
        };
        return b;
    }
    // ธุรกรรม: อ่าน → คำนวณ → เขียนแบบมีเงื่อนไขเวลาแก้ไข ถ้าแถวถูกเครื่องอื่นแก้ก่อนก็วนทำใหม่
    async function runTransaction(fn) {
        for (let attempt = 0; attempt < 6; attempt++) {
            const reads = new Map(), writes = [];
            const key = (r) => r.path;
            const tx = {
                async get(r) { const row = await fetchRow(r.name, r.id); reads.set(key(r), row); return docSnap(r.name, r.id, row); },
                update(r, p) { writes.push({ t: 'update', r, p }); return tx; },
                set(r, d, o) { writes.push({ t: 'set', r, d, o }); return tx; },
                delete(r) { writes.push({ t: 'del', r }); return tx; }
            };
            const result = await fn(tx);
            let conflict = false;
            for (const w of writes) {
                const name = w.r.name, id = w.r.id;
                if (w.t === 'del') { await deleteDoc(name, id); continue; }
                if (w.t === 'set') { await setDoc(name, id, w.d, w.o); continue; }
                let row = reads.get(key(w.r));
                if (row === undefined) row = await fetchRow(name, id);
                if (!row) { const e = new Error('ไม่พบเอกสาร ' + name + '/' + id); e.code = 'not-found'; throw wrapErr(e); }
                const next = applyPatch(row.data, w.p);
                const { data: res, error } = await sb.from(name).update({ data: next }).eq('id', id).eq('updated_at', row.updated_at).select('id,updated_at');
                if (error) throw wrapErr(error);
                if (!res || !res.length) { conflict = true; break; }
                localPut(name, id, next, res[0].updated_at);
            }
            if (!conflict) return result;
            await sleep(80 * (attempt + 1));
        }
        const e = new Error('write-conflict'); e.code = 'aborted'; throw wrapErr(e);
    }

    /* ---------- ล็อกอิน (แทน Firebase Auth) ---------- */
    let curUser = null;
    const auth = {
        get currentUser() { return curUser; },
        async signInWithEmailAndPassword(email, password) {
            let r;
            try { r = await sb.auth.signInWithPassword({ email, password }); }
            catch (e) { const er = new Error(e && e.message ? e.message : 'network'); er.code = 'auth/network-request-failed'; throw er; }
            if (r.error) {
                const er = new Error(r.error.message || 'login failed');
                const c = String(r.error.code || ''), st = r.error.status;
                if (c === 'invalid_credentials' || st === 400) er.code = 'auth/invalid-credential';
                else if (st === 429 || /rate_limit/.test(c)) er.code = 'auth/too-many-requests';
                else er.code = 'auth/unknown';
                throw er;
            }
            return { user: curUser };
        },
        async signOut() { await sb.auth.signOut(); },
        onAuthStateChanged(cb) {
            let last;
            const push = (sess) => {
                const uid = sess && sess.user ? sess.user.id : null;
                if (uid === last) return; // เหตุการณ์ซ้ำ (เช่น กลับมาที่แท็บ) ไม่ต้องแจ้งซ้ำ
                last = uid;
                curUser = uid ? { uid, email: sess.user.email || '' } : null;
                cb(curUser);
            };
            sb.auth.getSession().then((r) => push(r && r.data ? r.data.session : null)).catch(() => push(null));
            sb.auth.onAuthStateChange((ev, sess) => { if (ev !== 'INITIAL_SESSION') push(sess); });
        }
    };

    /* ---------- ประกอบเป็น "firebase" ตัวปลอมให้ OrderManagers.js ใช้ ---------- */
    const db = {
        collection(name) { return { doc: (id) => docRef(name, id), onSnapshot: (cb, errCb) => onSnapshot(name, cb, errCb) }; },
        batch, runTransaction,
        settings() {}, enablePersistence() { return Promise.resolve(); }
    };
    const firestoreFn = function () { return db; };
    firestoreFn.FieldValue = {
        increment: (n) => ({ __sfb: 'inc', n: Number(n) || 0 }),
        delete: () => ({ __sfb: 'del' }),
        serverTimestamp: () => new Date().toISOString()
    };
    window.firebase = { initializeApp() {}, firestore: firestoreFn, auth: () => auth };
    window.__sfbOrdersShim = { sb, T };

    /* ---------- เก็บตกตอนกลับมาที่แท็บ / เน็ตกลับมา ---------- */
    function resyncAll(force) {
        Object.keys(T).forEach((k) => {
            const st = T[k];
            if (st.started && (force || Date.now() - st.lastSync > 30000)) sync(st).catch(() => {});
        });
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resyncAll(false); });
    }
    window.addEventListener('online', () => resyncAll(true));

    // ป้ายเล็กๆ บอกว่ากำลังทดสอบด้วย Supabase (โผล่เฉพาะตอนเปิดด้วย ?src=supabase)
    if (window.ORDERS_SOURCE_TEST && document.body) {
        const b = document.createElement('div');
        b.textContent = 'โหมดทดสอบ: Supabase';
        b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99997;background:#0f766e;color:#fff;font-size:11px;padding:4px 9px;border-radius:999px;opacity:.85;pointer-events:none;font-family:inherit';
        document.body.appendChild(b);
    }
    console.info('[OrderData] ระบบออเดอร์ใช้ Supabase');
})();
