const API = "";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let sessions = [];
let currentRegistrationId = "";

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}
function dateText(value) {
  if (!value) return "ไม่ระบุวันที่";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(d);
}
function showNotice(message, type = "") {
  const box = $("#notice");
  box.textContent = message;
  box.className = `notice ${type}`;
  box.hidden = false;
}
function setFormMessage(selector, message, ok = false) {
  const box = $(selector);
  box.textContent = message;
  box.className = `form-message${ok ? " success" : ""}`;
  box.hidden = false;
}
async function request(url, options = {}) {
  const response = await fetch(`${API}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = data?.detail || data?.message || `HTTP ${response.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return data;
}
function renderSessions(items) {
  const grid = $("#courseGrid");
  grid.innerHTML = "";
  $("#emptyState").hidden = items.length > 0;
  if (!items.length) return;
  for (const item of items) {
    const capacity = Number(item.capacity || 0);
    const registered = Number(item.registered_count || 0);
    const remaining = Math.max(
      0,
      Number(item.seats_available ?? capacity - registered),
    );
    const full = remaining <= 0;
    const card = document.createElement("article");
    card.className = "course-card";
    card.innerHTML = `
      <div class="course-banner"></div>
      <div class="course-content">
        <span class="course-tag">${full ? "ที่นั่งเต็มแล้ว" : "เปิดรับสมัคร"}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="course-description">${escapeHtml(item.description || "รายละเอียดหลักสูตรจะแจ้งเพิ่มเติม")}</p>
        <div class="course-meta">
          <div class="meta-line"><span class="meta-symbol">▦</span><span>${escapeHtml(dateText(item.training_date))}</span></div>
          <div class="meta-line"><span class="meta-symbol">⌖</span><span>${escapeHtml(item.location || "ไม่ระบุสถานที่")}</span></div>
          <div class="meta-line"><span class="meta-symbol">♙</span><span>ลงทะเบียนแล้ว ${registered} / ${capacity} คน</span></div>
        </div>
        <div class="seat-row"><span>จำนวนที่นั่งคงเหลือ</span><strong class="${full ? "seat-full" : "seat-open"}">${remaining} ที่นั่ง</strong></div>
        <button class="button ${full ? "button-outline" : "button-primary"} course-action" type="button" ${full ? "disabled" : ""} data-register="${escapeHtml(item.id)}">${full ? "รอบอบรมเต็มแล้ว" : "ลงทะเบียนรอบนี้ →"}</button>
      </div>`;
    grid.appendChild(card);
  }
}
async function loadSessions() {
  $("#courseGrid").innerHTML =
    '<div class="loading-card">กำลังโหลดข้อมูลรอบอบรม…</div>';
  $("#emptyState").hidden = true;
  try {
    const data = await request("/api/sessions");
    sessions = Array.isArray(data) ? data : [];
    renderSessions(sessions);
    const registered = sessions.reduce(
      (sum, item) => sum + Number(item.registered_count || 0),
      0,
    );
    const seats = sessions.reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          Number(
            item.seats_available ??
              Number(item.capacity || 0) - Number(item.registered_count || 0),
          ),
        ),
      0,
    );
    $("#statCourses").textContent = sessions.length;
    $("#statRegistered").textContent = registered;
    $("#statSeats").textContent = seats;
    $("#notice").hidden = true;
  } catch (error) {
    $("#courseGrid").innerHTML = "";
    $("#emptyState").hidden = true;
    showNotice(`โหลดรอบอบรมไม่สำเร็จ: ${error.message}`, "error");
  }
}
function openRegister(sessionId) {
  const item = sessions.find((row) => row.id === sessionId);
  if (!item) return;
  $("#registerForm").reset();
  $('#registerForm [name="session_id"]').value = item.id;
  $("#selectedCourse").textContent =
    `${item.title} · ${dateText(item.training_date)}`;
  $("#registerMessage").hidden = true;
  $("#registerDialog").showModal();
}
function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

