import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';
import { HttpError } from './auth.js';
import { sniffFileType } from './security.js';

/* Image uploads (student photos, story pictures): JPG/PNG only, verified by content */

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' };

export function imageUpload(subdir, maxMb) {
  const dir = path.join(UPLOAD_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (IMAGE_EXT[file.mimetype] || '.bin')),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => (IMAGE_EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only JPG and PNG images are allowed'))),
  });
}

/** Verify the uploaded image's real type; deletes it and throws if it isn't what it claims. Returns the stored file name. */
export function acceptImage(file) {
  if (!file) throw new HttpError(400, 'Please choose an image');
  const real = sniffFileType(file.path);
  if (real !== file.mimetype || !IMAGE_EXT[real]) {
    fs.rmSync(file.path, { force: true });
    throw new HttpError(400, 'This file is not a real JPG or PNG image');
  }
  return file.filename;
}

export function removeUpload(subdir, name) {
  if (name) fs.rm(path.join(UPLOAD_DIR, subdir, path.basename(name)), () => {});
}

export function sendUpload(res, subdir, name) {
  const file = name && path.join(UPLOAD_DIR, subdir, path.basename(name));
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Image not found');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(file);
}
