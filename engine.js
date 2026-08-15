/* 깨진 글자 복구 엔진.
 *
 * ⚠ 엔진 원본은 이 파일이다. 예전에는 index.html 안에 있었고 test/sync.js 가 사본을
 *   떠서 테스트에 썼는데, 다국어로 가면서 언어별 페이지가 엔진을 공유해야 해서 옮겼다.
 *   사본이 사라졌으므로 test/sync.js 도 없앴다 — 테스트가 이 파일을 직접 부른다.
 *
 * ⚠ 이 파일은 언어 중립이다. 언어별 분기를 넣지 말 것.
 *   화면에 보이는 글자는 langHint() 가 돌려주는 "키" 를 화면 코드가 I18N 에서 찾아 쓴다.
 *
 * ⚠ <script type="module"> 로 부르지 말 것. file:// 에서 CORS 로 막힌다 (실측 확인).
 *   이 프로젝트는 더블클릭으로 열리는 것이 원칙이라(기획서 3.1) 일반 <script src> 만 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node (테스트)
  else root.MojiEngine = api;                                              // 브라우저
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

/* ─────────── 인코딩 정의 ─────────── */
// type sb = 단일바이트, mb = 멀티바이트(2바이트 조합 순회 필요)
const SPEC = {
  'windows-1252':{t:'sb'}, 'windows-1251':{t:'sb'}, 'windows-1250':{t:'sb'},
  'windows-1253':{t:'sb'}, 'windows-1254':{t:'sb'}, 'windows-1255':{t:'sb'},
  'windows-1256':{t:'sb'}, 'windows-1257':{t:'sb'}, 'koi8-r':{t:'sb'},
  'ibm866':{t:'sb'}, 'macintosh':{t:'sb'}, 'x-mac-cyrillic':{t:'sb'},
  'euc-kr':   {t:'mb', leads:[[0x81,0xFE]],             trails:[[0x41,0xFE]]},
  'shift_jis':{t:'mb', leads:[[0x81,0x9F],[0xE0,0xFC]], trails:[[0x40,0xFC]]},
  'gbk':      {t:'mb', leads:[[0x81,0xFE]],             trails:[[0x40,0xFE]]},
  'big5':     {t:'mb', leads:[[0x81,0xFE]],             trails:[[0x40,0xFE]]},
  'gb18030':  {t:'mb', leads:[[0x81,0xFE]],             trails:[[0x40,0xFE]]}
};

// 잘못 읽은 쪽(Y) 후보. latin1-raw 는 0x00~0xFF 를 그대로 U+0000~U+00FF 로 읽는 방식.
// windows-1252 와 달리 0x80~0x9F 를 제어문자로 남기기 때문에 실제 깨짐에서 매우 흔하다.
const MISREAD = ['latin1-raw','windows-1252','windows-1251','koi8-r','ibm866',
                 'macintosh','x-mac-cyrillic','euc-kr','shift_jis','gbk','big5'];

// 진짜 인코딩(X) 후보
const ACTUAL = ['utf-8','euc-kr','shift_jis','euc-jp','gbk','big5',
                'windows-1251','windows-1252','windows-1250','windows-1253',
                'windows-1254','windows-1255','windows-1256','windows-1257',
                'koi8-r','iso-8859-7','iso-8859-2','utf-16le',
                'iso-2022-jp','gb18030'];

/* ─────────── 역변환 테이블 (지연 생성 + 캐시) ─────────── */
const encCache = {};
function buildEncoder(name){
  if(encCache[name]) return encCache[name];
  const spec = SPEC[name];
  if(!spec) return null;
  const dec = new TextDecoder(name);
  const map = new Map();
  const b1 = new Uint8Array(1);
  for(let b=0;b<256;b++){
    b1[0]=b;
    const c = dec.decode(b1);
    if(c.length===1 && c!=='\uFFFD' && !map.has(c)) map.set(c,[b]);
  }
  if(spec.t==='mb'){
    const b2 = new Uint8Array(2);
    for(const [la,lb] of spec.leads){
      for(let a=la;a<=lb;a++){
        for(const [ta,tb] of spec.trails){
          for(let b=ta;b<=tb;b++){
            b2[0]=a; b2[1]=b;
            const c = dec.decode(b2);
            if(c.length===1 && c!=='\uFFFD' && !map.has(c)) map.set(c,[a,b]);
          }
        }
      }
    }
  }
  encCache[name]=map;
  return map;
}

function encodeWith(str,name){
  const out=[];
  if(name==='latin1-raw'){
    for(let i=0;i<str.length;i++){
      const c=str.charCodeAt(i);
      if(c>255) return null;
      out.push(c);
    }
    return new Uint8Array(out);
  }
  const map=buildEncoder(name);
  if(!map) return null;
  for(const ch of str){
    const v=map.get(ch);
    // 이 인코딩으로 만들어질 수 없는 글자가 있으면 가설이 틀린 것이다.
    // 예전엔 0x3F('?')를 밀어넣고 계속 진행했는데, 바이트가 오염된 채로
    // 점수만 높게 나와 "??" 같은 가짜 답을 1순위로 내놓는 원인이었다.
    if(!v) return null;
    for(let k=0;k<v.length;k++) out.push(v[k]);
  }
  return new Uint8Array(out);
}

/* ─────────── 문자 분류 & 채점 ─────────── */
const ACCENT = new Set(Array.from("àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿšžœÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŠŽŒßğıİşĞŞçÇåäöÅÄÖøæÆØ"));

function bucket(cp,ch){
  if(cp===9||cp===10||cp===13||cp===32) return 'ws';
  if(cp<32) return 'ctrl';
  if(cp<0x80) return (cp>=0x30&&cp<=0x39)||(cp>=0x41&&cp<=0x5A)||(cp>=0x61&&cp<=0x7A) ? 'ascii':'punct';
  if(cp<0xA0) return 'c1';
  if(cp>=0x100&&cp<0x180) return 'accent';
  if(cp<0x250) return ACCENT.has(ch) ? 'accent':'latinodd';
  if(cp>=0x370&&cp<0x400) return 'greek';
  if(cp>=0x400&&cp<0x530) return 'cyrillic';
  if(cp>=0x590&&cp<0x600) return 'hebrew';
  if(cp>=0x600&&cp<0x700) return 'arabic';
  if(cp>=0xE00&&cp<0xE80) return 'thai';
  if(cp>=0x1100&&cp<0x1200) return 'jamo';
  if(cp>=0x1E00&&cp<0x1F00) return 'accent';
  if(cp>=0x2000&&cp<0x2070) return 'punct';
  if(cp>=0x2070&&cp<0x2C00) return 'symbol';
  if(cp>=0x3000&&cp<0x3040) return 'cjkpunct';
  if(cp>=0x3040&&cp<0x3100) return 'kana';
  if(cp>=0x3130&&cp<0x3190) return 'jamo';
  if(cp>=0x3190&&cp<0x3300) return 'enclosed';
  if(cp>=0x4E00&&cp<=0x9FFF) return 'cjk';
  if(cp>=0xAC00&&cp<=0xD7A3) return 'hangul';
  if(cp>=0xE000&&cp<=0xF8FF) return 'pua';
  if(cp>=0xFF01&&cp<=0xFF60) return 'fullwidth';
  return 'rare';
}

