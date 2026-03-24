// ── Nail Studio Service Worker ──────────────────────────
var CACHE = "nailstudio-v1";

self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(clients.claim()); });

// ── Click en notificación → abrir la app ────────────────
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:"window"}).then(function(list){
      for(var i=0;i<list.length;i++){
        if("focus" in list[i]){ list[i].focus(); return; }
      }
      clients.openWindow("./index.html");
    })
  );
});

// ── Periodic Background Sync ─────────────────────────────
self.addEventListener("periodicsync", function(e){
  if(e.tag === "turnos-manana"){
    e.waitUntil(notificarTurnosManana());
  }
});

// ── Mensaje desde la app ─────────────────────────────────
self.addEventListener("message", function(e){
  if(e.data && e.data.type === "SYNC_TURNOS"){
    guardarTurnosIDB(e.data.turnos);
  }
  if(e.data && e.data.type === "CHECK_MANANA"){
    notificarTurnosManana();
  }
  if(e.data && e.data.type === "DAME_TURNOS"){
    leerTurnosIDB().then(function(t){
      e.ports[0].postMessage({turnos: t});
    });
  }
});

function notificarTurnosManana(){
  return leerTurnosIDB().then(function(turnosData){
    if(!turnosData) turnosData = [];
    var manana = getFechaManana();
    var delDia = turnosData.filter(function(t){
      return t.fecha === manana && !t.realizado && !t.ausente;
    });
    delDia.sort(function(a,b){ return a.hora > b.hora ? 1 : -1; });

    if(!delDia.length){
      return self.registration.showNotification("💅 Mañana libre", {
        body: "No tenés turnos agendados para mañana 🌸",
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        tag: "turnos-manana",
        renotify: true
      });
    }

    var resumen = delDia.map(function(t){
      return fmtHoraSW(t.hora) + " · " + t.nombre;
    }).join("\n");

    return self.registration.showNotification(
      "💅 Mañana tenés " + delDia.length + " turno" + (delDia.length > 1 ? "s" : ""),
      {
        body: resumen,
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        tag: "turnos-manana",
        renotify: true,
        vibrate: [200, 100, 200]
      }
    );
  });
}

function leerTurnosIDB(){
  return new Promise(function(resolve){
    try{
      var req = indexedDB.open("nailstudio_sw", 1);
      req.onupgradeneeded = function(e){ e.target.result.createObjectStore("kv"); };
      req.onsuccess = function(e){
        var tx = e.target.result.transaction("kv","readonly");
        var get = tx.objectStore("kv").get("turnos");
        get.onsuccess = function(){ resolve(get.result || []); };
        get.onerror   = function(){ resolve([]); };
      };
      req.onerror = function(){ resolve([]); };
    }catch(err){ resolve([]); }
  });
}

function guardarTurnosIDB(turnos){
  try{
    var req = indexedDB.open("nailstudio_sw", 1);
    req.onupgradeneeded = function(e){ e.target.result.createObjectStore("kv"); };
    req.onsuccess = function(e){
      var tx = e.target.result.transaction("kv","readwrite");
      tx.objectStore("kv").put(turnos, "turnos");
    };
  }catch(err){}
}

function getFechaManana(){
  var d = new Date();
  d.setDate(d.getDate() + 1);
  var mm = d.getMonth()+1, dd = d.getDate();
  return d.getFullYear()+"-"+(mm<10?"0":"")+mm+"-"+(dd<10?"0":"")+dd;
}

function fmtHoraSW(s){
  if(!s) return "";
  var p=s.split(":"), h=parseInt(p[0]), m=parseInt(p[1]||0);
  return (h%12||12)+":"+(m<10?"0":"")+m+(h>=12?" PM":" AM");
}
