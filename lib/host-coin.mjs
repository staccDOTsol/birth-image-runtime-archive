// Host a coin's art + metadata anonymously. Catbox rejects some cloud IPs ("Invalid uploader"),
// so uguu is the fallback — both return a plain public URL for one POST.
export async function upload(fileBytes, filename) {
  const fd = () => { const f = new FormData(); f.append('fileToUpload', new Blob([fileBytes]), filename); return f; };
  try {
    const f = fd(); f.append('reqtype', 'fileupload');
    const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: f, signal: AbortSignal.timeout(45000) });
    const url = (await r.text()).trim();
    if (/^https:\/\//.test(url)) return url;
  } catch {}
  const f2 = new FormData();
  f2.append('files[]', new Blob([fileBytes]), filename);
  const r2 = await fetch('https://uguu.se/upload.php', { method: 'POST', body: f2, signal: AbortSignal.timeout(45000) });
  const j = await r2.json().catch(() => ({}));
  const url = j?.files?.[0]?.url;
  if (!url) throw new Error('host: catbox + uguu both refused');
  return url;
}

export async function hostCoin({ name, symbol, description, imageBytes, ext }) {
  const imageUrl = await upload(imageBytes, `coin.${ext || 'webp'}`);
  const uri = await upload(Buffer.from(JSON.stringify({ name, symbol, description, image: imageUrl, showName: true })), 'meta.json');
  return { uri, image: imageUrl };
}
