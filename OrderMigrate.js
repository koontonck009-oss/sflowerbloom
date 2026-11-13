/* =========================================================
   S.Flower Bloom — OrderMigrate.js
   ตัวย้ายข้อมูลระบบออเดอร์ Firebase → Supabase (รอบ 3, ใช้ครั้งเดียว)

   - คัดลอก orders + transactions จาก Firestore ไปตาราง orders / transactions ใน Supabase
   - ไม่แก้ไข ไม่ลบอะไรใน Firebase เลย (อ่านอย่างเดียว)
   - กดซ้ำได้ ข้อมูลจะถูกเขียนทับแถวเดิม ไม่ซ้ำซ้อน
   - เสร็จแล้วอ่านกลับมาเทียบทีละแถว แล้วรายงานผล
   - ไฟล์นี้ลบทิ้งได้ตอนล้างโค้ด Firebase (ขั้น 7)
   ต้องใช้ db / auth จาก OrderManagers.js และ SUPABASE_URL / SUPABASE_KEY จาก firebase-config.js
   ========================================================= */
(function () {
    'use strict';

    const TABLES = [['orders', 'ออเดอร์'], ['transactions', 'รายรับ-รายจ่าย']];
    const MAX_ROWS = 200;              // ต่อ 1 คำขอ
    const MAX_BYTES = 2 * 1024 * 1024; // ต่อ 1 คำขอ (ออเดอร์ที่มีรูป base64 อาจใหญ่)
    const READ_PAGE = 20;              // ตอนอ่านกลับมาเทียบ

    const sbBase = () => String(window.SUPABASE_URL || '').replace(/\/+$/, '');
    const sbEmail = () => window.SUPABASE_ADMIN_EMAIL || window.ADMIN_EMAIL || 'admin@sflowerbloom.local';

    /* ---------- แปลงข้อมูล Firestore ให้เป็น JSON ธรรมดา ---------- */
    function normalize(v, stats) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v !== 'object') return v;
        if (typeof v.toDate === 'function') { stats.converted++; return v.toDate().toISOString(); } // Firestore Timestamp
        if (v instanceof Date) { stats.converted++; return v.toISOString(); }
        if (Array.isArray(v)) return v.map(x => normalize(x, stats));
        const out = {};
        Object.keys(v).forEach(k => { if (v[k] !== undefined) out[k] = normalize(v[k], stats); });
        return out;
    }
    // JSON ที่เรียงคีย์คงที่ ไว้เทียบว่าสองก้อนเท่ากันไหม (jsonb ของ Supabase สลับลำดับคีย์ได้)
    function canon(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    // นับรูปที่ฝังในเอกสาร (base64) กับรูปแบบลิงก์/พาธ
    function scanImages(v, acc) {
        if (typeof v === 'string') {
            if (/^data:image\//i.test(v)) acc.b64 = true;
            else if (/^(\.?\/)?images\//i.test(v) || /^https?:\/\//i.test(v)) acc.link = true;
        } else if (Array.isArray(v)) v.forEach(x => scanImages(x, acc));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => scanImages(v[k], acc));
        return acc;
    }

    /* ---------- Supabase (REST ตรงๆ) ---------- */
    async function sbLogin(password) {
        let res;
        try {
            res = await fetch(sbBase() + '/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: { apikey: window.SUPABASE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: sbEmail(), password })
            });
        } catch (e) { throw new Error('เชื่อมต่อ Supabase ไม่ได้ (เช็กอินเทอร์เน็ต)'); }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.access_token) throw new Error('ล็อกอิน Supabase ไม่สำเร็จ: ' + (j.error_description || j.msg || j.message || ('HTTP ' + res.status)));
        return j.access_token;
    }
    async function sbRest(token, method, path, body, extra) {
        const res = await fetch(sbBase() + '/rest/v1/' + path, {
            method,
            headers: Object.assign({ apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, extra || {}),
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store'
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error('Supabase ' + res.status + ' ' + t.slice(0, 200));
        }
        const t = await res.text();
        return t ? JSON.parse(t) : null;
    }
    function chunkRows(rows) {
        const chunks = []; let cur = [], size = 0;
        rows.forEach(r => {
            const s = JSON.stringify(r).length;
            if (cur.length && (cur.length >= MAX_ROWS || size + s > MAX_BYTES)) { chunks.push(cur); cur = []; size = 0; }
            cur.push(r); size += s;
        });
        if (cur.length) chunks.push(cur);
        return chunks;
    }

    /* ---------- หน้าต่างโต้ตอบ (สร้างด้วย JS ไม่ยุ่งกับเทมเพลตของแอป) ---------- */
    function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }

    function openUi() {
        const ov = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit');
        const box = el('div', 'background:#fff;border-radius:16px;padding:20px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.3)');
        box.appendChild(el('b', 'font-size:16px', 'ย้ายข้อมูลออเดอร์ไป Supabase'));
        box.appendChild(el('div', 'font-size:13px;color:#475569;line-height:1.6',
            'คัดลอกออเดอร์และรายรับ-รายจ่ายจาก Firebase ไป Supabase แล้วเทียบให้ว่าตรงครบ ไม่แก้และไม่ลบอะไรใน Firebase กดซ้ำได้ ไม่ซ้ำซ้อน'));
        const passRow = el('div', 'display:flex;flex-direction:column;gap:6px');
        passRow.appendChild(el('label', 'font-size:13px;color:#334155', 'รหัสผ่านแอดมิน (ชุดเดียวกับที่ล็อกอินแอปนี้)'));
        const pass = el('input', 'border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:14px');
        pass.type = 'password'; pass.autocomplete = 'current-password';
        passRow.appendChild(pass);
        box.appendChild(passRow);
        const log = el('div', 'display:none;font-size:12.5px;line-height:1.6;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;white-space:pre-wrap;overflow:auto;max-height:42vh');
        box.appendChild(log);
        const result = el('div', 'display:none;font-size:13.5px;line-height:1.6;border-radius:10px;padding:10px 12px;white-space:pre-wrap');
        box.appendChild(result);
        const btnRow = el('div', 'display:flex;gap:8px;justify-content:flex-end');
        const close = el('button', 'padding:9px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:14px', 'ปิด');
        close.type = 'button';
        const go = el('button', 'padding:9px 16px;border-radius:10px;border:0;background:#db2777;color:#fff;font-size:14px;font-weight:600', 'เริ่มย้ายข้อมูล');
        go.type = 'button';
        btnRow.appendChild(close); btnRow.appendChild(go);
        box.appendChild(btnRow);
        ov.appendChild(box);
        document.body.appendChild(ov);
        ['keydown', 'keyup', 'keypress'].forEach(ev => ov.addEventListener(ev, e => e.stopPropagation()));
        setTimeout(() => pass.focus(), 50);
        return {
            ov, pass, go, close, passRow,
            line(t) { log.style.display = 'block'; log.textContent += t + '\n'; log.scrollTop = log.scrollHeight; },
            show(t, ok) {
                result.style.display = 'block';
                result.style.background = ok ? '#ecfdf5' : '#fef2f2';
                result.style.border = '1px solid ' + (ok ? '#a7f3d0' : '#fecaca');
                result.style.color = ok ? '#065f46' : '#991b1b';
                result.textContent = t;
            }
        };
    }

    /* ---------- งานหลัก ---------- */
    async function migrate(ui, password) {
        const report = [];
        let allOk = true;

        ui.line('1) ล็อกอิน Supabase …');
        const token = await sbLogin(password);
        ui.line('   ✓ ล็อกอินสำเร็จ');

        for (const [table, label] of TABLES) {
            ui.line('');
            ui.line('2) อ่าน' + label + 'จาก Firebase …');
            const snap = await db.collection(table).get({ source: 'server' });
            const stats = { converted: 0 };
            const rows = [];
            const imgs = { b64: 0, link: 0 };
            let skipped = 0;
            snap.forEach(d => {
                const data = normalize(d.data(), stats);
                if (!d.id) { skipped++; return; }
                rows.push({ id: d.id, data });
                if (table === 'orders') { const s = scanImages(data, {}); if (s.b64) imgs.b64++; if (s.link) imgs.link++; }
            });
            ui.line('   พบ ' + rows.length + ' รายการ' + (stats.converted ? ' (แปลงวันที่ Firestore ' + stats.converted + ' ช่อง)' : ''));

            if (rows.length) {
                ui.line('3) เขียนลง Supabase …');
                const chunks = chunkRows(rows);
                let done = 0;
                for (const ch of chunks) {
                    await sbRest(token, 'POST', table + '?on_conflict=id', ch, { Prefer: 'resolution=merge-duplicates,return=minimal' });
                    done += ch.length;
                    ui.line('   เขียนแล้ว ' + done + ' / ' + rows.length);
                }
            }

            ui.line('4) อ่านกลับมาเทียบ …');
            const back = new Map();
            for (let off = 0; ; off += READ_PAGE) {
                const page = await sbRest(token, 'GET', table + '?select=id,data&order=id&limit=' + READ_PAGE + '&offset=' + off);
                (page || []).forEach(r => back.set(r.id, r.data));
                if (!page || page.length < READ_PAGE) break;
            }
            const bad = [];
            rows.forEach(r => { if (!back.has(r.id) || canon(back.get(r.id)) !== canon(r.data)) bad.push(r.id); });
            const srcIds = new Set(rows.map(r => r.id));
            let extra = 0; back.forEach((_, id) => { if (!srcIds.has(id)) extra++; });

            const ok = bad.length === 0 && skipped === 0;
            if (!ok) allOk = false;
            ui.line(ok ? '   ✓ ตรงครบทุกรายการ' : '   ✗ ไม่ตรง ' + bad.length + ' รายการ');
            let txt = (ok ? '✓ ' : '✗ ') + label + ': Firebase ' + rows.length + ' · Supabase ' + back.size + (ok ? ' · ตรงครบ' : ' · ไม่ตรง ' + bad.length + ' รายการ');
            if (bad.length) txt += '\n   รายการที่ไม่ตรง: ' + bad.slice(0, 15).join(', ') + (bad.length > 15 ? ' …' : '');
            if (skipped) txt += '\n   ข้าม ' + skipped + ' เอกสารที่ไม่มีรหัส';
            if (extra) txt += '\n   หมายเหตุ: ใน Supabase มีเพิ่มจาก Firebase ' + extra + ' รายการ (ไม่ได้ลบให้)';
            if (table === 'orders') txt += '\n   รูปฝังในเอกสาร (base64): ' + imgs.b64 + ' ออเดอร์ · รูปแบบลิงก์/พาธ: ' + imgs.link + ' ออเดอร์ (ลิงก์ที่เสียต้องแนบรูปใหม่)';
            report.push(txt);
        }

        ui.show(report.join('\n\n') + '\n\n' + (allOk
            ? 'สรุป: ย้ายสำเร็จ ข้อมูลตรงกับ Firebase ครบ ส่งข้อความนี้ให้ผมดูได้เลย'
            : 'สรุป: ยังมีรายการไม่ตรง กดเริ่มย้ายอีกครั้ง ถ้ายังไม่ตรงส่งข้อความนี้ให้ผมดู'), allOk);
    }

    window.sfbMigrate = function sfbMigrate() {
        if (typeof db === 'undefined' || typeof auth === 'undefined' || !auth.currentUser) { alert('ต้องล็อกอินแอปออเดอร์ก่อน'); return; }
        if (!window.SUPABASE_URL || !window.SUPABASE_KEY) { alert('ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_KEY ใน firebase-config.js'); return; }
        const ui = openUi();
        let busy = false;
        ui.close.addEventListener('click', () => { if (!busy) ui.ov.remove(); });
        const start = async () => {
            if (busy) return;
            if (!ui.pass.value) { ui.show('กรุณากรอกรหัสผ่านแอดมิน', false); return; }
            busy = true; ui.go.disabled = true; ui.go.style.opacity = '.6'; ui.go.textContent = 'กำลังย้าย …';
            ui.passRow.style.display = 'none';
            try { await migrate(ui, ui.pass.value); }
            catch (e) { console.error(e); ui.show('ย้ายไม่สำเร็จ: ' + (e && e.message ? e.message : e), false); }
            finally { ui.passRow.style.display = 'flex'; busy = false; ui.go.disabled = false; ui.go.style.opacity = '1'; ui.go.textContent = 'เริ่มย้ายอีกครั้ง'; ui.pass.value = ''; }
        };
        ui.go.addEventListener('click', start);
        ui.pass.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
    };

    // ปุ่มลอยมุมซ้ายล่าง (โผล่เฉพาะตอนเข้าหน้าด้วย ?migrate=1)
    function addFloatingButton() {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'ย้ายข้อมูลไป Supabase';
        b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99998;padding:10px 14px;border-radius:12px;border:0;background:#db2777;color:#fff;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25);font-family:inherit';
        b.addEventListener('click', () => window.sfbMigrate());
        document.body.appendChild(b);
    }
    if (document.body) addFloatingButton(); else document.addEventListener('DOMContentLoaded', addFloatingButton);
})();
