/* 화면 코드. 모든 언어 페이지가 공유한다.
 *
 * ⚠ 여기에 사람이 읽는 글자를 직접 쓰지 말 것. 전부 I18N 에서 꺼내 쓴다 —
 *   그래야 언어를 늘릴 때 i18n.<언어>.js 만 번역하면 된다.
 * ⚠ <script type="module"> 로 부르지 말 것. file:// 에서 막힌다 (engine.js 와 같은 이유).
 */
(function(){
"use strict";
// 엔진은 engine.js 에 있다. 아래 한 줄 덕분에 화면 코드의 호출부는 예전 그대로다.
const { encodeWith, utf8Damage, recover, recoverLines, recoverSegments, confidences, MAX_FILE, contentMojibake, recoverBytes, isZip, zipInspect, zipRebuild, langHint } = MojiEngine;
const langName = k => (k && I18N.lang[k]) || '';
const T = I18N.ui;
/* ─────────── UI ─────────── */
const $=id=>document.getElementById(id);
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const label=n=>n==='latin1-raw'?T.latin1Raw:n;

function show(kind,html){
  const m=$('msg');
  m.className='msg show '+kind;
  m.innerHTML=html;
}
// 클래스만 지우면 이전 안내문이 DOM 에 남아 다음 결과와 섞여 보인다
function hideMsg(){ const m=$('msg'); m.className='msg'; m.innerHTML=''; }

/* ─────────── 입력 진단 ─────────── */
// 복구가 안 될 때 "왜" 를 말해준다. 원인 대부분은 엔진이 아니라 입력 쪽에 있다.
const SHORT_LEN=10;

// 라틴 보조 영역(U+0080~U+00FF) 비율. 이만큼 넘으면 "깨져 보이는 글자" 로 취급한다.
// 정상 텍스트 20건의 최대가 0.36(악센트가 많은 프랑스어), 깨진 텍스트 148건의 중앙값이
// 0.82 였다. 0.5 는 그 사이에서 정상 쪽에 안전한 자리다. 결과를 바꾸는 값이 아니라
// "왜 안 됐는지" 안내 문구를 고르는 데만 쓴다.
const MOJI_HINT=0.5;

function diagnose(s){
  let n=0,fffd=0,qmark=0,c1=0,hi=0;
  for(const ch of s){
    const cp=ch.codePointAt(0); n++;
    if(cp===0xFFFD) fffd++;
    else if(cp===0x3F) qmark++;
    else if(cp>=0x80&&cp<0xA0) c1++;      // C1 제어문자 — 붙여넣기에서 가장 먼저 사라진다
    else if(cp>=0xA0&&cp<0x100) hi++;     // latin1 상위 영역 — 깨짐의 전형적 흔적
  }
  return {n:n,fffd:fffd,qmark:qmark,c1:c1,hi:hi,short:n<SHORT_LEN,dmg:utf8Damage(s)};
}

// 복구 실패 시 원인 후보를 순서대로 반환한다.
// 1순위 점수가 이 밑이면 어떤 조합도 자연스럽지 않았다는 뜻.
// 벤치마크 148건에서 정답의 최저 점수가 75 였다.
const SCORE_FLOOR=70;
// UTF-8 구조가 "대부분 멀쩡한데 일부만" 깨진 상태. 벤치마크에서 이 구간은 0건이라
// 정상 입력을 잘못 짚을 위험이 없다.
const DMG_MAX_RATIO=0.25;

function reasons(d,found,partial,topScore,nbsp){
  const r=[];
  // 복원에 성공했더라도 알려준다 — 이번엔 되살렸지만 다음번엔 못 살릴 수도 있고,
  // 파일로 올리면 애초에 이런 손상이 없다는 것이 사용자가 얻어갈 실질적인 정보다.
  if(nbsp) r.push(T.nbspFixed);
  const g=d.dmg;
  if(g&&g.seen>=3&&g.broken>=1&&g.ratio<=DMG_MAX_RATIO){
    r.push(T.damaged(g.broken));
  }
  if(typeof topScore==='number'&&topScore<SCORE_FLOOR){
    r.push(T.lowScore);
  }
  if(partial&&partial.length) r.push(T.partialBytes);
  if(d.fffd>0) r.push(T.fffd(d.fffd));
  if(d.qmark>=2&&d.qmark/d.n>0.05) r.push(T.qmark(d.qmark));
  if(!found&&d.hi>0&&d.c1===0) r.push(T.pasteDamage);
  if(d.short) r.push(T.shortInput(d.n,SHORT_LEN));
  return r;
}

function reasonHtml(head,list){
  if(!list.length) return head;
  return head+'<ul style="margin:8px 0 0;padding-left:18px">'+
         list.map(function(x){return '<li style="margin-top:4px">'+x+'</li>';}).join('')+'</ul>';
}

// short: 입력이 짧아 확신도가 무의미 / weak: 입력이 이미 정상이라 후보가 참고용
function render(list,confs,ms,short,weak){
  const out=$('out');
  if(!list.length){ out.innerHTML=''; return; }
  out.innerHTML=list.map((r,i)=>{
    const chain=r.chain.map(c=>
      '<span class="chip dim">'+esc(label(c.m))+'</span><span>'+T.undo+'</span>'+
      // 붙여넣다가 NBSP 를 잃은 입력은 그 사실을 밝힌다. 사용자가 "다음엔 파일로 올리면
      // 된다" 를 알게 되는 지점이라 감춰서 이득이 없다.
      (c.nbsp?'<span class="chip">'+T.nbspChip+'</span>':'')+
      '<span class="chip">'+esc(c.a)+'</span><span>'+T.readAs+'</span>'
    ).join('<span>→</span>');
    // 확신도는 근거가 있을 때만 보여준다.
    // 짧은 입력은 통계가 성립하지 않고, 이미 정상인 입력은 애초에 복구 대상이 아니다.
    const conf=short
      ? '<span class="conf" title="'+T.confShortTitle+'">'+T.confShort+'</span>'
      : weak
      ? '<span class="conf">'+T.confRef+'</span>'
      : '<span class="conf"><span class="track"><span class="fill" style="width:'+confs[i]+'%"></span></span>'+confs[i]+'%</span>';
    // 마지막 단계에서 어떤 인코딩으로 읽었는지가 언어 판정의 보조 단서다
    const lang=langName(langHint(r.text,r.chain[r.chain.length-1].a));
    return '<div class="res'+(i===0&&!weak?' best':'')+'">'+
      '<div class="rhead">'+
        '<span class="rank">'+(i===0&&!weak?'<b>'+T.rank1+'</b>':T.rankN(i+1))+
          (lang?'<span class="lang">'+esc(lang)+'</span>':'')+'</span>'+
        conf+
      '</div>'+
      '<div class="text">'+esc(r.text)+'</div>'+
      '<div class="rfoot">'+
        '<div class="chain">'+chain+'</div>'+
        '<button class="copy" data-i="'+i+'">'+T.copy+'</button>'+
      '</div></div>';
  }).join('');

  out.querySelectorAll('.copy').forEach(b=>{
    b.addEventListener('click',()=>{
      navigator.clipboard.writeText(list[+b.dataset.i].text).then(()=>{
        const o=b.textContent; b.textContent=T.copied;
        setTimeout(()=>b.textContent=o,1200);
      });
    });
  });
  $('meta').textContent=T.meta(ms,list.length);
}

// 줄마다 다른 방식으로 깨진 입력. 줄별 근거가 제각각이라 랭킹 카드 형식에 안 맞고,
// 판정 성격도 달라 순위 경쟁에 섞지 않는다 (부분 복구 섹션과 같은 원칙).
// 줄별 복구(recoverLines)와 구간 복구(recoverSegments)가 같은 자리·같은 형식을 쓴다.
// 둘 다 "통짜로는 못 푸는 입력을 쪼개서 풀었다" 는 같은 성격이라 카드를 나눌 이유가 없다.
function renderLines(lr){
  const box=$('lines');
  if(!lr){ box.innerHTML=''; return; }
  const seg = lr.kind==='seg';
  // 구간 복구는 어디를 고쳤는지 보여준다. 일부만 고쳤다는 사실 자체가 정보다.
  const body = seg && lr.parts
    ? lr.parts.map(p=>p.fixed?'<mark>'+esc(p.t)+'</mark>':esc(p.t)).join('')
    : esc(lr.text);
  box.innerHTML='<div class="res best">'+
    '<div class="rhead">'+
      '<span class="rank"><b>'+(seg?T.cardSeg:T.cardLine)+'</b></span>'+
      '<span class="conf">'+(seg?T.segCount(lr.fixed):T.lineCount(lr.lines,lr.fixed))+'</span>'+
    '</div>'+
    '<div class="text">'+body+'</div>'+
    '<div class="rfoot">'+
      '<div class="chain"><span class="chip">'+(seg?T.chipSeg:T.chipLine)+'</span><span>'+
        (seg?T.segTail:T.lineTail)+'</span></div>'+
      '<button class="copy" data-l="1">'+T.copy+'</button>'+
    '</div></div>';
  box.querySelector('.copy').addEventListener('click',function(){
    const b=this;
    navigator.clipboard.writeText(lr.text).then(function(){
      const o=b.textContent; b.textContent=T.copied;
      setTimeout(function(){ b.textContent=o; },1200);
    });
  });
}

// 부분 복구 섹션. 순위·확신도를 붙이지 않는다 — 어느 것이 맞는지 판단한 게 아니라
// "이렇게도 읽힌다" 를 나열하는 것뿐이다.
function renderPartial(partial){
  const box=$('part');
  if(!partial||!partial.length){ box.innerHTML=''; return; }
  box.innerHTML='<div class="part">'+
    '<h3>'+T.partialTitle+'</h3>'+
    '<p>'+T.partialDesc+'</p>'+
    partial.map(function(p,i){
      // 이 후보들은 채점상 전부 동점이라 순서가 판단 결과가 아니다.
      // 언어 라벨이 사실상 유일한 선택 근거이므로 반드시 붙인다.
      const lang=langName(langHint(p.clean,p.actual));
      return '<div class="prow">'+
        (lang?'<span class="lang">'+esc(lang)+'</span>':'')+
        '<div class="text">'+esc(p.text)+'</div>'+
        '<button class="copy" data-p="'+i+'">'+T.copy+'</button>'+
      '</div>';
    }).join('')+
  '</div>';

  box.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click',function(){
      navigator.clipboard.writeText(partial[+b.dataset.p].clean).then(function(){
        const o=b.textContent; b.textContent=T.copied;
        setTimeout(function(){ b.textContent=o; },1200);
      });
    });
  });
}

