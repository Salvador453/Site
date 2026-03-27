/* eslint-disable no-inner-declarations */
(function () {
  console.log('app.js завантажено');

  const COURSES = [1, 2, 3, 4];
  const DB_KEY = "ukrEdu.db.v1";
  const SESSION_KEY = "ukrEdu.session.userId";

  const elApp = document.getElementById("app");
  const elUserBadge = document.getElementById("userBadge");

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[c] || c;
    });

  const $ = (sel, root = document) => root.querySelector(sel);

  const defaultDB = () => ({
    version: 1,
    users: [],
    groups: COURSES.map((c) => ({
      id: `group-${c}`,
      courseId: c,
      name: "",
    })),
    subjects: [],
    grades: [], // {id, studentId, subjectId, score, dateISO}
    attendance: [], // {id, courseId, dateISO, studentId, present}
    settings: {
      passThreshold: 60,
    },
  });

  function loadDB() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      const db = defaultDB();
      saveDB(db);
      return db;
    }
    let db;
    try {
      db = JSON.parse(raw);
    } catch {
      db = defaultDB();
    }
    // Ensure schema parts exist even if older data.
    if (!db.version) db.version = 1;
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.groups)) {
      db.groups = COURSES.map((c) => ({ id: `group-${c}`, courseId: c, name: "" }));
    }
    for (const c of COURSES) {
      const found = db.groups.find((g) => g.courseId === c);
      if (!found) db.groups.push({ id: `group-${c}`, courseId: c, name: "" });
    }
    if (!Array.isArray(db.subjects)) db.subjects = [];
    if (!Array.isArray(db.grades)) db.grades = [];
    if (!Array.isArray(db.attendance)) db.attendance = [];
    if (!db.settings) db.settings = { passThreshold: 60 };
    if (typeof db.settings.passThreshold !== "number") db.settings.passThreshold = 60;
    saveDB(db);
    return db;
  }

  function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function sha256Hex(text) {
    // WebCrypto може бути вимкнений у контексті `file://` (без HTTPS).
    // Для демо робимо fallback, щоб кнопки реєстрації/входу працювали.
    try {
      if (crypto && crypto.subtle && crypto.subtle.digest) {
        const enc = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest("SHA-256", enc);
        const arr = Array.from(new Uint8Array(buf));
        return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch {
      // fallthrough to fallback hash
    }

    // FNV-1a 32-bit fallback (NOT cryptographically secure).
    const str = String(text ?? "");
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    const hex = h.toString(16).padStart(8, "0");
    return `${hex}${hex}${hex}${hex}`.slice(0, 64);
  }

  function normalizeEmail(email) {
    return String(email ?? "").trim().toLowerCase();
  }

  function getSessionUser(db) {
    const userId = localStorage.getItem(SESSION_KEY);
    if (!userId) return null;
    return db.users.find((u) => u.id === userId) || null;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function formatDate(iso) {
    // iso: YYYY-MM-DD
    return iso;
  }

  function getCourseLabel(courseId) {
    return `Курс ${courseId}`;
  }

  function getGroupForCourse(db, courseId) {
    return db.groups.find((g) => g.courseId === Number(courseId)) || null;
  }

  function getStudentFullName(user) {
    return `${user.lastName} ${user.firstName}`;
  }

  function getGradeStats(db, studentId) {
    const list = db.grades
      .filter((g) => g.studentId === studentId)
      .slice()
      .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
    if (list.length === 0) return { average: null, list };
    const sum = list.reduce((acc, g) => acc + Number(g.score), 0);
    return { average: sum / list.length, list };
  }

  function getAttendanceStats(db, user) {
    const courseId = user.courseId;
    const sessions = Array.from(
      new Set(db.attendance.filter((a) => a.courseId === courseId).map((a) => a.dateISO))
    ).sort((a, b) => (a < b ? 1 : -1));
    const total = sessions.length;
    if (total === 0) return { present: 0, total: 0, percent: 0, sessions: [] };
    const presentByDate = new Set(
      db.attendance
        .filter((a) => a.courseId === courseId && a.studentId === user.id && a.present)
        .map((a) => a.dateISO)
    );
    const present = presentByDate.size;
    const percent = Math.round((present / total) * 100);
    const lastSessions = sessions.slice(0, 6).map((dateISO) => ({
      dateISO,
      present: presentByDate.has(dateISO),
    }));
    return { present, total, percent, sessions: lastSessions };
  }

  function drawSimpleBarChart(canvas, items) {
    // items: [{label, value}] where value in [0..100] (or any positive range)
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.fillStyle = "rgba(0,0,0,.10)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    for (let i = 0; i <= 4; i++) {
      const y = Math.round((h * i) / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const max = Math.max(1, ...items.map((x) => Number(x.value)));
    const pad = 10;
    const barAreaW = w - pad * 2;
    const barCount = Math.max(1, items.length);
    const gap = barCount > 1 ? 10 : 0;
    const barW = Math.floor((barAreaW - gap * (barCount - 1)) / barCount);

    items.forEach((it, idx) => {
      const v = Number(it.value);
      const barH = Math.round((v / max) * (h - 34));
      const x = pad + idx * (barW + gap);
      const y = h - barH - 24;

      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, "rgba(124,92,255,.85)");
      grad.addColorStop(1, "rgba(56,189,248,.45)");
      ctx.fillStyle = grad;

      ctx.beginPath();
      roundRect(ctx, x, y, barW, barH, 10);
      ctx.fill();

      ctx.fillStyle = "rgba(234,240,255,.9)";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const lbl = String(it.label ?? "").slice(0, 8);
      ctx.fillText(lbl, x, h - 8);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function setNavVisibleByRole(db, user) {
    const adminLink = document.querySelector('[data-nav].nav__link--admin');
    if (!adminLink) return;
    if (!user) {
      adminLink.style.display = "none";
      return;
    }
    adminLink.style.display = user.role === "admin" ? "" : "none";
  }

  function renderUserBadge(db, user) {
    if (!user) {
      elUserBadge.innerHTML = "";
      return;
    }
    const group = getGroupForCourse(db, user.courseId);
    const groupName = group?.name?.trim() ? group.name.trim() : `Група ${user.courseId}`;

    elUserBadge.innerHTML = `
      <div class="user-badge__inner">
        <div style="text-align:right;">
          <div style="font-weight:900; line-height:1.1;">${escapeHtml(getStudentFullName(user))}</div>
          <div style="color:rgba(234,240,255,.7); font-size:12.5px; margin-top:3px;">
            ${escapeHtml(getCourseLabel(user.courseId))} · ${escapeHtml(groupName)}
          </div>
          <div style="margin-top:10px;">
            <button class="btn" id="btnLogout" type="button">Вийти</button>
          </div>
        </div>
      </div>
    `;

    const btn = document.getElementById("btnLogout");
    if (btn) {
      btn.addEventListener("click", () => {
        clearSession();
        render();
      });
    }
  }

  function currentRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    const route = h.startsWith("/") ? h : `/${h}`;
    return route;
  }

  function renderLanding(db, user) {
    const adminHint =
      user && user.role === "admin"
        ? `<div class="notice notice--ok" style="margin-top:12px;">
            Ви зараз увійшли як адмін. Перейдіть у розділ «Адмін-панель».
          </div>`
        : "";

    elApp.innerHTML = `
      <div class="card">
        <h2 class="section-title">Швидкий старт</h2>
        <div class="grid grid--2">
          <div class="notice">
            <div style="font-weight:900; margin-bottom:6px;">Студентам</div>
            <div class="muted">
              Реєстрація по email та прізвищу/імені, вибір курсу 1–4, перегляд відвідуваності й оцінок у кабінеті.
            </div>
          </div>
          <div class="notice">
            <div style="font-weight:900; margin-bottom:6px;">Адміну</div>
            <div class="muted">
              Керування групами, призначення адміністраторів, внесення відвідуваності та оцінок, перегляд статистики студентів.
            </div>
          </div>
        </div>

        ${adminHint}

        <div class="btnbar" style="margin-top:14px;">
          ${user ? `<button class="btn btn--primary" type="button" id="btnToCabinet">Кабінет</button>` : ""}
          <button class="btn btn--primary" type="button" id="btnToLogin">Вхід</button>
          <button class="btn" type="button" id="btnToRegister">Реєстрація</button>
        </div>

        <div class="notice" style="margin-top:14px;">
          <div style="font-weight:900; margin-bottom:6px;">Важливо</div>
          <div class="muted">
            Ця версія працює як демонстрація без сервера: дані зберігаються локально у вашому браузері. Для реальної багатокористувацької системи потрібен бекенд.
          </div>
        </div>
      </div>
    `;
    const btnToLogin = $("#btnToLogin");
    if (btnToLogin) btnToLogin.addEventListener("click", () => (location.hash = "#/вхід"));
    const btnToRegister = $("#btnToRegister");
    if (btnToRegister) btnToRegister.addEventListener("click", () => (location.hash = "#/реєстрація"));
    const btnToCabinet = $("#btnToCabinet");
    if (btnToCabinet) btnToCabinet.addEventListener("click", () => (location.hash = "#/кабінет"));
  }

  function renderAuthCard(mode, db) {
    const isLogin = mode === "login";
    const title = isLogin ? "Вхід" : "Реєстрація";
    elApp.innerHTML = `
      <div class="card split">
        <div class="split__left">
          <h2 class="section-title">${escapeHtml(title)}</h2>
          <form id="authForm">
            ${
              isLogin
                ? `
                <div class="field">
                  <div class="label">Email</div>
                  <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required />
                </div>
                <div class="field">
                  <div class="label">Пароль</div>
                  <input name="password" type="password" autocomplete="current-password" placeholder="Введіть пароль" required />
                </div>
              `
                : `
                <div class="grid grid--2" style="margin-bottom:12px;">
                  <div class="field" style="margin:0;">
                    <div class="label">Прізвище</div>
                    <input name="lastName" type="text" autocomplete="family-name" placeholder="Напр.: Петренко" required />
                  </div>
                  <div class="field" style="margin:0;">
                    <div class="label">Ім'я</div>
                    <input name="firstName" type="text" autocomplete="given-name" placeholder="Напр.: Олександр" required />
                  </div>
                </div>
                <div class="field">
                  <div class="label">Email</div>
                  <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required />
                </div>
                <div class="field">
                  <div class="label">Курс</div>
                  <select name="courseId" required>
                    ${COURSES.map((c) => `<option value="${c}">${escapeHtml(getCourseLabel(c))}</option>`).join("")}
                  </select>
                </div>
                <div class="field">
                  <div class="label">Пароль</div>
                  <input name="password" type="password" autocomplete="new-password" placeholder="Мінімум 6 символів" required minlength="6" />
                </div>
                <div class="field">
                  <div class="label">Повторіть пароль</div>
                  <input name="password2" type="password" autocomplete="new-password" placeholder="Повторіть пароль" required minlength="6" />
                </div>
              `
            }

            <div class="btnbar">
              <button class="btn btn--primary" type="submit">${escapeHtml(isLogin ? "Увійти" : "Зареєструватися")}</button>
              <button class="btn" type="button" id="btnBack">${escapeHtml(isLogin ? "Назад" : "У мене вже є акаунт")}</button>
            </div>
            <div id="authError" class="notice notice--danger" style="display:none; margin-top:12px;"></div>
          </form>
        </div>

        <div class="split__right">
          <div class="notice">
            <div style="font-weight:900; margin-bottom:6px;">Порада</div>
            <div class="muted" style="line-height:1.5;">
              ${isLogin ? "Якщо ще немає акаунта — перейдіть до «Реєстрація»." : "Після першої реєстрації користувач автоматично стане адміном (щоб вам було зручно вести статистику)."}
            </div>
          </div>
          <div class="notice" style="margin-top:12px;">
            <div style="font-weight:900; margin-bottom:6px;">Конфіденційність</div>
            <div class="muted" style="line-height:1.5;">
              Дані зберігаються локально у браузері. Для безпечної багатокористувацької системи потрібен бекенд та захист паролів на сервері.
            </div>
          </div>
        </div>
      </div>
    `;

    $("#btnBack").addEventListener("click", () => {
      location.hash = isLogin ? "#/" : "#/вхід";
    });

    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = new FormData(form);

      const setError = (msg) => {
        const box = $("#authError");
        box.style.display = "";
        box.textContent = msg;
      };

      try {
        if (isLogin) {
          const email = normalizeEmail(data.get("email"));
          const password = String(data.get("password") || "");
          if (!email || !password) {
            setError("Заповніть email і пароль.");
            return;
          }
          const db2 = loadDB();
          const user = db2.users.find((u) => u.email === email);
          if (!user) {
            setError("Акаунт не знайдено. Перевірте email.");
            return;
          }
          const hash = await sha256Hex(password);
          if (hash !== user.passwordHash) {
            setError("Невірний пароль.");
            return;
          }
          localStorage.setItem(SESSION_KEY, user.id);
          location.hash = "#/кабінет";
          render();
          return;
        }

        const firstName = String(data.get("firstName") || "").trim();
        const lastName = String(data.get("lastName") || "").trim();
        const email = normalizeEmail(data.get("email"));
        const courseId = Number(data.get("courseId"));
        const password = String(data.get("password") || "");
        const password2 = String(data.get("password2") || "");

        if (!firstName || !lastName) {
          setError("Вкажіть прізвище та ім'я.");
          return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError("Вкажіть коректний email.");
          return;
        }
        if (!COURSES.includes(courseId)) {
          setError("Оберіть коректний курс.");
          return;
        }
        if (password.length < 6) {
          setError("Пароль має бути мінімум 6 символів.");
          return;
        }
        if (password !== password2) {
          setError("Паролі не збігаються.");
          return;
        }

        const db2 = loadDB();
        const exists = db2.users.some((u) => u.email === email);
        if (exists) {
          setError("Цей email уже використовується.");
          return;
        }
        const isFirstAdmin = db2.users.filter((u) => u.role === "admin").length === 0;
        const passwordHash = await sha256Hex(password);
        const id = uuid();

        db2.users.push({
          id,
          email,
          firstName,
          lastName,
          passwordHash,
          role: isFirstAdmin ? "admin" : "student",
          courseId,
          createdAt: new Date().toISOString(),
        });

        saveDB(db2);
        localStorage.setItem(SESSION_KEY, id);
        location.hash = isFirstAdmin ? "#/адмін" : "#/кабінет";
        render();
      } catch (err) {
        setError("Сталася помилка. Спробуйте ще раз.");
      }
    });
  }

  function renderStudentCabinet(db, user) {
    const group = getGroupForCourse(db, user.courseId);
    const groupName = group?.name?.trim() ? group.name.trim() : `Група ${user.courseId}`;
    const attendance = getAttendanceStats(db, user);
    const grades = getGradeStats(db, user.id);

    const passThreshold = Number(db.settings.passThreshold ?? 60);
    const avg = grades.average;
    const passed = avg == null ? null : avg >= passThreshold;
    
    // Get all students on same course for ranking
    const allStudentsOnCourse = db.users.filter(u => u.role === "student" && u.courseId === user.courseId);
    const allGradesOnCourse = allStudentsOnCourse.map(s => ({
      studentId: s.id,
      fullName: getStudentFullName(s),
      average: getGradeStats(db, s.id).average
    })).filter(x => x.average != null).sort((a, b) => b.average - a.average);
    
    const userRank = allGradesOnCourse.findIndex(x => x.studentId === user.id) + 1;
    const totalStudents = allGradesOnCourse.length;

    const chartItems = grades.list
      .slice()
      .reverse()
      .slice(-6)
      .map((g) => {
        const subject = db.subjects.find((s) => s.id === g.subjectId);
        return { label: (g.dateISO || "").slice(5), value: Number(g.score), subject: subject?.name || "" };
      });

    elApp.innerHTML = `
      <div class="card">
        <div class="row" style="margin-bottom:12px;">
          <div>
            <h2 class="section-title" style="margin:0;">Кабінет студента</h2>
            <div class="muted" style="margin-top:6px;">${escapeHtml(groupName)} · ${escapeHtml(getCourseLabel(user.courseId))}</div>
          </div>
          <div>
            <span class="pill pill--accent">${escapeHtml(user.role === "admin" ? "Адмін" : "Студент")}</span>
          </div>
        </div>

        <div class="grid grid--4" style="grid-template-columns: 1fr 1fr 1fr 1fr;">
          <div class="notice">
            <div class="muted" style="font-weight:800; margin-bottom:4px;">Відвідуваність</div>
            <div style="font-weight:1000; font-size:22px; margin-bottom:6px;">${attendance.total ? `${attendance.percent}%` : "Н/Д"}</div>
            <div class="muted">Присутній: ${attendance.present}/${attendance.total}</div>
          </div>
          <div class="notice">
            <div class="muted" style="font-weight:800; margin-bottom:4px;">Середній бал</div>
            <div style="font-weight:1000; font-size:22px; margin-bottom:6px;">
              ${avg == null ? "Н/Д" : `${avg.toFixed(1)}`}
            </div>
            <div class="muted">
              Поріг: ${passThreshold}%
            </div>
          </div>
          <div class="notice">
            <div class="muted" style="font-weight:800; margin-bottom:4px;">Статус</div>
            <div style="font-weight:1000; font-size:22px; margin-bottom:6px;">
              ${
                passed == null ? "—" : passed ? "✓ Успішно" : "⚠ Потрібна увага"
              }
            </div>
            <div class="muted">Оцінки вносяться адміном</div>
          </div>
          <div class="notice">
            <div class="muted" style="font-weight:800; margin-bottom:4px;">Рейтинг у групі</div>
            <div style="font-weight:1000; font-size:22px; margin-bottom:6px;">
              ${totalStudents > 0 ? `${userRank}/${totalStudents}` : "Н/Д"}
            </div>
            <div class="muted">За середнім балом</div>
          </div>
        </div>

        <div class="grid grid--2" style="margin-top:14px;">
          <div>
            <div class="section-title" style="font-size:16px;">Останні оцінки (графік)</div>
            <canvas class="chart" id="scoreChart" width="520" height="130"></canvas>
            <div class="muted" style="margin-top:10px; font-size:13px;">
              ${grades.list.length ? "Показуються останні оцінки з датами." : "Немає оцінок — адмін додасть їх в панелі."}
            </div>
          </div>
          <div>
            <div class="section-title" style="font-size:16px;">Останні заняття (відвідуваність)</div>
            <div class="tableWrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    attendance.sessions.length
                      ? attendance.sessions
                          .map(
                            (s) => `
                        <tr>
                          <td>${escapeHtml(formatDate(s.dateISO))}</td>
                          <td>
                            ${
                              s.present
                                ? '<span class="pill pill--ok">Присутній</span>'
                                : '<span class="pill pill--danger">Відсутній</span>'
                            }
                          </td>
                        </tr>
                      `
                          )
                          .join("")
                      : `
                    <tr>
                      <td colspan="2" class="muted">Немає даних.</td>
                    </tr>
                  `
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style="margin-top:14px;">
          <div class="section-title" style="font-size:16px;">Список оцінок</div>
          <div class="tableWrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th>Оцінка</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                ${
                  grades.list.length
                    ? grades.list
                        .slice(0, 12)
                        .map((g) => {
                          const subject = db.subjects.find((s) => s.id === g.subjectId);
                          return `
                        <tr>
                          <td>${escapeHtml(subject?.name || "Невідомий предмет")}</td>
                          <td>${escapeHtml(String(g.score))}%</td>
                          <td>${escapeHtml(formatDate(g.dateISO || ""))}</td>
                        </tr>
                      `;
                        })
                        .join("")
                    : `
                  <tr>
                    <td colspan="3" class="muted">Немає оцінок.</td>
                  </tr>
                `
                }
              </tbody>
            </table>
          </div>
          <div class="muted" style="margin-top:10px; font-size:13px;">
            Порада: адмін керує списком предметів і виставляє оцінки в адмін-панелі.
          </div>
        </div>
      </div>
    `;

    const canvas = document.getElementById("scoreChart");
    if (canvas && canvas.getContext) {
      // Make responsive canvas scaling.
      canvas.width = 520;
      canvas.height = 130;
      if (chartItems.length) drawSimpleBarChart(canvas, chartItems);
    }
  }

  function courseStudents(db, courseId) {
    const cid = Number(courseId);
    return db.users
      .filter((u) => u.role === "student" && u.courseId === cid)
      .slice()
      .sort((a, b) => (a.lastName > b.lastName ? 1 : -1));
  }

  function renderAdminPanel(db, user) {
    const [c1, c2, c3, c4] = COURSES;
    const currentCourseDefault = c1;

    const groupRow = (courseId) => {
      const group = getGroupForCourse(db, courseId);
      const name = group?.name?.trim() ? group.name.trim() : "";
      return `
        <tr data-group-row="${escapeHtml(courseId)}">
          <td><span class="pill pill--accent">${escapeHtml(getCourseLabel(courseId))}</span></td>
          <td style="min-width: 340px;">
            <input class="groupNameInput" data-course-id="${escapeHtml(courseId)}" value="${escapeHtml(name)}" placeholder="Вкажіть назву групи" />
          </td>
          <td style="width: 180px;">
            <button class="btn btn--primary btnSaveGroup" type="button" data-course-id="${escapeHtml(courseId)}">Зберегти</button>
          </td>
        </tr>
      `;
    };

    const allStudents = db.users
      .filter((u) => u.role === "student")
      .slice()
      .sort((a, b) => (a.lastName > b.lastName ? 1 : -1));

    const adminUsers = db.users
      .filter((u) => u.role === "admin")
      .slice()
      .sort((a, b) => (a.lastName > b.lastName ? 1 : -1));

    const subjectOptions = db.subjects.length
      ? db.subjects.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")
      : `<option value="">Немає предметів</option>`;

    elApp.innerHTML = `
      <div class="card">
        <div class="row" style="margin-bottom:10px;">
          <div>
            <h2 class="section-title" style="margin:0;">Адмін-панель</h2>
            <div class="muted" style="margin-top:6px;">Керування групами, відвідуваністю, оцінками та призначення адміністраторів.</div>
          </div>
          <div>
            <span class="pill pill--accent">Адмін</span>
          </div>
        </div>

        <div class="tabs">
          <div class="tab tab--active" data-admin-tab="groups">Групи</div>
          <div class="tab" data-admin-tab="students">Студенти</div>
          <div class="tab" data-admin-tab="attendance">Відвідуваність</div>
          <div class="tab" data-admin-tab="grades">Оцінки</div>
          <div class="tab" data-admin-tab="stats">Статистика</div>
          <div class="tab" data-admin-tab="admins">Адміни</div>
        </div>

        <div id="adminTabContent">
          <div data-admin-content="groups">
            <div class="section-title" style="font-size:16px;">Назви груп (1–4)</div>
            <div class="muted" style="margin-bottom:12px; font-size:13px;">Ви зможете потім змінювати назви груп під свій формат.</div>

            <table class="table" style="margin-top:12px;">
              <thead>
                <tr>
                  <th>Курс</th>
                  <th>Назва групи</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${COURSES.map((c) => groupRow(c)).join("")}
              </tbody>
            </table>
          </div>

          <div data-admin-content="students" style="display:none;">
            <div class="split">
              <div class="split__left">
                <div class="section-title" style="font-size:16px;">Список студентів</div>
                <div class="muted" style="margin-bottom:12px; font-size:13px;">Можна змінити курс студенту (група прив’язана до курсу).</div>

                <table class="table" style="margin-top:12px;">
                  <thead>
                    <tr>
                      <th>ПІБ</th>
                      <th>Email</th>
                      <th>Курс</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      allStudents.length
                        ? allStudents
                            .map((s) => {
                              const courseId = s.courseId;
                              return `
                                <tr data-student-row="${escapeHtml(s.id)}">
                                  <td>${escapeHtml(getStudentFullName(s))}</td>
                                  <td>${escapeHtml(s.email)}</td>
                                  <td style="min-width: 240px;">
                                    <select class="studentCourseSelect" data-student-id="${escapeHtml(s.id)}">
                                      ${COURSES.map((c) => `<option value="${c}" ${c === courseId ? "selected" : ""}>${escapeHtml(getCourseLabel(c))}</option>`).join("")}
                                    </select>
                                  </td>
                                  <td style="width: 200px;">
                                    <button class="btn btn--primary btnSaveStudentCourse" type="button" data-student-id="${escapeHtml(s.id)}">Зберегти</button>
                                  </td>
                                </tr>
                              `;
                            })
                            .join("")
                        : `<tr><td colspan="4" class="muted">Немає студентів. Створіть акаунти через «Реєстрація».</td></tr>`
                    }
                  </tbody>
                </table>
              </div>
              <div class="split__right">
                <div class="notice">
                  <div style="font-weight:900; margin-bottom:6px;">Примітка</div>
                  <div class="muted" style="line-height:1.5;">
                    Відвідуваність і оцінки прив'язані до студента. Якщо змінити курс, поточний кабінет рахуватиме тільки ті записи, де збігається курс.
                  </div>
                </div>
                <div class="notice" style="margin-top:12px;">
                  <div style="font-weight:900; margin-bottom:6px;">Статистика</div>
                  <div class="muted" style="line-height:1.5;">
                    Для кожного студента кабінет рахує відсоток відвідуваності та середній бал.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div data-admin-content="attendance" style="display:none;">
            <div class="grid grid--2">
              <div>
                <div class="section-title" style="font-size:16px;">Внесення відвідуваності</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Оберіть курс та дату. Потім відмітьте присутність.</div>

                <div class="grid grid--2" style="grid-template-columns: 1fr 1fr;">
                  <div class="field">
                    <div class="label">Курс</div>
                    <select id="attCourse">
                      ${COURSES.map((c) => `<option value="${c}" ${c === currentCourseDefault ? "selected" : ""}>${escapeHtml(getCourseLabel(c))}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field">
                    <div class="label">Дата</div>
                    <input id="attDate" type="date" />
                  </div>
                </div>

                <div id="attendanceFormWrap" style="margin-top:10px;"></div>

                <div class="btnbar" style="margin-top:12px;">
                  <button class="btn btn--primary" type="button" id="btnLoadAttendance">Завантажити</button>
                  <button class="btn" type="button" id="btnSaveAttendance">Зберегти</button>
                </div>
                <div id="attendanceError" class="notice notice--danger" style="display:none; margin-top:12px;"></div>
              </div>

              <div>
                <div class="section-title" style="font-size:16px;">Останні записи</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Швидкий перегляд внесених занять.</div>
                <div id="attendanceRecentWrap"></div>
              </div>
            </div>
          </div>

          <div data-admin-content="grades" style="display:none;">
            <div class="grid grid--2">
              <div>
                <div class="section-title" style="font-size:16px;">Предмети</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Додайте предмети, після чого можна виставляти оцінки студентам.</div>

                <form id="subjectForm" style="display:flex; gap:10px; align-items:flex-end;">
                  <div class="field" style="margin:0; flex:1;">
                    <div class="label">Назва предмета</div>
                    <input name="subjectName" placeholder="Напр.: Математика" required />
                  </div>
                  <button class="btn btn--primary" type="submit" style="height:44px;">Додати</button>
                </form>
                <div style="margin-top:12px;">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>Предмет</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody id="subjectsTableBody">
                      ${
                        db.subjects.length
                          ? db.subjects
                              .map(
                                (s) => `
                                <tr>
                                  <td>${escapeHtml(s.name)}</td>
                                  <td style="width:140px;">
                                    <button class="btn btn--danger btnDeleteSubject" type="button" data-subject-id="${escapeHtml(s.id)}">Видалити</button>
                                  </td>
                                </tr>
                              `
                              )
                              .join("")
                          : `<tr><td colspan="2" class="muted">Немає предметів. Додайте перший.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div class="section-title" style="font-size:16px;">Виставлення оцінок</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Оцінка зберігається у відсотках (0–100).</div>

                <form id="gradeForm">
                  <div class="grid grid--2" style="grid-template-columns: 1fr 1fr;">
                    <div class="field">
                      <div class="label">Курс</div>
                      <select id="gradeCourse">
                        ${COURSES.map((c) => `<option value="${c}" ${c === currentCourseDefault ? "selected" : ""}>${escapeHtml(getCourseLabel(c))}</option>`).join("")}
                      </select>
                    </div>
                    <div class="field">
                      <div class="label">Дата</div>
                      <input id="gradeDate" type="date" required />
                    </div>
                  </div>

                  <div class="field">
                    <div class="label">Студент</div>
                    <select id="gradeStudent"></select>
                  </div>

                  <div class="field">
                    <div class="label">Предмет</div>
                    <select id="gradeSubject">${subjectOptions}</select>
                  </div>

                  <div class="field">
                    <div class="label">Оцінка (в %)</div>
                    <input id="gradeScore" type="number" min="0" max="100" step="0.5" placeholder="Напр.: 87" required />
                  </div>

                  <div class="btnbar">
                    <button class="btn btn--primary" type="submit">Зберегти оцінку</button>
                  </div>
                  <div id="gradeError" class="notice notice--danger" style="display:none; margin-top:12px;"></div>
                </form>

                <div class="notice" style="margin-top:12px;">
                  <div style="font-weight:900; margin-bottom:6px;">Пояснення</div>
                  <div class="muted" style="line-height:1.5;">
                    Кабінет студента рахує середній бал та відображає останні записи.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div data-admin-content="stats" style="display:none;">
            <div class="section-title" style="font-size:16px;">Загальна статистика</div>
            <div class="muted" style="margin-bottom:14px; font-size:13px;">Аналітика студентів та їхніх показників.</div>

            <div class="grid grid--4" style="margin-bottom:14px;">
              <div class="notice">
                <div class="muted" style="font-weight:800; margin-bottom:4px;">Всього студентів</div>
                <div style="font-weight:1000; font-size:22px;">${escapeHtml(String(allStudents.length))}</div>
              </div>
              <div class="notice">
                <div class="muted" style="font-weight:800; margin-bottom:4px;">З оцінками</div>
                <div style="font-weight:1000; font-size:22px;">${escapeHtml(String(db.grades.length > 0 ? new Set(db.grades.map(g => g.studentId)).size : 0))}</div>
              </div>
              <div class="notice">
                <div class="muted" style="font-weight:800; margin-bottom:4px;">Занять записано</div>
                <div style="font-weight:1000; font-size:22px;">${escapeHtml(String(new Set(db.attendance.map(a => a.dateISO)).size))}</div>
              </div>
              <div class="notice">
                <div class="muted" style="font-weight:800; margin-bottom:4px;">Предметів</div>
                <div style="font-weight:1000; font-size:22px;">${escapeHtml(String(db.subjects.length))}</div>
              </div>
            </div>

            <div class="grid grid--2" style="margin-bottom:14px;">
              <div>
                <div class="section-title" style="font-size:16px;">Топ студентів (за середнім балом)</div>
                <div class="tableWrap">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>Місце</th>
                        <th>ПІБ</th>
                        <th>Курс</th>
                        <th>Середній бал</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        allStudents.length > 0
                          ? allStudents
                              .map(s => ({
                                student: s,
                                average: getGradeStats(db, s.id).average
                              }))
                              .filter(x => x.average != null)
                              .sort((a, b) => b.average - a.average)
                              .slice(0, 10)
                              .map((x, idx) => `
                                <tr>
                                  <td style="font-weight:900;">${escapeHtml(String(idx + 1))}</td>
                                  <td>${escapeHtml(getStudentFullName(x.student))}</td>
                                  <td>${escapeHtml(getCourseLabel(x.student.courseId))}</td>
                                  <td><span class="pill pill--ok">${escapeHtml(x.average.toFixed(1))}</span></td>
                                </tr>
                              `)
                              .join("")
                          : `<tr><td colspan="4" class="muted">Немає даних.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div class="section-title" style="font-size:16px;">Потребують уваги (низькі оцінки)</div>
                <div class="tableWrap">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>ПІБ</th>
                        <th>Курс</th>
                        <th>Середній бал</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        allStudents.length > 0
                          ? allStudents
                              .map(s => ({
                                student: s,
                                average: getGradeStats(db, s.id).average
                              }))
                              .filter(x => x.average != null && x.average < passThreshold)
                              .sort((a, b) => a.average - b.average)
                              .slice(0, 10)
                              .map((x) => `
                                <tr>
                                  <td>${escapeHtml(getStudentFullName(x.student))}</td>
                                  <td>${escapeHtml(getCourseLabel(x.student.courseId))}</td>
                                  <td><span class="pill pill--danger">${escapeHtml(x.average.toFixed(1))}</span></td>
                                </tr>
                              `)
                              .join("")
                          : `<tr><td colspan="3" class="muted">Немає даних.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="notice" style="margin-top:14px;">
              <div style="font-weight:900; margin-bottom:8px;">Експорт даних</div>
              <div class="muted" style="margin-bottom:10px;">Завантажте дані студентів та їхні оцінки у форматі CSV для аналізу.</div>
              <div class="btnbar">
                <button class="btn btn--primary" type="button" id="btnExportCSV">📥 Експортувати CSV</button>
              </div>
            </div>
          </div>

          <div data-admin-content="admins" style="display:none;">
            <div class="split">
              <div class="split__left">
                <div class="section-title" style="font-size:16px;">Адміністратори</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Можна призначити адміна за email або прибрати роль.</div>

                <table class="table">
                  <thead>
                    <tr>
                      <th>ПІБ</th>
                      <th>Email</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      adminUsers.length
                        ? adminUsers
                            .map((a) => {
                              const studentCourse = getCourseLabel(a.courseId);
                              return `
                                <tr>
                                  <td>${escapeHtml(getStudentFullName(a))}<div class="muted" style="font-size:12.5px; margin-top:2px;">${escapeHtml(studentCourse)}</div></td>
                                  <td>${escapeHtml(a.email)}</td>
                                  <td style="width: 200px;">
                                    <button class="btn btn--danger btnRevokeAdmin" type="button" data-admin-id="${escapeHtml(a.id)}">Зняти адмін роль</button>
                                  </td>
                                </tr>
                              `;
                            })
                            .join("")
                        : `<tr><td colspan="3" class="muted">Немає адмінів.</td></tr>`
                    }
                  </tbody>
                </table>
              </div>
              <div class="split__right">
                <div class="section-title" style="font-size:16px;">Призначити адміна</div>
                <div class="muted" style="font-size:13px; margin-bottom:12px;">Вкажіть email користувача (він має бути зареєстрований).</div>

                <form id="addAdminForm">
                  <div class="field">
                    <div class="label">Email</div>
                    <input name="adminEmail" type="email" placeholder="name@example.com" required />
                  </div>
                  <div class="btnbar">
                    <button class="btn btn--primary" type="submit">Зробити адміном</button>
                  </div>
                  <div id="adminError" class="notice notice--danger" style="display:none; margin-top:12px;"></div>
                </form>

                <div class="notice" style="margin-top:12px;">
                  <div style="font-weight:900; margin-bottom:6px;">Правило</div>
                  <div class="muted" style="line-height:1.5;">
                    Заборонено зняти роль з останнього адміна, щоб не втратити керування.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="muted" style="font-size:12.5px; margin-top:14px;">
          Порада: якщо ви змінюєте щось в адмін-панелі, кабінет студента оновлюється одразу після перезавантаження сторінки.
        </div>
      </div>
    `;

    function activateTab(tabName) {
      document.querySelectorAll("[data-admin-tab]").forEach((t) => t.classList.remove("tab--active"));
      document.querySelectorAll("[data-admin-tab]").forEach((t) => {
        if (t.getAttribute("data-admin-tab") === tabName) t.classList.add("tab--active");
      });
      document.querySelectorAll("[data-admin-content]").forEach((node) => {
        node.style.display = node.getAttribute("data-admin-content") === tabName ? "" : "none";
      });
    }

    // Tabs
    document.querySelectorAll("[data-admin-tab]").forEach((t) => {
      t.addEventListener("click", () => activateTab(t.getAttribute("data-admin-tab")));
    });

    // Group save
    document.querySelectorAll(".btnSaveGroup").forEach((btn) => {
      btn.addEventListener("click", () => {
        const db2 = loadDB();
        const courseId = Number(btn.getAttribute("data-course-id"));
        const input = $(`.groupNameInput[data-course-id="${courseId}"]`);
        const name = input ? input.value.trim() : "";
        const g = db2.groups.find((x) => x.courseId === courseId);
        if (g) {
          g.name = name;
          saveDB(db2);
        }
        render();
      });
    });

    // Students save course
    document.querySelectorAll(".btnSaveStudentCourse").forEach((btn) => {
      btn.addEventListener("click", () => {
        const db2 = loadDB();
        const studentId = btn.getAttribute("data-student-id");
        const rowSel = $(`.studentCourseSelect[data-student-id="${studentId}"]`);
        const courseId = Number(rowSel?.value ?? 0);
        const student = db2.users.find((u) => u.id === studentId);
        if (student && COURSES.includes(courseId)) {
          student.courseId = courseId;
          saveDB(db2);
        }
        render();
      });
    });

    // Admins: revoke
    document.querySelectorAll(".btnRevokeAdmin").forEach((btn) => {
      btn.addEventListener("click", () => {
        const db2 = loadDB();
        const adminId = btn.getAttribute("data-admin-id");
        const admins = db2.users.filter((u) => u.role === "admin");
        if (admins.length <= 1) {
          const box = $("#adminError");
          if (box) {
            box.style.display = "";
            box.textContent = "Неможливо зняти роль з останнього адміна.";
          }
          return;
        }
        const target = db2.users.find((u) => u.id === adminId);
        if (target) {
          target.role = "student";
          saveDB(db2);
          render();
        }
      });
    });

    // Admins: add
    const addAdminForm = $("#addAdminForm");
    if (addAdminForm) {
      addAdminForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const db2 = loadDB();
        const formData = new FormData(addAdminForm);
        const email = normalizeEmail(formData.get("adminEmail"));
        const target = db2.users.find((u) => u.email === email);
        const box = $("#adminError");
        if (box) {
          box.style.display = "none";
        }
        if (!target) {
          if (box) {
            box.style.display = "";
            box.textContent = "Користувача з таким email не знайдено. Спочатку зареєструйтесь.";
          }
          return;
        }
        target.role = "admin";
        saveDB(db2);
        render();
      });
    }

    // Attendance handling
    const attendanceRecentWrap = $("#attendanceRecentWrap");
    const attendanceError = $("#attendanceError");
    const btnLoadAttendance = $("#btnLoadAttendance");
    const btnSaveAttendance = $("#btnSaveAttendance");
    const attCourse = $("#attCourse");
    const attDate = $("#attDate");
    const attendanceFormWrap = $("#attendanceFormWrap");

    function renderAttendanceRecent() {
      const db2 = loadDB();
      const courseId = Number(attCourse?.value ?? currentCourseDefault);
      const dateFilter = db2.attendance
        .filter((a) => a.courseId === courseId)
        .slice()
        .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
      const uniqueDates = Array.from(new Set(dateFilter.map((x) => x.dateISO))).slice(0, 6);
      if (!attendanceRecentWrap) return;
      if (!uniqueDates.length) {
        attendanceRecentWrap.innerHTML = `<div class="notice">Немає записів відвідуваності.</div>`;
        return;
      }

      const students = courseStudents(db2, courseId);
      const rows = uniqueDates
        .map((dateISO) => {
          const presentSet = new Set(
            db2.attendance
              .filter((a) => a.courseId === courseId && a.dateISO === dateISO && a.present)
              .map((a) => a.studentId)
          );
          const presentCount = presentSet.size;
          return `
            <div class="notice" style="margin-bottom:10px;">
              <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                <div>
                  <div style="font-weight:900;">${escapeHtml(formatDate(dateISO))}</div>
                  <div class="muted" style="font-size:12.5px; margin-top:2px;">${escapeHtml(getCourseLabel(courseId))}</div>
                </div>
                <div>
                  <span class="pill pill--ok">${escapeHtml(presentCount)}/${escapeHtml(students.length)}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      attendanceRecentWrap.innerHTML = rows;
    }

    function renderAttendanceForm() {
      const db2 = loadDB();
      const courseId = Number(attCourse?.value ?? currentCourseDefault);
      const dateISO = String(attDate?.value || "");
      const students = courseStudents(db2, courseId);
      if (!attendanceFormWrap) return;

      if (!dateISO) {
        attendanceFormWrap.innerHTML = `<div class="notice">Оберіть дату, щоб зберегти відвідуваність.</div>`;
        return;
      }

      const existing = db2.attendance.filter((a) => a.courseId === courseId && a.dateISO === dateISO);
      const presentByStudent = new Map(existing.map((a) => [a.studentId, Boolean(a.present)]));

      if (!students.length) {
        attendanceFormWrap.innerHTML = `<div class="notice notice--danger">Немає студентів на цьому курсі.</div>`;
        return;
      }

      const checks = students
        .map((s) => {
          const present = presentByStudent.get(s.id) ?? false;
          return `
            <tr>
              <td>${escapeHtml(getStudentFullName(s))}</td>
              <td style="width: 220px;">
                <label style="display:flex; gap:10px; align-items:center; cursor:pointer;">
                  <input type="checkbox" class="attPresent" data-student-id="${escapeHtml(s.id)}" ${present ? "checked" : ""} />
                  <span class="muted">Присутній</span>
                </label>
              </td>
            </tr>
          `;
        })
        .join("");

      attendanceFormWrap.innerHTML = `
        <div class="notice">
          <div style="font-weight:900; margin-bottom:8px;">Дата: ${escapeHtml(formatDate(dateISO))}</div>
          <table class="table">
            <thead>
              <tr>
                <th>Студент</th>
                <th>Відмітка</th>
              </tr>
            </thead>
            <tbody>
              ${checks}
            </tbody>
          </table>
        </div>
      `;
    }

    if (btnLoadAttendance) {
      btnLoadAttendance.addEventListener("click", () => {
        if (attendanceError) attendanceError.style.display = "none";
        renderAttendanceRecent();
        renderAttendanceForm();
      });
    }

    if (btnSaveAttendance) {
      btnSaveAttendance.addEventListener("click", () => {
        if (attendanceError) attendanceError.style.display = "none";
        const courseId = Number(attCourse?.value ?? 0);
        const dateISO = String(attDate?.value || "");
        if (!COURSES.includes(courseId)) {
          if (attendanceError) {
            attendanceError.style.display = "";
            attendanceError.textContent = "Оберіть курс.";
          }
          return;
        }
        if (!dateISO) {
          if (attendanceError) {
            attendanceError.style.display = "";
            attendanceError.textContent = "Оберіть дату.";
          }
          return;
        }
        const db2 = loadDB();
        const students = courseStudents(db2, courseId);
        if (!students.length) {
          if (attendanceError) {
            attendanceError.style.display = "";
            attendanceError.textContent = "Немає студентів для цього курсу.";
          }
          return;
        }

        // Remove existing records for this course+date, then insert full set.
        db2.attendance = db2.attendance.filter((a) => !(a.courseId === courseId && a.dateISO === dateISO));
        for (const s of students) {
          const checkbox = document.querySelector(`.attPresent[data-student-id="${s.id}"]`);
          const present = checkbox ? Boolean(checkbox.checked) : false;
          db2.attendance.push({
            id: uuid(),
            courseId,
            dateISO,
            studentId: s.id,
            present,
          });
        }
        saveDB(db2);
        render();
      });
    }

    // Grades handling
    const subjectForm = $("#subjectForm");
    if (subjectForm) {
      subjectForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const db2 = loadDB();
        const formData = new FormData(subjectForm);
        const name = String(formData.get("subjectName") || "").trim();
        const box = $("#gradeError");
        if (box) box.style.display = "none";
        if (!name) return;
        const exists = db2.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase());
        if (exists) return;
        db2.subjects.push({ id: uuid(), name, createdAt: new Date().toISOString() });
        saveDB(db2);
        render();
      });
    }

    document.querySelectorAll(".btnDeleteSubject").forEach((btn) => {
      btn.addEventListener("click", () => {
        const db2 = loadDB();
        const subjectId = btn.getAttribute("data-subject-id");
        // Remove grades linked to this subject as well.
        db2.subjects = db2.subjects.filter((s) => s.id !== subjectId);
        db2.grades = db2.grades.filter((g) => g.subjectId !== subjectId);
        saveDB(db2);
        render();
      });
    });

    const gradeForm = $("#gradeForm");
    const gradeCourse = $("#gradeCourse");
    const gradeStudent = $("#gradeStudent");
    const gradeSubject = $("#gradeSubject");

    function renderGradeStudents() {
      const db2 = loadDB();
      const courseId = Number(gradeCourse?.value ?? currentCourseDefault);
      const students = courseStudents(db2, courseId);
      if (!gradeStudent) return;
      gradeStudent.innerHTML = students.length
        ? students.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(getStudentFullName(s))}</option>`).join("")
        : `<option value="">Немає студентів</option>`;
    }

    if (gradeCourse) gradeCourse.addEventListener("change", () => renderGradeStudents());
    renderGradeStudents();

    if (gradeForm) {
      gradeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const db2 = loadDB();
        const box = $("#gradeError");
        if (box) box.style.display = "none";

        const dateISO = String($("#gradeDate")?.value || "");
        const courseId = Number(gradeCourse?.value ?? 0);
        const studentId = String(gradeStudent?.value || "");
        const subjectId = String(gradeSubject?.value || "");
        const scoreRaw = $("#gradeScore")?.value;
        const score = Number(scoreRaw);

        if (!dateISO) {
          if (box) {
            box.style.display = "";
            box.textContent = "Оберіть дату.";
          }
          return;
        }
        if (!COURSES.includes(courseId)) {
          if (box) {
            box.style.display = "";
            box.textContent = "Оберіть курс.";
          }
          return;
        }
        if (!studentId) {
          if (box) {
            box.style.display = "";
            box.textContent = "Оберіть студента.";
          }
          return;
        }
        if (!subjectId || !db2.subjects.find((s) => s.id === subjectId)) {
          if (box) {
            box.style.display = "";
            box.textContent = "Немає предметів або виберіть предмет.";
          }
          return;
        }
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          if (box) {
            box.style.display = "";
            box.textContent = "Вкажіть оцінку в межах 0–100.";
          }
          return;
        }

        db2.grades.push({
          id: uuid(),
          studentId,
          subjectId,
          score,
          dateISO,
        });
        saveDB(db2);
        render();
      });
    }

    // Initial render for attendance recent+form once tab opened.
    renderAttendanceRecent();

    // Export CSV functionality
    const btnExportCSV = $("#btnExportCSV");
    if (btnExportCSV) {
      btnExportCSV.addEventListener("click", () => {
        const db2 = loadDB();
        const csvRows = [];
        
        // Header
        csvRows.push(["ПІБ", "Email", "Курс", "Група", "Средній бал", "Відвідуваність %", "Статус"].join(","));
        
        // Data rows
        for (const student of allStudents) {
          const gradeStats = getGradeStats(db2, student.id);
          const attStats = getAttendanceStats(db2, student);
          const group = getGroupForCourse(db2, student.courseId);
          const groupName = group?.name?.trim() ? group.name.trim() : `Група ${student.courseId}`;
          const avg = gradeStats.average;
          const passed = avg == null ? "Н/Д" : (avg >= passThreshold ? "Успішний" : "Потребує уваги");
          
          csvRows.push([
            `"${getStudentFullName(student)}"`,
            `"${student.email}"`,
            student.courseId,
            `"${groupName}"`,
            avg != null ? avg.toFixed(1) : "Н/Д",
            attStats.total > 0 ? attStats.percent : "Н/Д",
            passed
          ].join(","));
        }
        
        const csv = csvRows.join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `студенти_${new Date().toISOString().split("T")[0]}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    }
  }

  function renderAdminUnauthorized() {
    elApp.innerHTML = `
      <div class="card">
        <h2 class="section-title">Доступ заборонено</h2>
        <div class="notice notice--danger">
          Для перегляду цієї сторінки потрібні права адміна.
        </div>
        <div class="btnbar">
          <a class="btn" href="#/кабінет" style="text-decoration:none; display:inline-block;">На кабінет</a>
          <a class="btn btn--primary" href="#/" style="text-decoration:none; display:inline-block;">На головну</a>
        </div>
      </div>
    `;
  }

  function render() {
    const db = loadDB();
    const user = getSessionUser(db);
    console.log('render() route=', currentRoute(), 'user=', user ? user.email : null);
    setNavVisibleByRole(db, user);
    renderUserBadge(db, user);

    const route = currentRoute();
    const r = route.toLowerCase();

    if (!user) {
      if (r === "/кабінет" || r === "/адмін") {
        elApp.innerHTML = `
          <div class="card">
            <h2 class="section-title">Потрібен вхід</h2>
            <div class="notice notice--danger">Увійдіть, щоб переглянути сторінку.</div>
            <div class="btnbar" style="margin-top:12px;">
              <a class="btn btn--primary" href="#/вхід" style="text-decoration:none; display:inline-block;">Вхід</a>
              <a class="btn" href="#/реєстрація" style="text-decoration:none; display:inline-block;">Реєстрація</a>
            </div>
          </div>
        `;
        return;
      }
    }

    if (r === "/" || r === "") return renderLanding(db, user);
    if (r === "/вхід") return renderAuthCard("login", db);
    if (r === "/реєстрація") return renderAuthCard("register", db);
    if (r === "/кабінет") {
      if (!user) return;
      return renderStudentCabinet(db, user);
    }
    if (r === "/адмін") {
      if (!user) return;
      if (user.role !== "admin") return renderAdminUnauthorized();
      return renderAdminPanel(db, user);
    }

    // Fallback
    return renderLanding(db, user);
  }

  window.addEventListener("hashchange", () => render());
  // Initial render
  render();

  // Лог помилок у консоль, щоб було видно причину “не працює кнопка”.
  window.addEventListener("error", (e) => {
    // eslint-disable-next-line no-console
    console.error("JS помилка:", e?.message, e?.error);
  });
})();

