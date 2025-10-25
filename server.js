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

// 🧭 /control – web panel za promjenu URL-a (minimalno sučelje)
app.get("/control", (req, res) => {
    res.send(`
  <html>
    <head>
      <title>Kontrolni panel</title>
      <style>
        body { font-family: sans-serif; padding: 30px; background-color: #f0f4f8; color: #1e293b; }
        h2 { color: #0d9488; }
        b { color: #4b5563; }
        #current { color: #16a34a; font-weight: bold; word-break: break-all; }
        #url { width: 400px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 8px 15px; background-color: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; }
        #msg { margin-top: 15px; padding: 10px; background-color: #dbeafe; border: 1px solid #93c5fd; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h2>🎛️ Radio Kontrolni Panel</h2>
      <p><b>Stream URL za klijente:</b> <a href="/live" target="_blank">/live</a></p>
      <p><b>Trenutni izvorni stream:</b> <span id="current">${currentStreamUrl}</span></p>
      <input id="url" value="${currentStreamUrl}">
      <button onclick="change()">Promijeni URL</button>
      <pre id="msg">Spreman za promjenu.</pre>
      <script>
        async function change(){
          const url=document.getElementById('url').value;
          
          if (!url) {
            document.getElementById('msg').textContent = '❌ URL ne smije biti prazan.';
            return;
          }

          const button = document.querySelector('button');
          button.disabled = true;
          document.getElementById('msg').textContent = '📡 Slanje zahtjeva...';

          try {
            const res=await fetch('/set-stream',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({url})
            });
            const data=await res.json();
            
            if (res.ok) {
                document.getElementById('msg').textContent=data.message;
                document.getElementById('current').textContent=data.newUrl;
            } else {
                document.getElementById('msg').textContent = '❌ Greška: ' + (data.message || 'Nepoznata greška.');
            }
          } catch(error) {
            document.getElementById('msg').textContent = '❌ Neuspješna komunikacija sa serverom.';
          } finally {
             button.disabled = false;
          }
        }
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
