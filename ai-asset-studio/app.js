'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let PRESETS = [], MODELS = [], batches = [], assetGroups = [], activePreset = 'kro_forest';
let lbItems = [], lbIndex = 0;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

/* ---------- 标签页 ---------- */
$$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
  $$('.tab-btn').forEach((b) => b.classList.remove('active'));
  $$('.tab-page').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  $('#page-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'gallery' && !batches.length) loadGallery();
  if (btn.dataset.tab === 'assets' && !assetGroups.length) loadAssets();
}));

/* ---------- 初始化 ---------- */
async function init() {
  try {
    const r = await api('/api/presets');
    PRESETS = r.presets; MODELS = r.models;
    $('#tokenDot').classList.toggle('ok', !!r.token_ready);
    $('#tokenText').textContent = r.token_ready ? '魔搭令牌已加载' : '未设置令牌（服务端需 MS_TOKEN）';
    const chips = PRESETS.map((p) => `<button class="chip${p.id === activePreset ? ' active' : ''}" data-id="${p.id}">${esc(p.label)}</button>`).join('');
    $('#presetChips').innerHTML = chips;
    $$('#presetChips .chip').forEach((c) => c.addEventListener('click', () => {
      activePreset = c.dataset.id;
      $$('#presetChips .chip').forEach((x) => x.classList.toggle('active', x === c));
      const p = PRESETS.find((x) => x.id === activePreset);
      $('#negativeInput').value = p.negative || '';
      const meta = MODELS[0];
      $('#stepsInput').value = meta.steps;
    }));
    $('#modelSelect').innerHTML = MODELS.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
    $('#modelSelect').addEventListener('change', () => {
      const m = MODELS.find((x) => x.id === $('#modelSelect').value);
      if (m) $('#stepsInput').value = m.steps;
    });
    $('#negativeInput').value = PRESETS.find((p) => p.id === activePreset).negative || '';
    const updateCount = () => { $('#promptCount').textContent = $('#promptInput').value.length + ' 字'; };
    $('#promptInput').addEventListener('input', updateCount);
    $('#clearPrompt').addEventListener('click', () => {
      $('#promptInput').value = ''; updateCount(); $('#promptInput').focus();
    });
    updateCount();
  } catch (e) {
    $('#tokenText').textContent = '服务不可用: ' + e.message;
  }
  renderPlaceholders();
}

/* ---------- 生图 ---------- */
function renderPlaceholders() {
  $('#resultGrid').innerHTML = [1, 2, 3, 4].map((i) =>
    `<div class="result-card"><span class="badge">0${i}</span><span class="placeholder">✧</span></div>`).join('');
  $('#resultMeta').textContent = '等待生成';
}

function setResultStates(items) {
  $('#resultGrid').innerHTML = items.map((it, i) => {
    if (it.status === '完成' && it.file) {
      const src = '/file?p=' + encodeURIComponent($('#currentBatch').value + '/' + it.file);
      return `<div class="result-card done"><span class="badge">0${i + 1}</span><img src="${src}" alt="变体 ${i + 1}" data-i="${i}"><a class="dl" href="${src}" download="${esc(it.file)}">下载</a></div>`;
    }
    const text = it.error ? esc(it.error.slice(0, 70)) : esc(it.status || '等待');
    return `<div class="result-card"><span class="badge">0${i + 1}</span><span class="placeholder" style="font-size:12px">${text}</span></div>`;
  }).join('');
}

/* ---------- 提示词增强（魔搭文本模型） ---------- */
async function runEnhance(showHint) {
  const goal = $('#promptInput').value.trim();
  if (!goal) { if (showHint) $('#genHint').textContent = '请先填写创作目标。'; return null; }
  if (showHint) $('#genHint').textContent = '正在调用魔搭文本模型扩写提示词…';
  try {
    const r = await api('/api/enhance', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({goal, style: PRESETS.find((p) => p.id === activePreset)?.label || '',
                            size: $('#sizeSelect').value}),
    });
    $('#enhancedText').textContent = r.prompt;
    $('#enhancedMeta').textContent = r.enhanced_words + ' 词 · ' + r.model;
    $('#enhancedBox').classList.remove('hidden');
    if (showHint) $('#genHint').textContent = '提示词已自动扩写，正在提交生图…';
    return r;
  } catch (e) {
    $('#enhancedBox').classList.add('hidden');
    if (showHint) $('#genHint').textContent = '增强失败，将使用原始提示词：' + e.message;
    return null;
  }
}
$('#enhanceBtn').addEventListener('click', async () => {
  const btn = $('#enhanceBtn'); btn.disabled = true; btn.textContent = '增强中…';
  await runEnhance(true);
  btn.disabled = false; btn.textContent = '✦ 仅增强';
});

