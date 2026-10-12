// Documentation-only SVG renderer. No runtime or external font requests.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));
const spec=JSON.parse(fs.readFileSync(dir+'spec.json','utf8'));
const font=fs.readFileSync(dir+'diagram-sans.woff2').toString('base64');
const palettes={light:{bg:'#f6f8fb',card:'#fff',ink:'#202b3c',muted:'#526174',line:'#dce5f2',blue:'#2563eb',cyan:'#008da5',purple:'#7c3aed',green:'#059669',soft:'#edf3fa'},dark:{bg:'#101a2c',card:'#1a273d',ink:'#f0f5ff',muted:'#a7b7cf',line:'#354662',blue:'#82acff',cyan:'#5ed3e2',purple:'#ba99ff',green:'#65d6b0',soft:'#22324b'}};
let b,p;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function text(x,y,s,size=14,c=p.ink,weight=500){b.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${c}" font-weight="${weight}">${esc(s)}</text>`);}
function rect(x,y,w,h,c=p.card,stroke=p.line,r=10){b.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}" stroke="${stroke}"/>`);}
function arrow(x,y,X,Y,c=p.cyan){const a=Math.atan2(Y-y,X-x),s=6;b.push(`<path class="flow" d="M${x} ${y}L${X} ${Y}" fill="none" stroke="${c}" stroke-width="1.8" stroke-dasharray="3 6"/><path d="M${X-s*Math.cos(a-.5)} ${Y-s*Math.sin(a-.5)}L${X} ${Y}L${X-s*Math.cos(a+.5)} ${Y-s*Math.sin(a+.5)}" fill="none" stroke="${c}" stroke-width="1.8"/>`);}
function icon(x,y,type,c=p.blue){
 if(type==='memory'){rect(x,y+6,62,40,p.soft,c,5);for(let i=0;i<3;i++)rect(x+7+i*17,y+14,12,22,p.card,c,2);for(let i=0;i<5;i++)rect(x+6+i*11,y+46,6,6,c,c,0);}
 else if(type==='browser'){rect(x,y,64,49,p.card,c,5);b.push(`<path d="M${x} ${y+11}h64" stroke="${c}"/>`);for(let i=0;i<3;i++)b.push(`<circle cx="${x+7+i*7}" cy="${y+6}" r="1.8" fill="${c}"/>`);b.push(`<path d="M${x+9} ${y+36}h12v-13h12v8h15" fill="none" stroke="${c}" stroke-width="2"/>`);}
 else if(type==='file'){b.push(`<path d="M${x+10} ${y}h30l14 14v40H${x+10}Z M${x+40} ${y}v14h14 M${x+20} ${y+26}h25 M${x+20} ${y+36}h25" fill="${p.card}" stroke="${c}" stroke-width="1.5"/>`);}
 else if(type==='cube'){b.push(`<path d="M${x+31} ${y}l27 15v29l-27 14-27-14v-29Z M${x+4} ${y+15}l27 15 27-15 M${x+31} ${y+30}v28" fill="${p.soft}" stroke="${c}" stroke-width="2"/>`);}
 else{rect(x+8,y+5,48,44,p.soft,c,5);for(let i=0;i<4;i++)b.push(`<path d="M${x} ${y+12+i*10}h8 M${x+56} ${y+12+i*10}h8 M${x+16+i*10} ${y-3}v8 M${x+16+i*10} ${y+49}v8" stroke="${c}" stroke-width="2"/>`);text(x+17,y+33,type==='gpu'?'GPU':'RUN',12,c,650);}
}
function header(d,m,h){const w=m?420:800;b=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${esc(d.title)}</title><desc id="desc">${esc(d.description)}</desc><style>@font-face{font-family:DiagramSans;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}text{font-family:DiagramSans,sans-serif}.flow{animation:flow 1.8s linear infinite}@keyframes flow{to{stroke-dashoffset:-18}}@media(prefers-reduced-motion:reduce){.flow{animation:none}}</style>`];rect(0,0,w,h,p.bg,p.bg,16);text(28,30,spec.label,10,p.muted,600);text(28,67,d.title,m?23:27,p.ink,650);d.subtitle.forEach((s,i)=>text(28,96+i*21,s,13,p.muted));}
function stepDiagram(d,m){
 const h=165+d.groups.length*149+(d.notes.length*22);header(d,m,h);let y=145;
 d.groups.forEach((g,i)=>{rect(28,y,m?364:744,121,p.card,p.line,12);icon(44,y+27,g.icon,[p.blue,p.cyan,p.purple,p.green][i%4]);text(124,y+31,g.title,17,p.ink,650);g.lines.forEach((s,j)=>text(124,y+58+j*23,s,m?12:14,p.muted));if(i<d.groups.length-1)arrow(m?210:400,y+127,m?210:400,y+144);y+=149;});
 d.notes.forEach((s,i)=>text(28,y+5+i*22,s,m?11:12,p.muted));
}
function traceArchitecture(d,m){
 header(d,m,m?805:675);const w=m?364:744;rect(28,143,w,m?606:464,p.card,p.line,14);text(44,170,'브라우저 · 서버 없이 로컬 실행',13,p.ink,650);
 icon(50,199,'browser');text(134,216,'React 화면',18,p.ink,650);text(134,242,d.ui,12,p.muted);
 arrow(m?165:345,269,m?165:345,308,p.blue);arrow(m?245:455,308,m?245:455,269,p.green);text(m?58:210,294,'명령 / 조회',11,p.blue);text(m?260:475,294,'응답',11,p.green);
 rect(44,321,m?332:712,m?407:265,p.soft,p.cyan,12);text(60,349,'Rust / WASM 영역',15,p.cyan,650);
 icon(66,382,'chip',p.cyan);text(154,396,d.engine,16,p.ink,650);d.engineLines.forEach((s,i)=>text(154,423+i*21,s,12,p.muted));
 const Y=m?509:483;rect(60,Y,m?300:680,m?198:84,p.card,p.line,10);icon(76,Y+16,'memory',p.purple);text(158,Y+30,'Generational Arena',16,p.purple,650);text(158,Y+55,'Span을 슬롯에 저장',12,p.muted);
 if(m){text(76,Y+109,d.policy[0],13,p.ink,650);text(76,Y+136,d.policy[1],12,p.muted);text(76,Y+163,d.policy[2],12,p.muted);}
 else{d.policy.forEach((s,i)=>text(455,Y+23+i*22,s,12,i===0?p.ink:p.muted,i===0?650:500));}
 text(28,m?780:641,'메모리 모양은 소프트웨어 저장 공간의 역할을 나타냅니다.',m?11:12,p.muted);
}
function engineArchitecture(d,m){
 header(d,m,m?985:807);const w=m?364:744;rect(28,140,w,m?710:523,p.card,p.line,14);text(44,169,'브라우저 · 같은 씬과 카메라 입력',13,p.ink,650);icon(52,193,'browser');text(135,211,'React + TypeScript driver',m?16:19,p.ink,650);text(135,239,'설정 · 단일 프레임 루프 · 비교 제어',m?11:13,p.muted);
 const lane=(x,y,width,main)=>{rect(x,y,width,main?200:171,p.soft,main?p.cyan:p.purple,12);text(x+16,y+28,main?'기본 경로 · Rust / WASM':'비교 경로 · TypeScript',15,main?p.cyan:p.purple,650);icon(x+20,y+48,main?'chip':'cube',main?p.cyan:p.purple);text(x+104,y+68,main?'씬 · Pool · Culling':'같은 알고리즘의',m?14:16,p.ink,650);text(x+104,y+92,main?'LOD · 상대 좌표 준비':'TS reference',13,p.muted);text(x+20,y+139,main?'wgpu → WebGPU':'Three.js → WebGPU',16,p.ink,650);text(x+20,y+164,main?'객체 슬롯과 씬 상태 소유':'비교 선택 시 지연 로드',12,p.muted);};
 if(m){arrow(210,260,210,281);lane(44,291,332,true);lane(44,537,332,false);text(52,519,'아래는 기본 경로와 별개의 비교 경로',11,p.muted);text(52,743,'두 경로 모두 브라우저 WebGPU 사용',12,p.muted);icon(70,773,'gpu',p.green);text(155,803,'GPU · 실제 Draw',17,p.green,650);}
 else{arrow(280,260,215,284);arrow(520,260,585,284,p.purple);lane(44,296,346,true);lane(410,296,346,false);arrow(215,505,215,550);arrow(585,476,585,550,p.purple);rect(170,557,460,80,p.card,p.line,10);icon(190,569,'gpu',p.green);text(277,589,'WebGPU → GPU',20,p.green,650);text(277,615,'공통 API로 실제 렌더링 · 비동기 계측',12,p.muted);}
 text(28,m?887:705,'FrameInput v1 · 공유 Geometry · 같은 카메라',m?12:14,p.muted);text(28,m?915:733,'Pool은 여러 처리 단계가 공유하는 저장소입니다.',m?12:14,p.muted);text(28,m?943:766,'칩은 실행 역할, 경계는 소프트웨어 실행 위치를 뜻합니다.',m?10:12,p.muted);
}
function arenaDiagram(d,m){
 header(d,m,m?691:582);const ys=m?[163,316,469]:[163,163,163],xs=m?[40,40,40]:[40,300,560];
 d.states.forEach((s,i)=>{const x=xs[i],y=ys[i],w=m?340:200;rect(x,y,w,120,p.card,i===1?p.line:p.purple,10);icon(x+16,y+28,'memory',i===1?p.muted:p.purple);text(x+93,y+38,s[0],17,p.ink,650);text(x+93,y+65,s[1],12,p.muted);text(x+16,y+102,s[2],12,p.muted);if(i<2){if(m)arrow(210,y+127,210,y+146,p.purple);else arrow(x+w+7,y+57,x+253,y+57,p.purple);}});
 const yy=m?622:337;d.notes.forEach((s,i)=>text(28,yy+i*25,s,m?11:14,i===0?p.purple:p.muted));
 if(!m){rect(40,448,720,83,p.soft,p.line,10);text(60,480,'Handle = index + generation',18,p.ink,650);text(60,507,'같은 슬롯 번호라도 세대가 다르면 이전 Handle의 접근은 거부됩니다.',13,p.muted);}
}
for(const theme of ['light','dark'])for(const m of [false,true])for(const d of spec.diagrams){p=palettes[theme];({steps:stepDiagram,trace:traceArchitecture,engine:engineArchitecture,arena:arenaDiagram}[d.type])(d,m);b.push('</svg>');const s=b.join('\n')+'\n',stem=dir+d.id+(m?'-mobile':'')+'-'+theme;fs.writeFileSync(stem+'.svg',s);fs.writeFileSync(stem+'-still.svg',s.replaceAll('animation:flow 1.8s linear infinite','animation:none'));}
console.log(`Generated ${spec.diagrams.length*8} SVGs for ${spec.label}`);
