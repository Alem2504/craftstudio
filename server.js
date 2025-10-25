const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Nema 'lastStreamUrl', nema logike za fallback
let currentStreamUrl = "https://stream.rsgmedia.ba/listen/radio_mix/radio.mp3";
let clients = [];
let sourceReq = null;

// bira http ili https
function getLib(url) {
    return url.startsWith("https") ? https : http;
}

// 🔁 pokreće stream (bez timeouta i fallback logike)
function startStream() {
    if (sourceReq) {
        try { sourceReq.destroy(); } catch {}
    }

    console.log("🎧 Pokrećem izvor:", currentStreamUrl);

    const lib = getLib(currentStreamUrl);
    const url = new URL(currentStreamUrl);

    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
            "Connection": "keep-alive",
            "Icy-MetaData": "0",
        },
    };

    sourceReq = lib.get(options, (streamRes) => {
        console.log("✅ Spojen na izvor:", currentStreamUrl, "Status:", streamRes.statusCode);

        if (streamRes.statusCode !== 200) {
            console.error("❌ Stream ne radi (Status:", streamRes.statusCode, "), pokušavam ponovo odmah...");
            // Nema fallback, nema delay-a
            return startStream();
        }

        streamRes.on("data", (chunk) => {
            clients.forEach((res) => {
                try { res.write(chunk); } catch {}
            });
        });

        streamRes.on("end", () => {
            console.log("⛔ Stream završio, pokušavam ponovo odmah...");
            // Nema delay-a
            startStream();
        });
    });

    sourceReq.on("error", (err) => {
        console.error("⚠️ Greška u streamu, pokušavam ponovo odmah:", err.message);
        // Nema fallback, nema delay-a
        startStream();
    });
}

// 🔊 /live endpoint — gdje hardverski uređaji slušaju
app.get("/live", (req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    clients.push(res);
    console.log("📡 Novi klijent, ukupno:", clients.length);

    req.on("close", () => {
        clients = clients.filter((c) => c !== res);
        console.log("❌ Klijent otišao, ostalo:", clients.length);
    });
});

// 🔄 /set-stream (promjena izvora)
app.post("/set-stream", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).send("❌ Nije poslan URL");

    console.log("🔄 Pokušavam novi izvor:", url);
    // Nema 'lastStreamUrl'
    currentStreamUrl = url;

    // 🔥 KLJUČNO: Zatvori SVE klijente da se automatski rekonektuju
    clients.forEach((c) => {
        try { c.end(); } catch {}
    });
    clients = []; // Resetiraj listu

    // Pokreni novi stream odmah
    startStream();

    // Dodajemo 'newUrl' za kontrolni panel
    res.send({ message: `✅ Novi stream aktiviran: ${url}`, newUrl: url });
});

// 🧭 /control – napredni, responsive web panel
app.get("/control", (req, res) => {
    res.send(`
  <html>
    <head>
      <title>Kontrolni panel</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: 'Segoe UI', sans-serif;
          padding: 20px;
          background-color: #f0f4f8;
          color: #1e293b;
          max-width: 800px;
          margin: auto;
        }
        h2 { color: #0d9488; text-align: center; }
        b { color: #334155; }
        #current { color: #16a34a; font-weight: bold; word-break: break-all; }
        #url {
          width: 100%;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
          font-size: 16px;
          margin-bottom: 10px;
        }
        button {
          padding: 10px 15px;
          background-color: #f59e0b;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 15px;
          transition: background 0.2s;
        }
        button:hover { background-color: #d97706; }
        #msg {
          margin-top: 15px;
          padding: 10px;
          background-color: #dbeafe;
          border: 1px solid #93c5fd;
          border-radius: 4px;
          white-space: pre-wrap;
        }
        .saved {
          margin-top: 20px;
          background: #fff;
          padding: 10px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .saved h3 {
          margin-top: 0;
          color: #0d9488;
          font-size: 18px;
        }
        .saved-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .saved-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f9fafb;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 14px;
          word-break: break-all;
        }
        .saved-item button {
          background: #ef4444;
          padding: 5px 10px;
          font-size: 13px;
          border-radius: 4px;
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        @media(max-width:600px){
          body{padding:15px;}
          button{width:100%;}
          #url{font-size:14px;}
        }
      </style>
    </head>
    <body>
      <h2>🎛️ Radio Kontrolni Panel</h2>
      <p><b>Stream URL za klijente:</b> <a href="/live" target="_blank">/live</a></p>
      <p><b>Trenutni izvor:</b> <span id="current">${currentStreamUrl}</span></p>
      <input id="url" value="${currentStreamUrl}" placeholder="Unesi novi stream URL...">
      <div class="actions">
        <button onclick="change()">🔄 Promijeni URL</button>
        <button onclick="saveUrl()">💾 Spremi</button>
      </div>
      <pre id="msg">Spreman za promjenu.</pre>

      <div class="saved">
        <h3>💡 Spremljeni izvori</h3>
        <div id="savedList" class="saved-list"></div>
      </div>

      <script>
        function loadSaved(){
          const saved = JSON.parse(localStorage.getItem('savedStreams') || '[]');
          const container = document.getElementById('savedList');
          container.innerHTML = '';
          if(saved.length===0){
            container.innerHTML = '<i>Nema spremljenih izvora.</i>';
            return;
          }
          saved.forEach((url,i)=>{
            const div = document.createElement('div');
            div.className='saved-item';
            div.innerHTML=\`
              <span>\${url}</span>
              <div>
                <button onclick="useUrl('\${url}')">Učitaj</button>
                <button onclick="removeUrl(\${i})">❌</button>
              </div>\`;
            container.appendChild(div);
          });
        }

        function saveUrl(){
          const url = document.getElementById('url').value.trim();
          if(!url) return alert('Unesi URL prije spremanja.');
          let saved = JSON.parse(localStorage.getItem('savedStreams') || '[]');
          if(!saved.includes(url)){
            saved.push(url);
            localStorage.setItem('savedStreams', JSON.stringify(saved));
            loadSaved();
            document.getElementById('msg').textContent = '💾 Spremljeno!';
          } else {
            document.getElementById('msg').textContent = '⚠️ Već postoji u listi.';
          }
        }

        function useUrl(url){
          document.getElementById('url').value = url;
          document.getElementById('msg').textContent = '🔁 Učitano iz spremljenih.';
        }

        function removeUrl(index){
          let saved = JSON.parse(localStorage.getItem('savedStreams') || '[]');
          saved.splice(index,1);
          localStorage.setItem('savedStreams', JSON.stringify(saved));
          loadSaved();
        }

        async function change(){
          const url=document.getElementById('url').value.trim();
          if (!url) {
            document.getElementById('msg').textContent = '❌ URL ne smije biti prazan.';
            return;
          }
          const button=document.querySelector('.actions button');
          button.disabled=true;
          document.getElementById('msg').textContent='📡 Slanje zahtjeva...';
          try{
            const res=await fetch('/set-stream',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({url})
            });
            const data=await res.json();
            if(res.ok){
              document.getElementById('msg').textContent=data.message;
              document.getElementById('current').textContent=data.newUrl;
            }else{
              document.getElementById('msg').textContent='❌ Greška: '+(data.message||'Nepoznata greška.');
            }
          }catch(e){
            document.getElementById('msg').textContent='❌ Neuspješna komunikacija sa serverom.';
          }finally{
            button.disabled=false;
          }
        }

        loadSaved();
      </script>
    </body>
  </html>
  `);
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Relay aktivan: http://localhost:${PORT}/live`);
    console.log(`⚙️ Kontrolni panel: http://localhost:${PORT}/control`);
    startStream();
});