let pollTimer = null;
$('#generateBtn').addEventListener('click', async () => {
  const prompt = $('#promptInput').value.trim();
  if (!prompt) { $('#genHint').textContent = '请先填写画面主题。'; $('#promptInput').focus(); return; }
  const enhanced = $('#autoEnhance').checked ? await runEnhance(true) : null;
  const payload = {
    title: $('#titleInput').value.trim() || prompt.slice(0, 30),
    prompt: enhanced ? enhanced.prompt : prompt,
    style: enhanced ? 'custom' : activePreset,
    negative: enhanced ? enhanced.negative : $('#negativeInput').value.trim(),
    model: $('#modelSelect').value,
    size: $('#sizeSelect').value,
    steps: Number($('#stepsInput').value) || 8,
    seed: Number($('#seedInput').value) || null,
  };
  const btn = $('#generateBtn');
  btn.disabled = true; btn.innerHTML = '生成中… <span>✦</span>';
  $('#progressWrap').classList.add('show');
  $('#progressBar').style.width = '3%';
  $('#progressText').textContent = '提交 4 个任务…';
  $('#resultMeta').textContent = '正在生成';
  $('#genHint').textContent = '四张图排队中，请勿关闭页面。';
  if ($('#currentBatch')) $('#currentBatch').remove();
  const input = document.createElement('input'); input.type = 'hidden'; input.id = 'currentBatch'; input.value = '';
  document.body.appendChild(input);
  setResultStates([{}, {}, {}, {}]);

  let jobId;
  try {
    const r = await api('/api/generate', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    });
    jobId = r.job_id;
  } catch (e) {
    btn.disabled = false; btn.innerHTML = '生成 4 张 <span>✦</span>';
    $('#genHint').textContent = '提交失败: ' + e.message; return;
  }
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const job = await api('/api/job/' + jobId);
      $('#progressBar').style.width = (job.progress || 0) + '%';
      $('#progressText').textContent = (job.items || []).map((x) => x.status).join(' · ') || job.status;
      if (job.batch_id) $('#currentBatch').value = job.batch_id;
      if (job.items && job.items.length) setResultStates(job.items);
      if (job.status === 'done') {
        clearInterval(pollTimer);
        btn.disabled = false; btn.innerHTML = '生成 4 张 <span>✦</span>';
        $('#genHint').textContent = job.summary + '，可在「作品画廊」查看全部。';
        $('#resultMeta').textContent = job.summary;
        batches = []; loadGallery();
        bindResultLightbox();
      }
    } catch (e) {
      clearInterval(pollTimer);
      btn.disabled = false; btn.innerHTML = '生成 4 张 <span>✦</span>';
      $('#genHint').textContent = '轮询失败: ' + e.message;
    }
  }, 1500);
});

function bindResultLightbox() {
  $$('#resultGrid img').forEach((img) => img.addEventListener('click', () => {
    const src = img.src;
    openLightbox([{src, title: '本次产出 · 变体 ' + (Number(img.dataset.i) + 1), meta: $('#resultMeta').textContent, prompt: $('#promptInput').value}], 0);
  }));
}

/* ---------- 画廊 ---------- */
async function loadGallery() {
  try {
    const r = await api('/api/batches'); batches = r.batches; renderGallery();
  } catch (e) { $('#galleryList').innerHTML = '<div class="empty">加载失败: ' + esc(e.message) + '</div>'; }
}
function renderGallery() {
  const q = $('#gallerySearch').value.trim().toLowerCase();
  const source = $('#gallerySource').value;
  const list = batches.filter((b) => (source === 'all' || b.source === source) &&
    (!q || (b.title + ' ' + (b.prompt || '')).toLowerCase().includes(q)));
  $('#galleryCount').textContent = list.length + ' 个批次 / ' + list.reduce((n, b) => n + (b.images || []).length, 0) + ' 张';
  if (!list.length) { $('#galleryList').innerHTML = '<div class="empty">暂无匹配的批次</div>'; return; }
  $('#galleryList').innerHTML = list.map((b, bi) => {
    const imgs = b.images || [];
    const shown = imgs.slice(0, 8);
    const meta = [b.model, b.size && b.size + 'px', b.steps && b.steps + ' steps', b.created, b.source === 'legacy' ? '历史批次' : '工坊产出'].filter(Boolean).join(' · ');
    return `<article class="batch">
      <div class="batch-head"><div><h2>${esc(b.title || b.id)}</h2></div>
      <div class="meta"><em>${imgs.length} 张</em><span>${esc(meta)}</span>
      ${b.source === 'studio' ? `<a href="/api/download/${encodeURIComponent(b.id)}">打包下载</a><button class="btn-del" data-del="${esc(b.id)}">删除</button>` : ''}</div></div>
      <div class="batch-grid">${shown.map((im, i) => `<figure class="shot" data-b="${bi}" data-i="${i}">
        <img src="${im.src}" loading="lazy" alt="${esc(im.caption || '')}">
        <figcaption>${esc(im.caption || ('0' + (i + 1)))}</figcaption></figure>`).join('')}</div>
      ${imgs.length > 8 ? `<button class="more" data-b="${bi}">展开全部 ${imgs.length} 张</button>` : ''}
    </article>`;
  }).join('');
  $$('#galleryList .shot').forEach((el) => el.addEventListener('click', () => {
    const b = list[Number(el.dataset.b)];
    openLightbox(b.images.map((im) => ({src: im.src, title: b.title, meta: im.caption || '', prompt: im.prompt || b.prompt || ''})), Number(el.dataset.i));
  }));
  $$('#galleryList .btn-del').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.del;
    const title = (list.find((b) => b.id === id) || {}).title || id;
    if (!confirm('确定删除批次「' + title + '」？图片文件将一并移除，且不可恢复。')) return;
    try {
      await api('/api/batch/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadGallery();
    } catch (e) { alert('删除失败: ' + e.message); }
  }));
  $$('#galleryList .more').forEach((btn) => btn.addEventListener('click', () => {
    const b = list[Number(btn.dataset.b)];
    const art = btn.closest('.batch');
    art.querySelector('.batch-grid').innerHTML = b.images.map((im, i) => `<figure class="shot" data-b="${btn.dataset.b}" data-i="${i}">
      <img src="${im.src}" loading="lazy" alt=""><figcaption>${esc(im.caption || ('0' + (i + 1)))}</figcaption></figure>`).join('');
    art.querySelectorAll('.shot').forEach((el) => el.addEventListener('click', () => openLightbox(
      b.images.map((im) => ({src: im.src, title: b.title, meta: im.caption || '', prompt: im.prompt || b.prompt || ''})), Number(el.dataset.i))));
    btn.remove();
  }));
}
$('#gallerySearch').addEventListener('input', renderGallery);
$('#gallerySource').addEventListener('change', renderGallery);

