(function () {
    const socket = io('https://rekserver-production.up.railway.app');

    const statusBadge = document.getElementById('status');
    const complaintList = document.getElementById('complaintList');
    const statsEls = {
        total: document.getElementById('statTotal'),
        pending: document.getElementById('statPending'),
        resolved: document.getElementById('statResolved'),
        rejected: document.getElementById('statRejected'),
        critical: document.getElementById('statCritical'),
        avg: document.getElementById('statAvg'),
    };
    const categoryBars = document.getElementById('categoryBars');
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const filterToggle = document.getElementById('filterToggle');
    const filterPanel = document.getElementById('filterPanel');
    const categoryBoxes = document.querySelectorAll('#categories input[type="checkbox"]');
    const severityBoxes = document.querySelectorAll('#severityFilters input[type="checkbox"]');

    // ---------- state ----------
    const complaints = new Map();   // id -> normalized complaint
    const order = [];               // ids, oldest -> newest (arrival order)
    const expandedIds = new Set();  // ids with details panel open
    let historyLoaded = false;

    // ---------- helpers ----------
    function esc(str) {
        return String(str ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function getId(raw) { return raw.trackingid || raw.trackingId; }

    function normalize(raw) {
        const category = Array.isArray(raw.category)
            ? raw.category.filter(Boolean)
            : (raw.category ? [raw.category] : []);
        return {
            name: raw.name,
            isAnonymous: !!raw.isAnonymous,
            status: raw.status || 'Pending',
            date: raw.date,
            reason: raw.reason,
            category,
            studentId: raw.studentId || raw.studentID || 'N/A',
            email: raw.email,
            contactNumber: raw.contactNumber,
            text: raw.text,
            section: raw.section,
            score: Number(raw.score) || 0,
            imageUrl: raw.imageUrl || raw.image_url || null,
        };
    }

    function getSeverityLevel(score) {
        if (score >= 75) return 'critical';
        if (score >= 50) return 'high';
        if (score >= 25) return 'medium';
        return 'low';
    }

    function getCheckedValues(nodeList) {
        return Array.from(nodeList).filter(b => b.checked).map(b => b.value);
    }

    // ---------- stats ----------
    function computeStats() {
        let total = 0, pending = 0, resolved = 0, rejected = 0, critical = 0, scoreSum = 0;
        const catCounts = {};
        for (const c of complaints.values()) {
            total++;
            if (c.status === 'Pending') pending++;
            else if (c.status === 'Resolved') resolved++;
            else if (c.status === 'Rejected') rejected++;
            scoreSum += c.score;
            if (c.score >= 75) critical++;
            c.category.forEach(cat => { catCounts[cat] = (catCounts[cat] || 0) + 1; });
        }
        return { total, pending, resolved, rejected, critical, avg: total ? Math.round(scoreSum / total) : 0, catCounts };
    }

    function renderStats() {
        const s = computeStats();
        statsEls.total.textContent = s.total;
        statsEls.pending.textContent = s.pending;
        statsEls.resolved.textContent = s.resolved;
        statsEls.rejected.textContent = s.rejected;
        statsEls.critical.textContent = s.critical;
        statsEls.avg.textContent = s.avg;

        const entries = Object.entries(s.catCounts).sort((a, b) => b[1] - a[1]);
        if (!entries.length) {
            categoryBars.innerHTML = '<div class="bars-empty">No cases yet.</div>';
            return;
        }
        const max = entries[0][1];
        categoryBars.innerHTML = entries.map(([cat, count]) => `
      <div class="bar-row">
        <span class="bar-label">${esc(cat)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / max * 100).toFixed(0)}%"></div></div>
        <span class="bar-count">${count}</span>
      </div>
    `).join('');
    }

    // ---------- card rendering ----------
    function buildCardElement(c, id) {
        const level = getSeverityLevel(c.score);
        const statusClass = (c.status || 'Pending').toLowerCase();
        const catAttr = c.category.map(x => x.trim()).join('|');
        const expanded = expandedIds.has(id);

        const el = document.createElement('article');
        el.className = `complaint-card severity-${level}`;
        el.dataset.id = id;
        el.dataset.category = catAttr;

        el.innerHTML = `
      <span class="stamp stamp-${level}">${level}</span>
      <div class="card-head">
        <div class="who">
          <span class="avatar">${c.isAnonymous ? '🕶️' : '👤'}</span>
          <div>
            <p class="name">${c.isAnonymous ? 'Anonymous Student' : esc(c.name || 'Unknown')}</p>
            <p class="meta">${esc(id)} · ${esc(c.section || 'N/A')}</p>
          </div>
        </div>
        <span class="status-dot ${statusClass}" title="${esc(c.status)}"></span>
      </div>

      <div class="status-control" role="radiogroup" aria-label="Case status">
        <label class="seg"><input type="radio" name="status-${esc(id)}" value="Pending" ${c.status === 'Pending' ? 'checked' : ''}> Pending</label>
        <label class="seg"><input type="radio" name="status-${esc(id)}" value="Resolved" ${c.status === 'Resolved' ? 'checked' : ''}> Resolved</label>
        <label class="seg"><input type="radio" name="status-${esc(id)}" value="Rejected" ${c.status === 'Rejected' ? 'checked' : ''}> Rejected</label>
      </div>

      <p class="reason"><strong>Reason:</strong> ${esc(c.reason || 'N/A')}</p>
      <p class="category-line"><strong>Category:</strong> ${c.category.length ? esc(c.category.join(', ')) : 'N/A'}</p>

      ${c.imageUrl ? `<img class="card-thumb" src="${esc(c.imageUrl)}" alt="Attached photo for complaint ${esc(id)}" loading="lazy">` : ''}

      <button class="toggle-details" aria-expanded="${expanded}">${expanded ? 'Hide details' : 'View details'}</button>
      <div class="details" ${expanded ? '' : 'hidden'}>
        <dl>
          <dt>Student ID</dt><dd>${esc(c.studentId)}</dd>
          <dt>Email</dt><dd>${esc(c.email || 'N/A')}</dd>
          <dt>Contact</dt><dd>${esc(c.contactNumber || 'N/A')}</dd>
          <dt>Date filed</dt><dd>${esc(c.date || 'N/A')}</dd>
        </dl>
        <p class="narrative">${c.text ? esc(c.text) : '<em>No written details provided.</em>'}</p>
      </div>

      <div class="card-foot">
        <span class="score">Severity ${c.score}</span>
        <button class="delete-btn" aria-label="Delete complaint ${esc(id)}" data-id="${esc(id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </div>
    `;
        return el;
    }

    function getVisibleIds() {
        let ids = [...order];
        const q = searchInput.value.trim().toLowerCase();
        const activeCats = getCheckedValues(categoryBoxes);
        const activeSevs = getCheckedValues(severityBoxes);

        ids = ids.filter(id => {
            const c = complaints.get(id);
            if (!c) return false;
            if (q) {
                const hay = `${c.name || ''} ${id} ${c.studentId || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            if (activeCats.length && !c.category.some(cat => activeCats.includes(cat))) return false;
            if (activeSevs.length && !activeSevs.includes(getSeverityLevel(c.score))) return false;
            return true;
        });

        if (sortSelect.value === 'severity') {
            ids.sort((a, b) => complaints.get(b).score - complaints.get(a).score);
        } else {
            ids.reverse(); // newest first
        }
        return ids;
    }

    function renderList() {
        const ids = getVisibleIds();
        complaintList.innerHTML = '';
        if (!order.length) {
            complaintList.innerHTML = '<div class="no-data">No complaints received yet. New cases will appear here in real time.</div>';
            return;
        }
        if (!ids.length) {
            complaintList.innerHTML = '<div class="no-data">No cases match your filters.</div>';
            return;
        }
        const frag = document.createDocumentFragment();
        ids.forEach(id => frag.appendChild(buildCardElement(complaints.get(id), id)));
        complaintList.appendChild(frag);
        maybeScrollToHash();
    }

    function renderAll() {
        renderStats();
        renderList();
    }

    function maybeScrollToHash() {
        if (!historyLoaded) return;
        const hash = window.location.hash;
        if (!hash) return;
        const target = document.querySelector(hash);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('highlight');
        setTimeout(() => target.classList.remove('highlight'), 4000);
    }

    // ---------- socket events ----------
    socket.on('connect', () => {
        statusBadge.textContent = '🟢 Connected (Live)';
        statusBadge.className = 'status-badge connected';
    });

    socket.on('disconnect', () => {
        statusBadge.textContent = '🔴 Disconnected';
        statusBadge.className = 'status-badge';
    });

    socket.on('complaintHistory', (historyArray) => {
        complaints.clear();
        order.length = 0;
        (historyArray || []).forEach(raw => {
            const id = getId(raw);
            if (!id) return;
            complaints.set(id, normalize(raw));
            order.push(id);
        });
        historyLoaded = true;
        renderAll();
    });

    socket.on('newComplaint', (raw) => {
        const id = getId(raw);
        if (!id) return;
        complaints.set(id, normalize(raw));
        if (!order.includes(id)) order.push(id);
        renderAll();
    });

    socket.on('statusUpdated', ({ trackingId, status }) => {
        const c = complaints.get(trackingId);
        if (!c) return;
        c.status = status;
        renderAll();
    });

    socket.on('cardDeleted', ({ trackingId }) => {
        complaints.delete(trackingId);
        const idx = order.indexOf(trackingId);
        if (idx > -1) order.splice(idx, 1);
        expandedIds.delete(trackingId);
        renderAll();
    });

    // ---------- image lightbox ----------
    // These elements only exist once you add the matching markup to index.html —
    // until then, this stays null and clicking a photo just opens it in a new tab instead.
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = document.getElementById('lightboxClose');
    if (lightbox && lightboxClose) {
        lightboxClose.addEventListener('click', () => lightbox.classList.remove('open'));
        lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.remove('open'); });
    }

    // ---------- delegated card interactions ----------
    complaintList.addEventListener('change', (e) => {
        const radio = e.target.closest('input[type="radio"]');
        if (!radio) return;
        const card = radio.closest('.complaint-card');
        const id = card.dataset.id;
        const status = radio.value;
        socket.emit('updateStatus', { trackingId: id, status });
        const c = complaints.get(id);
        if (c) { c.status = status; renderStats(); }
        const dot = card.querySelector('.status-dot');
        dot.className = `status-dot ${status.toLowerCase()}`;
        dot.title = status;
    });

    complaintList.addEventListener('click', (e) => {
        const thumb = e.target.closest('.card-thumb');
        if (thumb) {
            if (lightbox && lightboxImg) {
                lightboxImg.src = thumb.src;
                lightboxImg.alt = thumb.alt;
                lightbox.classList.add('open');
            } else {
                window.open(thumb.src, '_blank');
            }
            return;
        }
        const delBtn = e.target.closest('.delete-btn');
        if (delBtn) {
            const id = delBtn.dataset.id;
            if (window.confirm('Delete this complaint record? This cannot be undone.')) {
                socket.emit('deleteComplaint', { trackingId: id });
            }
            return;
        }
        const toggleBtn = e.target.closest('.toggle-details');
        if (toggleBtn) {
            const card = toggleBtn.closest('.complaint-card');
            const id = card.dataset.id;
            const details = card.querySelector('.details');
            const isHidden = details.hasAttribute('hidden');
            if (isHidden) {
                details.removeAttribute('hidden');
                expandedIds.add(id);
                toggleBtn.setAttribute('aria-expanded', 'true');
                toggleBtn.textContent = 'Hide details';
            } else {
                details.setAttribute('hidden', '');
                expandedIds.delete(id);
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.textContent = 'View details';
            }
        }
    });

    // ---------- filter controls ----------
    searchInput.addEventListener('input', renderList);
    sortSelect.addEventListener('change', renderList);
    categoryBoxes.forEach(box => box.addEventListener('change', renderList));
    severityBoxes.forEach(box => box.addEventListener('change', renderList));

    clearFiltersBtn.addEventListener('click', () => {
        searchInput.value = '';
        categoryBoxes.forEach(b => b.checked = false);
        severityBoxes.forEach(b => b.checked = false);
        sortSelect.value = 'newest';
        renderList();
    });

    filterToggle.addEventListener('click', () => {
        const open = filterPanel.classList.toggle('open');
        filterToggle.setAttribute('aria-expanded', String(open));
    });

    window.addEventListener('hashchange', maybeScrollToHash);
})();
