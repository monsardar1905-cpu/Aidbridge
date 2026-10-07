// =========================================================
// AidBridge - Disaster Relief & Mutual Aid Network Frontend
// =========================================================

let currentUser = {
  role: "Citizen",
  name: "Anonymous",
  team: ""
};

let citizenBeacons = [];
let bulletins = [];
let meshMessages = [];
let currentFilter = "All";

document.addEventListener("DOMContentLoaded", () => {
  setupAuthEvents();
  setupSOSEvents();
  setupBulletinEvents();
  setupMeshEvents();
  setupAIEvents();
  setupFilterTabs();

  // Start the adaptive data sync loop
  syncData();
});

// =========================================================
// LOW-BANDWIDTH ADAPTIVE SYNC
// =========================================================
async function syncData() {
  if (navigator.onLine) {
    try {
      await Promise.all([
        fetchBulletins(),
        fetchMessages(),
        fetchBeacons()
      ]);
    } catch (err) {
      console.warn("Low bandwidth sync struggling, retrying...", err);
    }
  }
  setTimeout(syncData, 4000);
}

// =========================================================
// 1. AUTHENTICATION & ROLE SWITCHING
// =========================================================

function setupAuthEvents() {
  const citizenRadio = document.getElementById("citizenRadio");
  const rescueRadio = document.getElementById("rescueRadio");
  const citizenForm = document.getElementById("citizenForm");
  const rescueForm = document.getElementById("rescueForm");
  const logoutBtn = document.getElementById("logoutBtn");

  if (citizenRadio && rescueRadio) {
    citizenRadio.addEventListener("change", () => {
      if (citizenRadio.checked) {
        citizenForm.classList.remove("hidden");
        rescueForm.classList.add("hidden");
      }
    });
    rescueRadio.addEventListener("change", () => {
      if (rescueRadio.checked) {
        rescueForm.classList.remove("hidden");
        citizenForm.classList.add("hidden");
      }
    });
  }

  if (citizenForm) {
    citizenForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("citName").value.trim();
      const age = document.getElementById("citAge").value.trim();
      const phone = document.getElementById("citPhone").value.trim();

      try {
        await fetch("/api/citizen-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, age, phone })
        });
      } catch (err) {
         console.error("Citizen Login Error:", err);
      }

      currentUser = { role: "Citizen", name: name || "Citizen", team: "" };
      loginSuccess();
    });
  }

  if (rescueForm) {
    rescueForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("officerId").value.trim();
      const pass = document.getElementById("officerPass").value.trim();
      const team = document.getElementById("officerTeam").value;
      const errorLabel = document.getElementById("rescueError");

      try {
        const res = await fetch("/api/rescue-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, pass, team })
        });

        const data = await res.json();
        
        if (data.authenticated) {
          if (errorLabel) errorLabel.classList.add("hidden");
          currentUser = { role: "Rescue Team", name: data.name || id, team: team };
          loginSuccess();
        } else {
          if (errorLabel) {
            errorLabel.textContent = data.message || "Invalid credentials.";
            errorLabel.classList.remove("hidden");
          }
        }
      } catch (err) {
         console.error("Rescue Login Error:", err);
         if (errorLabel) {
            errorLabel.textContent = "Server unreachable.";
            errorLabel.classList.remove("hidden");
         }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      document.getElementById("loginModal").classList.remove("hidden");
      document.getElementById("citizenView").classList.add("hidden");
      document.getElementById("rescueView").classList.add("hidden");

      const aiToggleBtn = document.getElementById("aiToggleBtn");
      if (aiToggleBtn) aiToggleBtn.style.display = "flex";
    });
  }
}