function run(){
  const s=$('in').value;
  hideMsg();
  $('out').innerHTML='';
  $('part').innerHTML='';
  $('lines').innerHTML='';
  $('meta').textContent='';
  if(!s.trim()){ show('warn',T.needInput); return; }

  const d=diagnose(s);
  const t0=performance.now();
  const {base,list,partial}=recover(s);
  const ms=Math.round(performance.now()-t0);

  // 통짜 → 줄 → 구간 순으로 내려간다. 위에서 풀리면 아래는 시도하지 않는다.
  //
  // 정상 글자가 섞인 입력은 통짜로는 후보가 0개다 — encodeWith 가 되돌릴 수 없는 문자를
  // 만나면 가설을 통째로 버리기 때문이다. 그 구간을 recoverSegments 가 담당한다.
  //
  // ⚠ wholeOk 가드를 빼지 말 것. 통짜가 이미 답을 냈는데도 구간 복구를 돌리면, 정답을
  // 찾아놓고 그 위에 오답 카드를 띄운다 (카드가 .res.best 라 화면에서 가장 큰 자리다).
  // 실제로 그렇게 나갔다 — `¿À´Ã È¸ÀÇ´Â …` 이 랭킹 1위는 정답인데 카드는 쓰레기였고
  // 확신도까지 참고용으로 강등됐다. 판정식은 아래 weak 과 같은 것을 쓴다.
  const lr=recoverLines(s);
  const wholeOk = list.length && list[0].score >= base + 10;
  const sg=(lr||wholeOk)?null:recoverSegments(s);
  const SEG_MSG=T.segMsg;

  if(!list.length){
    if(lr||sg){
      show('ok', lr
        ? T.lineMsg
        : SEG_MSG);
      renderLines(lr||sg);
    } else if(base>60){
      show('ok',T.notBroken);
    } else {
      show('warn',reasonHtml(T.noCombo,
        reasons(d,false,partial,null).concat([T.lossyExtra])));
    }
    renderPartial(partial);
    $('meta').textContent=ms+'ms';
    return;
  }

  // 줄마다 가정이 다르면 통짜 1순위가 쓰레기다. 그 상태로 확신도를 붙이면 안 된다.
  const weak = (lr||sg) ? true : !wholeOk;
  // 1순위가 NBSP 복원을 거쳤으면 그 사실을 안내에 넣는다
  const usedNbsp = list[0].chain.some(function(c){ return c.nbsp; });
  const notes=reasons(d,true,partial,list[0].score,usedNbsp);
  if(lr){
    show('ok',T.lineMsg+T.rankIsRef);
  } else if(sg){
    show('ok',SEG_MSG+T.rankIsRef);
  } else if(weak){
    show('ok',reasonHtml(T.alreadyNormal,notes));
  } else if(usedNbsp){
    // 복구는 성공했다. "믿기 전에 확인하세요" 로 겁줄 일이 아니라, 입력이 오는 길에
    // 손상됐다는 사실과 다음번 대처를 알려주는 자리다.
    show('ok',reasonHtml(T.nbspRecovered,notes));
  } else if(notes.length){
    show('warn',reasonHtml(T.verifyFirst,notes));
  }
  renderLines(lr||sg);
  render(list,confidences(list),ms,d.short,weak);
  renderPartial(partial);
  syncClear();
}

