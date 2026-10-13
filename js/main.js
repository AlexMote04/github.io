/* alexmote04.github.io: small progressive enhancements. The page works without JS. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- Mobile menu ---------- */
  const menuBtn = document.querySelector(".menu-btn");
  const nav = document.getElementById("site-nav");
  if (menuBtn && nav) {
    const setOpen = (open) => {
      menuBtn.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    };
    menuBtn.addEventListener("click", () => setOpen(menuBtn.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); menuBtn.focus(); }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".site-header")) setOpen(false);
    });
  }

  /* ---------- About carousel (Education / Objectives / Interests) ---------- */
  const about = document.querySelector(".about");
  if (about) {
    const track = about.querySelector(".about__track");
    const tabs = [...about.querySelectorAll(".tab")];
    const slides = [...about.querySelectorAll(".slide")];
    const bar = about.querySelector(".about__bar");
    const pos = about.querySelector("[data-pos]");
    let current = 0;

    const mark = (i) => {
      current = i;
      tabs.forEach((t) => t.removeAttribute("aria-current"));
      tabs[i].setAttribute("aria-current", "true");
      if (pos) pos.textContent = String(i + 1);
      // keep the active tab visible when the tab bar overflows (narrow screens)
      bar.scrollLeft = tabs[i].offsetLeft - 8;
    };
    const go = (i) => {
      i = (i + slides.length) % slides.length;
      track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion.matches ? "auto" : "smooth" });
      mark(i);
    };

    tabs.forEach((t, i) => t.addEventListener("click", () => go(i)));
    about.querySelectorAll("[data-step]").forEach((b) =>
      b.addEventListener("click", () => go(current + Number(b.dataset.step)))
    );
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(current + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1); }
    });

    // follow swipes / trackpad scrolls
    let ticking = false;
    track.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== current && i >= 0 && i < slides.length) mark(i);
      });
    }, { passive: true });
  }

  /* ---------- Project index: highlight the record in view ---------- */
  const indexLinks = [...document.querySelectorAll(".index__row")];
  if (indexLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(indexLinks.map((a) => [a.hash.slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        indexLinks.forEach((a) => a.removeAttribute("aria-current"));
        byId.get(entry.target.id)?.setAttribute("aria-current", "true");
      }
    }, { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll(".record").forEach((r) => io.observe(r));
  }

  /* ---------- Copy email ---------- */
  const toast = document.querySelector(".toast");
  let toastTimer;
  const say = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };
  document.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Copied";
        say("Email address copied to clipboard");
        setTimeout(() => (btn.textContent = "Copy"), 2200);
      } catch {
        say("Couldn’t copy. Select the address and copy it manually.");
      }
    })
  );

  /* ---------- Backdrop: a 2D LiDAR sweeping an unseen room ----------
     Obstacles are invisible; only the scan returns are drawn, so the map
     builds up and fades as the sensor drifts around the viewport. */
  const canvas = document.querySelector(".backdrop");
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;

  const CYAN = "95,212,255";
  const FADE_MS = 9000;           // how long a return stays visible
  const SWEEP_PERIOD_MS = 3800;   // one revolution
  const RAY_STEP = Math.PI / 360; // 0.5° between rays
  const MAX_POINTS = 2400;
  const LEVELS = 10;
  const STYLES = Array.from({ length: LEVELS + 1 }, (_, b) => `rgba(${CYAN},${((0.85 * b) / LEVELS).toFixed(2)})`);

  let W = 0, H = 0, dpr = 1;
  let segs = [];                  // [x1, y1, x2, y2]
  let grid = null;                // pre-rendered grid layer
  let pts = new Float32Array(MAX_POINTS * 3), head = 0, count = 0;
  let angle = 0, last = 0, start = 0, raf = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  // sensor drives a slow closed figure-of-eight around the viewport
  const LOOP_MS = 120000;
  const sensorAt = (t) => {
    const w = (2 * Math.PI * t) / LOOP_MS;
    return [W * (0.5 + 0.3 * Math.sin(w)), H * (0.5 + 0.25 * Math.sin(2 * w + 0.6))];
  };

  const nearPath = (x, y, margin) => {
    for (let t = 0; t < LOOP_MS; t += 1000) {
      const [px, py] = sensorAt(t);
      if (Math.hypot(px - x, py - y) < margin) return true;
    }
    return false;
  };

  const addPoly = (pts) => {
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  };

  const buildWorld = () => {
    segs = [];
    addPoly([[0, 0], [W, 0], [W, H], [0, H]]); // room walls = viewport edges
    const n = Math.round((W * H) / 55000) + 8;
    let tries = 0;
    while (segs.length < 4 + n * 4 && tries++ < 400) {
      const cx = rand(0, W), cy = rand(0, H);
      const r = rand(18, 70);
      if (nearPath(cx, cy, r + 70)) continue;
      if (Math.random() < 0.35) {
        // round obstacle (pillar / bin), as a polygon
        const k = 12, poly = [];
        for (let i = 0; i < k; i++) poly.push([cx + r * Math.cos((i / k) * 2 * Math.PI), cy + r * Math.sin((i / k) * 2 * Math.PI)]);
        addPoly(poly);
      } else {
        // rotated box (crate / desk)
        const w = rand(20, 120), h = rand(14, 60), th = rand(0, Math.PI);
        const c = Math.cos(th), s = Math.sin(th);
        addPoly([[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [cx + (x * c - y * s) / 2, cy + (x * s + y * c) / 2]));
      }
    }
  };

  const buildGrid = () => {
    grid = document.createElement("canvas");
    grid.width = W * dpr; grid.height = H * dpr;
    const g = grid.getContext("2d");
    g.scale(dpr, dpr);
    g.strokeStyle = "rgba(120,160,220,0.045)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0.5; x < W; x += 48) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0.5; y < H; y += 48) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
  };

  // nearest ray/segment intersection distance
  const cast = (ox, oy, dx, dy) => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const [x1, y1, x2, y2] = segs[i];
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const fx = x1 - ox, fy = y1 - oy;
      const t = (fx * ey - fy * ex) / den;
      const u = (fx * dy - fy * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
  };

  const record = (x, y, t) => {
    pts[head * 3] = x; pts[head * 3 + 1] = y; pts[head * 3 + 2] = t;
    head = (head + 1) % MAX_POINTS;
    if (count < MAX_POINTS) count++;
  };

  const scan = (ox, oy, a0, a1, t) => {
    for (let a = a0; a < a1; a += RAY_STEP) {
      const dx = Math.cos(a), dy = Math.sin(a);
      const d = cast(ox, oy, dx, dy);
      if (d < Infinity) record(ox + dx * d + rand(-0.8, 0.8), oy + dy * d + rand(-0.8, 0.8), t);
    }
  };

  const draw = (now, ox, oy, sweep) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(grid, 0, 0, W, H);

    // returns, batched into a few opacity levels
    for (let b = 1; b <= LEVELS; b++) {
      ctx.fillStyle = STYLES[b];
      for (let i = 0; i < count; i++) {
        const life = sweep ? 1 - (now - pts[i * 3 + 2]) / FADE_MS : 0.75;
        if (life > 0 && Math.ceil(life * LEVELS) === b) ctx.fillRect(pts[i * 3] - 1, pts[i * 3 + 1] - 1, 2, 2);
      }
    }

    // sweep wedge + beam
    if (sweep) {
      const tail = 0.5;
      const grad = ctx.createConicGradient
        ? ctx.createConicGradient(angle - tail, ox, oy)
        : null;
      if (grad) {
        grad.addColorStop(0, `rgba(${CYAN},0)`);
        grad.addColorStop(tail / (2 * Math.PI), `rgba(${CYAN},0.07)`);
        grad.addColorStop(tail / (2 * Math.PI) + 0.0001, `rgba(${CYAN},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, Math.hypot(W, H), angle - tail, angle);
        ctx.closePath();
        ctx.fill();
      }
      const d = Math.min(cast(ox, oy, Math.cos(angle), Math.sin(angle)), Math.hypot(W, H));
      ctx.strokeStyle = `rgba(${CYAN},0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(angle) * d, oy + Math.sin(angle) * d);
      ctx.stroke();
    }

    // the sensor itself
    ctx.fillStyle = "rgba(74,158,255,0.9)";
    ctx.beginPath(); ctx.arc(ox, oy, 3, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "rgba(74,158,255,0.35)";
    ctx.beginPath(); ctx.arc(ox, oy, 9, 0, 2 * Math.PI); ctx.stroke();
  };

  const frame = (now) => {
    const t = now - start;
    const dt = Math.min(now - last, 64);
    last = now;
    const [ox, oy] = sensorAt(t);
    const next = angle + (dt / SWEEP_PERIOD_MS) * 2 * Math.PI;
    scan(ox, oy, angle, next, now);
    angle = next % (2 * Math.PI);
    draw(now, ox, oy, true);
    raf = requestAnimationFrame(frame);
  };

  const renderStatic = () => {
    // reduced motion: one full revolution from a fixed point, no animation
    cancelAnimationFrame(raf);
    count = 0; head = 0;
    const [ox, oy] = sensorAt(0);
    scan(ox, oy, 0, 2 * Math.PI, 0);
    draw(0, ox, oy, false);
  };

  const run = () => {
    cancelAnimationFrame(raf);
    if (reduceMotion.matches) { renderStatic(); return; }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const setup = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    count = 0; head = 0;
    buildWorld();
    buildGrid();
    run();
    canvas.classList.add("is-ready");
  };

  start = performance.now();
  setup();

  // rebuild on real resizes (ignore mobile URL-bar height jitter)
  let resizeTimer, lastW = W, lastH = H;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth !== lastW || Math.abs(window.innerHeight - lastH) > 140) {
        lastW = window.innerWidth; lastH = window.innerHeight;
        setup();
      }
    }, 200);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else run();
  });
  reduceMotion.addEventListener?.("change", run);
})();
