/* Walkie Prototype
 * - Leaflet map + live geotracking
 * - Haversine distance, metrics, history (localStorage)
 * - Health Index score (0-100) + badge
 */

const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => [...el.querySelectorAll(s)];

// Tabs
qsa(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    qsa(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    qsa("section.view").forEach(v => v.classList.remove("active"));
    const id = `view-${btn.dataset.tab}`;
    qs("#" + id).classList.add("active");
  });
});

// Persistent settings
const store = {
  get(k, d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{ return d }},
  set(k, v){localStorage.setItem(k, JSON.stringify(v))}
};

// Goal handling
const goalInput = qs("#goalKm");
goalInput.value = store.get("goalKm", 2.0);
qs("#dailyGoalLabel").textContent = `Goal: ${Number(goalInput.value).toFixed(1)} km`;
goalInput.addEventListener("input", () => {
  store.set("goalKm", Number(goalInput.value));
  qs("#dailyGoalLabel").textContent = `Goal: ${Number(goalInput.value).toFixed(1)} km`;
});

// Map setup
let map, userMarker, pathLine, watchId = null, path = [], startTime = null, distanceKm = 0;
function initMap(){
  map = L.map("map", { zoomControl: true }).setView([45.4642, 9.19], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  pathLine = L.polyline([], { weight: 5 }).addTo(map);
}
document.addEventListener("DOMContentLoaded", initMap);

// Helpers
function haversine(a, b){
  const toRad = d => d * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h)); // km
}
const fmtTime = (sec) => {
  const m = Math.floor(sec/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${m}:${s}`;
};

// Walk controls
const btnStart = qs("#btnStart");
const btnStop = qs("#btnStop");
const btnRecenter = qs("#btnRecenter");
const mDistance = qs("#mDistance");
const mDuration = qs("#mDuration");
const mPace = qs("#mPace");

btnStart.addEventListener("click", async () => {
  if (!navigator.geolocation) { alert("Geolocalizzazione non supportata"); return; }

  // reset session
  path = []; distanceKm = 0; startTime = Date.now();
  pathLine.setLatLngs([]);

  btnStart.disabled = true; btnStop.disabled = false;

  watchId = navigator.geolocation.watchPosition(onPos, onGeoError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 10000
  });
});

btnStop.addEventListener("click", () => {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; btnStart.disabled = false; btnStop.disabled = true;

  const seconds = (Date.now() - startTime) / 1000;
  const history = store.get("history", []);
  history.unshift({
    date: new Date().toISOString(),
    km: Number(distanceKm.toFixed(2)),
    sec: Math.round(seconds),
    avg: computeAvgSpeed(distanceKm, seconds)
  });
  store.set("history", history);
  refreshHistory();
});

btnRecenter.addEventListener("click", () => {
  if (!path.length) return;
  const last = path[path.length-1];
  map.setView([last.lat, last.lng], 17);
});

function onPos(pos){
  const { latitude, longitude } = pos.coords;
  const point = { lat: latitude, lng: longitude };
  if (!userMarker){
    userMarker = L.marker([point.lat, point.lng]).addTo(map);
    map.setView([point.lat, point.lng], 17);
  } else userMarker.setLatLng([point.lat, point.lng]);

  // update path
  if (path.length){
    const prev = path[path.length-1];
    const inc = haversine(prev, point);
    distanceKm += inc;
  }
  path.push(point);
  pathLine.addLatLng([point.lat, point.lng]);

  const seconds = (Date.now() - startTime) / 1000;
  mDistance.textContent = `${distanceKm.toFixed(2)} km`;
  mDuration.textContent = fmtTime(seconds);
  mPace.textContent = `${computeAvgSpeed(distanceKm, seconds).toFixed(1)} km/h`;

  // goal visual (simple)
  const goal = Number(store.get("goalKm", 2.0));
  if (distanceKm >= goal) {
    mDistance.parentElement.style.outline = "2px solid var(--accent)";
  } else {
    mDistance.parentElement.style.outline = "none";
  }
}

function onGeoError(err){
  alert("GPS errore: " + err.message);
  btnStart.disabled = false; btnStop.disabled = true;
}
function computeAvgSpeed(km, seconds){
  if (seconds <= 0) return 0;
  return km / (seconds/3600);
}

// History rendering
function refreshHistory(){
  const list = qs("#historyList");
  const history = store.get("history", []);
  if (!history.length){ list.innerHTML = `<div class="muted">Nessuna passeggiata salvata.</div>`; return; }
  list.innerHTML = "";
  history.slice(0, 25).forEach((h, idx) => {
    const div = document.createElement("div");
    const d = new Date(h.date);
    div.className = "history-item";
    div.innerHTML = `
      <div>
        <div><strong>${h.km.toFixed(2)} km</strong> · ${fmtTime(h.sec)} · ${h.avg.toFixed(1)} km/h</div>
        <div class="muted">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div>
      </div>
      <div class="muted">#${idx+1}</div>
    `;
    list.appendChild(div);
  });
}
document.addEventListener("DOMContentLoaded", refreshHistory);

// HEALTH INDEX
/* Heuristic model (range 0..100)
 * Inputs: age(yrs), weight(kg), mins activity/day, BCS(1..9), sleep hours, resting HR
 * - Ideal mins: 30..90, best ~60
 * - Ideal BCS: 4..5
 * - Sleep ideal: 10..14
 * - Resting HR small/medium dogs ~60-100 (we normalize 60..90 as best)
 */
function healthScore({age, weight, mins, bcs, sleep, hr}){
  // Normalize helpers -> 0..1
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const gaussian = (x, mu, sigma) => Math.exp(-0.5 * ((x-mu)/sigma)**2);

  const act = clamp( gaussian(mins, 60, 20), 0, 1);        // best around 60 min
  const cond = clamp( gaussian(bcs, 4.5, 1.2), 0, 1);      // best around 4-5
  const slp = clamp( gaussian(sleep, 12, 2.5), 0, 1);      // best around 12h
  const pulse = clamp( gaussian(hr, 80, 12), 0, 1);        // best around 80 bpm

  // Age factor: younger slightly better until 6y, then gentle decline
  const ageF = clamp( 1 - Math.max(0, (age - 6)) * 0.05, 0.6, 1);

  // Weight penalty vs. rough ideal weight for size category (very crude)
  const ideal = weight; // assume given weight already near ideal; keep neutral
  const wF = clamp( gaussian(weight, ideal, ideal*0.12), 0.6, 1);

  const score = (act*0.28 + cond*0.28 + slp*0.16 + pulse*0.18 + ageF*0.05 + wF*0.05) * 100;
  return clamp( Math.round(score), 0, 100 );
}
function healthLabel(score){
  if (score >= 80) return {label:"Ottimo", img:"assets/images/happydog.png"};
  if (score >= 60) return {label:"Buono", img:"assets/images/healtydog.png"};
  return {label:"Attenzione", img:"assets/images/dogsection.png"};
}
qs("#btnHealth").addEventListener("click", () => {
  const payload = {
    age: Number(qs("#age").value),
    weight: Number(qs("#weight").value),
    mins: Number(qs("#mins").value),
    bcs: Number(qs("#bcs").value),
    sleep: Number(qs("#sleep").value),
    hr: Number(qs("#hr").value),
  };
  const s = healthScore(payload);
  const {label, img} = healthLabel(s);
  qs("#healthOut").innerHTML = `
    <img src="${img}" alt="${label}" />
    <div>
      <div><strong>Punteggio Salute: ${s}/100</strong></div>
      <div class="muted">${label}</div>
    </div>
  `;
});