/* ─────────── 지우기 ─────────── */
// 아무것도 안 하는 버튼을 띄워두지 않는다 — 입력도 결과도 없으면 숨긴다.
// 파일 탭에서도 숨긴다 (붙여넣기 전용).
function syncClear(){
  const onText = !$('pane-text').hidden;
  const has = $('in').value.length > 0 || $('out').innerHTML !== '' || $('lines').innerHTML !== '';
  $('clear').hidden = !(onText && has);
}

$('clear').textContent = T.clear;
$('clear').addEventListener('click',function(){
  $('in').value='';
  clearResults();
  syncClear();
  $('in').focus();
});
$('in').addEventListener('input',syncClear);

$('go').addEventListener('click',run);
$('in').addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter') run();
});

/* ─────────── 탭 ─────────── */
const TABS=[['tab-text','pane-text'],['tab-file','pane-file']];

function selectTab(id){
  for(const [t,p] of TABS){
    const on=t===id;
    $(t).setAttribute('aria-selected',on?'true':'false');
    $(t).tabIndex=on?0:-1;
    $(p).hidden=!on;
  }
  // 반대편 탭의 결과가 남아 있으면 어느 입력에 대한 답인지 알 수 없다.
  clearResults();
  // 지우기는 붙여넣기 전용이다. 파일은 새로 고르면 대체되므로 필요가 다르다.
  syncClear();
}

