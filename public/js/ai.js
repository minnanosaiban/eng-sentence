// AI(Gemini)での解析。Gemini API を直接呼ぶ方法と、コピペモード(プロンプトを自分で Gemini に貼る)の2つ。
// AI の返事は、そのままでは使わない。clean.js の検査(原文と一致するか など)を通ったものだけを入れる。
const AI = (() => {
  const $ = s => document.querySelector(s);
  const DEFAULT = { mode: "copy", apiKey: "", model: "gemini-2.5-flash" };
  let cfg = { ...DEFAULT };

  const CATS = Clean.CATS.filter(c => c !== "聞き取り"); // 4択の「問われる論点」(聞き取りは、聞き取り練習の間違いにだけ使う)

  // ---------- プロンプト ----------
  const POS_RULE = `w は英文を半角スペースで区切った1語(句読点は語に付けたまま)。w を半角スペースでつなぐと、原文と完全に一致すること。
m は、前置詞(prep)・不定詞の to・接続詞(従属接続詞)にだけ付ける、その文での意味(短い日本語、12字以内)。「〜ために」「〜について」「〜の前に」のように、日本語にしたときの形で書き、文脈で意味が変わる語は、この文での意味にする。例: to(目的)→ 〜するために / to(方向・相手)→ 〜へ・〜に / for(目的)→ 〜のために / for(期間)→ 〜の間 / on → 〜について・〜の上に / by(期限)→ 〜までに / by(手段)→ 〜によって / before(接続詞)→ 〜する前に。それ以外の語には m を付けない。
p は品詞コードで、その文の中での働きで決める: n=名詞(固有名詞・動名詞の名詞用法を含む) / pron=代名詞(I, it, they, this など) / v=動詞(be動詞・分詞が動詞として働く場合を含む) / aux=助動詞(will, must, can, have/has/had と be の助動詞用法, do/does) / adj=形容詞(名詞を修飾する過去分詞・現在分詞を含む) / adv=副詞 / prep=前置詞 / conj=接続詞・関係詞(and, because, which, who, that(節を導く) など) / det=冠詞・限定詞(a, the, this/that+名詞, some, its, their, any など) / other=不定詞の to・数詞・記号・その他`;

  const PHRASE_RULE = `phrases は、英文を、文法上のまとまり(主語+動詞の核、to不定詞句、前置詞句、副詞節、関係詞節など)ごとに、前から順に区切ったもの(2〜8個)。t は原文の語句で、t を半角スペースでつなぐと、原文と完全に一致すること。f は、そのまとまりの文法上の形で、短い日本語(24字以内)。
f の例: 主語+動詞 / 主語+動詞+目的語 / 主語+動詞+補語 / to+不定詞句 / 動名詞句 / 分詞句 / 前置詞句 / 副詞(句) / 接続詞+節(副詞節) / 関係詞節 / 名詞節(that節) / 同格 / 比較句 / 挿入句 / 動詞+目的語(命令文)
例: "Candidates are advised to bring copies of their certificates to the interview." → [{"t":"Candidates are advised","f":"主語+動詞"},{"t":"to bring copies of their certificates","f":"to+不定詞句"},{"t":"to the interview","f":"前置詞句"}]`;

  const SLASH_RULE = `slash は、意味のまとまり(意味句)ごとに前から順に区切ったもの(2〜12個)。en は原文の語句、ja はその直訳(短く)。en を半角スペースでつなぐと、原文と完全に一致すること。`;

  const IU_RULE = `iu は、イントネーション・ユニット(一続きで読まれる、音の区切り。息継ぎ・抑揚のひとまとまり)ごとに、前から順に区切ったもの。t は原文の語句で、t を半角スペースでつなぐと、原文と完全に一致すること。
区切り方: 1つは、だいたい3〜8語(10語を超えない)。カンマの後ろで区切る。文頭の副詞(句)・副詞節は、カンマで区切って1つ。主語が長い(4語以上)ときは主語のあとで区切り、短いときは動詞とつなげる。長い文では、前置詞句・to不定詞・分詞・関係詞節・接続詞の前が区切りの候補。冠詞と名詞、前置詞とその目的語、助動詞と動詞のあいだでは区切らない。短い文(7語以下)は1つのままでよい。IU は1〜6個。
例: "Candidates are advised to bring copies of their certificates to the interview." → [{"t":"Candidates are advised"},{"t":"to bring copies of their certificates"},{"t":"to the interview."}]`;

  const SHAPE = `{
 "translation":"自然な日本語訳",
 "slash":[{"en":"意味のまとまりごとに区切った英語","ja":"その直訳(短く)"}],
 "words":[{"w":"英文を半角スペースで区切った1語","p":"品詞コード","m":"前置詞・不定詞の to・接続詞だけに付ける、この文での意味(省略可)"}],
 "phrases":[{"t":"文法上のまとまりの英語","f":"そのまとまりの形"}],
 "iu":[{"t":"イントネーション・ユニットの英語"}],
 "vocab":[{"word":"単語・熟語(原形)","pos":"品詞","meaning":"この文脈での意味","ipa":"発音記号(IPA・アメリカ英語。/ / は付けない。熟語は語ごとにスペースで区切る)","note":"補足(任意)","level":"TOEIC頻出度 1〜3 の数字(3が最頻出)","toeic":"TOEICでの典型的な使われ方・よく組む語。なければ空文字"}],
 "pattern":{"type":"第3文型(SVO) のように","explanation":"主節について、なぜその文型か"},
 "clauses":[{"text":"節の英文","kind":"主節 / 名詞節 / 関係詞節 / 副詞節 など","role":"文中での働き"}],
 "elements":[{"text":"英語の語句","role":"S|V|O|C|M のいずれか","note":"補足(任意、空文字可)"}],
 "tense":{"name":"時制・態(例: 現在形・能動態)","voice":"態(主節の動詞): 能(能動態) / 受(受動態)","tns":"時制(主節の動詞): 現 / 過 / 未","asp":"相(主節の動詞): 単(単純) / 進(進行) / 完(完了) / 完進(完了進行)","explanation":"解説"},
 "gtags":[{"k":"分類","t":"項目"}],
 "grammar":[{"point":"文法事項","explanation":"解説"}],
 "toeic":{"scene":"ビジネス場面(人事・会議・出張・契約・広告・顧客対応・社内通知・施設/設備 など1つ)","part":"この英文が出題されるパート。次のいずれか1つ: Part 1(写真描写) / Part 2(応答問題) / Part 3(会話) / Part 4(説明文) / Part 5(短文穴埋め) / Part 6(長文穴埋め) / Part 7(読解)","points":[{"type":"品詞 / 時制 / 前置詞 / 接続詞・副詞 / 関係詞 / 代名詞 / 語彙 / 語法 のいずれか","detail":"この文で問われうる論点"}],"paraphrase":["TOEICで使われそうな言い換え表現"]},
 "difficulty":600 / 730 / 860 のいずれかの数字1つ(TOEICのスコア帯の目安。600=基本的な語彙と単文中心 / 730=関係詞・分詞などで修飾が長い、ビジネス語彙を含む / 860=複数の節が入れ子になる、抽象度の高い語彙),
 "quiz":{"question":"4択の穴埋め。______ は1か所だけ。part に合わせる: Part 5 は原文の語句1つ(または短い句)を空所にした英文 / Part 6 は空所1か所を含む短い文章 / Part 1 は描写文の動詞や前置詞を空所にした文 / Part 2 は質問のあとの応答を空所にして、正しい応答を選ばせる / Part 3・4 は用件・理由・依頼など内容を問う一文の空所","choices":["A","B","C","D"],"answer":0〜3の正解インデックス,"type":"問われる論点。次のいずれか1つ: ${CATS.join(" / ")}","explanation":"正解と各誤答が不適切な理由(日本語)"}
}`;
  const RULES = `【${"slash"}の規則】${SLASH_RULE}
【品詞コードの規則(words)】${POS_RULE}
【区切りの形の規則(phrases)】${PHRASE_RULE}
【イントネーション・ユニットの規則(iu)】${IU_RULE}
他の文法(gtags)は、次の分類と項目だけを使い、この英文にある文法を漏れなく入れる(k=分類、t=項目。分類ごとに複数可。項目は下のとおり、一字一句同じに書く)。
 文型: SV / SVC / SVO / SVOO / SVOC(主節の文型。必ず1つ)
 助動詞: can / could / may / might / must / shall / should / will / would / ought to / have to / be able to / be going to / be supposed to / be required to / be allowed to / be encouraged to / be eligible for / be entitled to(文中のものすべて)
 準動詞: 不定詞 / 動名詞 / 分詞(文中のものすべて。分詞構文も含む。1つごとに別の要素にして、"w" に英文中のその語句を原文のまま入れる。例: {"k":"準動詞","t":"不定詞","w":"to submit","m":"〜することを"}。"m" は、その語句のこの文での日本語の意味を短く(12字以内)。助動詞・準動詞・修飾には "m" を付ける)
 修飾: 形容詞 / 副詞 / 前置詞句 / 分詞 / 関係詞(名詞や動詞を修飾するもの。使われているものすべて。形容詞・前置詞句は、1つごとに別の要素にして、"w" に英文中のその語句を原文のまま入れる。例: {"k":"修飾","t":"前置詞句","w":"to the interview","m":"〜へ"})
 接続: 等位(and・but・or) / 従属(because・although・when・while・if・unless・once など)
 条件・仮定: 条件(if・unless などの条件節。現実にありうること) / 仮定法(現実とは違う・現実から距離を置く表現)。なければ入れない
 比較: 原級 / 比較級 / 最上級。なければ入れない
 文の種類: 肯定 / 否定 / 疑問 / 命令(主節について、必ず1つ)
例: "All new employees must complete the safety training before they begin working." → [{"k":"文型","t":"SVO"},{"k":"助動詞","t":"must"},{"k":"準動詞","t":"動名詞","w":"working"},{"k":"接続","t":"従属"},{"k":"文の種類","t":"肯定"}]
文構造(elements)は、主節の要素を文の順に並べる(Mは修飾語句)。
単語・熟語(vocab)は、この文で学ぶ価値のあるものを3〜6個。解説は日本語。`;

  const one = s => `あなたは日本の英語教師です。次の英文を分析し、JSONのみで答えてください。
英文: ${s}

JSON形式:
${SHAPE}
${RULES}`;
  const batch = list => `あなたは日本の英語教師です。次の${list.length}個の英文それぞれを、下の「1文あたりの指示」どおりに分析し、結果を JSON 配列 [{"n":1, ...}, {"n":2, ...}] で答えてください(n は英文の番号。各要素は、指示の JSON 形式に n を加えたもの)。
英文:
${list.map((s, i) => `${i + 1}. ${s}`).join("\n")}

--- 1文あたりの指示 ---
JSON形式:
${SHAPE}
${RULES}`;

  // 他の AI のチャットで、登録用の JSON をまとめて作ってもらうプロンプトの、共通部分(出力の形・1文あたりの形・規則)
  const FILE_BODY = textRule => `【出力の形】
{"sentences":[
 {"text":"${textRule}","level":難易度(600 / 730 / 860 のいずれか),"part":"Part 1 / Part 2 / Part 3 / Part 4 / Part 5 / Part 6 / Part 7 のいずれか","groups":["グループ名(任意。なければ空の配列)"],
  "analysis":{ 下の「1文あたりの形」の translation, slash, words, phrases, iu, vocab, pattern, clauses, elements, tense, gtags, grammar, toeic },
  "quiz":{ 下の「1文あたりの形」の quiz }}
]}
sentences には、英文と同じ数・同じ順番で入れます。

【1文あたりの形】(difficulty は level に、quiz は quiz に入れ、それ以外は analysis に入れる)
${SHAPE}
${RULES}`;

  // 自分の英文を投入する版。list が空なら、英文をあとで貼るひな形
  const file = list => `あなたは日本の英語教師です。次の英文それぞれを分析して、英語学習アプリに登録するための JSON を作ってください。出力は JSON だけ(前後の説明は不要)。

${FILE_BODY("英文(原文のまま、1文字も変えない)")}

【英文】
${list && list.length ? list.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(ここに英文を、1行に1文で貼り付けてください)"}`;

  // AI が英文も作る版。o = { n: 個数, level: "混ぜる"|"600"|"730"|"860", part: "Part 5" など(空なら指定なし), scene: 場面(空なら幅広く), group: グループ名(空なら無し), memo: 自由な追加指定 }
  // 登録済みの英文の解析を、他の AI のチャットで確認・修正してもらうプロンプト。items = Clean.slim の配列
  const review = items => `あなたは日本の英語教師です。次の JSON は、TOEIC 対策の英語学習アプリに登録されている、英文とその解析(AI が作ったもの)です。間違いや不自然な点がないか確認し、直した JSON を返してください。

【確認すること】
- 和訳(translation): 英文の意味と合っているか。不自然な日本語や誤訳がないか。
- 区切り(slash・phrases・iu): つなぐと原文と完全に一致するか。区切りの位置が自然か。
- 品詞(words): 各語の品詞コードが正しいか。
- 単語(vocab): この文脈での意味が正しいか。
- 文構造・節・文型・時制・文法の解説(pattern・clauses・elements・tense・grammar): 説明が正しいか。
- 他の文法(gtags): 英文に実際にある文法だけが、漏れなく入っているか。
- TOEIC 解説(toeic): パート(part)・場面・論点が、この英文に合っているか。
- 4択(quiz): 正解が1つだけで、正解の選択肢を空所に入れると原文になるか。誤答が本当に誤りか。解説が正しいか。空所は1か所か。
- 難易度(level): 600 / 730 / 860 のどれが近いか。

【守ること】
- 英文(text)は、1文字も変えない。
- 間違いがない項目は、そのまま返す(直しすぎない)。直すときは、下の「規則」に従う。
- 出力は JSON だけ(前後の説明は不要)。次の形で、sentences は元と同じ数・同じ順番、changes は直した箇所の一覧(直した箇所がなければ空の配列)。
{"sentences":[ 元の JSON と同じ形(text, level, part, groups, analysis, quiz) ],
 "changes":[{"n":英文の番号(1から),"field":"直した項目(例: translation / slash / quiz)","before":"直す前(短く)","after":"直した後(短く)","reason":"直した理由(日本語で短く)"}]}

【規則】
${RULES}

【確認する JSON】
${JSON.stringify({ sentences: items })}`;

  // パートごとの英文の作り方(Part 1〜4 は聞き取りの文なので、1文ではなく、まとまりで作る)
  const PART_GUIDE = {
    "Part 1": "写真描写(聞き取り)。1枚の写真を見て説明する、1文。人の動作は現在進行形(is/are + -ing)、人がいない写真は物の状態(受動態・現在完了の受動態・位置の前置詞)で述べる。",
    "Part 2": "応答問題(聞き取り)。質問(または依頼・提案)と、それに合う短い応答を、1つの英文にする(例: \"When does the new office open? It opens next Monday.\")。When/Where/Who/Why/How/Which や Yes/No・依頼・提案を混ぜる。",
    "Part 3": "会話(聞き取り)。2人の会話を、話者名を付けずに、3〜4回のやり取り(3〜4文、50語前後)でつなげて1つの英文にする。用件・理由・次の行動が分かる内容にする。",
    "Part 4": "説明文(聞き取り)。1人が話す、アナウンス・留守番電話・広告・案内・発表など。3文前後(50語前後)で1つの英文にする。",
    "Part 5": "短文穴埋め。1文で、文法(品詞・時制・関係詞など)や語彙が問われうる文にする。",
    "Part 6": "長文穴埋め。メール・お知らせ・メモなどの一部を、2〜3文(40語前後)で1つの英文にする。前後の文の論理(接続副詞・代名詞など)が問われうる内容にする。",
    "Part 7": "読解。メール・記事・広告などの中の、1〜2文で、情報を読み取る文にする。"
  };
  const make = (o = {}) => {
    const n = Math.max(1, Math.min(30, parseInt(o.n, 10) || 10));
    const lv = ["600", "730", "860"].includes(String(o.level)) ? `${o.level} のみ` : "600 / 730 / 860 を混ぜる";
    const scene = (o.scene || "").trim() || "人事・会議・出張・契約・広告・顧客対応・社内通知・施設/設備 などから幅広く";
    const group = (o.group || "").trim(), pt = (o.part || "").trim();
    return `あなたは日本の英語教師です。TOEIC 対策の英語学習アプリに登録するため、①下の「作成条件」に合う英文を作り、②その英文それぞれを分析して、JSON にしてください。出力は JSON だけ(前後の説明は不要)。

【英文の作り方】
- 1つずつ独立して意味が通る、自然な英語にする(TOEIC の文章らしい文体。Part 5〜7 はビジネス英語)。
- 同じ表現・同じ話題・同じ構文を繰り返さない。
- 実在の企業名・個人名は使わない。
- パートごとの作り方(part の指定に合わせる。「おまかせ」なら、Part 1〜7 をまんべんなく混ぜる):
${Object.entries(PART_GUIDE).filter(([k]) => !pt || k === pt).map(([k, v]) => `  ・${k}: ${v}`).join("\n")}
- 1つの英文の長さは、パートの作り方に従う(Part 2〜4・6 は複数の文を、スペース区切りで1つの text にする)。

【作成条件】
- 個数: ${n}文
- 難易度(level): ${lv}
- パート(part): ${(o.part || "").trim() || "Part 1 / Part 2 / Part 3 / Part 4 / Part 5 / Part 6 / Part 7 を混ぜる"}
- 場面: ${scene}
- groups: ${group ? `["${group}"]` : "空の配列"}${(o.memo || "").trim() ? `\n- その他: ${o.memo.trim()}` : ""}

${FILE_BODY("あなたが作った英文(1文字も変えずに、slash・words・phrases・iu と一致させる)")}`;
  };

  // ---------- 返事の読み取り ----------
  function parseLoose(t) {
    t = String(t || "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
    try { return JSON.parse(t) } catch {}
    const s = t.search(/[\[{]/); if (s < 0) throw new Error("JSON が見つかりません");
    const close = t[s] === "[" ? "]" : "}", e = t.lastIndexOf(close);
    return JSON.parse(t.slice(s, e + 1));
  }

  // ---------- Gemini API ----------
  async function gemini(prompt, temp = 0.2) {
    if (!cfg.apiKey) throw new Error("Gemini API キーが入っていません。下の設定に入力するか、「コピペモード」に切り替えてください。");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: temp } })
    });
    let j = {}; try { j = await r.json() } catch {}
    if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
    const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("");
    return parseLoose(t);
  }

  // ---------- コピペモード ----------
  async function copyText(text, ta) {
    try { await navigator.clipboard.writeText(text) } catch { ta.select(); document.execCommand("copy") }
  }
  // プロンプトを見せ、利用者が Gemini に貼って得た返事を、貼り付けてもらう。title は「何通目か」などの表示
  function copyPaste(prompt, title) {
    const full = prompt + "\n\n【出力形式】JSON だけを ```json のコードブロック1つで出力してください。前後の説明は不要です。";
    return new Promise((resolve, reject) => {
      const d = $("#cpDlg"); $("#cpTitle").textContent = title || "コピペモード"; $("#cpPrompt").value = full; $("#cpIn").value = ""; $("#cpErr").textContent = "";
      let settled = false; const fin = (ok, v) => { if (settled) return; settled = true; d.close(); ok ? resolve(v) : reject(v) };
      $("#cpCopy").onclick = () => copyText(full, $("#cpPrompt")).then(() => { $("#cpErr").textContent = "コピーしました。Gemini に貼り付けて送り、返事を下に貼ってください。" });
      $("#cpOk").onclick = () => { try { fin(true, parseLoose($("#cpIn").value)) } catch (e) { $("#cpErr").textContent = "返事を読み取れませんでした: " + e.message + "\n返事の全体をコピーして貼り付けてください。" } };
      $("#cpCancel").onclick = () => fin(false, new Error("キャンセルしました"));
      d.oncancel = () => fin(false, new Error("キャンセルしました"));
      d.showModal();
    });
  }

  // ---------- 設定 ----------
  return {
    CATS, prompt: { one, batch, review, file, make }, parseLoose, gemini, copyPaste,
    get cfg() { return cfg },
    async load() { try { const c = await Store.getMeta("ai", null); if (c && typeof c === "object") cfg = { ...DEFAULT, ...c } } catch {} return cfg },
    async save(c) {
      cfg = { mode: c.mode === "api" ? "api" : "copy", apiKey: String(c.apiKey || "").trim(), model: String(c.model || "").trim() || DEFAULT.model };
      await Store.setMeta("ai", cfg); // API キーは、この端末の中だけ(同期・バックアップには入れない)
    }
  };
})();
