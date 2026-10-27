// 入力の検査。外から届くデータ(ファイル・AI・受信箱)は、必ずここを通してから入れる。
// 形が合わない部分だけを捨て、ほかは残す。試作(eng-analyzer)の検査を、英文の表に合わせて移したもの。
const Clean = (() => {
  const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();

  const POS = { n: "名詞", pron: "代名詞", v: "動詞", aux: "助動詞", adj: "形容詞", adv: "副詞", prep: "前置詞", conj: "接続詞・関係詞", det: "冠詞・限定詞", other: "その他" };
  const STATUS = { new: "未学習", learning: "学習中", mastered: "覚えた" };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 発音記号: 記号として使える文字だけ。/ / や [ ] は外して中身だけ持つ
  function ipa(s) {
    if (typeof s !== "string") return "";
    const t = s.trim().replace(/^[\/\[]+|[\/\]]+$/g, "").trim();
    return t.length > 0 && t.length <= 80 && /^[A-Za-zÀ-Ͽᴀ-ᶿ‿.\s()\-]+$/.test(t) ? t : "";
  }

  // 品詞の色分け: 語を半角スペースでつなぐと原文と一致するときだけ採用
  function words(ws, text) {
    if (!Array.isArray(ws) || ws.length < 1 || ws.length > 200) return null;
    const out = [];
    for (const x of ws) {
      if (!x || typeof x.w !== "string" || !x.w || !has(POS, x.p)) return null;
      out.push(typeof x.m === "string" && x.m.trim() ? { w: x.w, p: x.p, m: clip(x.m, 24) } : { w: x.w, p: x.p });
    }
    return norm(out.map(x => x.w).join(" ")) === norm(text) ? out : null;
  }

  // 区切りの形: 区切りをつなぐと原文と一致するときだけ採用
  function phrases(ps, text) {
    if (!Array.isArray(ps) || ps.length < 2 || ps.length > 12) return null;
    const out = [];
    for (const x of ps) {
      const t = clip(x && x.t, 300), f = clip(x && x.f, 40);
      if (!t || !f) return null;
      out.push({ t, f });
    }
    return norm(out.map(x => x.t).join(" ")) === norm(text) ? out : null;
  }

  // スラッシュリーディング(意味句): [{en, ja}]。英語をつなぐと原文と一致するときだけ
  function slash(sl, text) {
    if (!Array.isArray(sl) || sl.length < 2 || sl.length > 12) return null;
    const out = [];
    for (const x of sl) {
      const en = clip(x && x.en, 300), ja = clip(x && x.ja, 200), p = ipa(x && x.ipa);
      if (!en) return null;
      out.push(p ? { en, ja, ipa: p } : { en, ja });
    }
    return norm(out.map(x => x.en).join(" ")) === norm(text) ? out : null;
  }

  // イントネーション・ユニット(IU): [{t, ipa?}]。つなぐと原文と一致するときだけ。1つだけの文もある
  function iu(list, text) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 8) return null;
    const out = [];
    for (const x of list) {
      const t = clip(x && x.t, 300), p = ipa(x && x.ipa);
      if (!t) return null;
      out.push(p ? { t, ipa: p } : { t });
    }
    return norm(out.map(x => x.t).join(" ")) === norm(text) ? out : null;
  }

  function vocab(v) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, 40).filter(x => x && typeof x.word === "string" && x.word.trim()).map(x => ({
      word: clip(x.word, 100), pos: clip(x.pos, 40), meaning: clip(x.meaning, 300), note: clip(x.note, 500),
      ipa: ipa(x.ipa), level: Math.min(3, Math.max(0, +x.level || 0)), toeic: clip(x.toeic, 500)
    }));
  }

  function grammar(g) {
    if (!Array.isArray(g)) return [];
    return g.slice(0, 12).filter(x => x && x.point).map(x => ({ point: clip(x.point, 100), explanation: clip(x.explanation, 800) }));
  }

  // 文構造: 主節の要素(S V O C M)・節・文型・時制
  function structure(a) {
    const o = {};
    o.elements = (Array.isArray(a.elements) ? a.elements : []).slice(0, 20).filter(x => x && typeof x.text === "string" && x.text.trim())
      .map(x => ({ text: clip(x.text, 300), role: ["S", "V", "O", "C", "M"].includes(x.role) ? x.role : "M", note: clip(x.note, 300) }));
    o.clauses = (Array.isArray(a.clauses) ? a.clauses : []).slice(0, 12).filter(x => x && typeof x.text === "string" && x.text.trim())
      .map(x => ({ text: clip(x.text, 500), kind: clip(x.kind, 40), role: clip(x.role, 200) }));
    o.pattern = a.pattern && typeof a.pattern === "object" && !Array.isArray(a.pattern) && a.pattern.type ? { type: clip(a.pattern.type, 60), explanation: clip(a.pattern.explanation, 800) } : null;
    o.gtags = gtags(a.gtags);
    o.tense = a.tense && typeof a.tense === "object" && !Array.isArray(a.tense) && a.tense.name ? tenseOf(a.tense) : null;
    return o;
  }

  // 態(能・受)・時制(現・過・未)・相(単・進・完・完進)。主節の動詞について
  const VOICES = ["能", "受"], TNS = ["現", "過", "未"], ASPS = ["単", "進", "完", "完進"];
  function tenseOf(t) {
    const o = { name: clip(t.name, 100), explanation: clip(t.explanation, 800) };
    if (VOICES.includes(t.voice)) o.voice = t.voice;
    if (TNS.includes(t.tns)) o.tns = t.tns;
    if (ASPS.includes(t.asp)) o.asp = t.asp;
    return o;
  }
  // 明示された値を優先し、無ければ name(「現在進行形・能動態」など)から読み取る。時制が読めなければ null
  function tenseTags(t) {
    if (!t) return null;
    const name = String(t.name || ""), head = name.split(/[・(（/]/)[0];
    const tns = t.tns || (/過去/.test(head) ? "過" : /未来|will/i.test(head) ? "未" : /現在/.test(head) ? "現" : null);
    if (!tns) return null;
    const asp = t.asp || (/完了進行/.test(head) ? "完進" : /完了/.test(head) ? "完" : /進行/.test(head) ? "進" : "単");
    const voice = t.voice || (/受動|受け身/.test(name) ? "受" : "能");
    return { voice, tns, asp };
  }

  // 態・時制・相のほかの文法(英文法.txt の分類)。AI が付ける gtags [{k, t}] の検査。決まった分類・項目だけを残す
  const GT = {
    "文型": ["SV", "SVC", "SVO", "SVOO", "SVOC"],
    "助動詞": ["can", "could", "may", "might", "must", "shall", "should", "will", "would", "ought to", "have to", "be able to", "be going to", "be supposed to", "be required to", "be allowed to", "be encouraged to", "be eligible for", "be entitled to"],
    "準動詞": ["不定詞", "動名詞", "分詞"],
    "修飾": ["形容詞", "副詞", "前置詞句", "分詞", "関係詞"],
    "接続": ["等位", "従属"],
    "条件・仮定": ["条件", "仮定法"],
    "比較": ["原級", "比較級", "最上級"],
    "文の種類": ["肯定", "否定", "疑問", "命令"]
  };
  function gtags(g) {
    if (!Array.isArray(g)) return null;
    const out = [];
    for (const x of g) {
      const [k, t] = typeof x === "string" ? x.split(/[:：]/).map(v => v.trim()) : [x && x.k, x && typeof x.t === "string" ? x.t.trim() : x && x.t];
      const w = k === "準動詞" && x && typeof x.w === "string" ? x.w.trim().slice(0, 60) : ""; // 準動詞は、英文中の該当する語句(例: to submit)も持てる
      if (GT[k] && GT[k].includes(t) && !out.some(y => y.k === k && y.t === t && (y.w || "") === w)) out.push(w ? { k, t, w } : { k, t });
    }
    out.sort((a, b) => Object.keys(GT).indexOf(a.k) - Object.keys(GT).indexOf(b.k));
    return out.length ? out : null;
  }
  // 態・時制・相のほかの文法(英文法.txt の分類)を、解析の文型・節・文法ポイントと、英文そのものから拾う。[{ k: 分類, t: 表示 }]
  const AUX = ["can", "could", "may", "might", "must", "shall", "should", "will", "would", "ought to"];
  const AUXLIKE = [["have to", /\b(have|has|had) to\b/i], ["be able to", /\b(am|is|are|was|were|be|been) able to\b/i], ["be going to", /\b(am|is|are|was|were) going to\b/i], ["be supposed to", /\b(am|is|are|was|were|be) supposed to\b/i], ["be required to", /\b(am|is|are|was|were|be|been) required to\b/i], ["be allowed to", /\b(am|is|are|was|were|be|been) allowed to\b/i], ["be encouraged to", /\b(am|is|are|was|were|be|been) encouraged to\b/i], ["be eligible for", /\beligible for\b/i], ["be entitled to", /\bentitled to\b/i]];
  // 不定詞のタグに語句(to submit)が無いときは、単語の品詞から、不定詞の to と次の語を拾って補う
  const GORDER = ["文型", "文の種類"]; // 表示は、文型 → 文の種類 → ほかの順
  const gsort = l => l.map((x, i) => [GORDER.includes(x.k) ? GORDER.indexOf(x.k) : GORDER.length, i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(a => a[2]);
  function gramTags(r) { return gsort(gramTags0(r)) }
  function gramTags0(r) {
    const base = gramBase(r);
    if (!base.some(x => x.k === "準動詞" && x.t === "不定詞" && !x.w)) return base;
    const ws = r.words || [], found = [], bare = w => String(w).replace(/^[^\w']+|[^\w']+$/g, "");
    ws.forEach((x, i) => { if (x.p === "other" && String(x.w).toLowerCase() === "to" && ws[i + 1]) found.push("to " + bare(ws[i + 1].w)) });
    if (!found.length) return base;
    return base.flatMap(x => x.k === "準動詞" && x.t === "不定詞" && !x.w ? [...new Set(found)].map(w => ({ k: x.k, t: x.t, w })) : [x]);
  }
  function gramBase(r) {
    if (r.gtags && r.gtags.length) return r.gtags; // AI が付けた確かなもの。無いときだけ、下の推定
    const out = [], add = (k, t) => { if (!out.some(x => x.k === k && x.t === t)) out.push({ k, t }) };
    const text = String(r.text || ""), low = text.toLowerCase();
    const pt = String(r.pattern && r.pattern.type || ""), m = pt.match(/\(([A-Z]+)\)/);
    if (m) add("文型", m[1]);
    const gram = (r.grammar || []).map(x => String(x.point || "")).join("\n"), kinds = (r.clauses || []).map(x => String(x.kind || "")).join("\n"), all = gram + "\n" + kinds;
    for (const a of AUX) if (new RegExp("\\b" + a + "\\b", "i").test(text)) add("助動詞", a);
    if (/'ll\b/.test(low)) add("助動詞", "will");
    if (/\bcan't|\bcannot\b/.test(low)) add("助動詞", "can");
    if (/\bwon't\b/.test(low)) add("助動詞", "will");
    for (const [n, re] of AUXLIKE) if (re.test(text)) add("助動詞", n);
    if (/不定詞/.test(all)) add("準動詞", "不定詞");
    if (/動名詞/.test(all)) add("準動詞", "動名詞");
    if (/分詞/.test(all)) add("準動詞", "分詞");
    if (/関係/.test(all)) add("修飾", "関係詞");
    if (/分詞/.test(all) && /修飾/.test(all)) add("修飾", "分詞");
    if (/形容詞/.test(all)) add("修飾", "形容詞");
    if (/副詞(?!節)/.test(all)) add("修飾", "副詞");
    if (/前置詞/.test(all) || /\b(in|on|at|by|for|with|within|across|around|due to|of)\s*\+/i.test(all)) add("修飾", "前置詞句");
    if (/等位/.test(all)) add("接続", "等位");
    if (/副詞節|名詞節|従属|接続詞/.test(all)) add("接続", "従属");
    if (/仮定法/.test(all)) add("条件・仮定", "仮定法");
    else if (/\b(if|unless)\b/i.test(text) || /条件/.test(kinds)) add("条件・仮定", "条件");
    if (/最上級/.test(all)) add("比較", "最上級");
    else if (/比較級|\bthan\b/i.test(all + " " + text)) add("比較", "比較級");
    else if (/\bas\s+\w+\s+as\b/i.test(text)) add("比較", "原級");
    if (/\?\s*$/.test(text)) add("文の種類", "疑問");
    else if (/\b(not|never|nobody|nothing|none|neither|nor)\b|n't\b/i.test(text)) add("文の種類", "否定");
    else add("文の種類", /^\s*(please|do not|don't|let's)\b/i.test(text) ? "命令" : "肯定");
    return out;
  }

  function toeic(t) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return null;
    return {
      scene: clip(t.scene, 60), part: clip(t.part, 40),
      points: (Array.isArray(t.points) ? t.points : []).slice(0, 8).map(p => ({ type: clip(p && p.type, 40), detail: clip(p && p.detail, 400) })),
      paraphrase: (Array.isArray(t.paraphrase) ? t.paraphrase : []).slice(0, 8).map(s => clip(s, 120)).filter(Boolean)
    };
  }

  // 4択: 空所(______)があり、選択肢が重ならない4つで、正解の番号が範囲内のとき
  function quiz(q) {
    if (!q || typeof q !== "object" || Array.isArray(q)) return null;
    const choices = Array.isArray(q.choices) ? q.choices.map(c => clip(c, 120)) : [];
    if (choices.length !== 4 || choices.some(c => !c) || new Set(choices).size !== 4) return null;
    const ans = Number.isInteger(q.answer) ? q.answer : parseInt(q.answer, 10);
    if (!(ans >= 0 && ans < 4)) return null;
    const question = clip(q.question, 500);
    if (question.length < 5 || !question.includes("______")) return null;
    return { question, choices, answer: ans, type: clip(q.type, 40) || "その他", explanation: clip(q.explanation, 1200) };
  }

  // 間違いの分類。AI が4択に付ける分類に、「聞き取り」(聞き取り練習で間違えたとき)を足したもの
  const CATS = ["品詞", "時制", "助動詞", "受動態", "前置詞", "接続詞", "関係詞", "不定詞・動名詞", "分詞", "比較", "語彙", "構文把握", "その他", "聞き取り"];
  const catOf = c => (CATS.includes(c) ? c : "その他");
  // 間違いの記録: [{cat, date, src}]。src = quiz(4択)/ dict(聞き取り)/ manual(手動)
  function mistakes(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 300).filter(m => m && typeof m === "object").map(m => ({ cat: catOf(m.cat), date: date(m.date) || "", src: ["quiz", "dict", "manual"].includes(m.src) ? m.src : "manual" }));
  }

  // TOEIC のパート(Part 1〜7)。"Part 5" "part5" "パート5" "5" などを "Part 5" にそろえる。読み取れなければ ""
  const PARTS = ["Part 1", "Part 2", "Part 3", "Part 4", "Part 5", "Part 6", "Part 7"];
  const partNo = v => { const m = /^\s*(?:part|パート)?\s*([1-7])(?!\d)/i.exec(String(v == null ? "" : v)); return m ? "Part " + m[1] : "" };
  const partOf = r => r.part || partNo(r.toeic && r.toeic.part); // 英文のパート。part が無い古いデータは、TOEIC解説のパートから

  // ---------- AI による確認(書き出し → AI が確認・修正 → 修正として取り込み) ----------
  // 確認の対象にする項目と、画面に出す名前
  const REVIEW = { ja: "和訳", slash: "意味の区切り", phrases: "文法区切り", words: "品詞", iu: "IU", vocab: "単語", grammar: "文法の解説", toeic: "TOEIC解説", quiz: "4択", elements: "文構造", clauses: "節", pattern: "文型", tense: "時制", gtags: "他の文法", level: "難易度", part: "パート" };
  // 確認用の書き出し。学習の状態・復習・イラスト・発音記号は入れない(発音記号は辞書から付くので、AI に見せない)
  function slim(r) {
    const o = {
      text: r.text, level: r.level, part: partOf(r), groups: r.groups || [],
      analysis: {
        translation: r.ja, slash: (r.slash || []).map(x => ({ en: x.en, ja: x.ja })), words: r.words, phrases: r.phrases,
        iu: (r.iu || []).map(x => ({ t: x.t })), vocab: (r.vocab || []).map(v => { const { ipa, ...rest } = v; return rest }),
        pattern: r.pattern, clauses: r.clauses, elements: r.elements, tense: r.tense, gtags: r.gtags, grammar: r.grammar, toeic: r.toeic
      },
      quiz: r.quiz
    };
    return JSON.parse(JSON.stringify(o)); // null・undefined を落とす
  }
  const cmp = v => JSON.stringify(v, (k, x) => (k === "ipa" ? undefined : x));
  const blank = v => v == null || v === "" || (Array.isArray(v) && !v.length);
  // 検査を通した新しい英文 add と、いまの英文 ex を比べて、違う項目の名前(キー)を返す。add に無い・空の項目は、見ない
  function diffReview(ex, add) {
    return Object.keys(REVIEW).filter(k => !blank(add[k]) && cmp(ex[k]) !== cmp(add[k]));
  }
  // 違う項目を、add の内容に差し替える。発音記号が同じ語・区切りには引き継ぐ。「確認済み」にする(学習の状態・復習・間違いの記録・グループは残す)
  function applyReview(ex, add) {
    const keys = diffReview(ex, add);
    for (const k of keys) {
      const nv = add[k];
      if (k === "slash" || k === "iu" || k === "vocab") {
        const key = x => (k === "slash" ? x.en : k === "iu" ? x.t : x.word).toLowerCase();
        const old = new Map((ex[k] || []).map(x => [key(x), x.ipa]));
        nv.forEach(x => { if (!x.ipa && old.get(key(x))) x.ipa = old.get(key(x)) });
      }
      ex[k] = nv;
    }
    ex.verified = true;
    return keys;
  }

  function level(v) { const n = +v; return [600, 730, 860].includes(n) ? n : null; }
  function date(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  // 作った順に並ぶ id(IndexedDB は id 順に返すので、同じ瞬間に作ったものも、作った順になる)
  let seq = 0;
  function uid() { seq = (seq + 1) % 1296; return Date.now().toString(36) + seq.toString(36).padStart(2, "0") + Math.random().toString(36).slice(2, 6); }

  // 英文1件。text が無い・空なら null。外から来た値は、ここで作り直す(状態・復習回数なども検査する)
  function sentence(o, { keepState = false } = {}) {
    if (!o || typeof o.text !== "string") return null;
    const text = clip(o.text, 500);
    if (!text) return null;
    const a = o.analysis && typeof o.analysis === "object" ? o.analysis : o;
    const groups = [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clip(g, 40)).filter(Boolean))].slice(0, 20);
    const s = {
      id: uid(), type: "sentence", text,
      ja: clip(a.translation ?? a.ja, 500), level: level(o.level), groups, part: partNo(o.part ?? (a.toeic && a.toeic.part)),
      status: "new", review_count: 0, last_reviewed: null, mistakes: [], verified: !(a.translation || a.ja), added: Date.now(),
      words: words(a.words, text), phrases: phrases(a.phrases, text), slash: slash(a.slash, text), iu: iu(a.iu, text),
      vocab: vocab(a.vocab), grammar: grammar(a.grammar), toeic: toeic(a.toeic), quiz: quiz(o.quiz), ...structure(a)
    };
    if (keepState) {
      if (has(STATUS, o.status)) s.status = o.status;
      s.review_count = Math.max(0, Math.floor(+o.review_count || 0));
      s.last_reviewed = date(o.last_reviewed);
      s.mistakes = mistakes(o.mistakes);
      if (typeof o.verified === "boolean") s.verified = o.verified;
    }
    return s;
  }

  // すでにある英文に、足りないものだけを足す。足したら true(解析・状態・記録は上書きしない)
  function fill(ex, add) {
    let c = false;
    const set = (k, v) => { if (v && (ex[k] == null || ex[k] === "" || (Array.isArray(ex[k]) && !ex[k].length))) { ex[k] = v; c = true } };
    set("ja", add.ja); set("words", add.words);
    if (ex.words && add.words && ex.words.length === add.words.length) ex.words.forEach((x, i) => { if (!x.m && add.words[i].m && x.w === add.words[i].w) { x.m = add.words[i].m; c = true } }); // 語の意味(m)だけ足す set("phrases", add.phrases); set("slash", add.slash); set("iu", add.iu);
    if (ex.slash && add.slash && ex.slash.length === add.slash.length) ex.slash.forEach((x, i) => { if (!x.ipa && add.slash[i].ipa && x.en === add.slash[i].en) { x.ipa = add.slash[i].ipa; c = true } });
    if (ex.iu && add.iu && ex.iu.length === add.iu.length) ex.iu.forEach((x, i) => { if (!x.ipa && add.iu[i].ipa && x.t === add.iu[i].t) { x.ipa = add.iu[i].ipa; c = true } });
    set("elements", add.elements); set("clauses", add.clauses); set("pattern", add.pattern); set("tense", add.tense); set("gtags", add.gtags);
    set("grammar", add.grammar); set("toeic", add.toeic); set("quiz", add.quiz); set("level", add.level); set("part", add.part);
    set("vocab", add.vocab && add.vocab.length ? add.vocab : null);
    if (ex.vocab && add.vocab) { // 発音記号が無い単語にだけ足す
      const m = new Map(add.vocab.map(v => [v.word.toLowerCase(), v.ipa]));
      for (const v of ex.vocab) if (!v.ipa && m.get(v.word.toLowerCase())) { v.ipa = m.get(v.word.toLowerCase()); c = true }
    }
    const g = [...new Set([...(ex.groups || []), ...(add.groups || [])])];
    if (g.length !== (ex.groups || []).length) { ex.groups = g; c = true }
    return c;
  }

  // 単語の「分解」と「つながり」。parts = 語の部品 [{p, kind, mean, like}]、rel = 類義語・反意語・上位・下位、tip = 覚え方
  const PKIND = ["接頭辞", "語根", "接尾辞", "語"];
  const strs = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => clip(x, m)).filter(Boolean);
  function wordExtra(o) {
    const parts = (Array.isArray(o.parts) ? o.parts : []).slice(0, 8).filter(x => x && typeof x.p === "string" && x.p.trim())
      .map(x => ({ p: clip(x.p, 40), kind: PKIND.includes(x.kind) ? x.kind : "語", mean: clip(x.mean, 100), like: strs(x.like, 8, 60) }));
    let rel = null;
    if (o.rel && typeof o.rel === "object" && !Array.isArray(o.rel)) {
      const r = { syn: strs(o.rel.syn, 8, 60), ant: strs(o.rel.ant, 8, 60), up: strs(o.rel.up, 8, 60), down: strs(o.rel.down, 8, 60) };
      if (r.syn.length || r.ant.length || r.up.length || r.down.length) rel = r;
    }
    return { parts, rel, tip: clip(o.tip, 600) };
  }

  // 単語1件。word(または text)が無い・空なら null。
  // freq = TOEIC頻出度 1〜3、level = 難易度 600/730/860。試作の単語は、level に頻出度を入れていたので、freq が無いときは level(1〜3)を頻出度とみなす
  function word(o, { keepState = false } = {}) {
    if (!o || typeof (o.word ?? o.text) !== "string") return null;
    const text = clip(o.word ?? o.text, 100);
    if (!text) return null;
    const hasFreq = o.freq != null, lv = +o.level;
    const freq = Math.min(3, Math.max(0, Math.floor(hasFreq ? +o.freq || 0 : (lv >= 1 && lv <= 3 ? lv : 0))));
    const w = {
      id: uid(), type: "word", text, ipa: ipa(o.ipa), ja: clip(o.meaning ?? o.ja, 300), pos: clip(o.pos, 40),
      freq, level: level(o.level), note: clip(o.note, 500), toeic: clip(o.toeic, 500), ex: clip(o.ex, 500),
      groups: [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clip(g, 40)).filter(Boolean))].slice(0, 20),
      status: "new", review_count: 0, last_reviewed: null, mistakes: [], added: Date.now(), ...wordExtra(o)
    };
    if (keepState) {
      if (has(STATUS, o.status)) w.status = o.status;
      w.review_count = Math.max(0, Math.floor(+o.review_count || 0));
      w.last_reviewed = date(o.last_reviewed);
      w.mistakes = mistakes(o.mistakes);
    }
    return w;
  }

  // 意味句・IU(区切り)1件。type: "meaning" | "iu"。ex = 親の英文、idx = 何番目、n = 全部でいくつ
  const CTYPE = { meaning: "意味句", iu: "IU" };
  function chunk(o, { keepState = false } = {}) {
    if (!o || !has(CTYPE, o.type) || typeof o.text !== "string") return null;
    const text = clip(o.text, 300), ex = clip(o.ex, 500);
    const n = Math.floor(+o.n), idx = Math.floor(+o.idx);
    if (!text || !ex || !(n >= 1 && n <= 12) || !(idx >= 0 && idx < n)) return null;
    const c = {
      id: uid(), type: o.type, text, ipa: ipa(o.ipa), ja: o.type === "meaning" ? clip(o.ja, 200) : "", ex, idx, n,
      level: level(o.level), groups: [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clip(g, 40)).filter(Boolean))].slice(0, 20),
      status: "new", review_count: 0, last_reviewed: null, added: Date.now()
    };
    if (keepState) {
      if (has(STATUS, o.status)) c.status = o.status;
      c.review_count = Math.max(0, Math.floor(+o.review_count || 0));
      c.last_reviewed = date(o.last_reviewed);
    }
    return c;
  }
  const chunkKey = c => c.type + "|" + c.ex.toLowerCase() + "|" + c.idx;
  // 英文から、意味句と IU の一覧を作る。難易度・グループは、その英文のものを引き継ぐ
  function chunksOf(s) {
    const mk = (type, list, f) => (list || []).map((x, idx) => ({ type, text: f.t(x), ja: f.ja ? x.ja : "", ipa: x.ipa, ex: s.text, idx, n: list.length, level: s.level, groups: s.groups }));
    return [...mk("meaning", s.slash, { t: x => x.en, ja: true }), ...mk("iu", s.iu, { t: x => x.t })];
  }
  function fillChunk(ex, add) {
    let c = false;
    for (const k of ["ipa", "ja"]) if (!ex[k] && add[k]) { ex[k] = add[k]; c = true }
    if (!ex.level && add.level) { ex.level = add.level; c = true }
    const g = [...new Set([...(ex.groups || []), ...(add.groups || [])])];
    if (g.length !== (ex.groups || []).length) { ex.groups = g; c = true }
    return c;
  }

  // 英文の単語欄(vocab)から、単語の一覧を作る。難易度・グループ・例文は、その英文のものを引き継ぐ
  function wordsOf(s) {
    return (s.vocab || []).map(v => ({ word: v.word, pos: v.pos, meaning: v.meaning, note: v.note, ipa: v.ipa, freq: v.level, toeic: v.toeic, level: s.level, groups: s.groups, ex: s.text }));
  }

  // すでにある単語に、足りないものだけを足す。足したら true(状態・復習回数は上書きしない)
  function fillWord(ex, add) {
    let c = false;
    for (const k of ["ipa", "ja", "pos", "note", "toeic", "ex"]) if (!ex[k] && add[k]) { ex[k] = add[k]; c = true }
    for (const k of ["freq", "level"]) if (!ex[k] && add[k]) { ex[k] = add[k]; c = true }
    if (!(ex.parts && ex.parts.length) && add.parts && add.parts.length) { ex.parts = add.parts; c = true }
    if (!ex.rel && add.rel) { ex.rel = add.rel; c = true }
    if (!ex.tip && add.tip) { ex.tip = add.tip; c = true }
    const g = [...new Set([...(ex.groups || []), ...(add.groups || [])])];
    if (g.length !== (ex.groups || []).length) { ex.groups = g; c = true }
    return c;
  }

  return { tenseTags, gramTags, gtags, GT, REVIEW, slim, diffReview, applyReview, PARTS, partNo, partOf, CATS, catOf, mistakes, iu, chunk, chunkKey, chunksOf, fillChunk, CTYPE, word, wordsOf, fillWord, clip, norm, POS, STATUS, ipa, words, phrases, slash, vocab, grammar, toeic, quiz, level, date, uid, sentence, fill };
})();
