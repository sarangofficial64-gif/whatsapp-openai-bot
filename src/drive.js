import { google } from 'googleapis';
import { Readable } from 'stream';

function escapeQuery(q) {
  return q.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function uploadBuffer(auth, buffer, filename, mimeType) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: { name: filename },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

export async function searchFiles(auth, query, limit = 10) {
  const drive = google.drive({ version: 'v3', auth });
  const q = query
    ? `name contains '${escapeQuery(query)}' and trashed = false`
    : 'trashed = false';
  const res = await drive.files.list({
    q,
    pageSize: limit,
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
  });
  return res.data.files || [];
}

export async function downloadFileById(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId, fields: 'name, mimeType' });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return {
    buffer: Buffer.from(res.data),
    name: meta.data.name,
    mimeType: meta.data.mimeType,
  };
}
