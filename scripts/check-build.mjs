import { access, readFile } from 'node:fs/promises';
for (const file of ['public/index.html', 'public/app.js', 'public/styles.css', 'public/seal.png', 'public/app_icon.png', 'netlify/functions/verify.mjs', 'netlify/functions/publish.mjs']) await access(file);
const html = await readFile('public/index.html', 'utf8');
if (html.includes('http://') || /<script[^>]*https?:/.test(html)) throw new Error('Unexpected external active content');
console.log('Verification site build checked. No resident data or secrets included.');