const SCRIPTS=['hangul','kana','cjk','cyrillic','greek','thai','hebrew','arabic'];

function score(s){
  if(!s) return -1e9;
  if(s.indexOf('\uFFFD')>=0) return -1e9;
  const c={}; let n=0;
  for(const ch of s){
    const cp=ch.codePointAt(0);
    if(cp>0xFFFF){ c.rare=(c.rare||0)+1; n++; continue; }
    const b=bucket(cp,ch);
    c[b]=(c[b]||0)+1; n++;
  }
  if(!n) return -1e9;
  const f=k=>(c[k]||0)/n;
  let sc=0;

  // 의미 있는 문자 비중이 높을수록 가점
  let scriptN=0; for(const k of SCRIPTS) scriptN+=(c[k]||0);
  sc += (scriptN/n)*110;
  sc += (f('ascii')+f('ws')+f('punct'))*45;
  sc += f('accent')*110;
  sc += f('cjkpunct')*20;
  sc += f('fullwidth')*10;

  // 깨진 결과에서만 나타나는 특징에 감점
  sc -= f('c1')*450;
  sc -= f('ctrl')*450;
  sc -= f('pua')*400;
  sc -= f('rare')*260;
  sc -= f('latinodd')*150;
  sc -= f('symbol')*130;
  sc -= f('enclosed')*170;
  sc -= f('jamo')*90;

  // 문자 계열이 여러 개로 흩어지면 오답일 확률이 높다
  let kinds=0; for(const k of SCRIPTS) if(c[k]>0) kinds++;
  if(kinds>1) sc -= (kinds-1)*45;

  // 한자와 가나가 함께 나오는 건 일본어로서 정상이므로 감점 회복
  if(c.kana>0 && c.cjk>0) sc += 45;

  return sc;
}

/* ─────────── 후보 좁히기 ─────────── */
// 입력 문자의 성격만 봐도 "잘못 읽은 쪽"이 무엇이었는지 대부분 압축된다.
function narrowMisread(s){
  let hasHigh=false, hasCyr=false, hasCJK=false, hasHangul=false, hasKana=false, over255=false;
  for(const ch of s){
    const cp=ch.codePointAt(0);
    if(cp>0x7F) hasHigh=true;
    if(cp>0xFF) over255=true;
    if(cp>=0x400&&cp<0x530) hasCyr=true;
    if(cp>=0x4E00&&cp<=0x9FFF) hasCJK=true;
    if(cp>=0xAC00&&cp<=0xD7A3) hasHangul=true;
    if(cp>=0x3040&&cp<0x3100) hasKana=true;
  }
  if(!hasHigh) return [];
  const list=[];
  if(!over255) list.push('latin1-raw');
  list.push('windows-1252','macintosh');
  if(hasCyr) list.push('windows-1251','koi8-r','ibm866','x-mac-cyrillic');
  if(hasCJK||hasHangul||hasKana) list.push('euc-kr','shift_jis','gbk','big5');
  return list.filter((v,i,a)=>a.indexOf(v)===i);
}

/* ─────────── UTF-8 구조 손상 탐지 ─────────── */
// UTF-8 문서를 서유럽 인코딩으로 읽으면 "선두 바이트 + 연속 바이트" 구조가 그대로 남는다.
// 그 구조가 부분적으로 깨져 있으면, 깨진 뒤에 누가 글자를 바꿔치기했다는 뜻이다.
// (메신저·웹 입력창을 거치며 제어문자가 사라지거나 다른 글자로 치환되는 경우)
function utf8Bytes(s,mode){
  const map = mode==='cp1252' ? buildEncoder('windows-1252') : null;
  const b=[];
  for(const ch of s){
    const cp=ch.codePointAt(0);
    if(cp<0x80){ b.push(cp); continue; }
    if(mode==='latin1'){ b.push(cp<=0xFF?cp:-1); continue; }
    const v=map&&map.get(ch);
    b.push(v?v[0]:-1);
  }
  return b;
}
function utf8Scan(b){
  let seen=0,broken=0;
  for(let i=0;i<b.length;i++){
    const x=b[i];
    if(x<0xC2||x>0xF4) continue;      // UTF-8 선두 바이트가 아니면 건너뜀
    const need = x<0xE0?1 : x<0xF0?2 : 3;
    seen++;
    for(let k=1;k<=need;k++){
      const y=b[i+k];
      if(y===undefined||y<0x80||y>0xBF){ broken++; break; }
    }
  }
  return {seen:seen,broken:broken,ratio:seen?broken/seen:0};
}
// 두 가지 오독 방식 중 구조가 덜 깨지는 쪽을 채택한다.
function utf8Damage(s){
  const a=utf8Scan(utf8Bytes(s,'latin1'));
  const c=utf8Scan(utf8Bytes(s,'cp1252'));
  return c.broken<a.broken ? c : a;
}

/* ─────────── 복구 엔진 ─────────── */
// 부분 복구 후보 — 마지막 한 글자만 '\uFFFD' 인 경우.
// 바이트가 하나 빠져 짝이 안 맞을 때 나타나는 형태다. 앞부분이 한 가지 문자
// 체계로 깔끔하게 읽히면 참고용으로 따로 보여준다. 순위 경쟁에는 넣지 않는다.
const PARTIAL_MIN_SCORE=105, PARTIAL_MIN_LEN=3;
function collectPartial(out,t,Y,X){
  const ch=Array.from(t);
  let f=0; for(const c of ch) if(c==='\uFFFD') f++;
  if(f!==1 || ch[ch.length-1]!=='\uFFFD') return;
  const clean=ch.slice(0,-1).join('');
  if(ch.length-1<PARTIAL_MIN_LEN) return;
  const sc=score(clean);
  if(sc<PARTIAL_MIN_SCORE) return;
  out.push({text:t,clean:clean,score:sc,misread:Y,actual:X});
}

