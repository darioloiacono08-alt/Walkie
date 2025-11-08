/* Walkie – prettier UI + robust images + same features
   - Leaflet map tracking
   - Haversine distance, speed, pace
   - History in localStorage
   - Health index (0..100) with badge
*/

const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

// ---------- Tabs ----------
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(b => b.classList.remove("active"));
  t.classList.add("active");
  $$(".section").forEach(s => s.classList.remove("active"));
  $("#" + t.dataset.target).classList.add("active");
}));

// ---------- Store ----------
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v?JSON.parse(v):d } catch { return d } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)) }
};

// ---------- Goal UI ----------
const goalInput = $("#goalKm");
goalInput.value = store.get("goalKm", 2.0);
const setGoalLabel = () => $("#goalLabel").textContent = `Goal: ${Number(goalInput.value).toFixed(1)} km`;
setGoalLabel();
goalInput.addEventListener("input", () => { store.set("goalKm", Number(goalInput.value)); setGoalLabel(); });

// ---------- Leaflet Map ----------
let map, userMarker, pathLine, watchId=null, path=[], startTime=null, km=0;
function initMap(){
  map = L.map("map", { zoomControl:true }).setView([45.4642, 9.19], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  pathLine = L.polyline([], { weight:5 }).addTo(map);
}
document.addEventListener("DOMContentLoaded", initMap);

// ---------- Helpers ----------
const toRad = d => d * Math.PI / 180;
function haversine(a,b){
  const R=6371, dLat=toRad(b.lat-a.lat), dLon=toRad(b.lng-a.lng);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
const fmtMS = sec => {
  const m = Math.floor(sec/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${m}:${s}`;
};
const avgSpeed = (km, sec) => sec>0 ? km/(sec/3600) : 0;
const kmPace = (km, sec) => (km>0 ? (sec/km) : null); // s per km

// ---------- Controls ----------
const mDist=$("#mDist"), mTime=$("#mTime"), mSpeed=$("#mSpeed"), mPace=$("#mPace"), mGoal=$("#mGoal"), mCount=$("#mCount");
const startBtn=$("#startBtn"), stopBtn=$("#stopBtn"), centerBtn=$("#centerBtn");

startBtn.addEventListener("click", () => {
  if (!navigator.geolocation){ alert("Geolocalizzazione non supportata"); return; }
  path=[]; km=0; startTime=Date.now(); pathLine.setLatLngs([]);
  startBtn.disabled=true; stopBtn.disabled=false;

  watchId = navigator.geolocation.watchPosition(onPos, onGeoError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 10000
  });
});

stopBtn.addEventListener("click", () => {
  if (watchId!=null) navigator.geolocation.clearWatch(watchId);
  watchId=null; startBtn.disabled=false; stopBtn.disabled=true;

  const sec = (Date.now()-startTime)/1000;
  const hist = store.get("history", []);
  hist.unshift({ date:new Date().toISOString(), km:Number(km.toFixed(2)), sec:Math.round(sec), avg:avgSpeed(km,sec) });
  store.set("history", hist);
  renderHistory();
  mCount.textContent = hist.length;
});

centerBtn.addEventListener("click", () => {
  if (!path.length) return;
  const last = path[path.length-1];
  map.setView([last.lat, last.lng], 17);
});

function onPos(p){
  const cur = { lat: p.coords.latitude, lng: p.coords.longitude };
  if (!userMarker){ userMarker = L.marker([cur.lat,cur.lng]).addTo(map); map.setView([cur.lat,cur.lng], 17); }
  else userMarker.setLatLng([cur.lat,cur.lng]);

  if (path.length){ km += haversine(path[path.length-1], cur); }
  path.push(cur);
  pathLine.addLatLng([cur.lat,cur.lng]);

  const sec = (Date.now()-startTime)/1000;
  mDist.textContent = `${km.toFixed(2)} km`;
  mTime.textContent = fmtMS(sec);
  mSpeed.textContent = `${avgSpeed(km,sec).toFixed(1)} km/h`;
  const pace = kmPace(km, sec);
  mPace.textContent = pace ? `${Math.floor(pace/60).toString().padStart(2,"0")}:${Math.floor(pace%60).toString().padStart(2,"0")} /km` : "—";

  const goal = Number(store.get("goalKm", 2.0));
  const pct = Math.min(100, Math.round((km/goal)*100));
  mGoal.textContent = `${pct}%`;
}

function onGeoError(err){
  alert("GPS errore: " + err.message);
  startBtn.disabled=false; stopBtn.disabled=true;
}

// ---------- History ----------
function renderHistory(){
  const list = $("#history");
  const hist = store.get("history", []);
  if (!hist.length){ list.innerHTML = `<div class="muted">Nessuna passeggiata salvata.</div>`; return; }
  list.innerHTML = "";
  hist.slice(0,25).forEach((h,i)=>{
    const d = new Date(h.date);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div>
        <div><strong>${h.km.toFixed(2)} km</strong> · ${fmtMS(h.sec)} · ${h.avg.toFixed(1)} km/h</div>
        <div class="muted">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div>
      </div>
      <div class="muted">#${i+1}</div>
    `;
    list.appendChild(el);
  });
  mCount.textContent = hist.length;
}
document.addEventListener("DOMContentLoaded", renderHistory);

// ---------- Health Index ----------
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function gaussian(x, mu, sigma){ return Math.exp(-0.5 * ((x-mu)/sigma)**2); }

function healthScore({age, weight, mins, bcs, sleep, hr}){
  const act = clamp( gaussian(mins, 60, 20), 0, 1);
  const cond = clamp( gaussian(bcs, 4.5, 1.2), 0, 1);
  const slp = clamp( gaussian(sleep, 12, 2.5), 0, 1);
  const pulse = clamp( gaussian(hr, 80, 12), 0, 1);
  const ageF = clamp( 1 - Math.max(0, (age-6))*0.05, 0.6, 1);
  const wF = 1; // neutro: non abbiamo "ideal weight" affidabile
  return Math.round((act*0.30 + cond*0.28 + slp*0.16 + pulse*0.18 + ageF*0.08) * 100);
}
function badgeFor(score){
  if (score>=80) return {img:"assets/images/happydog.png", label:"Ottimo"};
  if (score>=60) return {img:"assets/images/healtydog.png", label:"Buono"};
  return {img:"assets/images/dogsection.png", label:"Attenzione"};
}
$("#calcBtn").addEventListener("click", ()=>{
  const payload = {
    age:Number($("#age").value),
    weight:Number($("#weight").value),
    mins:Number($("#mins").value),
    bcs:Number($("#bcs").value),
    sleep:Number($("#sleep").value),
    hr:Number($("#hr").value),
  };
  const s = healthScore(payload);
  const {img,label} = badgeFor(s);
  $("#healthOut").innerHTML = `<img src="${img}" alt="${label}"><div><div><strong>Punteggio Salute: ${s}/100</strong></div><div class="muted">${label}</div></div>`;
});

// ---------- Images fallback (se un asset manca) ----------
$$("img").forEach(img=>{
  img.addEventListener("error", ()=>{ img.alt = (img.alt||"")+ " (asset mancante)"; img.style.opacity=".5"; });
});
