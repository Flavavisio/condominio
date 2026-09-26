import {resetDemo} from './demo-backend.js?v=20260926-live-demo-8';
const select=document.querySelector('#demoRole');
select.value=new URLSearchParams(location.search).get('role')==='resident'?'resident':'manager';
select.onchange=()=>{const url=new URL(location.href);url.searchParams.set('role',select.value);url.searchParams.delete('condo');url.searchParams.delete('tab');location.href=url.href;};
document.querySelector('#demoReset').onclick=resetDemo;
const bar=document.querySelector('.demo-bar');
new ResizeObserver(()=>document.documentElement.style.setProperty('--demo-bar-height',`${bar.getBoundingClientRect().height}px`)).observe(bar);

document.querySelector("#demoFullscreen").onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.().catch(()=>window.open("demo.html","_blank"));};
