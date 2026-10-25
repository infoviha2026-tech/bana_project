import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, DATA_DIR, UPLOAD_DIR } from './db.js';
import { processOutbox, notifyUser } from './notify.js';
import { pledgeStatus } from './academics.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** Snapshot the database (VACUUM INTO) and mirror any new uploaded files. Keeps the newest N database snapshots. */
export function runBackup(kind = 'auto') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const fileName = `bana-${stamp}-${kind}-${crypto.randomUUID().slice(0, 6)}.db`;
  const file = path.join(BACKUP_DIR, fileName);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const bytes = fs.statSync(file).size;
  db.prepare('INSERT INTO backups (file_name, bytes, kind) VALUES (?, ?, ?)').run(fileName, bytes, kind);

  // Incremental copy of uploads (certificates, photos, story images): new files only
  const mirror = path.join(BACKUP_DIR, 'uploads');
  const copyDir = (src, dst) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
    }
  };
  copyDir(UPLOAD_DIR, mirror);

  const keep = Math.max(3, Number(getSettings().backup_retention) || 30);
  const old = db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT -1 OFFSET ?').all(keep);
  for (const b of old) {
    fs.rmSync(path.join(BACKUP_DIR, path.basename(b.file_name)), { force: true });
    db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
  }
  return { fileName, bytes };
}

function dailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const done = db.prepare("SELECT 1 FROM backups WHERE kind = 'auto' AND substr(created_at,1,10) = ?").get(today);
  if (!done && new Date().getHours() >= 2) {
    const b = runBackup('auto');
    console.log(`Automatic backup created: ${b.fileName} (${Math.round(b.bytes / 1024)} KB)`);
  }
}

/** Remind donors once per instalment period when an active pledge has fallen behind */
export function pledgeReminders() {
  const pledges = db.prepare("SELECT pl.*, d.user_id FROM pledges pl JOIN donors d ON d.id = pl.donor_id WHERE pl.status = 'Active'").all();
  let sent = 0;
  for (const p of pledges) {
    const s = pledgeStatus(p);
    if (s.state !== 'Behind') continue;
    const period = `${s.installmentsDue}`; // one reminder per instalment that falls due
    if (p.last_reminded === period) continue;
    notifyUser(p.user_id, {
      title: 'Pledge reminder',
      body: `Thank you for your ${p.frequency.toLowerCase()} pledge of Rs. ${p.amount.toLocaleString('en-IN')}${p.purpose ? ` towards ${p.purpose}` : ''}. Rs. ${s.balance.toLocaleString('en-IN')} is due so far. You can donate online from the portal.`,
      link: '/donate', email: true,
    });
    db.prepare('UPDATE pledges SET last_reminded = ? WHERE id = ?').run(period, p.id);
    sent++;
  }
  return sent;
}

export function startJobs() {
  const tick = () => {
    for (const [name, fn] of [['backup', dailyBackup], ['pledges', pledgeReminders], ['outbox', () => processOutbox()]]) {
      try {
        const out = fn();
        if (out?.catch) out.catch((e) => console.error(`job ${name}:`, e.message));
      } catch (e) {
        console.error(`job ${name}:`, e.message);
      }
    }
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();
}