/* ─────────── 줄바꿈 없는 공백(NBSP) 되살리기 ─────────── */
// 「제목」(U+C820) 처럼 UTF-8 바이트에 0xA0 이 들어가는 글자는 latin1 계열로 잘못 읽히면
// 깨진 문자열 안에 NBSP(U+00A0) 를 남긴다. 그런데 메신저·HTML·웹 입력창·엑셀이 NBSP 를
// **일반 공백으로 조용히 바꾼다.** 그러면 0xA0 이 0x20 이 되어 복구가 통째로 죽는다.
//
// 실측: 벤치 148건 중 NBSP 가 든 것 20건(14%), 그 20건이 NBSP 소실 시 **전부** 실패한다.
// 한국어 4 · 일본어 4 · 중국어 4 · 프랑스어 3 · 베트남어 3 · 태국어 1 · 그리스어 1 로 언어 편중도 없다.
//
// 되살릴 수 있는 이유 — UTF-8 의 이어지는 바이트는 반드시 0x80~0xBF 다. 0x20 은 그 범위에
// 들 수 없으므로, 그 자리에 공백이 있다는 것 자체가 손상 신호다. 그리고 각 오독 인코딩에서
// U+00A0 으로 읽히는 바이트는 하나뿐이라 되돌릴 값이 확정된다.
//
// ⚠ 되돌릴 바이트를 0xA0 으로 박아두지 말 것. 인코딩마다 다르다 —
//   latin1·windows-1252·windows-1251 은 0xA0 이지만 koi8-r 은 0x9A, ibm866 은 0xFF,
//   macintosh 는 0xCA 다. 0xA0 으로 고정했더니 utf-8→koi8-r 7건이 한 글자씩 틀렸다
//   (`안녕하세젔` `会議`→`传議`). 호출부에서 Y 의 역변환 표로 뽑아 넘긴다.
//
// ⚠ C1 제어문자 소실과 혼동하지 말 것. C1 은 바이트가 진짜로 사라져 복구 불가지만
// (기획서 5.1.2), NBSP 는 위 근거로 되살아난다. 안내 문구도 달라야 한다.
function repairNbsp(bytes,nbByte){
  if(!(nbByte>=0)) return null;
  const o=Uint8Array.from(bytes);
  let i=0, n=0;
  while(i<o.length){
    const c=o[i];
    let need=0;
    if(c<0x80){ i++; continue; }
    else if(c>=0xC2&&c<=0xDF) need=1;
    else if(c>=0xE0&&c<=0xEF) need=2;
    else if(c>=0xF0&&c<=0xF4) need=3;
    else { i++; continue; }
    for(let k=1;k<=need&&i+k<o.length;k++) if(o[i+k]===0x20){ o[i+k]=nbByte; n++; }
    i+=need+1;
  }
  return n?o:null;
}

// 이 오독 인코딩에서 U+00A0 이 어느 바이트였는지. encodeWith 와 같은 표를 쓴다.
function nbspByte(Y){
  if(Y==='latin1-raw') return 0xA0;
  const m=buildEncoder(Y);
  const v=m&&m.get('\u00A0');   // 리터럴 NBSP 로 쓰지 말 것 — 소스에서 안 보인다
  return (v&&v.length===1)?v[0]:-1;
}

// partialOut 을 넘기면 버려질 후보 중 부분 복구감을 여기에 모은다.
function attempt(s,partialOut){
  const res=[];
  const misreads=narrowMisread(s);
  for(const Y of misreads){
    const bytes=encodeWith(s,Y);
    if(!bytes||!bytes.length) continue;
    const nbByte=nbspByte(Y);   // 이 오독 인코딩에서 U+00A0 이 어느 바이트였는지
    for(const X of ACTUAL){
      let t;
      let strictUtf=false, nbsp=false;
      // ⚠ bytes 를 갈아치우지 말 것. ACTUAL 20종이 같은 배열을 돌려 쓴다.
      // NBSP 복원본은 utf-8 시도에만 쓰는 지역 변수에 담는다.
      let buf=bytes;
      if(X==='utf-8'){
        try{ new TextDecoder('utf-8',{fatal:true}).decode(buf); strictUtf=true; }
        catch(e){
          // 엄격 검증을 통과할 때만 채택한다. 복원해도 UTF-8 로 안 읽히면 가설이 틀린 것이다.
          // 정상 텍스트는 애초에 위 검증을 통과하므로 이 경로에 오지 않는다 — 오탐 0의 근거.
          const rep=repairNbsp(buf,nbByte);
          if(rep){
            try{ new TextDecoder('utf-8',{fatal:true}).decode(rep); buf=rep; strictUtf=true; nbsp=true; }
            catch(e2){}
          }
        }
      }
      try{ t=new TextDecoder(X,{fatal:false}).decode(buf); }catch(e){ continue; }
      if(!t||t===s) continue;
      if(t.indexOf('\uFFFD')>=0){ if(partialOut) collectPartial(partialOut,t,Y,X); continue; }
      let sc=score(t);
      if(strictUtf) sc+=70;
      // 길이 축소 신호: 정답은 2~3바이트가 1글자로 합쳐지므로 입력보다 짧아진다.
      // 단일바이트→단일바이트 오독은 길이가 그대로라 이 가점을 못 받는다.
      sc+=Math.max(0,1-t.length/s.length)*30;
      if(sc<=-1e8) continue;
      res.push({text:t,score:sc,misread:Y,actual:X,nbsp:nbsp});
    }
  }
  return res.sort((a,b)=>b.score-a.score);
}

function recover(s){
  const base=score(s);
  const partials=[];
  const round1=attempt(s,partials);
  const all=[];

  for(const r of round1){
    all.push({text:r.text,score:r.score,chain:[{m:r.misread,a:r.actual,nbsp:r.nbsp}]});
  }
  // 2중 인코딩 대응: 1차 결과를 한 번 더 복구해서 더 나아지면 채택
  for(const r of round1.slice(0,4)){
    const round2=attempt(r.text);
    for(const r2 of round2.slice(0,2)){
      if(r2.score > r.score + 12){
        all.push({text:r2.text,score:r2.score,
                  chain:[{m:r.misread,a:r.actual,nbsp:r.nbsp},{m:r2.misread,a:r2.actual,nbsp:r2.nbsp}]});
      }
    }
  }

  const seen=new Set(), out=[];
  for(const r of all.sort((a,b)=>b.score-a.score)){
    if(seen.has(r.text)) continue;
    seen.add(r.text);
    out.push(r);
    if(out.length>=3) break;
  }
  // 부분 복구는 점수 순으로 최대 2개. 같은 문자열은 한 번만.
  const pseen=new Set(), partial=[];
  for(const p of partials.sort((a,b)=>b.score-a.score)){
    if(pseen.has(p.text)) continue;
    pseen.add(p.text);
    partial.push(p);
    if(partial.length>=2) break;
  }
  return {base:base, list:out, partial:partial};
}

