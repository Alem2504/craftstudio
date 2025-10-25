const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let currentStreamUrl = "https://stream.rsgmedia.ba/listen/radio_mix/radio.mp3";
let lastStreamUrl = currentStreamUrl;
let clients = [];
let sourceReq = null;
let activeTimeout = null;

function getLib(url) {
    return url.startsWith("https") ? https : http;
}

function startStream() {
    if (sourceReq) {
        try { sourceReq.destroy(); } catch {}
    }
    if (activeTimeout) clearTimeout(activeTimeout);

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

    let dataCount = 0;
    activeTimeout = setTimeout(() => {
        if (dataCount === 0) {
            console.error("❌ Nema podataka sa izvora, vraćam stari stream:", lastStreamUrl);
            currentStreamUrl = lastStreamUrl;
            startStream();
        }
    }, 4000); // 4s za fallback

    sourceReq = lib.get(options, (streamRes) => {
        console.log("✅ Spojen na izvor:", currentStreamUrl, "Status:", streamRes.statusCode);

        if (streamRes.statusCode !== 200) {
            console.error("❌ Novi stream ne radi, vraćam stari...");
            currentStreamUrl = lastStreamUrl;
            return startStream();
        }

        streamRes.on("data", (chunk) => {
            dataCount++;
            clients.forEach((res) => {
                try { res.write(chunk); } catch {}
            });
        });

        streamRes.on("end", () => {
            console.log("⛔ Stream završio, pokušavam ponovo odmah...");
            startStream();
        });
    });

    sourceReq.on("error", (err) => {
        console.error("⚠️ Greška u streamu:", err.message);
        console.log("↩️ Vraćam stari stream:", lastStreamUrl);
        currentStreamUrl = lastStreamUrl;
        startStream();
    });
}

// 🔊 /live endpoint
app.get("/live", (req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    clients.push(res);
    console.log("📡 Novi klijent:", clients.length);

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
    lastStreamUrl = currentStreamUrl;
    currentStreamUrl = url;

    // Ne prekidamo klijente – oni će primiti novi stream čim krene
    startStream();

    res.send({ message: `✅ Novi stream aktiviran: ${url}` });
});

// 🧭 /control – web panel
app.get("/control", (req, res) => {
    res.send(`
  <html>
    <head><title>Kontrolni panel</title></head>
    <body style="font-family:sans-serif;padding:30px;">
      <h2>🎛️ Radio Kontrolni Panel</h2>
      <p><b>Trenutni stream:</b> <span id="current">${currentStreamUrl}</span></p>
      <input id="url" style="width:400px" value="${currentStreamUrl}">
      <button onclick="change()">Promijeni</button>
      <pre id="msg"></pre>
      <script>
        async function change(){
          const url=document.getElementById('url').value;
          const res=await fetch('/set-stream',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({url})
          });
          const data=await res.json();
          document.getElementById('msg').textContent=data.message;
          document.getElementById('current').textContent=url;
        }
      </script>
    </body>
  </html>
  `);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Relay aktivan: /live`);
    console.log(`⚙️ Kontrolni panel:/control`);
    startStream();
});