// 탭 전환과 지우기 버튼이 같이 쓴다.
function clearResults(){
  hideMsg();
  $('out').innerHTML=''; $('part').innerHTML=''; $('lines').innerHTML=''; $('flines').innerHTML=''; $('fout').innerHTML='';
  $('meta').textContent=''; $('fmeta').textContent='';
}

for(const [t] of TABS){
  $(t).addEventListener('click',()=>selectTab(t));
  $(t).addEventListener('keydown',e=>{
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return;
    e.preventDefault();
    const i=TABS.findIndex(x=>x[0]===t);
    const next=TABS[(i+(e.key==='ArrowRight'?1:TABS.length-1))%TABS.length][0];
    selectTab(next); $(next).focus();
  });
}

/* ─────────── 파일 탭 ─────────── */
// 엑셀은 BOM 없는 UTF-8 CSV 를 로컬 코드페이지로 읽어 다시 깨뜨린다.
// 그래서 표 계열 확장자는 BOM 을 기본으로 붙인다.
const SHEET_EXT=/\.(csv|tsv|txt)$/i;
const KB=1024;

function fmtSize(n){
  if(n<KB) return n+' B';
  if(n<KB*KB) return (n/KB).toFixed(1)+' KB';
  return (n/KB/KB).toFixed(1)+' MB';
}

