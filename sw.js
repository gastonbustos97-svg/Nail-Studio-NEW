// ── Nail Studio Service Worker ──────────────────────────────
// Versión: 2.0 — notificaciones en background para Android

var CACHE_NAME = "nail-studio-v2";
var _turnos = [];
var _disparadas = {};  // claves ya notificadas — evita duplicados

// ── Utilidades ───────────────────────────────────────────────
function pad(n){ return n < 10 ? "0" + n : "" + n; }

function hoy(){
  var d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
}

function fmtHora(s){
  if(!s) return "";
  var p = s.split(":");
  var h = parseInt(p[0]), m = parseInt(p[1]||0);
  var ampm = h >= 12 ? "PM" : "AM";
  return (h % 12 || 12) + ":" + pad(m) + " " + ampm;
}

// ── Lógica de chequeo de turnos próximos ────────────────────
function chequearTurnosProximos(){
  if(!_turnos || !_turnos.length) return;
  var ahora = new Date();
  var hoyStr = hoy();

  _turnos.forEach(function(t){
    if(t.realizado || t.ausente) return;
    if(t.fecha !== hoyStr) return;
    if(!t.hora) return;

    var partes = t.hora.split(":");
    var tHora = new Date();
    tHora.setHours(parseInt(partes[0]), parseInt(partes[1]), 0, 0);
    var diffMin = (tHora - ahora) / 60000;

    // 30 minutos antes (ventana: 28–32 min)
    var key30 = t.fecha + "_" + t.hora + "_30";
    if(diffMin >= 28 && diffMin <= 32 && !_disparadas[key30]){
      _disparadas[key30] = true;
      mostrarNotif(
        "⏰ Turno en 30 min",
        t.nombre + " · " + t.servicio + " a las " + fmtHora(t.hora),
        key30
      );
    }

    // 10 minutos antes (ventana: 8–12 min)
    var key10 = t.fecha + "_" + t.hora + "_10";
    if(diffMin >= 8 && diffMin <= 12 && !_disparadas[key10]){
      _disparadas[key10] = true;
      mostrarNotif(
        "🚨 Turno en 10 min",
        t.nombre + " · " + t.servicio + " a las " + fmtHora(t.hora),
        key10
      );
    }

    // Hora exacta (ventana: ±2 min)
    var key0 = t.fecha + "_" + t.hora + "_0";
    if(diffMin >= -2 && diffMin <= 2 && !_disparadas[key0]){
      _disparadas[key0] = true;
      mostrarNotif(
        "💅 ¡Es la hora del turno!",
        t.nombre + " · " + t.servicio,
        key0
      );
    }
  });
}

function chequearManana(){
  if(!_turnos || !_turnos.length) return;
  var manana = new Date();
  manana.setDate(manana.getDate() + 1);
  var mananaStr = manana.getFullYear() + "-" + pad(manana.getMonth()+1) + "-" + pad(manana.getDate());

  var turnosManana = _turnos.filter(function(t){
    return t.fecha === mananaStr && !t.realizado && !t.ausente;
  });

  if(!turnosManana.length) return;

  var keyManana = "manana_" + mananaStr;
  if(_disparadas[keyManana]) return;
  _disparadas[keyManana] = true;

  var nombres = turnosManana.slice(0, 3).map(function(t){
    return fmtHora(t.hora) + " " + t.nombre;
  }).join(" · ");
  var extra = turnosManana.length > 3 ? " y " + (turnosManana.length - 3) + " más" : "";

  mostrarNotif(
    "📅 Mañana tenés " + turnosManana.length + " turno" + (turnosManana.length > 1 ? "s" : ""),
    nombres + extra,
    keyManana
  );
}

function mostrarNotif(titulo, cuerpo, tag){
  return self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: tag || "nail-notif",
    vibrate: [200, 100, 200],
    data: { url: self.location.origin + self.location.pathname.replace("sw.js","") }
  });
}

// ── Polling en background (cada 60s via setInterval en SW) ──
var _swInterval = null;

function iniciarPolling(){
  if(_swInterval) clearInterval(_swInterval);
  _swInterval = setInterval(function(){
    chequearTurnosProximos();
  }, 60000);
}

// ── Mensajes desde la página ─────────────────────────────────
self.addEventListener("message", function(e){
  if(!e.data) return;

  // La página envía los turnos actualizados + claves ya disparadas
  if(e.data.type === "SYNC_TURNOS"){
    _turnos = e.data.turnos || [];
    // Fusionar claves disparadas para no duplicar notifs
    if(e.data.disparadas){
      Object.assign(_disparadas, e.data.disparadas);
    }
    iniciarPolling();
    // Chequear inmediatamente al recibir datos frescos
    chequearTurnosProximos();
  }

  // La página pide datos de turnos (flujo heredado)
  if(e.data.type === "DAME_TURNOS" && e.ports && e.ports[0]){
    e.ports[0].postMessage({turnos: _turnos});
  }

  // La página pide chequear mañana
  if(e.data.type === "CHECK_MANANA"){
    chequearManana();
  }

  // La página delega el disparo de una notificación puntual
  if(e.data.type === "SHOW_NOTIF"){
    mostrarNotif(e.data.titulo, e.data.cuerpo, null);
  }
});

// ── Clic en notificación → abrir/enfocar la app ──────────────
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({type:"window", includeUncontrolled:true}).then(function(list){
      // Si la app ya está abierta, enfocarla
      for(var i = 0; i < list.length; i++){
        if(list[i].url.indexOf(url) !== -1 && "focus" in list[i]){
          return list[i].focus();
        }
      }
      // Si no, abrirla
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Periodic Background Sync (Android Chrome, cuando está disponible) ──
self.addEventListener("periodicsync", function(e){
  if(e.tag === "turnos-manana"){
    e.waitUntil(chequearManana());
  }
});

// ── Install / Activate ───────────────────────────────────────
self.addEventListener("install", function(e){
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(clients.claim());
});

// ── Fetch: network first, cache fallback ─────────────────────
self.addEventListener("fetch", function(e){
  // Solo cachear GET del mismo origen
  if(e.request.method !== "GET") return;
  if(e.request.url.indexOf("firebaseio.com") !== -1) return;
  if(e.request.url.indexOf("googleapis.com") !== -1) return;

  e.respondWith(
    fetch(e.request).then(function(response){
      if(response && response.status === 200 && response.type === "basic"){
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache){
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function(){
      return caches.match(e.request);
    })
  );
});