/* ---------- 游戏素材 ---------- */
async function loadAssets() {
  try {
    const r = await api('/api/assets'); assetGroups = r.groups;
    $('#assetChips').innerHTML = ['全部', ...assetGroups.map((g) => g.group)].map((n, i) =>
      `<button class="chip${i === 0 ? ' active' : ''}" data-g="${esc(n)}">${esc(n)}</button>`).join('');
    $$('#assetChips .chip').forEach((c) => c.addEventListener('click', () => {
      $$('#assetChips .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderAssets();
    }));
    renderAssets();
  } catch (e) { $('#assetList').innerHTML = '<div class="empty">加载失败: ' + esc(e.message) + '</div>'; }
}
function renderAssets() {
  const active = $('#assetChips .chip.active')?.dataset.g || '全部';
  const q = $('#assetSearch').value.trim().toLowerCase();
  const groups = active === '全部' ? assetGroups : assetGroups.filter((g) => g.group === active);
  const items = groups.flatMap((g) => g.items).filter((x) => !q || x.name.toLowerCase().includes(q) || x.rel.toLowerCase().includes(q));
  $('#assetCount').textContent = items.length + ' 个素材';
  if (!items.length) { $('#assetList').innerHTML = '<div class="empty">暂无匹配素材</div>'; return; }
  $('#assetList').innerHTML = items.slice(0, 400).map((x, i) => `<figure class="asset" data-i="${i}">
    <img src="${x.src}" loading="lazy" alt="${esc(x.name)}"><figcaption>${esc(x.name)}</figcaption></figure>`).join('') +
    (items.length > 400 ? '<div class="empty">仅显示前 400 个，请用搜索缩小范围</div>' : '');
  $$('#assetList .asset').forEach((el) => el.addEventListener('click', () => {
    const x = items[Number(el.dataset.i)];
    openLightbox([{src: x.src, title: x.name, meta: x.rel, prompt: '原作逆向提取素材 · Kingdom Rush Origins'}], 0);
  }));
}
$('#assetSearch').addEventListener('input', renderAssets);

/* ---------- 灯箱 ---------- */
function openLightbox(items, i) {
  lbItems = items; lbIndex = i; paintLightbox();
  $('#lightbox').classList.remove('hidden');
}
function paintLightbox() {
  const it = lbItems[lbIndex]; if (!it) return;
  $('#lbImage').src = it.src;
  $('#lbTitle').textContent = it.title || '';
  $('#lbMeta').textContent = (it.meta || '') + (lbItems.length > 1 ? `  ·  ${lbIndex + 1}/${lbItems.length}` : '');
  $('#lbPrompt').textContent = it.prompt || '';
  $('#lbDownload').href = it.src;
  $('#lbDownload').download = (it.title || 'image').replace(/[\\/:*?"<>|]/g, '_') + '.png';
}
$('#lbClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
$('#lbPrev').addEventListener('click', () => { lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length; paintLightbox(); });
$('#lbNext').addEventListener('click', () => { lbIndex = (lbIndex + 1) % lbItems.length; paintLightbox(); });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').classList.contains('hidden')) return;
  if (e.key === 'Escape') $('#lightbox').classList.add('hidden');
  if (e.key === 'ArrowLeft') $('#lbPrev').click();
  if (e.key === 'ArrowRight') $('#lbNext').click();
});

init();