/* ─────────── 줄마다 다르게 깨진 입력 ─────────── */
// 복구는 "어떻게 잘못 읽혔는지" 를 하나 가정하고 되감는 것이라, 줄마다 가정이 다르면
// 통짜로는 풀 수 없다. 실제로 euc-kr→latin1 세 줄에 utf-8→cp1252 한 줄을 붙이면,
// 그 줄의 •…š 같은 문자를 latin1-raw 가 표현하지 못해 그 가설이 통째로 탈락하고
// 후보 전체가 windows-1252 로 밀려나 네 줄이 다 키릴 쓰레기가 된다.
//
// 줄 단위로 나누면 각 줄이 제 가설을 찾는다.
//
// ⚠ 같은 유형의 여러 줄에는 이 경로를 쓰면 안 된다 — 문장이 길수록 채점이 정확해지므로
// 통짜가 낫다. 그래서 "줄별이 통짜보다 자연스러울 때만" 채택한다. 실측: 한 언어·한 유형
// 문단 23건에서 이 조건이 성립한 것은 0건(개악 0), 유형 섞인 238건에서는 3건 → 76건.
const LINE_GAIN=10;   // 임계값 0~40 어디서도 문단 개악이 0이라 민감한 값이 아니다
const MAX_LINES=60;   // 줄마다 recover() 를 돌리므로 상한을 둔다

function recoverLines(s){
  const lines=s.split('\n');
  if(lines.length<2||lines.length>MAX_LINES) return null;

  let hit=0;
  const out=lines.map(function(l){
    if(!l.trim()) return l;
    // ASCII 가 대부분인 줄은 안 깨진 줄이다. 이 가드가 없으면 안 깨진 독일어 문단이
    // 통째로 한자가 된다 ("Bitte prüfen Sie die Unterlagen vorher" → "楂瑴⁥牰曼湥…").
    if(asciiRatio(l)>LINE_ASCII_MAX) return l;
    const r=recover(l);
    if(!r.list.length) return l;      // 못 고친 줄은 원문 그대로 — 줄 수와 순서를 지킨다
    hit++;
    return r.list[0].text;
  });
  if(!hit) return null;

  const text=out.join('\n');
  if(text===s) return null;
  const whole=recover(s);
  const wholeScore=whole.list.length?score(whole.list[0].text):score(s);
  if(score(text)<=wholeScore+LINE_GAIN) return null;
  return {kind:'line',text:text,lines:lines.length,fixed:hit};
}

/* ─────────── 깨진 구간만 복구 ─────────── */
// 정상 글자와 깨진 글자가 한 줄에 섞이면 통짜로는 후보가 0개가 된다. encodeWith 가
// 되돌릴 인코딩으로 표현 불가한 문자를 하나라도 만나면 그 가설을 통째로 버리기 때문이다.
// "제목: <깨짐> 입니다" · "<깨짐>_보고서.xlsx" 처럼 실사용에서 가장 흔한 형태가 여기서 죽는다.
//
// 실측: 벤치 148건 앞에 "제목: " 만 붙여도 82.4% → 0% (후보 0개가 98%). ASCII 라벨
// "name: " 만 76.4% 로 멀쩡한 것이 원인을 그대로 말해준다 — latin1-raw 가 ASCII 는
// 표현할 수 있기 때문이다.
//
// 되돌릴 수 있는 구간만 골라 되돌리고 나머지는 손대지 않는다. recoverLines 가 줄 단위로
// 하는 일을 한 단계 아래로 내린 것이고, 새 채점 로직 없이 recover() 를 그대로 재사용한다.
//
// ⚠ 공백 단위(토큰)로 쪼개는 방식은 실측으로 기각했다. 커버리지는 넓지만(CJK·키릴 0→53%)
// 짧은 토큰에서 정상 단어를 깨진 것으로 오판한다 — "déjà vu à côté" → "蹤衪 vu à 饣蹴".
// 5.1.2 의 "짧은 입력은 통계가 성립하지 않는다" 가 그대로 재현되는 것이라 임계값으로 못 막는다.
const SEG_MIN=4;    // 구간 최소 길이. 낮추면 위의 déjà·über 오작동이 살아난다
const SEG_GAIN=25;  // 구간 교체 기준 개선폭. CONTENT_GAIN 과 같은 성격의 상수다

// 줄별 복구(recoverLines)와 구간 복구(recoverSegments)가 같이 쓰는 판정. 함수는 공유하지만
// **임계값은 따로 둔다** — 측정 범위가 거의 겹치지 않는다. 구간은 0.67(베트남어 오작동) 아래여야
// 하고, 줄별은 0.65 이상이어야 섞임 정답률이 안 깎인다. 하나로 합치려다 26.3% → 24.6% 로
// 떨어뜨려 하한(25%)을 깬 적이 있다. 겹치는 구간이 0.65~0.67 뿐이라 여유가 없다.
//
// 깨진 글자는 고바이트 문자다. ASCII 는 어떤 오독을 거쳐도 깨지지 않고 그대로 통과하므로
// (래퍼 "name: " 이 통짜로도 76.4% 였던 이유가 이것이다) ASCII 글자가 대부분인 구간은
// 애초에 깨진 구간이 아니다. 이 가드가 없으면 베트남어 "Xin chào bạn" 의 "Xin chào b"
// 가 utf-16le 로 읽혀 한자 110점을 받고 "楘⁮档濠戠ạn" 이 된다. 줄별 쪽에서는 안 깨진
// 독일어 문단이 통째로 한자가 된다 ("Bitte prüfen Sie die Unterlagen vorher" →
// "楂瑴⁥牰曼湥匠敩搠敩唠瑮牥慬敧⁮潶桲牥").
//
// 실측 — 구간: 정답을 낸 278건의 ASCII 비율 max 0.58 (중앙 0.00) / 오작동한 베트남어 0.67
//        줄별: 정상 독일어 줄 0.86·0.84·0.70 / 깨진 줄 0.00·0.33
//              임계값 0.65~0.75 구간에서 정상문단 오발동 0 + 섞임 26.3%(무손실)로 평평하다
const SEG_ASCII_MAX=0.6;
const LINE_ASCII_MAX=0.65;

// 구간마다 recover() 를 돌리므로 둔 상한 (MAX_LINES 와 같은 성격).
// 실측: 서로 다른 깨진 조각이 반복되면 memo 가 안 먹혀 구간당 약 3.8ms 로 선형 증가한다.
// 50구간 206ms / 200구간 775ms / 800구간 3,071ms. 200 을 넘으면 시도하지 않는다.
const MAX_SEGS=200;

function asciiRatio(s){
  let n=0, t=0;
  for(const ch of s){
    const p=ch.codePointAt(0);
    if((p>=48&&p<=57)||(p>=65&&p<=90)||(p>=97&&p<=122)) n++;
    t++;
  }
  return t? n/t : 0;
}