function loginSuccess() {
  document.getElementById("loginModal").classList.add("hidden");

  const greeting = document.getElementById("displayGreeting");
  const roleBadge = document.getElementById("displayRoleBadge");
  const aiToggleBtn = document.getElementById("aiToggleBtn");
  const aiDrawer = document.getElementById("aiDrawer");

  if (greeting) greeting.textContent = `Hi, ${currentUser.name}!`;

  if (currentUser.role === "Rescue Team") {
    if (roleBadge) {
      roleBadge.textContent = currentUser.team || "Rescue";
      roleBadge.classList.add("rescue");
    }
    document.getElementById("rescueView").classList.remove("hidden");
    document.getElementById("citizenView").classList.add("hidden");

    if (aiToggleBtn) aiToggleBtn.style.display = "none";
    if (aiDrawer) aiDrawer.classList.add("hidden");
  } else {
    if (roleBadge) {
      roleBadge.textContent = "Citizen";
      roleBadge.classList.remove("rescue");
    }
    document.getElementById("citizenView").classList.remove("hidden");
    document.getElementById("rescueView").classList.add("hidden");

    if (aiToggleBtn) aiToggleBtn.style.display = "flex";
  }

  fetchBulletins();
  fetchMessages();
  fetchBeacons();
}

// =========================================================
// 2. SOS BEACON NETWORK SYNCHRONIZATION (WITH SMS FALLBACK)
// =========================================================

function setupSOSEvents() {
  const aidForm = document.getElementById("aidForm");
  if (aidForm) {
    aidForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const payload = {
        title: document.getElementById("requestTitle").value.trim(),
        category: document.getElementById("requestCategory").value,
        urgency: document.getElementById("requestUrgency").value,
        location: document.getElementById("requestLocation").value.trim(),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        sender: currentUser.name 
      };

      if (navigator.onLine) {
        try {
          const res = await fetch("/api/beacons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            aidForm.reset();
            fetchBeacons();
            return; 
          }
        } catch (err) {
           console.error("Wi-Fi network failed, switching to SMS fallback:", err);
        }
      }

      alert("No internet connection detected. Redirecting to your SMS app to broadcast this SOS via cellular towers.");
      const rawSmsText = `SOS|${payload.urgency}|${payload.category}|${payload.sender}|${payload.location}|${payload.title}`;
      const commandPhone = "+919876543210"; 
      window.location.href = `sms:${commandPhone}?body=${encodeURIComponent(rawSmsText)}`;
    });
  }
}

