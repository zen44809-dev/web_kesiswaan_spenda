const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'documents.json');
const MAX_BODY = 25 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

function readDocuments() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function writeDocuments(documents) { fs.writeFileSync(DATA_FILE, JSON.stringify(documents, null, 2)); }
function send(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  response.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) { reject(new Error('payload-too-large')); request.destroy(); }
    });
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('invalid-json')); } });
    request.on('error', reject);
  });
}
function publicDocument(document) {
  const { data, ...metadata } = document;
  return metadata;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(ROOT, 'kesiswaan.html'));
      return send(response, 200, html, 'text/html');
    }
    if (request.method === 'GET' && /\.(jpeg|jpg|png|gif|webp)$/i.test(url.pathname)) {
      const fileName = path.basename(decodeURIComponent(url.pathname));
      const filePath = path.join(ROOT, fileName);
      if (!fs.existsSync(filePath)) return send(response, 404, { error: 'not-found' });
      const mimeTypes = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] });
      return response.end(fs.readFileSync(filePath));
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await parseBody(request);
      const valid = body.username === 'guru' && body.password === 'guru123';
      return valid ? send(response, 200, { username: body.username }) : send(response, 401, { error: 'invalid-credentials' });
    }
    if (request.method === 'GET' && url.pathname === '/api/documents') {
      return send(response, 200, readDocuments().map(publicDocument));
    }
    if (request.method === 'POST' && url.pathname === '/api/documents') {
      const body = await parseBody(request);
      const required = ['teacherName', 'nip', 'academicYear', 'documentTitle', 'documentType', 'fileName', 'mimeType', 'data'];
      if (required.some((key) => !body[key])) return send(response, 400, { error: 'incomplete-document' });
      const document = { id: crypto.randomUUID(), teacherName: String(body.teacherName), nip: String(body.nip), academicYear: String(body.academicYear), documentTitle: String(body.documentTitle), documentType: String(body.documentType), fileName: String(body.fileName), mimeType: String(body.mimeType), size: Number(body.size) || 0, data: String(body.data), createdAt: new Date().toISOString() };
      const documents = readDocuments(); documents.unshift(document); writeDocuments(documents);
      return send(response, 201, publicDocument(document));
    }
    const match = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const document = readDocuments().find((item) => item.id === match[1]);
      if (!document) return send(response, 404, { error: 'not-found' });
      const buffer = Buffer.from(document.data, 'base64');
      response.writeHead(200, { 'Content-Type': document.mimeType, 'Content-Disposition': `inline; filename="${document.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Content-Length': buffer.length });
      return response.end(buffer);
    }
    if (request.method === 'DELETE' && match) {
      const documents = readDocuments();
      const remainingDocuments = documents.filter((item) => item.id !== match[1]);
      if (remainingDocuments.length === documents.length) return send(response, 404, { error: 'not-found' });
      writeDocuments(remainingDocuments);
      return send(response, 200, { success: true });
    }
    send(response, 404, { error: 'not-found' });
  } catch (error) {
    const status = error.message === 'payload-too-large' ? 413 : 400;
    send(response, status, { error: error.message });
  }
});

server.listen(PORT, () => console.log(`Portal guru berjalan di http://localhost:${PORT}`));