// Y 로 표현 가능한 문자들의 최대 구간. encodeWith 와 똑같은 판정을 쓰므로 새 표가 없다.
function segmentsFor(s,Y){
  const map = Y==='latin1-raw' ? null : buildEncoder(Y);
  if(!map && Y!=='latin1-raw') return [];
  const runs=[]; let cur=null;
  for(let i=0;i<s.length;){
    const cp=s.codePointAt(i);
    const ch=String.fromCodePoint(cp);
    const ok = map ? map.has(ch) : cp<=0xFF;
    if(ok){ if(cur) cur.b=i+ch.length; else { cur={a:i,b:i+ch.length}; runs.push(cur); } }
    else cur=null;
    i+=ch.length;
  }
  return runs;
}

function recoverSegments(s){
  if(!s) return null;
  const memo=new Map();   // 같은 구간이 후보 인코딩마다 반복된다
  let best=null, bestScore=-1e9;

  // ⚠ narrowMisread(s) 를 쓰면 안 된다. 그건 입력 전체를 보고 후보를 좁히는 함수라,
  // 정상 한글이 섞여 있다는 이유만으로 latin1-raw 를 빼버린다 — 정작 깨진 구간을
  // 되돌릴 유일한 가설이 그것인데도. 구간을 나누는 단계에서는 전 후보를 그대로 본다.
  for(const Y of MISREAD){
    const runs=segmentsFor(s,Y);
    // 전체가 한 구간이면 통짜와 같다 — 발동시킬 이유가 없다.
    if(!runs.length) continue;
    if(runs.length===1 && runs[0].a===0 && runs[0].b===s.length) continue;
    if(runs.length>MAX_SEGS) continue;

    // parts 는 UI 가 "어디를 고쳤는지" 를 표시하는 데 쓴다. 통짜와 달리 일부만 고쳤다는
    // 사실 자체가 사용자에게 정보다.
    let out='', last=0, fixed=0;
    const parts=[];
    for(const r of runs){
      if(r.b-r.a<SEG_MIN) continue;
      const seg=s.slice(r.a,r.b);
      if(asciiRatio(seg)>SEG_ASCII_MAX) continue;
      let fix=memo.get(seg);
      if(fix===undefined){
        const rec=recover(seg);
        // ⚠ 개선폭은 양쪽 다 raw score() 로 잰다. rec.list[0].score 에는 attempt() 가
        // 더한 strictUtf +70 과 길이 축소 가점(최대 30)이 섞여 있어 score(seg) 와 직접
        // 비교하면 안 된다. 실제로 정상 " 입니다" 가 gain 197.8 을 받아 교체됐다.
        fix = (rec.list.length && score(rec.list[0].text)-score(seg)>=SEG_GAIN)
              ? rec.list[0].text : null;
        memo.set(seg,fix);
      }
      if(fix===null) continue;
      if(r.a>last) parts.push({t:s.slice(last,r.a),fixed:false});
      parts.push({t:fix,fixed:true});
      out+=s.slice(last,r.a)+fix;
      last=r.b; fixed++;
    }
    if(!fixed) continue;
    if(last<s.length) parts.push({t:s.slice(last),fixed:false});

    const text=out+s.slice(last);
    if(text===s) continue;
    const sc=score(text);
    if(sc>bestScore){ bestScore=sc; best={kind:'seg',text:text,fixed:fixed,parts:parts}; }
  }
  return best;
}

/* ─────────── 확신도 ─────────── */
function confidences(list){
  if(!list.length) return [];
  const top=list[0].score;
  // 절대 품질 + 2위와의 격차를 함께 반영
  const quality=Math.max(0,Math.min(1,(top-30)/90));
  return list.map(r=>{
    const rel=Math.exp((r.score-top)/22);
    return Math.max(3,Math.min(99,Math.round(rel*(35+quality*64))));
  });
}

/* ─────────── 파일(바이트) 복구 ─────────── */
// 붙여넣기 경로는 깨진 "문자열"에서 encodeWith 로 원본 바이트를 역추정한다. 그 인코딩으로
// 만들어질 수 없는 글자가 하나라도 있으면 후보가 통째로 탈락하는 손실 단계다.
// 파일은 원본 바이트를 그대로 갖고 있으므로 그 단계가 아예 필요 없다.
// 따라서 attempt() 를 우회하되, 채점은 score() 를 그대로 공유한다 (배점 균형을 건드리지 않는다).

const SNIFF_BYTES = 65536;   // 판별용 샘플 크기. 확정 후 디코딩은 전체 바이트로 한다.
const SNIFF_TRIM  = 4;       // 샘플 끝에서 잘린 멀티바이트 조각을 버린다
const MAX_FILE    = 20*1024*1024;

const BOMS = [
  {enc:'utf-8',    sig:[0xEF,0xBB,0xBF]},
  {enc:'utf-16le', sig:[0xFF,0xFE]},
  {enc:'utf-16be', sig:[0xFE,0xFF]}
];

// BOM 이 있으면 인코딩이 파일에 명시된 것이므로 후보 경쟁을 돌릴 이유가 없다.
function sniffBom(bytes){
  for(const b of BOMS){
    if(bytes.length<b.sig.length) continue;
    let ok=true;
    for(let i=0;i<b.sig.length;i++){ if(bytes[i]!==b.sig[i]){ ok=false; break; } }
    if(ok) return {enc:b.enc,len:b.sig.length};
  }
  return null;
}

function decodeBytes(bytes,enc){
  try{ return new TextDecoder(enc,{fatal:false}).decode(bytes); }catch(e){ return null; }
}

function hasHighByte(bytes){
  for(let i=0;i<bytes.length;i++) if(bytes[i]>=0x80) return true;
  return false;
}

// 텍스트 파일에는 NUL 바이트가 없다. 있으면 이진 파일이거나 BOM 없는 UTF-16 이다.
// 이 가드가 없으면 PNG 헤더 16바이트가 "‰PNG ÿØ«" 같은 후보로 확신도까지 달고 나온다.
function looksBinary(bytes){
  const n=Math.min(bytes.length,SNIFF_BYTES);
  let ctrl=0;
  for(let i=0;i<n;i++){
    const b=bytes[i];
    if(b===0) return true;
    if(b<0x09||(b>0x0D&&b<0x20)) ctrl++;   // \t \n \v \f \r 은 정상 텍스트
  }
  return ctrl/n>0.05;
}