async function fetchBeacons() {
  try {
    const res = await fetch(`/api/beacons?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    citizenBeacons = data || [];
    renderBeacons();
  } catch (err) {
    console.error("Beacon Fetch Error:", err);
  }
}

function renderBeacons() {
  const citizenList = document.getElementById("citizenFeedList");
  const rescueList = document.getElementById("rescueFeedList");

  if (citizenList) {
    citizenList.innerHTML = "";
    const myBeacons = citizenBeacons.filter(b => b.sender === currentUser.name);

    if (myBeacons.length === 0) {
      citizenList.innerHTML = "<p style='color:#64748b; font-size:0.85rem;'>No active distress calls logged.</p>";
    } else {
      myBeacons.forEach((b) => {
        const card = document.createElement("div");
        card.className = `ticket-card tier-${b.urgency}`;
        card.innerHTML = `
          <div class="ticket-top">
            <span class="ticket-title">${escapeHTML(b.title)}</span>
            <span class="urgency-pill pill-${b.urgency}">${b.urgency}</span>
          </div>
          <div class="ticket-details">📍 ${escapeHTML(b.location)} • 📂 ${escapeHTML(b.category)}</div>
          <div class="ticket-footer">
            <span>Logged at ${b.time}</span>
            <span style="font-weight:700; color:${b.status === 'Resolved' ? '#16a34a' : '#d90429'};">${b.status}</span>
          </div>
        `;
        citizenList.appendChild(card);
      });
    }
  }

  if (rescueList) {
    rescueList.innerHTML = "";
    const filtered = citizenBeacons.filter((b) => {
      if (currentFilter === "All") return true;
      if (currentFilter === "Critical") return b.urgency === "Critical";
      if (currentFilter === "Medical") return b.category === "Medical";
      if (currentFilter === "Rescue") return b.category === "Rescue";
      return true;
    });

    if (filtered.length === 0) {
      rescueList.innerHTML = "<p style='color:#64748b; font-size:0.85rem;'>No incidents matching filter.</p>";
    } else {
      filtered.forEach((b) => {
        const card = document.createElement("div");
        card.className = `ticket-card tier-${b.urgency}`;
        card.innerHTML = `
          <div class="ticket-top">
            <span class="ticket-title">${escapeHTML(b.title)}</span>
            <span class="urgency-pill pill-${b.urgency}">${b.urgency}</span>
          </div>
          <div class="ticket-details">📍 ${escapeHTML(b.location)} | [${escapeHTML(b.category)}]</div>
          <div class="ticket-footer">
            <span>Reported: ${b.time}</span>
            ${
              b.status === "Pending"
                ? `<button class="claim-btn" onclick="resolveBeacon(${b.id})">Mark Resolved</button>`
                : `<span style="font-weight:700; color:#16a34a;">✓ Resolved</span>`
            }
          </div>
        `;
        rescueList.appendChild(card);
      });
    }
  }

  const rCrit = document.getElementById("rescueCriticalCount");
  const rPend = document.getElementById("rescuePendingCount");
  const rRes = document.getElementById("rescueResolvedCount");

  if (rCrit) rCrit.textContent = citizenBeacons.filter(b => b.urgency === "Critical" && b.status === "Pending").length;
  if (rPend) rPend.textContent = citizenBeacons.filter(b => b.status === "Pending").length;
  if (rRes) rRes.textContent = citizenBeacons.filter(b => b.status === "Resolved").length;
}

window.resolveBeacon = async function (id) {
  try {
    await fetch("/api/resolve-beacon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id })
    });
    fetchBeacons();
  } catch (err) {
     console.error("Resolve Beacon Error:", err);
  }
};

function setupFilterTabs() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-filter");
      renderBeacons();
    });
  });
}

// =========================================================
// 3. OFFICIAL CRISIS BULLETINS
// =========================================================

function setupBulletinEvents() {
  const alertForm = document.getElementById("broadcastAlertForm");
  if (alertForm) {
    alertForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/bulletins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: document.getElementById("alertTitle").value.trim(),
            content: document.getElementById("alertContent").value.trim(),
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            sender: currentUser.name || "Command Dispatch"
          })
        });
        alertForm.reset();
        fetchBulletins();
      } catch (err) {
         console.error("Bulletin Broadcast Error:", err);
      }
    });
  }
}

async function fetchBulletins() {
  try {
    const res = await fetch(`/api/bulletins?t=${Date.now()}`, { cache: "no-store" });
    bulletins = await res.json();
    renderBulletins();
  } catch (err) {
     console.error("Bulletin Fetch Error:", err);
  }
}

function renderBulletins() {
  const newsFeed = document.getElementById("newsFeedList");
  if (!newsFeed) return;
  newsFeed.innerHTML = "";
  if (!bulletins || bulletins.length === 0) {
    newsFeed.innerHTML = "<p style='color:#64748b; font-size:0.85rem;'>No official bulletins broadcast yet.</p>";
    return;
  }
  bulletins.forEach((item) => {
    const card = document.createElement("div");
    card.className = "news-card";
    card.innerHTML = `
      <h4>${escapeHTML(item.title)}</h4>
      <p>${escapeHTML(item.content)}</p>
      <span class="news-meta">By ${escapeHTML(item.sender || "Command")} • ${item.time}</span>
    `;
    newsFeed.appendChild(card);
  });
}

// =========================================================
// 4. LOCAL MESH RADIO CHAT (WITH SMS FALLBACK)
// =========================================================

function setupMeshEvents() {
  const citForm = document.getElementById("meshChatForm");
  const resForm = document.getElementById("rescueMeshChatForm");

  if (citForm) citForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("meshTextInput");
    transmitMesh(inp.value.trim());
    inp.value = "";
  });
  if (resForm) resForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("rescueMeshTextInput");
    transmitMesh(inp.value.trim());
    inp.value = "";
  });
}

async function transmitMesh(text) {
  if (!text) return;
  
  const payload = {
    sender: currentUser.name || "Survivor",
    role: currentUser.role,
    text: text,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };

  if (navigator.onLine) {
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        fetchMessages();
        return;
      }
    } catch (err) {
       console.error("Mesh Transmit Error:", err);
    }
  }

  alert("No internet connection detected. Redirecting to SMS to broadcast your mesh message.");
  const rawSmsText = `MESH|${payload.role}|${payload.sender}|${payload.text}`;
  const commandPhone = "+919876543210"; 
  window.location.href = `sms:${commandPhone}?body=${encodeURIComponent(rawSmsText)}`;
}

async function fetchMessages() {
  try {
    const res = await fetch(`/api/messages?t=${Date.now()}`, { cache: "no-store" });
    meshMessages = await res.json();
    renderMessages();
  } catch (err) {
     console.error("Mesh Fetch Error:", err);
  }
}

function renderMessages() {
  const html = meshMessages.length === 0 
    ? "<p style='color:#94a3b8; font-size:0.8rem;'>Channel silent. Transmit to connect.</p>" 
    : meshMessages.map((msg) => {
        const isRescuer = msg.role === "Rescue Team";
        return `
        <div class="mesh-item">
          <span class="badge ${isRescuer ? 'badge-rescuer' : 'badge-cit'}">${escapeHTML(msg.sender)}</span>
          <span style="color:#64748b; font-size:0.75rem;">${msg.time}:</span>
          <span>${escapeHTML(msg.text)}</span>
        </div>`;
      }).join("");

  const cit = document.getElementById("meshMessagesList");
  const res = document.getElementById("rescueMeshMessagesList");
  if (cit) { cit.innerHTML = html; cit.scrollTop = cit.scrollHeight; }
  if (res) { res.innerHTML = html; res.scrollTop = res.scrollHeight; }
}

// =========================================================
// 5. LIFE-LINE AI TRIAGE
// =========================================================

function setupAIEvents() {
  const drawer = document.getElementById("aiDrawer");
  document.getElementById("aiToggleBtn")?.addEventListener("click", () => drawer.classList.toggle("hidden"));
  document.getElementById("aiCloseBtn")?.addEventListener("click", () => drawer.classList.add("hidden"));

  document.querySelectorAll(".quick-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-prompt");
      if (prompt) submitAIDrawerMessage(prompt);
    });
  });

  const chatForm = document.getElementById("aiChatForm");
  if (chatForm) {
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = document.getElementById("aiUserInput");
      if (inp.value.trim()) {
        submitAIDrawerMessage(inp.value.trim());
        inp.value = "";
      }
    });
  }
}

async function submitAIDrawerMessage(text) {
  const container = document.getElementById("aiChatMessages");
  if (!container) return;

  container.innerHTML += `<div class="ai-msg user"><div class="bubble">${escapeHTML(text)}</div></div>`;
  const botDiv = document.createElement("div");
  botDiv.className = "ai-msg bot";
  botDiv.innerHTML = `<div class="bubble"><strong>LifeLine AI:</strong> Analyzing...</div>`;
  container.appendChild(botDiv);
  container.scrollTop = container.scrollHeight;

  const reply = await queryAIBackend(text);
  botDiv.querySelector(".bubble").innerHTML = `<strong>LifeLine AI:</strong> ${escapeHTML(reply)}`;
  container.scrollTop = container.scrollHeight;
}

async function queryAIBackend(prompt) {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.response) return data.response;
    }
  } catch (err) {
     console.error("AI Query Error:", err);
  }

  const lower = prompt.toLowerCase();
  if (lower.includes("bleed")) return "APPLY DIRECT PRESSURE: Place a clean cloth over the wound and press firmly. Elevate above heart level.";
  if (lower.includes("water") || lower.includes("purify")) return "WATER PURIFICATION: Strain water through cloth. Boil for 1-3 minutes. If no fire, add 8 drops unscented bleach per gallon.";
  if (lower.includes("cpr")) return "HANDS-ONLY CPR: Push hard and fast in the center of the chest at 100-120 beats per minute. Allow chest to fully recoil.";
  if (lower.includes("hypothermia") || lower.includes("cold")) return "HYPOTHERMIA: Move to dry shelter. Remove wet clothes. Warm body core (chest, neck, groin) first using dry blankets.";
  return "Stay secure. Keep device battery preserved and broadcast your coordinates through the SOS beacon form immediately.";
}
// =========================================================
// ULTRA LOW-POWER BLACKOUT MODE TOGGLE
// =========================================================
window.toggleBlackoutMode = function() {
  document.body.classList.toggle("blackout-mode");
  const btn = document.getElementById("blackoutBtn");
  if (document.body.classList.contains("blackout-mode")) {
    btn.textContent = "🌙 Normal Mode";
    btn.style.borderColor = "#22c55e";
  } else {
    btn.textContent = "🔋 Blackout";
    btn.style.borderColor = "#27272a";
  }
};

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}