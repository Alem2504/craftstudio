const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let currentStreamUrl = "https://stream.rsgmedia.ba/listen/radio_mix/radio.mp3";
let lastStreamUrl = currentStreamUrl; // Koristi se za fallback
let clients = [];
let sourceReq = null;

// bira http ili https
function getLib(url) {
    return url.startsWith("https") ? https : http;
}

// 🔁 pokreće stream
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

    let dataCount = 0;
    // Timeout check za novi stream (ako u 5s nema podataka → fallback)
    const timeoutCheck = setTimeout(() => {
        if (dataCount === 0) {
            console.error("❌ Nema podataka sa izvora, vraćam stari stream...");
            currentStreamUrl = lastStreamUrl;
            startStream();
        }
    }, 5000);

    sourceReq = lib.get(options, (streamRes) => {
        clearTimeout(timeoutCheck); // Uspješno spojen, poništi timeout
        console.log("✅ Spojen na izvor:", currentStreamUrl, "Status:", streamRes.statusCode);

        if (streamRes.statusCode !== 200) {
            console.error("❌ Novi stream ne radi, vraćam stari...");
            currentStreamUrl = lastStreamUrl;
            setTimeout(startStream, 100);
            return;
        }

        streamRes.on("data", (chunk) => {
            dataCount++;
            clients.forEach((res) => {
                try { res.write(chunk); } catch {}
            });
        });

        streamRes.on("end", () => {
            console.log("⛔ Stream završio, pokušavam ponovo za 3s...");
            setTimeout(startStream, 3000);
        });
    });

    sourceReq.on("error", (err) => {
        clearTimeout(timeoutCheck);
        console.error("⚠️ Greška u streamu:", err.message);
        console.log("↩️ Vraćam stari stream:", lastStreamUrl);
        currentStreamUrl = lastStreamUrl;
        setTimeout(startStream, 2000);
    });
}

// 🎙️ /live endpoint — gdje hardverski uređaji slušaju
app.get("/live", (req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    clients.push(res);
    console.log("📡 Novi klijent, ukupno:", clients.length);

    req.on("close", () => {
        clients = clients.filter((c) => c !== res);
        console.log("❌ Klijent otišao, ostalo:", clients.length);
    });
});

// 🔄 /set-stream — post request za promjenu izvora
app.post("/set-stream", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).send("❌ Nije poslan URL");

    console.log("🔄 Pokušavam novi izvor:", url);
    lastStreamUrl = currentStreamUrl; // zapamti prethodni za fallback
    currentStreamUrl = url;

    // 🔥 Zatvori sve klijente. Ovo je neophodno za automatski reconnect hardverskih playera.
    clients.forEach((c) => {
        try { c.end(); } catch {}
    });
    clients = [];

    // prekini trenutni stream i probaj novi
    startStream();
    res.send({ message: `✅ Novi stream postavljen: ${url}`, newUrl: url });
});


// ⚙️ /control endpoint — Kontrolni panel za promjenu URL-a
app.get("/control", (req, res) => {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Kontrolna ploča za Radio Relej</title>
    <style>
        body { 
            font-family: 'Inter', sans-serif; 
            background-color: #f0f4f8; 
            padding: 20px;
            color: #1e293b;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 25px;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #0d9488;
            border-bottom: 2px solid #0d9488;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .info-box {
            background-color: #e0f2f1;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .info-box strong {
            display: block;
            font-size: 0.9em;
            color: #042f2e;
            margin-bottom: 5px;
        }
        #currentUrl {
            word-break: break-all;
            font-weight: bold;
            color: #16a34a;
        }
        #controlForm {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        #urlInput {
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 6px;
            font-size: 1em;
        }
        #submitBtn {
            padding: 10px 15px;
            background-color: #f59e0b;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1em;
            transition: background-color 0.3s;
        }
        #submitBtn:hover {
            background-color: #d97706;
        }
        .message {
            margin-top: 15px;
            padding: 10px;
            border-radius: 8px;
            background-color: #dbeafe;
            color: #1e40af;
            border: 1px solid #93c5fd;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Kontrolni panel</h1>
        
        <div class="info-box">
            <strong>Trenutni aktivni stream:</strong>
            <span id="activeUrl">${currentStreamUrl}</span>
        </div>

        <form id="controlForm">
            <input type="url" id="urlInput" placeholder="Unesite novi URL streama (npr. http://...)" required>
            <button type="submit" id="submitBtn">Promijeni URL</button>
        </form>
        
        <div id="statusMessage" class="message">
             Unesite novi URL i pritisnite "Promijeni URL".
        </div>
    </div>

    <script>
        const statusMessage = document.getElementById('statusMessage');
        const controlForm = document.getElementById('controlForm');
        const urlInput = document.getElementById('urlInput');
        const activeUrlDisplay = document.getElementById('activeUrl');
        const submitBtn = document.getElementById('submitBtn');
        
        // Postavite početni URL na formi
        urlInput.value = activeUrlDisplay.textContent;

        // --- LOGIKA ZA PROMJENU URL-a (Form Submission) ---
        controlForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newUrl = urlInput.value;
            
            if (!newUrl) {
                statusMessage.textContent = '⚠️ URL ne smije biti prazan.';
                return;
            }

            // Privremeno onemogući gumb
            submitBtn.disabled = true;
            statusMessage.textContent = '📡 Slanje zahtjeva serveru za promjenu streama...';

            try {
                const response = await fetch('/set-stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: newUrl })
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Update poruka i URL na sučelju
                    statusMessage.textContent = data.message;
                    activeUrlDisplay.textContent = data.newUrl;
                } else {
                    statusMessage.textContent = \`❌ Greška: \${data.message || 'Nepoznata greška.'}\`;
                }

            } catch (error) {
                console.error("Fetch error:", error);
                statusMessage.textContent = \`❌ Neuspješno slanje zahtjeva: \${error.message}\`;
            } finally {
                submitBtn.disabled = false;
            }
        });

    </script>
</body>
</html>
    `;
    res.send(html);
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Relay aktivan: http://localhost:${PORT}/live`);
    console.log(`⚙️ Kontrolni panel: http://localhost:${PORT}/control`);
    startStream();
});