$("#courseGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-register]");
  if (button && !button.disabled) openRegister(button.dataset.register);
});
$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  button.textContent = "กำลังบันทึก…";
  try {
    const result = await request("/api/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const normalized = Array.isArray(result) ? result[0] : result;
    if (!normalized?.success)
      throw new Error(normalized?.message || "ไม่สามารถลงทะเบียนได้");
    currentRegistrationId = normalized.registration_id || "";
    $("#registrationCode").textContent =
      currentRegistrationId || "ระบบไม่ได้ส่งรหัสกลับมา";
    closeDialog("registerDialog");
    $("#successDialog").showModal();
    await loadSessions();
  } catch (error) {
    setFormMessage("#registerMessage", error.message, false);
  } finally {
    button.disabled = false;
    button.textContent = "ยืนยันการลงทะเบียน";
  }
});
$("#copyIdBtn").addEventListener("click", async () => {
  if (!currentRegistrationId) return;
  try {
    await navigator.clipboard.writeText(currentRegistrationId);
    $("#copyIdBtn").textContent = "คัดลอกแล้ว";
  } catch {
    $("#copyIdBtn").textContent = "คัดลอกไม่สำเร็จ";
  }
});
$("#cancelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = $('button[type="submit"]', form);
  if (!confirm("ยืนยันการยกเลิกการลงทะเบียนนี้หรือไม่?")) return;
  button.disabled = true;
  button.textContent = "กำลังยกเลิก…";
  try {
    const result = await request(
      `/api/cancel/${encodeURIComponent(values.registration_id)}?email=${encodeURIComponent(values.email)}`,
      { method: "POST" },
    );
    alert(result?.message || "ยกเลิกการลงทะเบียนสำเร็จ");
    form.reset();
    await loadSessions();
  } catch (error) {
    alert(`ยกเลิกไม่สำเร็จ: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "ยกเลิกการลงทะเบียน";
  }
});

function adminHeaders() {
  const token = sessionStorage.getItem("toyotaAdminToken");
  if (!token) throw new Error("กรุณาเข้าสู่ระบบผู้ดูแล");
  return { "X-Admin-Token": token };
}
async function loadAdminRegistrations() {
  const tbody = $("#registrationsTable");
  tbody.innerHTML = '<tr><td colspan="5">กำลังโหลด…</td></tr>';
  try {
    const data = await request("/api/admin/registrations", {
      headers: adminHeaders(),
    });
    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = '<tr><td colspan="5">ยังไม่มีรายการลงทะเบียน</td></tr>';
      return;
    }
    tbody.innerHTML = data
      .map((row) => {
        const person = Array.isArray(row.participants)
          ? row.participants[0]
          : row.participants;
        const course = Array.isArray(row.training_sessions)
          ? row.training_sessions[0]
          : row.training_sessions;
        const cancelled = row.status === "cancelled";
        return `<tr>
        <td><strong>${escapeHtml(person?.full_name || "-")}</strong><br><span class="muted">${escapeHtml(person?.email || "")}</span></td>
        <td>${escapeHtml(course?.title || "-")}</td>
        <td>${escapeHtml(dateText(course?.training_date))}</td>
        <td><span class="status-pill ${cancelled ? "cancelled" : ""}">${cancelled ? "ยกเลิกแล้ว" : "ลงทะเบียนแล้ว"}</span></td>
        <td>${cancelled ? "—" : `<button class="table-action" type="button" data-admin-cancel="${escapeHtml(row.id)}">ยกเลิก</button>`}</td>
      </tr>`;
      })
      .join("");
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    throw error;
  }
}
$("#adminOpenBtn").addEventListener("click", () =>
  $("#adminDialog").showModal(),
);
$("#adminLoginBtn").addEventListener("click", async () => {
  const token = $("#adminTokenInput").value.trim();
  if (!token) {
    alert("กรุณากรอกรหัสผู้ดูแล");
    return;
  }
  sessionStorage.setItem("toyotaAdminToken", token);
  try {
    await loadAdminRegistrations();
    $("#adminLogin").hidden = true;
    $("#adminPanel").hidden = false;
    $("#adminMessage").hidden = true;
  } catch (error) {
    sessionStorage.removeItem("toyotaAdminToken");
    alert(error.message);
  }
});
$("#adminLogoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("toyotaAdminToken");
  $("#adminPanel").hidden = true;
  $("#adminLogin").hidden = false;
  $("#adminTokenInput").value = "";
});
$("#adminRefreshBtn").addEventListener("click", () =>
  loadAdminRegistrations().catch(() => {}),
);
$("#sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.capacity = Number(data.capacity);
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    await request("/api/admin/sessions", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(data),
    });
    form.reset();
    form.elements.capacity.value = 20;
    $("#adminMessage").textContent = "เพิ่มรอบอบรมเรียบร้อยแล้ว";
    $("#adminMessage").className = "notice success";
    $("#adminMessage").hidden = false;
    await loadSessions();
  } catch (error) {
    $("#adminMessage").textContent = `เพิ่มรอบอบรมไม่สำเร็จ: ${error.message}`;
    $("#adminMessage").className = "notice error";
    $("#adminMessage").hidden = false;
  } finally {
    button.disabled = false;
  }
});
$("#registrationsTable").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-cancel]");
  if (!button || !confirm("ยืนยันยกเลิกการลงทะเบียนนี้หรือไม่?")) return;
  try {
    await request(
      `/api/admin/registrations/${encodeURIComponent(button.dataset.adminCancel)}/cancel`,
      { method: "POST", headers: adminHeaders() },
    );
    await loadAdminRegistrations();
    await loadSessions();
  } catch (error) {
    alert(`ดำเนินการไม่สำเร็จ: ${error.message}`);
  }
});
$$("[data-close]").forEach((button) =>
  button.addEventListener("click", () => closeDialog(button.dataset.close)),
);
$$("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }),
);
$("#refreshBtn").addEventListener("click", loadSessions);
$("#menuToggle").addEventListener("click", () => {
  const nav = $(".nav-links");
  const open = nav.classList.toggle("open");
  $("#menuToggle").setAttribute("aria-expanded", String(open));
});
$$(".nav-links a").forEach((link) =>
  link.addEventListener("click", () =>
    $(".nav-links").classList.remove("open"),
  ),
);
$("#year").textContent = new Date().getFullYear();
loadSessions();