function download(bytes,name){
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
  const a=document.createElement('a');
  a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function fixedName(name,suffix){
  const i=name.lastIndexOf('.');
  return i>0 ? name.slice(0,i)+suffix+name.slice(i) : name+suffix;
}

function textBytes(text,withBom){
  const body=new TextEncoder().encode(text);
  if(!withBom) return body;
  const out=new Uint8Array(body.length+3);
  out.set([0xEF,0xBB,0xBF],0); out.set(body,3);
  return out;
}

// 버튼 하나에 눌렸다는 표시를 잠깐 남긴다 (복사 버튼과 같은 방식)
function flash(b,msg){
  const o=b.textContent; b.textContent=msg;
  setTimeout(()=>{ b.textContent=o; },1200);
}

function fileHead(i,conf,lang){
  return '<div class="rhead">'+
    '<span class="rank">'+(i===0?'<b>'+T.rank1+'</b>':T.rankN(i+1))+
      (lang?'<span class="lang">'+esc(lang)+'</span>':'')+'</span>'+conf+
  '</div>';
}

/* 줄마다 다르게 깨진 파일 — 붙여넣기 탭의 renderLines 와 같은 판정, 받기 버튼만 다르다 */
function renderFileLines(lr,name){
  const box=$('flines');
  if(!lr){ box.innerHTML=''; return; }
  const seg = lr.kind==='seg';
  box.innerHTML='<div class="res best">'+
    '<div class="rhead">'+
      '<span class="rank"><b>'+(seg?T.cardSeg:T.cardLine)+'</b></span>'+
      '<span class="conf">'+(seg?T.segCount(lr.fixed):T.lineCount(lr.lines,lr.fixed))+'</span>'+
    '</div>'+
    '<div class="text">'+esc(lr.text.slice(0,500))+(lr.text.length>500?' …':'')+'</div>'+
    '<div class="rfoot">'+
      '<div class="chain"><span class="chip">'+(seg?T.chipSeg:T.chipLine)+'</span><span>'+
        (seg?T.segTail:T.lineTail)+'</span></div>'+
      '<button class="copy">'+T.download+'</button>'+
    '</div></div>';
  box.querySelector('.copy').addEventListener('click',function(){
    download(textBytes(lr.text,$('bom').checked),fixedName(name,'.utf8'));
    flash(this,T.downloading);
  });
}

/* 텍스트 계열 파일 */
// 후보 카드 한 장. 파일 인코딩 후보와 내용-깨짐 후보가 같은 모양을 쓴다.
function fileCard(i,conf,text,chain,btn,lang){
  return '<div class="res'+(i===0?' best':'')+'">'+
    fileHead(i,conf,lang)+
    '<div class="text">'+esc(text.slice(0,500))+(text.length>500?' …':'')+'</div>'+
    '<div class="rfoot">'+
      '<div class="chain">'+chain+'</div>'+
      '<button class="copy" data-i="'+i+'">'+btn+'</button>'+
    '</div></div>';
}

function confCell(fixed,short,pct){
  if(fixed) return '<span class="conf">'+T.confFixed+'</span>';
  if(short) return '<span class="conf" title="'+T.confShortTitleFile+'">'+T.confShort+'</span>';
  return '<span class="conf"><span class="track"><span class="fill" style="width:'+pct+'%"></span></span>'+pct+'%</span>';
}

function bindDownload(box,list,name){
  box.querySelectorAll('.copy').forEach(b=>{
    b.addEventListener('click',()=>{
      // 체크박스는 결과가 뜬 뒤에도 바꿀 수 있으므로 누르는 시점에 읽는다
      download(textBytes(list[+b.dataset.i].text,$('bom').checked),fixedName(name,'.utf8'));
      flash(b,T.downloading);
    });
  });
}

// 파일은 멀쩡한데 안에 담긴 글자가 이미 깨져 있던 경우.
// 깨진 글자를 복사해 메모장에 저장하면 이렇게 되므로 실제로 가장 흔한 경로다.
function renderContentMojibake(name,r,quiet){
  const box=$('fout'), enc=r.list[0].actual, list=r.content;
  if(!quiet) show('warn',T.contentBroken(esc(enc)));

  const confs=confidences(list);
  const short=list[0].text.length<SHORT_LEN;
  box.innerHTML=list.map(function(c,i){
    const chain='<span class="chip dim">'+esc(enc)+T.encFile+'</span><span>→</span>'+
      c.chain.map(function(x){
        return '<span class="chip dim">'+esc(label(x.m))+'</span><span>'+T.undo+'</span>'+
               '<span class="chip">'+esc(x.a)+'</span><span>'+T.readAs+'</span>';
      }).join('<span>→</span>');
    return fileCard(i,confCell(false,short,confs[i]),c.text,chain,T.download,
                    langName(langHint(c.text,c.chain[c.chain.length-1].a)));
  }).join('');
  bindDownload(box,list,name);
}

function renderTextFile(name,r){
  const box=$('fout');
  if(r.binary){
    show('warn',T.notText);
    return;
  }
  if(!r.list.length){
    show('warn',T.noGlyphs);
    return;
  }
  // 줄마다 다른 방식으로 깨져 있으면 통짜로는 못 푼다. **content 판정보다 먼저** 본다 —
  // content 는 통짜 recover() 결과라, 섞인 입력에서는 그것도 쓰레기이기 때문이다.
  // 같은 이유로 구간 복구도 여기서 본다 — 정상 글자와 깨진 글자가 한 줄에 섞인 파일이
  // 실사용에서 흔하다(깨진 글자를 복사해 메모장에 저장한 경우).
  //
  // ⚠ r.content 가드는 붙여넣기 탭의 wholeOk 와 같은 것이다. contentMojibake() 가 통짜로
  // 답을 냈으면 구간 복구를 돌리지 않는다 — 안 그러면 정답 위에 오답 카드가 얹힌다.
  const lr=recoverLines(r.list[0].text) || (r.content?null:recoverSegments(r.list[0].text));
  renderFileLines(lr,name);
  if(lr){
    show('ok', lr.kind==='seg'
      ? T.segMsg+T.belowIsRef
      : T.lineMsg+T.belowIsRef);
  }

  // 파일 인코딩이 아니라 그 안의 글자가 깨진 경우는 다른 이야기이므로 따로 그린다
  if(r.content){ renderContentMojibake(name,r,!!lr); return; }

  if(lr){
    // 위에서 이미 사유를 안내했다. 덮어쓰지 않는다.
  } else if(r.bom){
    show('ok',T.bomMsg(esc(r.bom)));
  } else if(r.ascii){
    show('ok',T.asciiMsg);
  } else if(r.certain){
    // 글자가 깨져 보이는데 되돌리지 못한 경우와, 정말 멀쩡한 경우를 구분해서 말한다.
    // "정상입니다" 라고 단정하면 안 된다 — 되돌릴 조합을 못 찾은 것과 같은 화면이 된다.
    const d=diagnose(r.list[0].text);
    if((d.hi+d.c1)/d.n>=MOJI_HINT){
      // 줄별 복구가 성공했으면 위에서 이미 안내했다. 여기는 그것마저 실패한 경우다.
      if(!lr){
        show('warn',T.mixedMsg);
      }
    } else {
      show('ok',T.utf8Fine);
    }
  }

  const fixed=r.certain;
  const confs=confidences(r.list);
  const short=r.list[0].text.length<SHORT_LEN;

  box.innerHTML=r.list.map(function(c,i){
    const chain='<span class="chip">'+esc(c.actual)+'</span><span>'+T.savedAs+'</span>';
    return fileCard(i,confCell(fixed,short,confs[i]),c.text,chain,T.download,
                    langName(langHint(c.text,c.actual)));
  }).join('');
  bindDownload(box,r.list,name);
}

/* ZIP 파일명 */
function renderZip(name,bytes,z){
  const box=$('fout');
  if(z.error){ show('warn',esc(z.error)); return; }
  if(z.ok){
    show('ok',T.zipAlready);
    box.innerHTML='<div class="res"><div class="names">'+
      z.cands[0].names.map(n=>'<div class="nrow kept"><b>'+esc(n)+'</b></div>').join('')+
    '</div></div>';
    return;
  }

  if(!z.cands.length){
    show('warn',T.zipFail);
    return;
  }

  const utf=new TextDecoder('utf-8');
  const olds=z.entries.map(e=>utf.decode(e.name));
  show('warn',T.zipMsg);

  box.innerHTML=z.cands.map((c,i)=>
    '<div class="res'+(i===0?' best':'')+'">'+
      fileHead(i,'<span class="conf">'+esc(c.actual)+'</span>')+
      '<div class="names">'+z.entries.map((e,k)=>
        e.utf8
          ? '<div class="nrow kept"><b>'+esc(c.names[k])+'</b></div>'
          : '<div class="nrow"><i>'+esc(olds[k])+'</i><span>→</span><b>'+esc(c.names[k])+'</b></div>'
      ).join('')+'</div>'+
      '<div class="rfoot">'+
        '<div class="chain"><span class="chip">'+esc(c.actual)+'</span><span>'+T.savedAsName+'</span></div>'+
        '<button class="copy" data-i="'+i+'">'+T.takeThisName+'</button>'+
      '</div></div>'
  ).join('');

  box.querySelectorAll('.copy').forEach(b=>{
    b.addEventListener('click',()=>{
      const rb=zipRebuild(bytes,z.entries,z.cands[+b.dataset.i].names);
      if(rb.error){ show('warn',esc(rb.error)); return; }
      download(rb.bytes,fixedName(name,'.utf8'));
      flash(b,T.downloading);
    });
  });
}

function handleFile(f){
  hideMsg();
  $('fout').innerHTML='';
  $('flines').innerHTML='';
  $('fmeta').textContent='';
  // 새 파일마다 BOM 기본값을 확장자로 다시 정한다
  $('bom').checked=SHEET_EXT.test(f.name);
  if(f.size>MAX_FILE){
    show('warn',T.tooBig(fmtSize(f.size),fmtSize(MAX_FILE)));
    return;
  }
  if(!f.size){ show('warn',T.emptyFile); return; }

  const rd=new FileReader();
  rd.onerror=()=>show('warn',T.readFail);
  rd.onload=()=>{
    const bytes=new Uint8Array(rd.result);
    const t0=performance.now();
    if(isZip(bytes)) renderZip(f.name,bytes,zipInspect(bytes));
    else renderTextFile(f.name,recoverBytes(bytes));
    $('fmeta').textContent=fmtSize(f.size)+' · '+Math.round(performance.now()-t0)+'ms';
  };
  rd.readAsArrayBuffer(f);
}

$('file').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0];
  e.target.value='';   // 같은 파일을 다시 골라도 change 가 뜨도록
  if(f) handleFile(f);
});

const drop=$('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{
  e.preventDefault(); drop.classList.add('over');
}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{
  e.preventDefault(); drop.classList.remove('over');
}));
drop.addEventListener('drop',e=>{
  const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
  if(f) handleFile(f);
});

// 드롭존을 살짝 빗나가면 브라우저가 그 파일로 이동해버려 입력이 통째로 날아간다.
['dragover','drop'].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault()));

})();