// 동점 깨기용 사전 확률. 파일 모드 전용이며 ACTUAL 배열 순서는 건드리지 않는다.
//
// 왜 필요한가 — score() 는 문자 "종류"의 비율만 본다. 그래서 같은 바이트를 그리스어로
// 읽든 키릴로 읽든 라틴 악센트로 읽든 전부 스크립트 110점이라 **완전 동점**이 난다
// (Καλημέρα κόσμε / КблзмЭсб кьуме / ÊáëçìÝñá êüóìå 셋 다 105.4). 붙여넣기 모드는
// narrowMisread + encodeWith 가 후보를 걸러 이 문제가 드러나지 않지만, 파일 모드는
// 바이트를 그대로 쓰므로 단일바이트 인코딩 12종이 한꺼번에 동점으로 남는다.
//
// 동점을 배열 순서로 깨면 windows-1251 이 항상 이겨 서유럽 파일이 전부 키릴로 나온다.
// 실사용 파일에서의 대략적 빈도를 아주 작은 가점(최대 6점)으로 준다. score() 의 신호
// 차이는 보통 45점 단위라 진짜 근거가 있을 때는 이 가점이 결과를 뒤집지 못한다.
// 측정: 이 가점만으로 Node 파일 벤치 66.2% → 76.6%. 독일어·프랑스어 29·40% → 100%.
const FILE_PRIOR = {
  'utf-8':6, 'euc-kr':5, 'shift_jis':5, 'gbk':5, 'big5':4, 'euc-jp':4,
  'windows-1252':3.5, 'gb18030':3, 'windows-1251':2.5, 'iso-8859-2':1.5,
  'windows-1250':1.4, 'windows-1253':1.3, 'iso-8859-7':1.2, 'windows-1254':1.1,
  'windows-1257':1, 'windows-1256':0.9, 'windows-1255':0.8, 'koi8-r':0.7,
  'utf-16le':0.2, 'iso-2022-jp':0.1
};

// attempt() 안쪽 루프와 같은 정책을 바이트에 직접 적용한다.
//
// ⚠ attempt() 의 길이 축소 가점(5차 수정)은 여기 옮기지 말 것. 실측으로 기각했다.
// 그 가점은 "입력이 깨진 문자열임이 이미 확실할 때 정답은 더 짧다" 는 전제에 기댄다.
// 파일은 깨졌다는 전제 자체가 없어서 글자 수가 줄어드는 게 근거가 되지 못하고,
// 오히려 단일바이트 파일을 아무 CJK 인코딩으로 읽으면 글자 수가 반으로 줄어 가점을 챙긴다.
// Chrome 은 euc-kr 을 17,048쌍 매핑해(Node ICU 는 8,412쌍) 이런 엉터리 후보가 훨씬 잘
// 살아남는다. 브라우저 파일 벤치 68.8% → 75.3%, 독일어 29% → 100% (Node 는 76.6% 무변화).
function decodeCandidates(bytes){
  const res=[], damaged=[];
  if(!bytes.length) return res;
  for(const X of ACTUAL){
    let strictUtf=false;
    if(X==='utf-8'){ try{ new TextDecoder('utf-8',{fatal:true}).decode(bytes); strictUtf=true; }catch(e){} }
    const t=decodeBytes(bytes,X);
    if(t===null||!t.length) continue;
    let sc=score(t);
    if(strictUtf) sc+=70;
    sc+=FILE_PRIOR[X]||0;
    let bad=0; for(const ch of t){ if(ch==='�') bad++; }
    if(bad>0){ damaged.push({text:t,score:sc,actual:X,bad:bad}); continue; }
    res.push({text:t,score:sc,actual:X,bad:0});
  }
  res.sort((a,b)=>b.score-a.score);
  // 전부 탈락했을 때만 � 가 가장 적은 후보 하나를 남긴다 (이진 파일이나 잘린 조각).
  if(!res.length&&damaged.length){
    damaged.sort((a,b)=>a.bad-b.bad||b.score-a.score);
    res.push(damaged[0]);
  }
  return res;
}

// 파일 인코딩은 멀쩡한데 그 안에 담긴 "글자"가 이미 깨진 채로 저장된 경우를 잡는다.
// 깨진 글자를 어디선가 복사해 메모장에 저장하면 정확히 이 상태가 된다 — 파일 탭을 쓰는
// 가장 자연스러운 방법이라 놓치면 안 된다. 바이트는 정상 UTF-8 이므로 바이트만 보는
// 판별로는 "정상 파일" 이라고 답하고 끝난다. 그래서 결과 텍스트를 붙여넣기 모드로 한 번 더 돌린다.
//
// CONTENT_GAIN 은 실측값이다. 정상 텍스트 20건의 개선폭은 최대 20, 깨진 텍스트 22건 중
// 21건이 25를 넘었다 (오탐 0). 10으로 낮추면 정상 한국어·일본어가 15~20을 받아 오탐 8/20.
// SCORE_FLOOR·DMG_MAX_RATIO 와 같은 성격의 상수다 — 바꾸려면 다시 측정할 것.
const CONTENT_GAIN=25;

function contentMojibake(t){
  if(!t) return null;
  const r=recover(t);
  if(!r.list.length||r.list[0].score-score(t)<=CONTENT_GAIN) return null;
  return r.list;
}

// 임의의 레거시 바이트가 UTF-8 구조를 우연히 만족할 확률은 극히 낮다 — 파일 벤치의
// 비(非)UTF-8 케이스 57건 중 유효 UTF-8 인 것은 0건이었다. 그래서 유효하면 확정한다.
//
// 후보 경쟁에 맡기면 안 되는 이유: 깨진 글자가 담긴 UTF-8 파일이 GBK 로 넘어간다.
// 깨진 글자는 라틴 보조 문자뿐이라 score() 가 낮게 주는데, 같은 바이트를 GBK 로 읽으면
// 한자가 나와 스크립트 110점을 받기 때문이다. strictUtf 가점 +70 으로는 못 막는다.
function validUtf8(bytes,tolerateTail){
  const d=new TextDecoder('utf-8',{fatal:true});
  // 샘플을 잘라 쓴 경우에만 꼬리를 봐준다. 끝이 멀티바이트 중간이면 무효로 나오기 때문.
  const max=tolerateTail?3:0;
  for(let cut=0;cut<=max&&cut<bytes.length;cut++){
    try{ d.decode(bytes.subarray(0,bytes.length-cut)); return true; }catch(e){}
  }
  return false;
}

// certain: 후보 경쟁 없이 인코딩이 확정된 경우 (BOM / ASCII / 유효 UTF-8)
function fileResult(enc,text,flags){
  const r={bom:null,ascii:false,binary:false,certain:false,content:null,list:[]};
  for(const k in flags) r[k]=flags[k];
  if(text===null) return r;
  r.list=[{text:text,score:score(text),actual:enc}];
  r.content=contentMojibake(text);
  return r;
}

