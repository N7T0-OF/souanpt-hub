'use strict';
const GOLD='#e4b24a',GREEN='#2e9a63',GREY='#3a3a3a',BLUE='#2d7dd2',DIM='rgba(255,255,255,.04)';
const SC={x:{grid:{color:DIM},ticks:{color:'#333',font:{size:8},maxTicksLimit:8,autoSkip:true}},y:{grid:{color:DIM},ticks:{color:'#333',font:{size:8}},min:0}};
let dashChart=null,analyticsChart=null,donutChart=null,revChart=null;
const D30=[280,310,260,420,380,540,490,620,580,710,660,780,740,870,820,750,900,830,960,880,1020,940,1100,980,1050,920,1080,1000,1120,1060];
const L30=D30.map((_,i)=>`J${i+1}`);
const PERIODS={
  7:{d:[310,280,420,490,620,540,690],l:['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']},
  30:{d:D30,l:L30},
  90:{d:[5000,5380,5800,6200,6700,7100,7600,8100,8400,8900,9200,9700,10100],l:['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12','S13']},
  365:{d:[18000,19500,21000,22000,23500,24000,22500,25000,26000,24500,27000,25500],l:['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']},
  0:{d:D30.filter((_,i)=>i%4===0),l:L30.filter((_,i)=>i%4===0)}
};
window.buildDashChart=function(pts){
  const ctx=document.getElementById('dashChart');if(!ctx||typeof Chart==='undefined')return;
  if(dashChart){dashChart.destroy();dashChart=null;}
  window._dashPeriod=pts;const set=PERIODS[pts]||PERIODS[30];
  dashChart=new Chart(ctx,{type:'line',data:{labels:set.l,datasets:[{data:set.d,borderColor:GOLD,borderWidth:1.5,pointRadius:0,fill:true,backgroundColor:'rgba(201,146,42,.05)',tension:.4}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:300},plugins:{legend:{display:false}},scales:SC}});
};
window.switchP=function(pts,btn){
  document.querySelectorAll('.cf').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');buildDashChart(pts);
};
window.initAnalyticsCharts=function(){
  const sub=D30.filter((_,i)=>i%3===0);const lbl=L30.filter((_,i)=>i%3===0);
  const ac=document.getElementById('analyticsChart');
  if(ac&&typeof Chart!=='undefined'&&!analyticsChart){
    analyticsChart=new Chart(ac,{type:'line',data:{labels:lbl,datasets:[
      {label:'Portfolio',data:sub.map(v=>Math.round(v*.6)),borderColor:GOLD,borderWidth:1.5,pointRadius:0,fill:false,tension:.4},
      {label:'Links',data:sub.map(v=>Math.round(v*.28)),borderColor:GREY,borderWidth:1.5,pointRadius:0,fill:false,tension:.4,borderDash:[4,3]},
      {label:'Ko-fi',data:sub.map(v=>Math.round(v*.12)),borderColor:GREEN,borderWidth:1.5,pointRadius:0,fill:false,tension:.4}
    ]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:300},plugins:{legend:{display:false}},scales:SC}});
  }
  const dc=document.getElementById('donutChart');
  if(dc&&typeof Chart!=='undefined'&&!donutChart){
    donutChart=new Chart(dc,{type:'doughnut',data:{datasets:[{data:[58,38,4],backgroundColor:[GOLD,'#2a2a2a','#3a3a3a'],borderWidth:0,hoverOffset:3}]},options:{cutout:'72%',responsive:false,maintainAspectRatio:false,animation:{duration:400},plugins:{legend:{display:false}}}});
  }
};
window.initRevChart=function(){
  const ctx=document.getElementById('revChart');if(!ctx||typeof Chart==='undefined'||revChart)return;
  const invoices=Store.get('invoices')||[];
  const monthly=[0,0,0,0,0,0];
  invoices.filter(i=>i.status==='paid').forEach(i=>{
    const d=new Date(i.date);const m=d.getMonth();
    if(m>=0&&m<6)monthly[m]+=(i.price||0);
  });
  const labels=['Jan','Fév','Mar','Avr','Mai','Jun'];
  const data=monthly.every(v=>v===0)?[180,240,320,190,420,640]:monthly;
  revChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:'rgba(201,146,42,.2)',borderColor:GOLD,borderWidth:1.5,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:300},plugins:{legend:{display:false}},scales:SC}});
};
