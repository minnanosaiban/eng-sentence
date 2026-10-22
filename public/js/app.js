// 画面の動き。登録 → 選択 → 学習(英文だけを学ぶ)
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => Stats.ymd(); // 端末の日付(UTC ではなく)

  let rows = [];                                   // 英文の表
  let words = [];                                  // 単語の表
  let chunks = [];                                 // 意味句・IU の表(type で区別)
  let sel = { sentence: new Set(), meaning: new Set(), iu: new Set(), word: new Set() }; // 単位ごとの選択中の id
  let unit = "sentence";                           // 選択で見ている単位
  let study = { unit: "sentence", ids: [], i: 0 }; // 学習セット
  let prefs = { view: {}, gramOn: false, slashMain: false, aux: { ipa: false, ja: true, vocab: true, quiz: false, rec: false }, waux: { ipa: true, ex: true, toeic: false, tr: false, quiz: false, parts: false, rel: false }, sh: { gap: 0, rep: 1 }, posOn: false, rate: 1, pick: { tns: true, ja: true, label: true, part: true, level: true, groups: true } };
  let tab = "study", setBack = "reg", wReveal = false, wq = null;
  const UN = { sentence: { kind: "sentences", name: "英文" }, meaning: { kind: "chunks", name: "意味句" }, iu: { kind: "chunks", name: "IU" }, word: { kind: "words", name: "単語" } };
  const tbl = u => (u === "word" ? words : u === "sentence" ? rows : chunks.filter(c => c.type === u));
  const isCard = u => u !== "sentence"; // 単語・意味句・IU は、1枚のカードで学ぶ
  const rowOf = text => rows.find(r => r.text.toLowerCase() === String(text).toLowerCase()); // 例文・親の英文から、英文の行を探す

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800) }
  const savePrefs = () => Store.setMeta("prefs", prefs).catch(() => {});
  const saveStudy = () => Store.setMeta("study", study).catch(() => {});

  // ---------- 取り込み ----------
  // 同じ英文があれば、足りないものだけ足す。なければ追加
  async function importSentences(list, { keepState = false } = {}) {
    const have = new Map(rows.map(r => [r.text.toLowerCase(), r]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const s = Clean.sentence(o, { keepState });
      if (!s) continue;
      const ex = have.get(s.text.toLowerCase());
      if (ex) { if (Clean.fill(ex, s)) { u++; touched.push(ex) } continue }
      rows.push(s); have.set(s.text.toLowerCase(), s); n++; touched.push(s);
    }
    if (touched.length) await Store.put(touched, "sentences");
    return { n, u };
  }
  async function importWords(list, { keepState = false } = {}) {
    const have = new Map(words.map(w => [w.text.toLowerCase(), w]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const w = Clean.word(o, { keepState });
      if (!w) continue;
      const ex = have.get(w.text.toLowerCase());
      if (ex) { if (Clean.fillWord(ex, w)) { u++; touched.push(ex) } continue }
      words.push(w); have.set(w.text.toLowerCase(), w); n++; touched.push(w);
    }
    if (touched.length) await Store.put(touched, "words");
    return { n, u };
  }

  async function importChunks(list, { keepState = false } = {}) {
    const have = new Map(chunks.map(c => [Clean.chunkKey(c), c]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const c = Clean.chunk(o, { keepState });
      if (!c) continue;
      const k = Clean.chunkKey(c), ex = have.get(k);
      if (ex) { if (Clean.fillChunk(ex, c)) { u++; touched.push(ex) } continue }
      chunks.push(c); have.set(k, c); n++; touched.push(c);
    }
    if (touched.length) await Store.put(touched, "chunks");
    return { n, u };
  }

  // ファイルの中身 → { sentences, words, chunks }(groups は名前にそろえる)
  // バックアップ・解析済み JSON・受信箱の中身 → { sentences, words, chunks }。試作の形 {groups, items, words}(gids)も読む
  function normPayload(d) {
    if (!d || typeof d !== "object") throw new Error("JSON の形が違います");
    const gname = Object.create(null);
    for (const g of Array.isArray(d.groups) ? d.groups : []) if (g && typeof g.name === "string") gname[g.id] = g.name;
    const fix = i => ({ ...i, groups: Array.isArray(i.groups) ? i.groups : (Array.isArray(i.gids) ? i.gids.map(g => gname[g]).filter(Boolean) : []) });
    const items = Array.isArray(d) ? d : Array.isArray(d.sentences) ? d.sentences : Array.isArray(d.items) ? d.items : [];
    return { sentences: items.map(fix), words: (Array.isArray(d.words) ? d.words : []).map(fix), chunks: (Array.isArray(d.chunks) ? d.chunks : []).map(fix) };
  }
  function parseFile(name, text) {
    if (/\.json$/i.test(name)) return normPayload(JSON.parse(text));
    if (/\.csv$/i.test(name)) {
      return {
        sentences: text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
          const m = l.match(/^"((?:[^"]|"")*)"\s*,?\s*(.*)$/) || l.match(/^([^,]*),?\s*(.*)$/);
          const t = (m[1] || "").replace(/""/g, '"').trim(), g = (m[2] || "").replace(/^"|"$/g, "");
          return { text: t, groups: g.split(/[、,]/).map(x => x.trim()).filter(Boolean) };
        }).filter(o => o.text && !/^(英文|text|sentence)$/i.test(o.text)), words: []
      };
    }
    return { sentences: text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(t => ({ text: t })), words: [] };
  }

  // 同期・受信箱から届いた中身を取り込む。外から来るので、状態(学習中・復習回数など)は取り込まない(検査は Clean が行う)
  async function importPayload(d) {
    const p = normPayload(d), a = await importSentences(p.sentences), b = await importWords(p.words), c = await importChunks(p.chunks);
    return { n: a.n, m: b.n, c: c.n, u: a.u + b.u + c.u };
  }

  // 登録した英文・単語・意味句に、種類のグループ(AI作成/収集)を足す
  function tagged(data, tag) {
    const t = list => (list || []).map(i => (i && typeof i === "object" ? { ...i, groups: [...new Set([...(Array.isArray(i.groups) ? i.groups : []), tag])] } : i));
    return { ...data, sentences: t(data.sentences), words: t(data.words), chunks: t(data.chunks) };
  }
  async function addFrom(data, label, opts) {
    data = tagged(data, (opts && opts.tag) || SRC_TAG[regSrc]);
    const a = await importSentences(data.sentences || [], opts), b = await importWords(data.words || [], opts), c = await importChunks(data.chunks || [], opts);
    renderAll();
    const msg = [];
    if (a.n || a.u) msg.push(`英文 ${a.n} 文を追加${a.u ? `、${a.u} 文に足りない項目を追加` : ""}`);
    if (b.n || b.u) msg.push(`単語 ${b.n} 語を追加${b.u ? `、${b.u} 語に足りない項目を追加` : ""}`);
    if (b.n || c.n) { const l = lackIpa(); if (l.w + l.c) { const r = await fillIpa(); if (r && (r.w || r.c)) { msg.push(`発音記号 ${r.w + r.c} 個を辞書から付与`); renderAll() } } }
    if (c.n || c.u) msg.push(`意味句・IU ${c.n} 個を追加${c.u ? `、${c.u} 個に足りない項目を追加` : ""}`);
    toast(`${label}: ${msg.join(" / ") || "追加するものはありませんでした"}`);
  }

  // ---------- AI による確認(書き出し → 修正として取り込み) ----------
  const MAX_REVIEW = 10;
  const selRows = () => rows.filter(r => sel.sentence.has(r.id));
  const reviewItems = () => {
    const l = selRows();
    if (!l.length) { toast("確認する英文を、選んでください"); return null }
    if (l.length > MAX_REVIEW) { toast(`一度に確認できるのは ${MAX_REVIEW} 文までです(いま ${l.length} 文)。選びなおしてください`); return null }
    return l.map(Clean.slim);
  };
  async function clip(text) { try { await navigator.clipboard.writeText(text) } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove() } }
  $("#btnReviewCopy").onclick = async () => { const it = reviewItems(); if (!it) return; await clip(AI.prompt.review(it)); toast(`${it.length} 文の確認用プロンプトをコピーしました。チャットに貼り付けてください`) };
  $("#btnReviewSave").onclick = () => {
    const it = reviewItems(); if (!it) return;
    const blob = new Blob([JSON.stringify({ sentences: it }, null, 1)], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "eng-sentence-review.json"; a.click(); URL.revokeObjectURL(a.href);
    toast(`${it.length} 文を保存しました。AI のチャットに渡すときは、「確認すること」を添えてください(「AI に確認してもらう(コピー)」は、それも含みます)`);
  };
  // ラベル(1〜5。付けるかどうかは任意)。選んだ英文に付ける
  $("#labelBtns").onclick = async e => {
    const b = e.target.closest("button[data-l]"); if (!b) return;
    const l = selRows(); if (!l.length) return toast("ラベルを付ける英文を、選んでください");
    const n = +b.dataset.l;
    l.forEach(r => { if (n) r.label = n; else delete r.label });
    await Store.put(l, "sentences"); renderPick(); toast(n ? `${l.length} 文に、ラベル ${n} を付けました` : `${l.length} 文の、ラベルを外しました`);
  };

  // 修正として取り込む: 英文の本文が同じものだけ。解析と4択を差し替え、確認済みにする(状態・復習・間違い・グループは残す)
  let fixPending = null;
  function previewFix(payload) {
    const have = new Map(rows.map(r => [r.text.toLowerCase(), r]));
    const items = [], missing = [];
    for (const o of payload.sentences || []) {
      const add = Clean.sentence(o); if (!add) continue;
      const ex = have.get(add.text.toLowerCase());
      if (!ex) { missing.push(add.text); continue }
      items.push({ ex, add, keys: Clean.diffReview(ex, add) });
    }
    return { items, missing, changes: Array.isArray(payload.changes) ? payload.changes : [] };
  }
  function showFix(p) {
    const ch = p.items.filter(i => i.keys.length), same = p.items.length - ch.length;
    $("#fixSum").textContent = `修正あり ${ch.length} 文 / 変更なし ${same} 文${p.missing.length ? ` / 登録に無い英文 ${p.missing.length} 文(取り込みません)` : ""}`;
    const li = ch.map(i => `<li>${esc(i.ex.text.slice(0, 60))}${i.ex.text.length > 60 ? "…" : ""}<br>差し替え: ${i.keys.map(k => Clean.REVIEW[k]).join("、")}</li>`).join("");
    const notes = p.changes.slice(0, 60).map(c => `<li>${esc(`${c.n ?? ""}. ${c.field ?? ""}: ${String(c.before ?? "").slice(0, 80)} → ${String(c.after ?? "").slice(0, 80)}(${String(c.reason ?? "").slice(0, 80)})`)}</li>`).join("");
    $("#fixList").innerHTML = (li ? `<b>差し替わる項目</b><ul>${li}</ul>` : "") + (notes ? `<b>AI が書いた、直した箇所</b><ul>${notes}</ul>` : "");
    $("#btnFixApply").disabled = !ch.length && !same;
    $("#fixPrev").hidden = false;
  }
  $("#btnFixCancel").onclick = () => { fixPending = null; $("#fixPrev").hidden = true };
  $("#btnFixApply").onclick = async () => {
    if (!fixPending) return;
    const touched = [], newChunks = [];
    let n = 0;
    for (const { ex, add, keys } of fixPending.items) {
      Clean.applyReview(ex, add); touched.push(ex); if (keys.length) n++;
    }
    await Store.put(touched, "sentences");
    if (lackIpa().s) await fillIpa(); // 発音記号は辞書から(先に付けて、意味句・IU の表にも引き継ぐ)
    for (const r of touched) newChunks.push(...Clean.chunksOf(r));
    // 意味句・IU の表も、新しい区切りに合わせる(区切りが変わった古いものは外す)
    const texts = new Set(touched.map(r => r.text.toLowerCase())), keep = new Set(newChunks.map(c => Clean.chunkKey({ ...c, ex: c.ex })));
    const old = chunks.filter(c => texts.has(c.ex.toLowerCase()) && !keep.has(Clean.chunkKey(c)));
    if (old.length) { await Store.del(old.map(c => c.id), "chunks"); chunks = chunks.filter(c => !old.includes(c)) }
    await importChunks(newChunks); for (const r of touched) await importWords(Clean.wordsOf(r));
    fixPending = null; $("#fixPrev").hidden = true; $("#jsonIn").value = ""; renderAll();
    toast(`修正: ${n} 文を差し替え、${touched.length} 文を確認済みにしました`);
  };

  // JSON(貼り付け・ファイル)の受け口。「修正として取り込む」にチェックがあれば、確認画面を出す
  async function takeJson(data, label, opts) {
    if ($("#jsonFix").checked) { fixPending = previewFix(data); showFix(fixPending); return }
    await addFrom(data, label, opts);
  }

  // ---------- 登録の方法(① Gemini API / ② 他の AI のチャット / ③ サンプルなど) ----------
  // ① AI作成英文(同梱のサンプルとして、同期しなくても表示される)/ ② 収集英文(公開しない。同期で表示される)。登録した英文には、この名前のグループを付ける
  const SRC_TAG = { ai: "AI作成", mine: "収集" };
  let regSrc = "ai";
  function setReg(r) {
    regSrc = r;
    document.querySelectorAll("#regNav button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === r)));
    document.querySelectorAll("#tab-reg [data-src]").forEach(e => { e.hidden = e.dataset.src !== r });
  }
  $("#regNav").onclick = e => { const b = e.target.closest("button[data-r]"); if (b) setReg(b.dataset.r) };
  setReg("ai");
  const chatLines = () => $("#chatSrc").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  $("#btnChatPrompt").onclick = async () => {
    const t = AI.prompt.file(chatLines().slice(0, 30)), ta = document.createElement("textarea");
    try { await navigator.clipboard.writeText(t) } catch { ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove() }
    toast(chatLines().length > 30 ? "プロンプトをコピーしました(英文は最初の30文だけ。残りは、別に分けて)" : "プロンプトをコピーしました。チャットに貼り付けてください");
  };
  $("#btnMakePrompt").onclick = async () => {
    const t = AI.prompt.make({ n: $("#mkN").value, level: $("#mkLevel").value, part: $("#mkPart").value, scene: $("#mkScene").value, group: $("#mkGroup").value, memo: $("#mkMemo").value }), ta = document.createElement("textarea");
    try { await navigator.clipboard.writeText(t) } catch { ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove() }
    toast("プロンプトをコピーしました。チャットに貼り付けてください");
  };
  $("#btnChatRegistered").onclick = () => {
    const l = rows.filter(needsAI).map(r => r.text);
    if (!l.length) return toast("解析が足りない英文は、ありません");
    $("#chatSrc").value = l.slice(0, 30).join("\n"); toast(`解析が足りない英文を ${Math.min(30, l.length)} 文、入れました`);
  };
  $("#btnJsonPaste").onclick = async () => {
    const t = $("#jsonIn").value.trim(); if (!t) return toast("JSON を貼り付けてください");
    try { const d = AI.parseLoose(t); await takeJson({ ...normPayload(d), changes: d && d.changes }, "JSON"); if (!$("#jsonFix").checked) $("#jsonIn").value = "" }
    catch (err) { toast("JSON を読めませんでした: " + err.message) }
  };

  // ---------- タブ ----------
  function setTab(t) {
    if (tab === "pick" && t !== "pick") stopAudio(); // 選択画面で聞いているときは、画面を離れたら止める
    tab = t;
    const inSet = t === "reg" || t === "sync";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $("#btnSettings").setAttribute("aria-selected", String(inSet));
    $("#setNav").hidden = !inSet;
    document.querySelectorAll("#setNav button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
    if (inSet) setBack = t;
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + t });
    if (t === "reg") renderReg();
    if (t === "pick") renderPick();
    if (t === "study") renderStudy();
    if (t === "sync") Sync.render();
    if (t === "rec") renderRec();
    window.scrollTo(0, 0);
  }
  $("#tabs").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) };
  $("#setNav").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) };
  $("#btnSettings").onclick = () => setTab(setBack); // 設定(登録・同期)。最後に開いた方を開く
  $("#syncStatus").onclick = () => setTab("sync");

  // ---------- 登録 ----------
  function renderReg() {
    const a = rows.filter(r => r.ja).length;
    $("#regInfo").textContent = rows.length
      ? `英文 ${rows.length} 文(うち、和訳などの解析つき ${a} 文)`
      : "まだ英文がありません。";
    $("#reviewInfo").textContent = `選択中の英文: ${sel.sentence.size} 文`;
  }
  async function loadSamples() {
    const all = { sentences: [], words: [], chunks: [] };
    for (const f of ["toeic-sentences-analyzed.json", "toeic-sentences-2-analyzed.json", "toeic-sentences-3-analyzed.json", "toeic-sentences-4-analyzed.json", "toeic-sentences-5-analyzed.json", "toeic-sentences-6-analyzed.json", "toeic-sentences-7-analyzed.json"]) {
      const r = await fetch("samples/" + f); if (!r.ok) throw new Error(f + " を読めません");
      const d = parseFile(f, await r.text()); all.sentences.push(...d.sentences); all.words.push(...d.words);
    }
    await addFrom(all, "サンプル", { tag: SRC_TAG.ai });
  }
  $("#btnSamples").onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await loadSamples() } catch (err) { toast("読み込みに失敗しました: " + err.message) } finally { b.disabled = false }
  };
  $("#btnPaste").onclick = async () => {
    const g = $("#pasteGroup").value.trim(), lines = $("#paste").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast("英文を入力してください");
    await addFrom({ sentences: lines.map(text => ({ text, groups: g ? [g] : [] })) }, "貼り付け");
    $("#paste").value = "";
  };
  $("#file").onchange = $("#fileJson").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(), d = parseFile(f.name, text); await takeJson(/\.json$/i.test(f.name) ? { ...d, changes: JSON.parse(text).changes } : d, f.name, { keepState: /\.json$/i.test(f.name) }) }
    catch (err) { toast("読み込めませんでした: " + err.message) }
    e.target.value = "";
  };
  $("#btnExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ sentences: rows, words, chunks }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `eng-sentence-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#btnClear").onclick = async () => {
    if (!(rows.length || words.length || chunks.length) || !confirm(`英文 ${rows.length} 文・単語 ${words.length} 語・意味句とIU ${chunks.length} 個を、すべて削除します。よろしいですか?`)) return;
    await Store.del(rows.map(r => r.id), "sentences"); await Store.del(words.map(w => w.id), "words"); await Store.del(chunks.map(c => c.id), "chunks");
    rows = []; words = []; chunks = []; sel = { sentence: new Set(), meaning: new Set(), iu: new Set(), word: new Set() }; study = { unit: "sentence", ids: [], i: 0 }; await saveStudy();
    renderAll(); toast("削除しました");
  };

  // ---------- 選択 ----------
  const allGroups = () => [...new Set([...rows, ...words, ...chunks].flatMap(r => r.groups || []))].sort();
  function filtered() {
    const q = $("#fq").value.trim().toLowerCase(), g = $("#fgroup").value, ln = $("#flen").value, ps = $("#fpos").value;
    const wc = r => r.text.split(" ").length, where = r => (r.n === 1 || r.idx === 0 ? "first" : r.idx === r.n - 1 ? "last" : "mid");
    return tbl(unit).filter(r =>
      (!isCard(unit) || unit === "word" || ((!ln || (ln === "s" ? wc(r) <= 2 : ln === "m" ? wc(r) >= 3 && wc(r) <= 5 : wc(r) >= 6)) && (!ps || where(r) === ps))) &&
      (!q || r.text.toLowerCase().includes(q) || (r.ja || "").includes(q)) &&
      inGroup(r, g));
  }
  // 「グループ」の選択肢は、パート → 難易度 → ラベル → 自分で付けたグループ の順。値は、種類の印(p: パート / v: 難易度 / l: ラベル / g: グループ)+ 中身
  const PART_NAMES = { "Part 1": "写真描写", "Part 2": "応答問題", "Part 3": "会話", "Part 4": "説明文", "Part 5": "短文穴埋め", "Part 6": "長文穴埋め", "Part 7": "読解" };
  function inGroup(r, g) {
    if (!g) return true;
    const k = g[0], v = g.slice(2);
    if (k === "p") return unit === "sentence" && (v === "none" ? !Clean.partOf(r) : Clean.partOf(r) === v);
    if (k === "v") return String(r.level) === v;
    if (k === "l") return unit === "sentence" && (v === "none" ? !r.label : String(r.label) === v);
    return (r.groups || []).includes(v);
  }
  function renderGroupSelect() {
    const cur = $("#fgroup").value, o = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`, sent = unit === "sentence";
    const opts = [`<option value="">グループ</option>`];
    if (sent) opts.push(...Object.entries(PART_NAMES).map(([k, n]) => o("p:" + k, `${k} ${n}`)), o("p:none", "パート未設定"));
    opts.push(...[600, 730, 860].map(n => o("v:" + n, "難易度 " + n)));
    if (sent) opts.push(...[1, 2, 3, 4, 5].map(n => o("l:" + n, "ラベル " + n)), o("l:none", "ラベルなし"));
    opts.push(...allGroups().map(g => o("g:" + g, g)));
    $("#fgroup").innerHTML = opts.join("");
    $("#fgroup").value = [...$("#fgroup").options].some(x => x.value === cur) ? cur : "";
  }
  function pickRow(r) {
    const chunk = unit === "meaning" || unit === "iu";
    const part = unit === "sentence" ? Clean.partOf(r) : "";
    const tt = unit === "sentence" && prefs.pick.tns ? Clean.tenseTags(r.tense) : null;
    const tags = `${tt ? [tt.voice, tt.tns, tt.asp].map(x => `<span class="tag tns">${x}</span>`).join("") : ""}${prefs.pick.groups ? `${part ? `<span class="tag">${part}</span>` : ""}${r.level ? `<span class="tag">${r.level}</span>` : ""}${unit === "sentence" && r.label ? `<span class="tag">ラベル ${r.label}</span>` : ""}` : ""}${chunk ? `<span class="tag">${r.idx + 1}/${r.n}番目・${r.text.split(" ").length}語</span>` : ""}${prefs.pick.groups ? (r.groups || []).map(g => `<span class="tag">${esc(g)}</span>`).join("") : ""}`;
    const body = chunk
      ? `${esc(r.text)} ${r.ipa ? `<span class="ipa">/${esc(r.ipa)}/</span>` : ""}${prefs.pick.ja ? `<span class="m"><br>${esc(r.ja)}</span>` : ""}`
      : unit === "word"
      ? `<b>${esc(r.text)}</b> ${r.ipa ? `<span class="ipa">/${esc(r.ipa)}/</span>` : ""} <span class="m">${esc(r.pos)}</span>${prefs.pick.ja ? `<span class="m"><br>${esc(r.ja)}</span>` : ""}`
      : `${prefs.slashMain && r.slash && r.slash.length ? r.slash.map(x => esc(x.en)).join(' <span class="slsep">/</span> ') : esc(r.text)}${prefs.pick.ja ? `<span class="m"><br>${esc(r.ja)}</span>` : ""}`;
    return `<label class="row-i"><span class="chk"><input type="checkbox" data-id="${r.id}" ${sel[unit].has(r.id) ? "checked" : ""}><button type="button" class="sm from" data-from="${r.id}" title="ここから順に聞く" aria-label="ここから順に聞く">▶</button></span><span class="t">${body}<span class="m"><br>${tags}</span></span><button type="button" class="go" data-go="${r.id}" title="この英文から、学習を始める" aria-label="この英文から、学習を始める">→</button></label>`;
  }
  function renderPick() {
    document.querySelectorAll("#segUnit button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.u === unit)));
    document.querySelectorAll(".chunk-only").forEach(e => { e.hidden = !(unit === "meaning" || unit === "iu") });
    document.querySelectorAll(".sent-only").forEach(e => { e.hidden = unit !== "sentence" && unit !== "word" });
    $("#btnSlashPick").setAttribute("aria-pressed", String(!!prefs.slashMain));
    document.querySelectorAll("#pickShow button").forEach(b => b.setAttribute("aria-pressed", String(!!prefs.pick[b.dataset.p])));
    document.querySelector('#pickShow [data-p="tns"]').hidden = unit !== "sentence";
    renderGroupSelect(); syncPickAudio();
    document.querySelectorAll(".word-only").forEach(e => { e.hidden = unit !== "word" });
    const list = filtered(), n = tbl(unit).length;
    $("#pickList").innerHTML = list.length ? list.map(pickRow).join("")
      : `<p class="sub">${n ? "条件に合うものがありません。" : `${UN[unit].name}がありません。「登録」で入れてください。`}</p>`;
    pickInfo(list.length);
  }
  function pickInfo(shown) {
    $("#pickInfo").textContent = `表示 ${shown ?? filtered().length} 件 / 全 ${tbl(unit).length} 件 ・ 選択中 ${sel[unit].size} 件`;
    $("#btnStart").disabled = sel[unit].size === 0;
    $("#btnDelSel").disabled = sel[unit].size === 0;
    { const t = sel[unit].size ? `選んだ ${sel[unit].size} 件を削除` : "選んだものを削除"; $("#btnDelSel").title = t; $("#btnDelSel").setAttribute("aria-label", t) }
  }
  $("#pickShow").onclick = e => { const b = e.target.closest("button[data-p]"); if (b) { prefs.pick[b.dataset.p] = !prefs.pick[b.dataset.p]; savePrefs(); renderPick() } };
  $("#segUnit").onclick = e => { const b = e.target.closest("button[data-u]"); if (b) { unit = b.dataset.u; renderPick() } };
  $("#pickList").onchange = e => { const c = e.target.closest("input[data-id]"); if (!c) return; c.checked ? sel[unit].add(c.dataset.id) : sel[unit].delete(c.dataset.id); pickInfo() };
  ["#fq", "#fgroup", "#flen", "#fpos"].forEach(s => { $(s).addEventListener("input", renderPick); $(s).addEventListener("input", () => stopAudio()) });
  $("#btnAll").onclick = () => { filtered().forEach(r => sel[unit].add(r.id)); renderPick() };
  $("#btnNone").onclick = () => { sel[unit].clear(); renderPick() };
  const pickRandom = n => {
    const pool = filtered().map(r => r.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
    sel[unit] = new Set(pool.slice(0, n)); renderPick(); toast(`${sel[unit].size} 件を選びました`);
  };
  $("#btnRand10").onclick = $("#btnRand20").onclick = e => pickRandom(+e.currentTarget.dataset.n);
  // ---------- 削除 ----------
  // 英文を消すと、その英文から作った意味句・IU も消す(単語は、ほかの英文でも使うので、残す)。同期している端末からも消える
  async function deleteItems(u, ids) {
    const set = new Set(ids); let cids = [];
    if (u === "sentence") {
      const texts = new Set(rows.filter(r => set.has(r.id)).map(r => r.text.toLowerCase()));
      cids = chunks.filter(c => texts.has(c.ex.toLowerCase())).map(c => c.id);
      rows = rows.filter(r => !set.has(r.id)); await Store.del(ids, "sentences");
    } else if (u === "word") { words = words.filter(w => !set.has(w.id)); await Store.del(ids, "words") }
    else cids = ids;
    if (cids.length) { const cs = new Set(cids); chunks = chunks.filter(c => !cs.has(c.id)); await Store.del(cids, "chunks") }
    for (const k of Object.keys(sel)) for (const id of [...ids, ...cids]) sel[k].delete(id);
    study.ids = study.ids.filter(id => !set.has(id) && !cids.includes(id)); if (study.i >= study.ids.length) study.i = Math.max(0, study.ids.length - 1);
    wq = null; wReveal = false; stopAudio(); await saveStudy(); renderAll();
    return cids.length;
  }
  // 確認してから削除。何を消すかを、はっきり見せる
  async function confirmDelete(u, ids) {
    if (!ids.length) return;
    let msg = ids.length + " 件の" + UN[u].name + "を削除します。";
    if (u === "sentence") {
      const texts = new Set(rows.filter(r => ids.includes(r.id)).map(r => r.text.toLowerCase())), n = chunks.filter(c => texts.has(c.ex.toLowerCase())).length;
      msg += "\nこの英文から作った意味句・IU(" + n + " 個)も、いっしょに削除します。単語は残ります。";
    }
    msg += "\n同期している場合は、ほかの端末からも消えます。元に戻せません。よろしいですか?";
    if (!confirm(msg)) return;
    const extra = await deleteItems(u, ids);
    toast(ids.length + " 件の" + UN[u].name + "を削除しました" + (extra && u === "sentence" ? "(意味句・IU " + extra + " 個も)" : ""));
  }
  $("#btnDelSel").onclick = () => confirmDelete(unit, tbl(unit).filter(r => sel[unit].has(r.id)).map(r => r.id));
  $("#btnDelCur").onclick = () => { const r = cur(); if (r) confirmDelete(study.unit, [r.id]) };

  $("#btnStart").onclick = async () => {
    // 表の並び順のまま、選んだものを学習セットにする
    study = { unit, ids: tbl(unit).filter(r => sel[unit].has(r.id)).map(r => r.id), i: 0 };
    wReveal = false; await saveStudy(); setTab("study");
  };

  // ---------- 学習(共通) ----------
  const cur = () => tbl(study.unit).find(r => r.id === study.ids[study.i]);
  function renderStudy() {
    const r = cur();
    $("#studyEmpty").hidden = !!r; $("#studyBox").hidden = !r;
    if (!r) return;
    renderSentence(r);
  }
  function go(d) { const n = study.i + d; if (n < 0 || n >= study.ids.length) return; stopAudio(); wq = null; study.i = n; wReveal = false; saveStudy(); renderStudy() }
  $("#btnPrev").onclick = () => go(-1);
  $("#btnNext").onclick = () => go(1);
  // 画面を左右になぞる(スワイプ): 左へ → 次の英文、右へ → 前の英文。語の選択(長押し)・ボタン・選択肢の操作とは、区別する
  {
    let sw = null;
    const ok = t => !t.closest("button, select, input, textarea, a, label");
    document.querySelectorAll("article.sentence").forEach(el => {
      el.addEventListener("touchstart", e => { sw = e.touches.length === 1 && ok(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null }, { passive: true });
      el.addEventListener("touchend", e => {
        if (!sw || window.getSelection().toString().trim()) { sw = null; return }
        const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 700) go(dx < 0 ? 1 : -1);
      }, { passive: true });
    });
  }
  // 選択画面の音声の設定(速さ・間・繰り返し)は、学習画面と同じ設定を使う。選択肢も、学習画面のものを写す
  for (const [a, b] of [["#rate", "#pRate"], ["#shGap", "#pGap"], ["#shRep", "#pRep"]]) $(b).innerHTML = $(a).innerHTML;
  function syncPickAudio() { $("#pRate").value = String(prefs.rate); $("#pGap").value = String(prefs.sh.gap); $("#pRep").value = String(prefs.sh.rep) }
  function setRate(v) { prefs.rate = +v; $("#rate").value = String(prefs.rate); syncPickAudio(); savePrefs() }
  $("#rate").onchange = e => setRate(e.target.value);
  $("#pRate").onchange = e => setRate(e.target.value);

  // ---------- 英文学習 ----------
  const LEG = [["n", "名詞"], ["pron", "代名詞"], ["v", "動詞"], ["aux", "助動詞"], ["adj", "形容詞"], ["adv", "副詞"], ["prep", "前置詞"], ["conj", "接続詞・関係詞"], ["det", "冠詞・限定詞"]];
  const NUM = "⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿";
  function phClass(f) {
    if (/節/.test(f)) return "c";
    if (/不定詞|動名詞|分詞/.test(f)) return "v";
    if (/前置詞/.test(f)) return "p";
    if (/主語|動詞|目的語|補語/.test(f)) return "s";
    return "o";
  }
  // 音声で読み上げる区切り。区切りの形があればそれ、なければスラッシュリーディング、なければ文全体

  function renderSentence(r) {
    $("#pos").textContent = `${study.i + 1} / ${study.ids.length}`;
    $("#btnPrev").disabled = study.i === 0; $("#btnNext").disabled = study.i >= study.ids.length - 1;
    document.querySelectorAll("#segShow button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v ? !!prefs.view[b.dataset.v] : b.dataset.x ? !!prefs.aux[b.dataset.x] : !!prefs.gramOn)));
    $("#btnSlashMain").setAttribute("aria-pressed", String(!!prefs.slashMain));
    $("#rate").value = String(prefs.rate);
    $("#shGap").value = String(prefs.sh.gap); $("#shRep").value = String(prefs.sh.rep);
    $("#stSel").value = r.status;
    $("#stInfo").textContent = infoText(r);
    renderDisp(r); renderAux(r);
  }

  // 区切りの見方(表示の入り切り)。全文の下に、出している見方が、この並びで縦に並ぶ。それぞれに、何を基準に区切っているかの説明を付ける
  const VIEWS = [
    { k: "links", note: "" }
  ];
  // 区切りを順に聞く(C)が使う区切り。出している区切り(英文 → 文法)、何も出していなければ、英文 → 文法 → 音
  function chunkSrc(r) {
    const avail = { iu: r.iu && r.iu.map(x => x.t), slash: r.slash && r.slash.map(x => x.en), phrases: r.phrases && r.phrases.map(x => x.t) };
    const key = ["slash", "phrases"].find(k => (k === "phrases" ? prefs.gramOn : prefs.slashMain) && avail[k]) || ["slash", "phrases", "iu"].find(k => avail[k]);
    return key ? { key, list: avail[key] } : { key: null, list: [r.text] };
  }
  // その見方を、表示に出す(出ていなければ)
  function showView(k) { if (k === "iu") return; if (k === "slash") { if (!prefs.slashMain) { prefs.slashMain = true; savePrefs(); renderStudy() } } else if (k === "phrases") { if (!prefs.gramOn) { prefs.gramOn = true; savePrefs(); renderStudy() } } else if (k && !prefs.view[k]) { prefs.view[k] = true; savePrefs(); renderStudy() } }

  // 文法(ひとまとめ): 品詞ボタン + 文構造(S V O C M・節・文型・時制)+ 文法区切り + 文法の解説
  function gramBlock(r, mkP, now, nowView, pw) {

    const hl = i => (nowView === "phrases" && i === now ? " now" : "");
    let h = '<div class="view gram" data-view="gram"><div class="gramhead"><span style="flex:1"></span>'
      + `<button class="sm" id="posBtn" aria-pressed="${!!prefs.posOn}" title="語ごとの品詞を、文字の色で表す(3)">品詞</button></div>`;
    if (prefs.posOn) h += '<div class="legend">' + (pw ? LEG.map(([k, n]) => `<span><i style="background:var(--pc-${k})"></i>${n}</span>`).join("") : "<span>この英文には、品詞の情報がないので、品詞の色は付きません</span>") + "</div>";
    h += '<h4 class="gh">文構造</h4>';
    if (r.elements && r.elements.length) {
      h += '<div class="els">' + r.elements.map(e => `<span class="el"><span class="role ${e.role}">${e.role}</span><b>${esc(e.text)}</b>${e.note ? ` <span class="sub">${esc(e.note)}</span>` : ""}</span>`).join("") + "</div>";
      if (r.pattern) h += `<div class="gp"><b>${esc(r.pattern.type)}</b> <span class="sub">${esc(r.pattern.explanation)}</span></div>`;
      if (r.tense) h += `<div class="gp"><b>${esc(r.tense.name)}</b> <span class="sub">${esc(r.tense.explanation)}</span></div>`;
      if (r.clauses && r.clauses.length) h += '<table class="cls">' + r.clauses.map(c => `<tr><td><b>${esc(c.kind)}</b></td><td>${esc(c.text)}</td><td class="sub">${esc(c.role)}</td></tr>`).join("") + "</table>";
    } else h += '<div class="sub">この英文には、文構造のデータがありません(「サンプル英文を入れる」をもう一度押すか、AI で解析し直すと付きます)。</div>';
    h += '<h4 class="gh">文法区切り <button class="vplay" data-k="phrases" title="文法区切りを、頭から順に聞く">▶</button></h4>';
    const P2 = mkP();
    h += r.phrases && r.phrases.length ? r.phrases.map((p, i) => `<span class="ph"><span class="no">${NUM[i] || i + 1}</span><span class="seg-i cl-${phClass(p.f)}${hl(i)}${sl("phrases", i)}" data-c="${i}">${P2(p.t)}</span> <span class="lab">${esc(p.f)}</span></span>`).join("") : '<div class="sub">この英文には、文法区切りのデータがありません。</div>';
    h += '<h4 class="gh">文法の解説</h4>';
    h += (r.grammar || []).length ? r.grammar.map(g => `<div class="gpt"><b>・${esc(g.point)}</b><div class="sub">${esc(g.explanation)}</div></div>`).join("") : '<div class="sub">なし</div>';
    { const t = r.toeic;
    h += '<h4 class="gh">TOEIC</h4>';
    h += `<div>${t ? `<span class="tag">${esc(t.part)}</span><span class="tag">${esc(t.scene)}</span>${t.points.map(p => `<div class="gpt"><b>・${esc(p.type)}</b> <span class="sub">${esc(p.detail)}</span></div>`).join("")}${t.paraphrase.length ? `<div class="sub">言い換え: ${t.paraphrase.map(esc).join(" / ")}</div>` : ""}` : '<span class="sub">なし</span>'}</div>`;
    }
    return h + "</div>";
  }

  const sl = (key, i) => { const r = cur(); return selC && r && selC.id === r.id && selC.key === key && selC.i === i ? " sel" : "" };

  // 主節の動詞の 態・時制・相 を、漢字1字ずつのタグで(例: 能 現 進)
  function tenseBadge(r) {
    const t = Clean.tenseTags(r.tense);
    return t ? `<div class="tnsbadge" title="態・時制・相(主節の動詞)">${[t.voice, t.tns, t.asp].map(x => `<span class="tag">${x}</span>`).join("")}</div>` : "";
  }

  function renderDisp(r, now = -1, nowView = null) {
    // 品詞の色(どの見方にも重ねる)。区切りをつなぐと原文に戻るので、語の並びの順に、品詞を当てる。文字の色だけで表す(区切りの下線と重ならないように)
    const pw = prefs.gramOn && prefs.posOn && r.words ? r.words : null;
    const mkP = () => { let ti = 0; return text => !pw ? esc(text) : text.split(" ").filter(Boolean).map(t => { const w = pw[ti++]; return w && w.w === t ? '<span class="pw pw-' + w.p + '">' + esc(t) + "</span>" : esc(t) }).join(" ") };
    const ftxt = prefs.slashMain && r.slash && r.slash.length ? (P => r.slash.map((s, i) => (i ? '<span class="slsep">/</span><wbr>' : "") + `<span class="seg-i${nowView === "slash" && i === now ? " now" : ""}${sl("slash", i)}" data-c="${i}">${P(s.en)}</span>`).join(""))(mkP()) : mkP()(r.text); // [/] を入れると、全文を / で区切った形にする
    let html = '<div class="fulltext" title="クリックで全文を聞く(スペース)。語をなぞって選ぶと、その部分だけ聞ける"><button class="vplay" data-k="main" title="聞く(スペース)">▶</button>' + ftxt + ' <button class="vstop" title="止める(S)">■</button></div>' + tenseBadge(r); // いちばん上は、いつも全文
    if (r.slash && r.slash.length && (prefs.aux.ipa || prefs.aux.ja)) { // 区切りごとの発音記号・訳(英文の下)
      html += '<div class="view" data-view="slash">'
        + (prefs.aux.ipa && r.slash.some(s => s.ipa) ? '<div class="sljas">' + r.slash.filter(s => s.ipa).map(s => `<div class="ja"><b>${esc(s.en)}</b> <span class="ipa">/${esc(s.ipa)}/</span></div>`).join("") + "</div>" : "")
        + (prefs.aux.ja ? '<div class="sljas">' + r.slash.map(s => `<div class="ja"><b>${esc(s.en)}</b> ${esc(s.ja)}</div>`).join("") + "</div>" : "") + "</div>";
    }
    for (const v of VIEWS) {
      if (!prefs.aux.ipa) continue;
      const P = mkP(), hl = i => (nowView === v.k && i === now ? " now" : "");
      let body;
      if (v.k === "links") {
        if (!Pron.ready) { body = '<div class="sub">発音辞書を読み込み中…</div>'; Pron.load().then(ok => { if (ok && prefs.aux.ipa && cur() === r) renderStudy() }) }
        else body = '<button class="vplay" data-k="links" title="つながって聞こえる所を、ゆっくり → ふつうの速さで聞き比べる(L)">▶</button>' + Pron.links(r.text).map((g, i) => g.linked
          ? `<span class="lk${hl(i)}" data-c="${i}">${P(g.t)}${g.ipa ? `<span class="lk-ipa ipa">/${esc(g.ipa)}/</span>` : ""}</span>`
          : `<span class="lk-s${hl(i)}">${P(g.t)}</span>`).join("");
      } else body = "";
      html += `<div class="view" data-view="${v.k}">${v.note ? `<div class="vnote">${esc(v.note)}</div>` : ""}${body}</div>`;
    }
    if (prefs.gramOn) html += gramBlock(r, mkP, now, nowView, pw);
    $("#disp").innerHTML = html;
  }

  function renderAux(r) {
    const a = prefs.aux; let h = "";
    $("#jaBox").innerHTML = a.ja ? (r.ja ? esc(r.ja) : '<span class="sub">なし</span>') : ""; // 全文の和訳は、英文の上に置く
    if (a.vocab) h += `<div class="blk"><div class="row" style="margin:0 0 8px"></div>${(r.vocab || []).length ? `<table class="v">${r.vocab.map((x, i) => `<tr><td><b>${esc(x.word)}</b>${x.ipa ? `<div class="ipa">/${esc(x.ipa)}/</div>` : ""}</td><td class="sub">${esc(x.pos)}</td><td>${esc(x.meaning)}<div class="sub">${esc(x.note)}</div>${x.toeic ? `<div class="sub">TOEIC: ${esc(x.toeic)}</div>` : ""}</td></tr>`).join("")}</table>` : '<span class="sub">なし</span>'}</div>`;
    if (a.quiz) {
      const q = r.quiz;
      h += `<div class="blk"><h3>4択問題</h3>${q ? `<div>${esc(q.question)}</div>${q.choices.map((c, i) => `<button class="choice" data-q="${i}">${"ABCD"[i]}. ${esc(c)}</button>`).join("")}<div id="qres" class="sub"></div>` : '<span class="sub">なし</span>'}</div>`;
    }
    if (a.rec) {
      const ms = r.mistakes || [];
      h += '<div class="blk"><h3>間違いの記録</h3><div class="mis">' + (ms.length ? ms.map((m, i) => '<span class="tag">' + esc(m.cat) + ' ・ ' + esc(m.date || '日付なし') + ' ・ ' + esc(SRC[m.src] || '手動') + '<button data-mdel="' + i + '" title="この記録を消す" aria-label="この記録を消す">×</button></span>').join('') : '<span class="sub">間違いの記録は、ありません。</span>') + '</div>'
        + '<div class="row"><select id="mCat" aria-label="分類">' + Clean.CATS.map(c => '<option>' + esc(c) + '</option>').join('') + '</select><button id="mAdd">＋ 間違いを記録</button></div></div>';
    }
    $("#aux").innerHTML = h;
  }

  $("#aux").onclick = async e => {
    const r = cur();
    const md = e.target.closest("[data-mdel]");
    if (md && r) { r.mistakes.splice(+md.dataset.mdel, 1); await Store.put(r, "sentences"); renderAux(r); $("#stInfo").textContent = infoText(r); return }
    if (e.target.closest("#mAdd") && r) { await addMistake(r, $("#mCat").value, "manual"); renderAux(r); $("#stInfo").textContent = infoText(r); return }
    const b = e.target.closest("button[data-q]");
    if (!b || !r || !r.quiz || b.parentElement.dataset.done) return;
    const i = +b.dataset.q, ok = i === r.quiz.answer;
    b.parentElement.dataset.done = "1";
    b.parentElement.querySelectorAll("button[data-q]").forEach(x => { if (+x.dataset.q === r.quiz.answer) x.classList.add("ok"); else if (x === b) x.classList.add("ng") });
    $("#qres").textContent = (ok ? "正解。" : "不正解。") + r.quiz.explanation;
    await countReview(r, "sentences"); // 4択に答えると、復習1回
    if (!ok) { await addMistake(r, r.quiz.type, "quiz"); toast("間違いを記録しました(分類: " + Clean.catOf(r.quiz.type) + ")"); if (prefs.aux.rec) renderAux(r) } // 間違えたら、分類つきで記録
    $("#stInfo").textContent = infoText(r);
  };

  // 表示のボタン: 区切りの見方(data-v)・補助(data-x)・品詞の色(data-p)は、どれも独立した入り切り
  $("#segShow").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) toggleView(b.dataset.v); else if (b.dataset.x) toggleAux(b.dataset.x); else if (b.dataset.g) toggleGram();
  };
  $("#shGap").onchange = $("#pGap").onchange = e => { prefs.sh.gap = +e.target.value; $("#shGap").value = $("#pGap").value = String(prefs.sh.gap); savePrefs() };
  $("#shRep").onchange = $("#pRep").onchange = e => { prefs.sh.rep = +e.target.value; $("#shRep").value = $("#pRep").value = String(prefs.sh.rep); savePrefs() };
  function toggleView(k) { prefs.view[k] = !prefs.view[k]; savePrefs(); renderStudy() }
  function toggleSlashMain() { prefs.slashMain = !prefs.slashMain; savePrefs(); renderStudy() }
  $("#btnSlashMain").onclick = toggleSlashMain;
  function toggleGram() { prefs.gramOn = !prefs.gramOn; savePrefs(); renderStudy() }
  function togglePos() { if (!prefs.gramOn) { prefs.gramOn = true; prefs.posOn = true } else prefs.posOn = !prefs.posOn; savePrefs(); renderStudy() }
  // 区切りをクリック → その区切りだけを、設定の回数、続けて聞く(もう一度クリックで解除)
  $("#disp").onclick = e => {
    if (e.target.closest("#posBtn")) return togglePos();
    if (e.target.closest(".vstop")) return stopAudio();
    if (disSel()) return; // 語をなぞって選んでいるときは、クリックの読み上げをしない
    const vp = e.target.closest(".vplay");
    if (vp) { // 区切りの ▶ → その区切りを、頭から順に聞く(選んだ区切りは解除)。音のつながりの ▶ → 聞き比べ
      const r = cur(); if (!r) return;
      if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
      if (vp.dataset.k === "links") { selC = null; play("links"); return }
      if (vp.dataset.k === "main") { selC = null; if (prefs.slashMain && r.slash && r.slash.length) { stopAudio(); playAll(r, "slash", r.slash.map(x => x.en), playing) } else play("once"); return }
      const key = vp.dataset.k, list = key === "phrases" ? (r.phrases || []).map(x => x.t) : (r.slash || []).map(x => x.en);
      selC = null; stopAudio(); if (list.length) playAll(r, key, list, playing); return;
    }
    const c = e.target.closest("[data-c]"), v = c && c.closest("[data-view]"), r = cur(), inFt = !!(c && c.closest(".fulltext"));
    if (!(c && r && (inFt || (v && v.dataset.view === "gram")))) { if (e.target.closest(".fulltext")) play("once"); return } // 全文をクリック → 全文を1回聞く
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    const key = inFt ? "slash" : "phrases", i = +c.dataset.c;
    if (selC && selC.id === r.id && selC.key === key && selC.i === i) { selC = null; stopAudio(); return }
    selC = { id: r.id, key, i }; stopAudio(); playSel(r, key, i, playing);
  };
  function clearViews() { for (const k of Object.keys(prefs.view)) prefs.view[k] = false; prefs.gramOn = false; prefs.slashMain = false; savePrefs(); renderStudy() }
  function toggleAux(x) { prefs.aux[x] = !prefs.aux[x]; savePrefs(); renderStudy() }
  $("#stSel").onchange = async e => { const r = cur(); if (r) { r.status = e.target.value; await Store.put(r, "sentences") } };

  // ---------- 音声(端末の読み上げ) ----------
  let selC = null; // 選んだ区切り { id: 英文の id, key: "slash" | "phrases", i: 番号 }
  let playing = 0; // 世代番号。止める・次へ行くと増やして、前の読み上げを無効にする
  const sleep = (ms, me) => new Promise(res => { const t0 = Date.now(), iv = setInterval(() => { if (me !== playing || Date.now() - t0 >= ms) { clearInterval(iv); res() } }, 80) });
  const sayTimed = async (text, rate) => { const t0 = performance.now(); await say(text, rate); return performance.now() - t0 };
  const pst = msg => { const e = $("#pstatus"); e.hidden = !msg; e.textContent = msg || ""; if (!msg) { $("#pickPst").textContent = ""; document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now")) } };
  function stopAudio() { playing++; pst(null); try { speechSynthesis.cancel() } catch {} const r = cur(); if (r && tab === "study" && study.unit === "sentence") renderDisp(r) }
  function say(text, rate = prefs.rate) {
    return new Promise(res => {
      if (!("speechSynthesis" in window)) return res();
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = rate;
      const v = speechSynthesis.getVoices().find(x => /^en[-_]US/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }
  async function play(mode) {
    const r = cur(); if (!r) return;
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    stopAudio(); const me = playing;
    if (mode === "word") return say(r.text);
    if (mode === "shadow1") { // 聞いて、まねする(意味句・IU)
      pst("聞く…"); const ms = await sayTimed(r.text); if (me !== playing) return;
      const wait = Practice.gap(ms, r.text, prefs.sh.gap, prefs.rate); pst(`声に出して、まねしてください…(${(wait / 1000).toFixed(1)}秒)`);
      await sleep(wait, me); if (me === playing) pst(null); return;
    }
    if (mode === "links") return playLinks(r, me);
    if (mode === "ex") { if (r.ex) await say(r.ex); else toast("例文がありません"); return }
    if (mode === "once") return playAll(r, null, [r.text], me); // 全文も、繰り返し・間の設定で聞く
    if (selC && selC.id === r.id) return playSel(r, selC.key, selC.i, me); // 選んだ区切りがあれば、それだけを繰り返す
    const { key, list: ch } = chunkSrc(r); showView(key); // 読む区切りを、表示に出す
    return playAll(r, key, ch, me);
  }
  // 区切りを、頭から順に聞く(only があれば、その番号の区切りだけ)。繰り返し: 同じ区切りを、設定の回数だけ続けて聞く
  // 間: 読み上げのあとに、まねする時間(同じ長さの無音)を置く。間を置いて最後まで聞いたら、復習+1
  async function playAll(r, key, ch, me, only = null) {
    const rep = prefs.sh.rep, gap = +prefs.sh.gap || 0, idx = only == null ? ch.map((_, i) => i) : [only];
    for (const i of idx) for (let k = 1; k <= rep; k++) {
      if (me !== playing) return;
      renderDisp(r, i, key); pst(rep > 1 ? `${k}回目` : "聞く");
      const ms = await sayTimed(ch[i]); if (me !== playing) return;
      if (gap) {
        const wait = Practice.gap(ms, ch[i], gap, prefs.rate);
        pst(`声に出して、まねしてください…(${(wait / 1000).toFixed(1)}秒)`);
        await sleep(wait, me);
      } else if (k < rep) await sleep(400, me);
    }
    if (me !== playing) return;
    pst(null); renderDisp(r);
    if (gap && only == null) { await countReview(r, "sentences"); renderStudy(); toast("最後まで聞きました(復習+1)") }
  }
  // 英文の中の語を、なぞって(長押しして)選ぶと、「▶ 聞く」が出る。選んだ部分だけを、繰り返し・間の設定で聞く
  function disSel() {
    const sel = window.getSelection(), d = tab === "pick" ? $("#pickList") : $("#disp");
    if (!sel || sel.isCollapsed || !sel.rangeCount || !d.contains(sel.anchorNode) || !d.contains(sel.focusNode)) return "";
    return sel.toString().replace(/\s+/g, " ").trim();
  }
  let selTimer = 0;
  function selBtnUpdate() {
    const b = $("#selPlay"), t = tab === "pick" || (tab === "study" && study.unit === "sentence") ? disSel() : "";
    if (!t) { b.hidden = true; return }
    const rc = window.getSelection().getRangeAt(0).getBoundingClientRect();
    b.hidden = false; b.style.top = Math.max(8, rc.bottom + 6) + "px"; b.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - b.offsetWidth - 8)) + "px";
  }
  document.addEventListener("selectionchange", () => { clearTimeout(selTimer); selTimer = setTimeout(selBtnUpdate, 150) });
  window.addEventListener("scroll", () => { if (!$("#selPlay").hidden) selBtnUpdate() }, { passive: true });
  // 選択画面で、英文をなぞって選んだとき、行のチェックが入れ替わらないようにする
  $("#pickList").addEventListener("click", e => { if (!e.target.closest("button") && window.getSelection().toString().trim()) e.preventDefault() }, true);
  $("#selPlay").onpointerdown = e => e.preventDefault(); // 押しても、選択が消えないように
  $("#selPlay").onclick = async () => {
    const text = disSel(); if (!text) return;
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    playing++; try { speechSynthesis.cancel() } catch {} const me = playing; // 表示は作り直さない(選択が消えるため)
    const rep = prefs.sh.rep, gap = +prefs.sh.gap || 0;
    for (let k = 1; k <= rep; k++) {
      if (me !== playing) return;
      pst(rep > 1 ? `${k}回目` : "聞く");
      const ms = await sayTimed(text); if (me !== playing) return;
      if (gap) { const wait = Practice.gap(ms, text, gap, prefs.rate); pst(`声に出して、まねしてください…(${(wait / 1000).toFixed(1)}秒)`); await sleep(wait, me) }
      else if (k < rep) await sleep(400, me);
    }
    if (me === playing) pst(null);
  };
  // 選択画面: 表示中の英文を、上から順に聞く。繰り返し: 同じ英文を、設定の回数だけ続けて聞く(英文ごと)
  $("#btnSlashPick").onclick = () => { prefs.slashMain = !prefs.slashMain; savePrefs(); renderPick() };
  // from: 聞き始める行の id(無ければ、いちばん上から)
  const playPick = async from => {
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    const list = filtered(); if (!list.length) return toast("聞く英文がありません");
    stopAudio(); const me = playing, rep = prefs.sh.rep, gap = +prefs.sh.gap || 0;
    for (let n = Math.max(0, list.findIndex(r => r.id === from)); n < list.length; n++) {
      const r = list[n];
      document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now"));
      const row = document.querySelector(`#pickList input[data-id="${r.id}"]`), li = row && row.closest(".row-i");
      if (li) { li.classList.add("now"); li.scrollIntoView({ block: "center", behavior: "smooth" }) }
      for (let k = 1; k <= rep; k++) {
        if (me !== playing) return;
        $("#pickPst").textContent = `${n + 1} / ${list.length}${rep > 1 ? ` ・ ${k}回目` : ""}`;
        const ms = await sayTimed(r.text); if (me !== playing) return;
        if (gap) { const wait = Practice.gap(ms, r.text, gap, prefs.rate); $("#pickPst").textContent = `${n + 1} / ${list.length} ・ まねする(${(wait / 1000).toFixed(1)}秒)`; await sleep(wait, me) }
        else if (k < rep) await sleep(400, me);
      }
      if (me !== playing) return;
      if (n < list.length - 1) await sleep(500, me);
    }
    if (me === playing) { pst(null); toast("最後まで聞きました") }
  };
  // 行の → を押すと、その英文から学習を始める(選んだ英文があれば、その続き。無ければ、この1文だけ)
  $("#pickList").addEventListener("click", async e => {
    const b = e.target.closest("button[data-go]"); if (!b) return; e.preventDefault();
    const id = b.dataset.go, ids = tbl(unit).filter(r => sel[unit].has(r.id)).map(r => r.id), k = ids.indexOf(id);
    study = k >= 0 ? { unit, ids, i: k } : { unit, ids: [id], i: 0 };
    wReveal = false; await saveStudy(); setTab("study");
  });
  // 行の ▶ を押すと、その行から順に聞く(チェックは変わらない)
  $("#pickList").addEventListener("click", e => { const b = e.target.closest("button[data-from]"); if (b) { e.preventDefault(); if (b.closest(".row-i.now")) { stopAudio(); document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now")); return } playPick(b.dataset.from) } });
  // 選んだ区切りを、繰り返しの回数だけ、続けて聞く
  function playSel(r, key, i, me) {
    const list = key === "phrases" ? (r.phrases || []).map(x => x.t) : (r.slash || []).map(x => x.en);
    if (list[i]) return playAll(r, key, list, me, i);
  }

  // つながりを聞く: つながって聞こえる所(2語以上のまとまり)を、ゆっくり → ふつうの速さの順に、聞き比べる
  async function playLinks(r, me) {
    if (!await Pron.load()) return toast("発音辞書を読み込めませんでした(通信できない可能性)");
    if (me !== playing) return;
    if (!prefs.aux.ipa) { prefs.aux.ipa = true; savePrefs(); renderStudy() }
    const gs = Pron.links(r.text), n = gs.filter(g => g.linked).length;
    if (!n) return toast("この英文には、つながりの所が、ありません");
    for (let i = 0; i < gs.length; i++) {
      if (!gs[i].linked) continue;
      if (me !== playing) return;
      renderDisp(r, i, "links"); pst("つながり: " + gs[i].t + "(ゆっくり → ふつう)");
      await say(gs[i].t, Math.min(prefs.rate, 0.7)); if (me !== playing) return; await sleep(350, me);
      if (me !== playing) return; await say(gs[i].t, prefs.rate); if (me !== playing) return; await sleep(600, me);
    }
    if (me === playing) { pst(null); renderDisp(r) }
  }


  // ---------- ショートカット ----------
  document.addEventListener("keydown", e => {
    if (tab !== "study" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.closest && e.target.closest("button") && e.key === " ")) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft") return go(-1);
    if (k === "arrowright") return go(1);
    if (k === "s") return stopAudio();
    const map = {}, ax = { i: "ipa", j: "ja", v: "vocab", q: "quiz", k: "rec" };
    if (k === " ") { e.preventDefault(); play("once") } else if (k === "c") play("chunks"); else if (k === "l") play("links");
    else if (k === "1") toggleSlashMain(); else if (k === "2" || k === "g") toggleGram(); else if (k === "3") togglePos(); else if (k === "0") clearViews();
    else if (map[k]) toggleView(map[k]); else if (ax[k]) toggleAux(ax[k]);
  });

  // ---------- 記録と復習 ----------
  let reviewLog = {};          // { "2026-10-10": {sentence, word, chunk} } 日ごとの復習回数(この端末だけ。同期しない)
  let weakDays = 7, weakCat = null;
  const KIND_UNIT = { sentences: "sentence", words: "word", chunks: "chunk" };

  // 復習を1回数える(回数・最終復習日・日ごとの記録)
  async function countReview(r, kind) {
    r.review_count++; r.last_reviewed = today(); await Store.put(r, kind);
    const d = Stats.ymd(), e = reviewLog[d] || (reviewLog[d] = {}), u = KIND_UNIT[kind];
    e[u] = (e[u] || 0) + 1; Store.setMeta("log", Stats.prune(reviewLog)).catch(() => {});
  }
  // 間違いを記録する(分類・日付・どこで間違えたか)
  async function addMistake(r, cat, src, kind = "sentences") { (r.mistakes ||= []).push({ cat: Clean.catOf(cat), date: Stats.ymd(), src }); await Store.put(r, kind) }
  const SRC = { quiz: "4択", dict: "聞き取り", manual: "手動" };
  const infoText = r => [r.review_count ? `復習 ${r.review_count} 回 ・ 最終 ${r.last_reviewed || "-"}` : "", (r.mistakes || []).length ? `間違い ${r.mistakes.length} 件` : ""].filter(Boolean).join(" ・ ");

  // 学習セットを作って、学習を始める
  async function startSet(u, ids) {
    if (!ids.length) return toast("対象がありません");
    study = { unit: u, ids, i: 0 }; await saveStudy(); setTab("study");
  }

  function renderRec() {
    // 学習の状況
    const head = "<tr><th></th><th>未学習</th><th>学習中</th><th>覚えた</th><th>復習の合計</th></tr>";
    $("#recStatus").innerHTML = head + ["sentence"].map(u => {
      const t = tbl(u), c = s => t.filter(r => r.status === s).length;
      return `<tr><td><b>${UN[u].name}</b></td><td>${c("new")}</td><td>${c("learning")}</td><td>${c("mastered")}</td><td>${t.reduce((a, r) => a + (r.review_count || 0), 0)} 回</td></tr>`;
    }).join("");
    // 復習の記録
    const days = Stats.lastDays(reviewLog, 14), sum = n => days.slice(-n).reduce((a, d) => a + d.total, 0), max = Math.max(1, ...days.map(d => d.total));
    $("#recSummary").textContent = `今日 ${sum(1)} 回 ・ 直近7日 ${sum(7)} 回 ・ 直近14日 ${sum(14)} 回 ・ 連続 ${Stats.streak(reviewLog)} 日`;
    $("#recBars").innerHTML = days.map(d => `<div class="b ${d.total ? "" : "zero"}" title="${d.date}: 英文 ${d.sentence}"><span>${d.total || ""}</span><i style="height:${Math.round((d.total / max) * 70)}px"></i><span>${+d.date.slice(8)}</span></div>`).join("");
    // 弱点
    document.querySelectorAll("#segWeak button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.w === weakDays || (!weakDays && b.dataset.w === "0"))));
    const wk = Stats.weak(rows, weakDays || null), top = Math.max(1, ...wk.map(x => x.n));
    if (weakCat && !wk.some(x => x.cat === weakCat)) weakCat = null;
    $("#recWeak").innerHTML = wk.length ? wk.map(x => `<div class="wk ${x.cat === weakCat ? "on" : ""}" data-cat="${esc(x.cat)}"><span class="lab">${esc(x.cat)}</span><span class="bar2"><i style="width:${Math.round((x.n / top) * 100)}%"></i></span><span class="n">${x.n} 件</span></div>`).join("")
      : '<p class="sub">この期間の間違いの記録は、ありません。4択に間違える、聞き取りで間違える、または、英文の「間違いの記録」で手動で追加すると、ここに集計されます。</p>';
    const cat = weakCat && wk.find(x => x.cat === weakCat);
    const list = cat ? rows.filter(r => cat.ids.includes(r.id)) : [];
    $("#recWeakList").innerHTML = cat ? `<div class="row"><b>${esc(weakCat)}</b><span class="sub">の英文 ${list.length} 文</span><span class="grow"></span><button id="wkGo" class="pri">この分類の英文を復習する</button></div>`
      + list.map(r => `<div class="row-i"><span class="t">${esc(r.text)}<span class="m"><br>${esc(r.ja)}</span></span></div>`).join("") : "";
    $("#rvMisInfo").textContent = `${Stats.mistaken(rows, weakDays || null).length} 文`;
  }
  $("#segWeak").onclick = e => { const b = e.target.closest("button[data-w]"); if (b) { weakDays = +b.dataset.w; weakCat = null; renderRec() } };
  $("#recWeak").onclick = e => { const x = e.target.closest(".wk"); if (x) { weakCat = weakCat === x.dataset.cat ? null : x.dataset.cat; renderRec() } };
  $("#recWeakList").onclick = e => {
    if (!e.target.closest("#wkGo")) return;
    const cat = Stats.weak(rows, weakDays || null).find(x => x.cat === weakCat);
    if (cat) startSet("sentence", rows.filter(r => cat.ids.includes(r.id)).map(r => r.id));
  };
  $("#rvGo").onclick = () => {
    const u = "sentence", n = Math.max(1, Math.min(200, +$("#rvN").value || 10));
    startSet(u, Stats.reviewOrder(tbl(u), n).map(r => r.id));
  };
  $("#rvMis").onclick = () => startSet("sentence", Stats.mistaken(rows, weakDays || null).map(r => r.id));

  // ---------- 発音記号(辞書から) ----------
  const lackIpa = () => ({
    w: words.filter(x => !x.ipa).length, c: chunks.filter(x => !x.ipa).length,
    s: rows.filter(r => (r.slash || []).some(x => !x.ipa) || (r.iu || []).some(x => !x.ipa) || (r.vocab || []).some(x => !x.ipa)).length
  });
  function renderIpa() {
    const l = lackIpa();
    $("#ipaInfo").textContent = rows.length ? (l.s ? `発音記号が無い英文: ${l.s} 文` : "すべてに、発音記号があります。") : "英文を登録すると、ここから付けられます。";
    $("#btnIpa").disabled = !l.s;
  }
  // 発音記号が無いものに、辞書から付ける(すでにあるものは、そのまま)。付けた数を返す。辞書を読み込めなければ null
  async function fillIpa() {
    if (!await Pron.load()) return null;
    const out = { s: 0 }, rs = [];
    for (const r of rows) if (Pron.fillSentence(r)) { out.s++; rs.push(r) }
    if (rs.length) await Store.put(rs, "sentences");
    return out;
  }
  $("#btnIpa").onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "辞書を読み込み中…";
    try {
      const r = await fillIpa();
      toast(r ? `発音記号を付けました: 英文 ${r.s} 文` : "辞書を読み込めませんでした(通信できない可能性)");
    } finally { b.textContent = "発音記号を辞書から付ける"; renderAll() }
  };

  // ---------- AI で解析(Gemini API / コピペモード) ----------
  // 足りない解析がある英文
  const needsAI = r => !r.ja || !r.slash || !r.phrases || !r.words || !r.iu || !(r.vocab && r.vocab.length) || !r.quiz;
  let aiBusy = false, aiStop = false, aiMode = "api";

  function renderAI() {
    const n = rows.filter(needsAI).length, c = AI.cfg;
    $("#aiInfo").textContent = n ? `解析が足りない英文: ${n} 文` : (rows.length ? "すべての英文に、解析があります。" : "英文を登録すると、ここから解析できます。");
    $("#btnAI").disabled = aiBusy || !n; $("#btnAICopy").disabled = aiBusy || !n; $("#btnAIStop").hidden = !(aiBusy && aiMode === "api");
    $("#aiInfo2").textContent = n ? `解析が足りない英文: ${n} 文` : (rows.length ? "すべての英文に、解析があります。" : "");
    if (document.activeElement !== $("#apiKey")) $("#apiKey").value = c.apiKey;
    if (document.activeElement !== $("#aiModel")) $("#aiModel").value = c.model;
  }
  $("#aiSave").onclick = async () => {
    await AI.save({ mode: "api", apiKey: $("#apiKey").value, model: $("#aiModel").value });
    renderAI(); toast("設定を保存しました");
  };

  // AI の1文分の結果を、英文に足す。検査を通ったものだけ(解析・状態・記録は上書きしない)。足したら true
  async function applyAI(row, res) {
    if (!res || typeof res !== "object" || Array.isArray(res)) return false;
    const add = Clean.sentence({ text: row.text, level: res.difficulty, quiz: res.quiz, analysis: res });
    if (!add) return false;
    const had = !!row.ja, hadVocab = !!(row.vocab && row.vocab.length), c = Clean.fill(row, add);
    if (c) {
      if (await Pron.load()) Pron.fillSentence(row, { override: !hadVocab }); // 発音記号は、AI ではなく、辞書から(辞書に無い語は、AI のものを残す)
      if (!had && row.ja) row.verified = false; // AI の解析は「未確認」
      await Store.put(row, "sentences");
      await importWords(Clean.wordsOf(row)); await importChunks(Clean.chunksOf(row)); // 単語・意味句・IU の表にも入れる
    }
    return c;
  }

  async function runAI(mode) {
    const targets = rows.filter(needsAI);
    if (!targets.length || aiBusy) return;
    if (mode === "api" && !AI.cfg.apiKey) { $("#aiSet").open = true; return toast("Gemini API キーを入力してください(API キーが無いときは、「② 他の AI のチャットで JSON を作って登録」へ)") }
    aiBusy = true; aiMode = mode; aiStop = false; let done = 0, skipped = 0, err = "";
    renderAI();
    try {
      if (mode === "api") {
        for (let i = 0; i < targets.length && !aiStop; i++) {
          $("#aiProg").textContent = `解析中 ${i + 1} / ${targets.length}`;
          const res = await AI.gemini(AI.prompt.one(targets[i].text));
          if (await applyAI(targets[i], res)) done++; else skipped++;
        }
      } else {
        const N = 5, total = Math.ceil(targets.length / N);
        for (let k = 0; k < total; k++) {
          const part = targets.slice(k * N, k * N + N);
          $("#aiProg").textContent = `${k + 1} / ${total} 通目`;
          const res = await AI.copyPaste(AI.prompt.batch(part.map(r => r.text)), `コピペモード ${k + 1} / ${total} 通目(${part.length} 文)`);
          const arr = Array.isArray(res) ? res : [res];
          for (let j = 0; j < arr.length; j++) {
            const idx = Number.isInteger(arr[j] && arr[j].n) ? arr[j].n - 1 : j; // n(番号)があれば、それで英文を決める
            if (part[idx] && await applyAI(part[idx], arr[j])) done++; else skipped++;
          }
        }
      }
    } catch (e) { err = e.message }
    aiBusy = false; $("#aiProg").textContent = ""; renderAll();
    toast(`解析: ${done} 文に追加${skipped ? `、${skipped} 文は、検査を通らず見送り` : ""}${aiStop ? "(止めました)" : ""}${err ? "。中断: " + err : ""}`);
  }
  $("#btnAI").onclick = () => runAI("api");
  $("#btnAICopy").onclick = () => runAI("copy");
  $("#btnAIStop").onclick = () => { aiStop = true };

  function renderAll() { if (tab === "rec") renderRec(); renderReg(); renderAI(); renderIpa(); if (tab === "pick") renderPick(); if (tab === "study") renderStudy() }

  // ---------- 起動 ----------
  (async () => {
    try {
      await AI.load();
      reviewLog = await Store.getMeta("log", {}) || {};
      rows = await Store.all("sentences"); words = await Store.all("words"); chunks = await Store.all("chunks");
      const p = await Store.getMeta("prefs", null);
      if (p && typeof p === "object") prefs = { ...prefs, ...p, aux: { ...prefs.aux, ...(p.aux || {}) }, waux: { ...prefs.waux, ...(p.waux || {}) }, sh: { ...prefs.sh, ...(p.sh || {}) }, pick: { ...prefs.pick, ...(p.pick || {}) }, view: { ...prefs.view, ...(p.view || {}) } };
      // 古い設定(見方を1つだけ選ぶ形)から移す
      if (p && p.disp === "pos") prefs.posOn = true; else if (p && p.disp && prefs.view[p.disp] === false) prefs.view[p.disp] = true;
      delete prefs.disp;
      if (p && p.gramOn === undefined && (p.posOn || (p.view && p.view.phrases) || (p.aux && p.aux.grammar))) prefs.gramOn = true; // 文法区切り・品詞・文法を、「文法」にまとめた
      delete prefs.view.phrases; delete prefs.aux.grammar;
      if (!p || !p.aux || p.aux.vocab === undefined) prefs.aux.vocab = !!prefs.aux.ja; // 「和訳」から「単語」を分けた(それまで和訳を出していれば、単語も出す)
      if (p && p.aux && p.aux.toeic) prefs.gramOn = true; // TOEIC解説を、「文法」にまとめた
      delete prefs.aux.toeic;
      if (!p || !p.sh || p.sh.v !== 2) prefs.sh.gap = 0; // シャドーイングを、区切りの ▶ にまとめた(間の初期値は「なし」)
      prefs.sh.v = 2;
      if (p && p.slashMain === undefined && p.view && p.view.slash) prefs.slashMain = true; // 英文ボタンを、左上の [/] にまとめた
      delete prefs.view.slash;
      if (p && p.view && p.view.links) prefs.aux.ipa = true; // 音のつながりを、「IPA」にまとめた
      delete prefs.view.links;
      if (p && p.view && p.view.iu) prefs.slashMain = true; // 音区切りを、「意味区切り」にまとめた
      delete prefs.view.iu;
      const s = await Store.getMeta("study", null);
      if (s && Array.isArray(s.ids)) {
        const u = UN[s.unit] ? s.unit : "sentence", ok = new Set(tbl(u).map(r => r.id));
        study = { unit: u, ids: s.ids.filter(id => ok.has(id)), i: Math.max(0, +s.i || 0) }; if (study.i >= study.ids.length) study.i = 0;
      }
    } catch (e) { toast("保存先(IndexedDB)を開けませんでした: " + e.message) }
    renderAll();
    // はじめて開いたとき(英文が1つも無いとき)は、同期しなくても読めるよう、同梱のサンプル英文を自動で入れる。1回だけ(あとで全削除しても、入れ直さない)
    try {
      if (!rows.length && !await Store.getMeta("samplesAuto", false)) {
        await Store.setMeta("samplesAuto", true);
        await loadSamples();
      }
    } catch (e) { toast("サンプル英文を読み込めませんでした: " + e.message) }
    // クラウド同期(あれば、起動時に1回同期する)
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    await Sync.init({
      table: k => (k === "word" ? words : k === "chunk" ? chunks : rows),
      sortAll: () => { rows.sort(byId); words.sort(byId); chunks.sort(byId) }, // id は作った順に並ぶ
      refresh: () => { study.ids = study.ids.filter(id => tbl(study.unit).some(r => r.id === id)); if (study.i >= study.ids.length) study.i = 0; renderAll() },
      importPayload, toast
    });
    if (Sync.wantsJoin) setTab("sync");
  })();
})();