function recoverBytes(bytes){
  const bom=sniffBom(bytes);
  if(bom) return fileResult(bom.enc,decodeBytes(bytes.subarray(bom.len),bom.enc),{bom:bom.enc,certain:true});
  if(looksBinary(bytes)) return {bom:null,ascii:false,binary:true,certain:false,content:null,list:[]};
  // 0x80 이상이 하나도 없으면 인코딩 불일치가 생길 수 없다. 깨진 파일이 아니다.
  if(!hasHighByte(bytes)) return fileResult('utf-8',decodeBytes(bytes,'utf-8'),{ascii:true,certain:true});

  const sampled=bytes.length>SNIFF_BYTES;
  const sample=sampled?bytes.subarray(0,SNIFF_BYTES-SNIFF_TRIM):bytes;
  if(validUtf8(sample,sampled)) return fileResult('utf-8',decodeBytes(bytes,'utf-8'),{certain:true});

  const seen=new Set(), list=[];
  for(const c of decodeCandidates(sample)){
    const full=sampled?decodeBytes(bytes,c.actual):c.text;
    if(full===null||seen.has(full)) continue;
    seen.add(full);
    list.push({text:full,score:c.score,actual:c.actual});
    if(list.length>=3) break;
  }
  return {bom:null,ascii:false,binary:false,certain:false,
          content:list.length?contentMojibake(list[0].text):null,list:list};
}

/* ─────────── ZIP 파일명 복구 ─────────── */
// ZIP 은 파일명 인코딩 플래그(GP bit 11)가 없으면 로컬 코드페이지로 저장된다.
// 한국 윈도우에서 만든 압축 파일이 다른 환경에서 깨져 보이는 원인이 이것이다.
// 압축 데이터는 손대지 않고 헤더만 다시 쓰므로 inflate/deflate 가 필요 없다.
const ZIP_LOCAL=0x04034B50, ZIP_CD=0x02014B50, ZIP_EOCD=0x06054B50;

function u16(b,p){ return b[p]|(b[p+1]<<8); }
function u32(b,p){ return (b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0; }

function isZip(bytes){
  return bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4B&&bytes[2]===0x03&&bytes[3]===0x04;
}

// 주석이 붙어 있을 수 있어 EOCD 는 뒤에서부터 찾는다 (주석 최대 65535 바이트).
function findEocd(b){
  const stop=Math.max(0,b.length-(22+65535));
  for(let i=b.length-22;i>=stop;i--){ if(u32(b,i)===ZIP_EOCD) return i; }
  return -1;
}

// extra 필드에 ZIP64 헤더(0x0001)가 있으면 크기·오프셋이 거기 들어 있다. 재작성 불가.
function hasZip64Extra(b,p,len){
  let q=p, end=p+len;
  while(q+4<=end){
    if(u16(b,q)===0x0001) return true;
    q+=4+u16(b,q+2);
  }
  return false;
}

function parseZip(b){
  const eo=findEocd(b);
  if(eo<0) return {error:'ZIP 구조를 찾지 못했습니다. 파일이 잘렸거나 ZIP 이 아닙니다.'};
  if(u16(b,eo+4)!==0||u16(b,eo+6)!==0) return {error:'분할 압축(다중 디스크) 아카이브는 지원하지 않습니다.'};
  const count=u16(b,eo+10), cdSize=u32(b,eo+12), cdOff=u32(b,eo+16);
  if(count===0xFFFF||cdSize===0xFFFFFFFF||cdOff===0xFFFFFFFF)
    return {error:'ZIP64 아카이브는 지원하지 않습니다.'};

  const entries=[];
  let p=cdOff;
  for(let i=0;i<count;i++){
    if(p+46>b.length||u32(b,p)!==ZIP_CD) return {error:'중앙 디렉토리가 손상됐습니다.'};
    const flag=u16(b,p+8);
    if(flag&0x1) return {error:'암호가 걸린 아카이브는 지원하지 않습니다.'};
    const nLen=u16(b,p+28), eLen=u16(b,p+30), cLen=u16(b,p+32);
    const csize=u32(b,p+20), usize=u32(b,p+24), lho=u32(b,p+42);
    if(csize===0xFFFFFFFF||usize===0xFFFFFFFF||lho===0xFFFFFFFF||hasZip64Extra(b,p+46+nLen,eLen))
      return {error:'ZIP64 아카이브는 지원하지 않습니다.'};
    entries.push({
      utf8:!!(flag&0x800), flag:flag,
      verMade:u16(b,p+4), verNeed:u16(b,p+6), method:u16(b,p+10),
      time:u16(b,p+12), date:u16(b,p+14), crc:u32(b,p+16),
      csize:csize, usize:usize,
      intAttr:u16(b,p+36), extAttr:u32(b,p+38), lho:lho,
      name:b.subarray(p+46,p+46+nLen)
    });
    p+=46+nLen+eLen+cLen;
  }
  return {entries:entries};
}

// 파일명 하나는 너무 짧아 통계가 성립하지 않는다 (기획서 5.1.2 의 짧은 입력 한계와 같은 문제).
// 아카이브 전체 파일명을 줄바꿈으로 이어붙여 하나의 표본으로 판별한다.
function zipInspect(bytes){
  const z=parseZip(bytes);
  if(z.error) return z;
  const utf=new TextDecoder('utf-8');
  const raw=z.entries.filter(e=>!e.utf8);

  let n=0; for(const e of raw) n+=e.name.length+1;
  const blob=new Uint8Array(n);
  let p=0;
  for(const e of raw){ blob.set(e.name,p); p+=e.name.length; blob[p++]=0x0A; }

  if(!hasHighByte(blob)){
    return {entries:z.entries,ok:true,
            cands:[{actual:'utf-8',names:z.entries.map(e=>utf.decode(e.name))}]};
  }
  const cands=decodeCandidates(blob).slice(0,3).map(c=>({
    actual:c.actual,
    names:z.entries.map(e=>e.utf8?utf.decode(e.name):decodeBytes(e.name,c.actual))
  }));
  return {entries:z.entries,ok:false,cands:cands};
}

// 압축 데이터 블록은 그대로 복사하고 헤더만 새 파일명(UTF-8) + GP bit 11 로 다시 쓴다.
// 파일명 길이가 바뀌어 오프셋이 밀리므로 아카이브를 처음부터 재구성한다.
// extra 필드는 버린다 — Unicode Path(0x7075) 같은 잔재가 새 이름과 충돌한다.
function zipRebuild(b,entries,names){
  const enc=new TextEncoder();
  const parts=[];
  const meta=[];
  let off=0;

  for(let i=0;i<entries.length;i++){
    const e=entries[i];
    if(u32(b,e.lho)!==ZIP_LOCAL) return {error:'로컬 헤더가 손상됐습니다. ('+names[i]+')'};
    const dataAt=e.lho+30+u16(b,e.lho+26)+u16(b,e.lho+28);
    if(dataAt+e.csize>b.length) return {error:'압축 데이터가 잘렸습니다. ('+names[i]+')'};

    const nb=enc.encode(names[i]);
    // bit 11 세트(UTF-8 명시), bit 3 해제 — 크기를 헤더에 직접 쓰므로 데이터 디스크립터 불필요
    const flag=(e.flag|0x800)&~0x8;
    const lh=new Uint8Array(30+nb.length);
    const v=new DataView(lh.buffer);
    v.setUint32(0,ZIP_LOCAL,true); v.setUint16(4,e.verNeed,true); v.setUint16(6,flag,true);
    v.setUint16(8,e.method,true);  v.setUint16(10,e.time,true);   v.setUint16(12,e.date,true);
    v.setUint32(14,e.crc,true);    v.setUint32(18,e.csize,true);  v.setUint32(22,e.usize,true);
    v.setUint16(26,nb.length,true);v.setUint16(28,0,true);
    lh.set(nb,30);

    parts.push(lh, b.subarray(dataAt,dataAt+e.csize));
    meta.push({e:e,nb:nb,flag:flag,off:off});
    off+=lh.length+e.csize;
  }

  const cdOff=off;
  for(const m of meta){
    const cd=new Uint8Array(46+m.nb.length);
    const v=new DataView(cd.buffer);
    v.setUint32(0,ZIP_CD,true);      v.setUint16(4,m.e.verMade,true); v.setUint16(6,m.e.verNeed,true);
    v.setUint16(8,m.flag,true);      v.setUint16(10,m.e.method,true); v.setUint16(12,m.e.time,true);
    v.setUint16(14,m.e.date,true);   v.setUint32(16,m.e.crc,true);    v.setUint32(20,m.e.csize,true);
    v.setUint32(24,m.e.usize,true);  v.setUint16(28,m.nb.length,true);v.setUint16(30,0,true);
    v.setUint16(32,0,true);          v.setUint16(34,0,true);          v.setUint16(36,m.e.intAttr,true);
    v.setUint32(38,m.e.extAttr,true);v.setUint32(42,m.off,true);
    cd.set(m.nb,46);
    parts.push(cd);
    off+=cd.length;
  }

  const eocd=new Uint8Array(22);
  const v=new DataView(eocd.buffer);
  v.setUint32(0,ZIP_EOCD,true); v.setUint16(4,0,true); v.setUint16(6,0,true);
  v.setUint16(8,meta.length,true); v.setUint16(10,meta.length,true);
  v.setUint32(12,off-cdOff,true); v.setUint32(16,cdOff,true); v.setUint16(20,0,true);
  parts.push(eocd);

  let total=0; for(const p of parts) total+=p.length;
  const out=new Uint8Array(total);
  let q=0; for(const p of parts){ out.set(p,q); q+=p.length; }
  return {bytes:out};
}

/* ─────────── 결과 언어 라벨 ─────────── */
// 후보 3개를 눈으로 비교할 때 "어느 쪽이 내 언어인지" 를 바로 알려준다.
//
// ⚠ 문자만으로는 언어를 단정할 수 없다. 키릴 문자는 러시아어·우크라이나어·불가리아어가
// 공유하고, 라틴 악센트는 독일어·프랑스어·폴란드어가 공유한다. 그래서 확실한 것만
// 언어 이름을 쓰고(한글·가나·태국·그리스·히브리·아랍), 나머지는 문자 이름으로 물러선다.
//
// 인코딩은 별도의 단서다 — gbk 로 저장했다면 중국어권 문서일 가능성이 높다.
// 스크립트로 판정이 안 될 때만 보조로 쓴다. 벤치 148건에서 94.6% 가 실제 언어와 일치했고,
// 어긋난 8건은 전부 가나 없는 일본어(`会議室A-301`)를 CJK 인코딩으로 저장한 합성 케이스다.
// ⚠ 값은 화면에 그대로 쓰는 글자가 아니라 **키**다. 실제 글자는 화면 코드가 I18N 에서 찾는다.
//   엔진은 언어 중립이어야 하므로 여기에 번역문을 두지 않는다.
const ENC_LANG = {
  'euc-kr':'ko',
  'shift_jis':'ja', 'euc-jp':'ja', 'iso-2022-jp':'ja',
  'gbk':'zhHans', 'gb18030':'zhHans', 'big5':'zhHant',
  'windows-1251':'cyrillic', 'koi8-r':'cyrillic',
  'windows-1253':'el', 'iso-8859-7':'el',
  'windows-1255':'he', 'iso-8859-8':'he',
  'windows-1256':'ar', 'windows-874':'th',
  'windows-1250':'centeur', 'iso-8859-2':'centeur',
  'windows-1254':'tr', 'windows-1257':'baltic',
  'windows-1258':'vi', 'windows-1252':'westeur'
};
const CJK_ENC = {'zhHans':1,'zhHant':1,'ja':1,'ko':1};

function langHint(text,actual){
  const c={};
  for(const ch of text){
    const b=bucket(ch.codePointAt(0),ch);
    if(b==='jamo') c.hangul=(c.hangul||0)+1;
    else if(b==='hangul'||b==='kana'||b==='cjk'||b==='cyrillic'||b==='greek'||
            b==='hebrew'||b==='arabic'||b==='thai'||b==='accent'||b==='latinodd') c[b]=(c[b]||0)+1;
  }
  const enc=ENC_LANG[actual]||'';

  // 스크립트 하나로 언어가 정해지는 것들
  if(c.hangul) return 'ko';
  if(c.kana)   return 'ja';
  if(c.thai)   return 'th';
  if(c.greek)  return 'el';
  if(c.hebrew) return 'he';
  if(c.arabic) return 'ar';
  // 키릴은 여러 언어가 공유한다. 언어 이름을 붙이지 않는다.
  if(c.cyrillic) return 'cyrillic';
  // 한자만 있으면 중국어·일본어·한국어 한자를 구분할 수 없다. 인코딩이 알려줄 때만 쓴다.
  if(c.cjk) return CJK_ENC[enc] ? enc : 'han';
  // 라틴 계열도 마찬가지 — 인코딩이 지역을 좁혀줄 때만 쓴다.
  if(c.accent||c.latinodd) return (enc&&!CJK_ENC[enc]&&enc!=='cyrillic') ? enc : 'latin';
  return '';
}

return {
  recover, recoverLines, recoverSegments, recoverBytes, contentMojibake, confidences, langHint, encodeWith, utf8Damage, MAX_FILE, isZip, zipInspect, zipRebuild, score, attempt, narrowMisread, decodeCandidates, sniffBom, segmentsFor, parseZip
};
});
