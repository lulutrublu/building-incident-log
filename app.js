(function () {
  'use strict';

  const STORAGE_KEY = 'buildingIncidentLog';

  const INCIDENT_TYPES = [
    { id: 'smoking', label: 'Smoking' },
    { id: 'fighting', label: 'Fighting / Domestic Disturbance' },
    { id: 'loud-media', label: 'Loud TV or Music' },
    { id: 'door-buzzing', label: 'Late Night Door Buzzing' },
    { id: 'stairwell', label: 'Shared Stairwell Noise' },
  ];

  function formatHourShort(hour) {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }

  function formatHourRange(hour) {
    const end = (hour + 1) % 24;
    return `${formatHourShort(hour)} – ${formatHourShort(end)}`;
  }

  const HOUR_BLOCKS = Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: formatHourShort(hour),
    rangeLabel: formatHourRange(hour),
  }));

  const LATE_NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5, 6]);

  const SEVERITY_LABELS = {
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    severe: 'Severe',
  };

  const IMPACT_OPTIONS = [
    { id: 'sleep', label: 'Sleep disruption' },
    { id: 'stress', label: 'Stress / anxiety' },
    { id: 'safety', label: 'Safety concern' },
    { id: 'property', label: 'Property disturbance' },
    { id: 'daily', label: 'Interference with daily life' },
    { id: 'business', label: 'Interrupted business activities' },
    { id: 'none', label: 'Minimal / none observed' },
    { id: 'other', label: 'Other' },
  ];

  const IMPACT_LABELS = Object.fromEntries(
    IMPACT_OPTIONS.map((option) => [option.id, option.label])
  );

  const EVIDENCE_LABELS = {
    photo: 'Photograph',
    video: 'Video recording',
    audio: 'Audio recording',
    witness: 'Written witness statement',
    official: 'Official correspondence',
    other: 'Other',
  };

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let incidents = [];
  let complaints = [];
  let currentWeekStart = getWeekStart(new Date());
  let editingId = null;
  let editingComplaintId = null;
  let supabase = null;
  let cloudEnabled = false;
  let appInitialized = false;
  let saveInFlight = null;
  let authEventsBound = false;

  const els = {
    weekRange: document.getElementById('weekRange'),
    prevWeek: document.getElementById('prevWeek'),
    nextWeek: document.getElementById('nextWeek'),
    todayWeek: document.getElementById('todayWeek'),
    hourHeaderRow: document.getElementById('hourHeaderRow'),
    gridBody: document.getElementById('gridBody'),
    complaintList: document.getElementById('complaintList'),
    complaintEmpty: document.getElementById('complaintEmpty'),
    logComplaint: document.getElementById('logComplaint'),
    incidentList: document.getElementById('incidentList'),
    emptyState: document.getElementById('emptyState'),
    incidentCount: document.getElementById('incidentCount'),
    saveStatus: document.getElementById('saveStatus'),
    exportPdf: document.getElementById('exportPdf'),
    exportCsv: document.getElementById('exportCsv'),
    exportBackup: document.getElementById('exportBackup'),
    importBackup: document.getElementById('importBackup'),
    importFile: document.getElementById('importFile'),
    printReport: document.getElementById('printReport'),
    filterType: document.getElementById('filterType'),
    filterSeverity: document.getElementById('filterSeverity'),
    filterDateFrom: document.getElementById('filterDateFrom'),
    filterDateTo: document.getElementById('filterDateTo'),
    filterLateNight: document.getElementById('filterLateNight'),
    filterDisclosed: document.getElementById('filterDisclosed'),
    clearFilters: document.getElementById('clearFilters'),
    modal: document.getElementById('incidentModal'),
    form: document.getElementById('incidentForm'),
    modalTitle: document.getElementById('modalTitle'),
    closeModal: document.getElementById('closeModal'),
    cancelModal: document.getElementById('cancelModal'),
    deleteIncident: document.getElementById('deleteIncident'),
    formDate: document.getElementById('formDate'),
    formHour: document.getElementById('formHour'),
    formType: document.getElementById('formType'),
    formSeverity: document.getElementById('formSeverity'),
    formNotes: document.getElementById('formNotes'),
    formEvidence: document.getElementById('formEvidence'),
    formEvidenceType: document.getElementById('formEvidenceType'),
    evidenceTypeGroup: document.getElementById('evidenceTypeGroup'),
    formImpactGroup: document.getElementById('formImpactGroup'),
    complaintModal: document.getElementById('complaintModal'),
    complaintForm: document.getElementById('complaintForm'),
    complaintModalTitle: document.getElementById('complaintModalTitle'),
    closeComplaintModal: document.getElementById('closeComplaintModal'),
    cancelComplaintModal: document.getElementById('cancelComplaintModal'),
    deleteComplaint: document.getElementById('deleteComplaint'),
    formComplaintDate: document.getElementById('formComplaintDate'),
    formCoversFrom: document.getElementById('formCoversFrom'),
    formCoversThrough: document.getElementById('formCoversThrough'),
    formComplaintNotes: document.getElementById('formComplaintNotes'),
    authScreen: document.getElementById('authScreen'),
    appShell: document.getElementById('appShell'),
    authForm: document.getElementById('authForm'),
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    authError: document.getElementById('authError'),
    authSignUp: document.getElementById('authSignUp'),
    signOut: document.getElementById('signOut'),
  };

  function initSupabaseClient() {
    const config = window.SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey || !window.supabase) return null;
    return window.supabase.createClient(config.url, config.anonKey);
  }

  function showAuthScreen() {
    els.appShell.hidden = true;
    els.authScreen.hidden = false;
  }

  function showAppShell() {
    els.authScreen.hidden = true;
    els.appShell.hidden = false;
  }

  function setAuthError(message) {
    if (!message) {
      els.authError.hidden = true;
      els.authError.textContent = '';
      return;
    }
    els.authError.hidden = false;
    els.authError.textContent = message;
  }

  function incidentToRow(incident) {
    return {
      id: incident.id,
      date: incident.date,
      hour: incident.hour,
      type: incident.type,
      severity: incident.severity,
      notes: incident.notes || '',
      has_evidence: Boolean(incident.hasEvidence),
      evidence_type: incident.evidenceType || '',
      impact: normalizeImpacts(incident.impact),
      created_at: incident.createdAt || null,
      updated_at: incident.updatedAt || new Date().toISOString(),
    };
  }

  function rowToIncident(row) {
    return {
      id: row.id,
      date: row.date,
      hour: row.hour,
      type: row.type,
      severity: row.severity,
      notes: row.notes || '',
      hasEvidence: Boolean(row.has_evidence),
      evidenceType: row.evidence_type || '',
      impact: normalizeImpacts(row.impact),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  function complaintToRow(complaint) {
    const normalized = normalizeComplaint(complaint);
    return {
      id: normalized.id,
      date_submitted: normalized.dateSubmitted,
      covers_from_date: normalized.coversFromDate,
      covers_through_date: normalized.coversThroughDate,
      notes: normalized.notes || '',
      created_at: normalized.createdAt || null,
      updated_at: normalized.updatedAt || new Date().toISOString(),
    };
  }

  function rowToComplaint(row) {
    return normalizeComplaint({
      id: row.id,
      dateSubmitted: row.date_submitted,
      coversFromDate: row.covers_from_date,
      coversThroughDate: row.covers_through_date,
      notes: row.notes || '',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    });
  }

  function loadDataLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        incidents = [];
        complaints = [];
        return;
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        incidents = parsed.map((incident) => ({
          ...stripIncidentLandlordFields(incident),
          impact: normalizeImpacts(incident.impact),
        }));
        complaints = migrateLandlordFieldsToComplaints(parsed).map(normalizeComplaint);
        return;
      }

      incidents = (parsed.incidents || []).map((incident) => ({
        ...stripIncidentLandlordFields(incident),
        impact: normalizeImpacts(incident.impact),
      }));
      complaints = (parsed.complaints || []).map(normalizeComplaint);

      const hasLegacyFields = (parsed.incidents || []).some(
        (inc) => inc.landlordComplaintSubmitted
      );
      if (hasLegacyFields) {
        const migrated = migrateLandlordFieldsToComplaints(parsed.incidents);
        const existingDates = new Set(complaints.map((c) => c.dateSubmitted));
        migrated.forEach((complaint) => {
          if (!existingDates.has(complaint.dateSubmitted)) {
            complaints.push(normalizeComplaint(complaint));
          }
        });
      }
    } catch {
      incidents = [];
      complaints = [];
    }
  }

  function saveDataLocal() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        incidents,
        complaints,
      })
    );
  }

  async function syncAllToCloud() {
    if (!cloudEnabled || !supabase) return;

    const incidentRows = incidents.map(incidentToRow);
    if (incidentRows.length) {
      const { error } = await supabase.from('incidents').upsert(incidentRows, { onConflict: 'id' });
      if (error) throw error;
    }

    const { data: serverIncidents, error: fetchIncError } = await supabase
      .from('incidents')
      .select('id');
    if (fetchIncError) throw fetchIncError;

    const localIncidentIds = new Set(incidents.map((inc) => inc.id));
    const incidentIdsToDelete = (serverIncidents || [])
      .map((row) => row.id)
      .filter((id) => !localIncidentIds.has(id));
    if (incidentIdsToDelete.length) {
      const { error: deleteIncError } = await supabase
        .from('incidents')
        .delete()
        .in('id', incidentIdsToDelete);
      if (deleteIncError) throw deleteIncError;
    }

    const complaintRows = complaints.map(complaintToRow);
    if (complaintRows.length) {
      const { error: complaintError } = await supabase
        .from('complaints')
        .upsert(complaintRows, { onConflict: 'id' });
      if (complaintError) throw complaintError;
    }

    const { data: serverComplaints, error: fetchCompError } = await supabase
      .from('complaints')
      .select('id');
    if (fetchCompError) throw fetchCompError;

    const localComplaintIds = new Set(complaints.map((c) => c.id));
    const complaintIdsToDelete = (serverComplaints || [])
      .map((row) => row.id)
      .filter((id) => !localComplaintIds.has(id));
    if (complaintIdsToDelete.length) {
      const { error: deleteCompError } = await supabase
        .from('complaints')
        .delete()
        .in('id', complaintIdsToDelete);
      if (deleteCompError) throw deleteCompError;
    }
  }

  async function loadDataFromCloud() {
    if (!cloudEnabled || !supabase) {
      loadDataLocal();
      return;
    }

    const [{ data: incidentRows, error: incError }, { data: complaintRows, error: compError }] =
      await Promise.all([
        supabase.from('incidents').select('*'),
        supabase.from('complaints').select('*'),
      ]);

    if (incError) {
      throw new Error(
        incError.message.includes('does not exist')
          ? 'Database tables are missing. Run supabase-setup.sql in your Supabase SQL Editor.'
          : incError.message
      );
    }
    if (compError) throw compError;

    const cloudEmpty = !incidentRows?.length && !complaintRows?.length;
    if (cloudEmpty) {
      loadDataLocal();
      if (incidents.length || complaints.length) {
        await syncAllToCloud();
      }
      saveDataLocal();
      return;
    }

    incidents = (incidentRows || []).map(rowToIncident);
    complaints = (complaintRows || []).map(rowToComplaint);
    saveDataLocal();
  }

  async function saveData() {
    saveDataLocal();

    if (!cloudEnabled || !supabase) {
      updateSaveStatus('local');
      return;
    }

    updateSaveStatus('syncing');

    const syncPromise = (async () => {
      await syncAllToCloud();
      updateSaveStatus('cloud');
    })();

    saveInFlight = syncPromise;

    try {
      await syncPromise;
    } catch (error) {
      console.error(error);
      updateSaveStatus('error');
      window.alert(
        'Saved locally, but cloud sync failed. Check your connection and try again.'
      );
    } finally {
      if (saveInFlight === syncPromise) {
        saveInFlight = null;
      }
    }
  }

  function normalizeComplaint(complaint) {
    const coversThroughDate = complaint.coversThroughDate || complaint.dateSubmitted;
    let coversFromDate = complaint.coversFromDate;

    if (!coversFromDate) {
      coversFromDate = incidents.length
        ? incidents.reduce(
            (earliest, inc) => (inc.date < earliest ? inc.date : earliest),
            incidents[0].date
          )
        : coversThroughDate;
    }

    if (coversFromDate > coversThroughDate) {
      coversFromDate = coversThroughDate;
    }

    return {
      ...complaint,
      coversFromDate,
      coversThroughDate,
    };
  }

  function isIncidentInComplaintRange(incident, complaint) {
    const normalized = normalizeComplaint(complaint);
    return (
      incident.date >= normalized.coversFromDate &&
      incident.date <= normalized.coversThroughDate
    );
  }

  function formatCoverageRange(complaint) {
    const { coversFromDate, coversThroughDate } = normalizeComplaint(complaint);
    if (coversFromDate === coversThroughDate) {
      return `Covers incidents on ${formatDisplayDate(coversFromDate)}`;
    }
    return `Covers incidents from ${formatDisplayDate(coversFromDate)} through ${formatDisplayDate(coversThroughDate)}`;
  }

  function normalizeImpacts(impact) {
    if (Array.isArray(impact)) return impact.filter(Boolean);
    if (typeof impact === 'string' && impact) return [impact];
    return [];
  }

  function stripIncidentLandlordFields(incident) {
    const {
      landlordComplaintSubmitted,
      landlordComplaintDate,
      landlordComplaintNotes,
      ...rest
    } = incident;
    return rest;
  }

  function migrateLandlordFieldsToComplaints(incidentList) {
    const byDate = new Map();

    incidentList.forEach((inc) => {
      if (!inc.landlordComplaintSubmitted || !inc.landlordComplaintDate) return;

      const key = inc.landlordComplaintDate;
      if (!byDate.has(key)) {
        byDate.set(key, { notes: '', minIncidentDate: inc.date, maxIncidentDate: inc.date });
      }

      const entry = byDate.get(key);
      if (inc.landlordComplaintNotes && !entry.notes) {
        entry.notes = inc.landlordComplaintNotes;
      }
      if (inc.date < entry.minIncidentDate) {
        entry.minIncidentDate = inc.date;
      }
      if (inc.date > entry.maxIncidentDate) {
        entry.maxIncidentDate = inc.date;
      }
    });

    const migrated = [];
    byDate.forEach((entry, dateSubmitted) => {
      migrated.push({
        id: crypto.randomUUID(),
        dateSubmitted,
        coversFromDate: entry.minIncidentDate,
        coversThroughDate: entry.maxIncidentDate,
        notes: entry.notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    return migrated.sort((a, b) => a.dateSubmitted.localeCompare(b.dateSubmitted));
  }

  function formatImpactList(impact) {
    const impacts = normalizeImpacts(impact);
    if (!impacts.length) return 'None recorded';
    return impacts.map((id) => IMPACT_LABELS[id] || id).join('; ');
  }

  function getSelectedImpacts() {
    return [...els.formImpactGroup.querySelectorAll('input[type="checkbox"]:checked')].map(
      (input) => input.value
    );
  }

  function setSelectedImpacts(impact) {
    const impacts = normalizeImpacts(impact);
    els.formImpactGroup.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = impacts.includes(input.value);
    });
  }

  function buildImpactOptions() {
    els.formImpactGroup.innerHTML = '';
    IMPACT_OPTIONS.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'impact-option';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'impact';
      input.value = option.id;

      label.appendChild(input);
      label.appendChild(document.createTextNode(option.label));
      els.formImpactGroup.appendChild(label);
    });
  }

  function getWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }

  function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDateISO(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDisplayDate(dateStr) {
    const d = parseDateISO(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function getWeekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  function formatWeekRange(weekStart) {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    const startStr = weekStart.toLocaleDateString('en-US', opts);
    const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }

  function getSortedComplaints() {
    return [...complaints].sort((a, b) => b.dateSubmitted.localeCompare(a.dateSubmitted));
  }

  function getComplaintsFiledOnDate(dateStr) {
    return complaints.filter((c) => c.dateSubmitted === dateStr);
  }

  function isIncidentDisclosed(incident) {
    return complaints.some((c) => isIncidentInComplaintRange(incident, c));
  }

  function getDisclosureComplaint(incident) {
    return getSortedComplaints().find((c) => isIncidentInComplaintRange(incident, c)) || null;
  }

  function countIncidentsCovered(complaint) {
    return incidents.filter((inc) => isIncidentInComplaintRange(inc, complaint)).length;
  }

  function findIncidentByCell(dateStr, hour, typeId) {
    return incidents.find(
      (inc) => inc.date === dateStr && inc.hour === hour && inc.type === typeId
    );
  }

  function findIncidentById(id) {
    return incidents.find((inc) => inc.id === id);
  }

  function findComplaintById(id) {
    return complaints.find((c) => c.id === id);
  }

  function updateSaveStatus(mode = 'local') {
    const incidentCount = incidents.length;
    const complaintCount = complaints.length;
    const now = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const parts = [];
    parts.push(
      incidentCount === 0
        ? 'no incidents yet'
        : `${incidentCount} incident${incidentCount === 1 ? '' : 's'}`
    );
    parts.push(
      complaintCount === 0
        ? 'no complaints logged'
        : `${complaintCount} complaint${complaintCount === 1 ? '' : 's'} logged`
    );

    let syncLabel = 'Saved locally';
    if (mode === 'cloud') syncLabel = 'Synced to cloud';
    if (mode === 'syncing') syncLabel = 'Syncing…';
    if (mode === 'error') syncLabel = 'Sync issue — saved locally';

    els.saveStatus.textContent = `${syncLabel} · ${parts.join(' · ')} · ${now}`;
    els.saveStatus.classList.toggle('saved', mode !== 'error');
  }

  function populateSelects() {
    INCIDENT_TYPES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      els.filterType.appendChild(opt.cloneNode(true));
      els.formType.appendChild(opt);
    });

    HOUR_BLOCKS.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h.value;
      opt.textContent = h.rangeLabel;
      els.formHour.appendChild(opt);
    });
  }

  function buildHourHeaders() {
    HOUR_BLOCKS.forEach((h) => {
      const th = document.createElement('th');
      th.className = 'hour-cell';
      th.scope = 'col';
      th.textContent = h.label;
      els.hourHeaderRow.appendChild(th);
    });
  }

  function renderGrid() {
    els.gridBody.innerHTML = '';
    const weekDates = getWeekDates(currentWeekStart);

    weekDates.forEach((date) => {
      const dateStr = formatDateISO(date);
      const dayName = DAY_NAMES[date.getDay()];
      const displayDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const filedComplaints = getComplaintsFiledOnDate(dateStr);

      const dayRow = document.createElement('tr');
      const dayCell = document.createElement('td');
      dayCell.className = 'day-header';
      dayCell.colSpan = 1 + HOUR_BLOCKS.length;
      dayCell.textContent = `${dayName}, ${displayDate}`;

      if (filedComplaints.length) {
        dayCell.classList.add('complaint-filed');
        const label = document.createElement('span');
        label.className = 'complaint-filed-label';
        label.textContent =
          filedComplaints.length === 1
            ? 'Complaint filed'
            : `${filedComplaints.length} complaints filed`;
        dayCell.appendChild(label);
      }

      dayRow.appendChild(dayCell);
      els.gridBody.appendChild(dayRow);

      INCIDENT_TYPES.forEach((type) => {
        const row = document.createElement('tr');

        const labelCell = document.createElement('td');
        labelCell.className = 'type-label';
        labelCell.textContent = type.label;
        row.appendChild(labelCell);

        HOUR_BLOCKS.forEach((hour) => {
          const td = document.createElement('td');
          const incident = findIncidentByCell(dateStr, hour.value, type.id);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cell-button';
          btn.setAttribute('aria-label', `${type.label} on ${dayName} ${hour.label}`);

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'cell-checkbox';
          checkbox.tabIndex = -1;
          checkbox.checked = Boolean(incident);

          if (incident) {
            btn.classList.add('has-incident', `severity-${incident.severity}`);
          }

          btn.appendChild(checkbox);
          btn.addEventListener('click', () => openModal(dateStr, hour.value, type.id, incident));

          td.appendChild(btn);
          row.appendChild(td);
        });

        els.gridBody.appendChild(row);
      });
    });

    els.weekRange.textContent = formatWeekRange(currentWeekStart);
  }

  function renderComplaints() {
    const sorted = getSortedComplaints();
    els.complaintList.innerHTML = '';

    if (!sorted.length) {
      els.complaintEmpty.hidden = false;
      return;
    }

    els.complaintEmpty.hidden = true;

    sorted.forEach((complaint) => {
      const card = document.createElement('article');
      card.className = 'complaint-card';
      card.setAttribute('role', 'listitem');

      const header = document.createElement('div');
      header.className = 'complaint-card-header';

      const date = document.createElement('span');
      date.className = 'complaint-date';
      date.textContent = `Submitted ${formatDisplayDate(complaint.dateSubmitted)}`;

      const count = document.createElement('span');
      count.className = 'badge badge-disclosed';
      const covered = countIncidentsCovered(complaint);
      count.textContent = `${covered} incident${covered === 1 ? '' : 's'} covered`;

      header.appendChild(date);
      header.appendChild(count);

      const coverage = document.createElement('p');
      coverage.className = 'complaint-coverage';
      coverage.textContent = formatCoverageRange(complaint);

      card.appendChild(header);
      card.appendChild(coverage);

      if (complaint.notes) {
        const notes = document.createElement('p');
        notes.className = 'complaint-notes';
        notes.textContent = complaint.notes;
        card.appendChild(notes);
      }

      card.addEventListener('click', () => openComplaintModal(complaint));
      els.complaintList.appendChild(card);
    });
  }

  function getFilteredIncidents() {
    const typeFilter = els.filterType.value;
    const severityFilter = els.filterSeverity.value;
    const fromFilter = els.filterDateFrom.value;
    const toFilter = els.filterDateTo.value;
    const lateNightOnly = els.filterLateNight.checked;
    const disclosedOnly = els.filterDisclosed.checked;

    return incidents
      .filter((inc) => {
        if (typeFilter && inc.type !== typeFilter) return false;
        if (severityFilter && inc.severity !== severityFilter) return false;
        if (fromFilter && inc.date < fromFilter) return false;
        if (toFilter && inc.date > toFilter) return false;
        if (lateNightOnly && !LATE_NIGHT_HOURS.has(inc.hour)) return false;
        if (disclosedOnly && !isIncidentDisclosed(inc)) return false;
        return true;
      })
      .sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return a.hour - b.hour;
      });
  }

  function getTypeLabel(typeId) {
    return INCIDENT_TYPES.find((t) => t.id === typeId)?.label || typeId;
  }

  function getHourLabel(hour) {
    const block = HOUR_BLOCKS.find((h) => h.value === hour);
    return block?.rangeLabel || `${hour}:00`;
  }

  function formatDisclosure(incident) {
    const complaint = getDisclosureComplaint(incident);
    if (!complaint) return 'Not yet disclosed';
    return `Disclosed in complaint filed ${formatDisplayDate(complaint.dateSubmitted)}`;
  }

  function renderList() {
    const filtered = getFilteredIncidents();
    els.incidentList.innerHTML = '';

    const count = filtered.length;
    els.incidentCount.textContent = `${count} incident${count === 1 ? '' : 's'}`;

    if (count === 0) {
      els.emptyState.hidden = false;
      return;
    }

    els.emptyState.hidden = true;

    filtered.forEach((inc) => {
      const card = document.createElement('article');
      card.className = `incident-card severity-${inc.severity}`;
      card.setAttribute('role', 'listitem');

      const header = document.createElement('div');
      header.className = 'incident-card-header';

      const datetime = document.createElement('span');
      datetime.className = 'incident-datetime';
      datetime.textContent = `${formatDisplayDate(inc.date)} · ${getHourLabel(inc.hour)}`;

      const badges = document.createElement('div');
      badges.className = 'incident-badges';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'badge badge-type';
      typeBadge.textContent = getTypeLabel(inc.type);

      const sevBadge = document.createElement('span');
      sevBadge.className = `badge badge-severity severity-${inc.severity}`;
      sevBadge.textContent = SEVERITY_LABELS[inc.severity];

      badges.appendChild(typeBadge);
      badges.appendChild(sevBadge);

      const disclosure = getDisclosureComplaint(inc);
      if (disclosure) {
        const disclosedBadge = document.createElement('span');
        disclosedBadge.className = 'badge badge-disclosed';
        disclosedBadge.textContent = 'Disclosed';
        badges.appendChild(disclosedBadge);
      }

      header.appendChild(datetime);
      header.appendChild(badges);

      const impact = document.createElement('p');
      impact.className = 'incident-detail';
      impact.textContent = `Impact: ${formatImpactList(inc.impact)}`;

      const evidence = document.createElement('p');
      evidence.className = 'incident-detail';
      if (inc.hasEvidence) {
        evidence.textContent = `Evidence: ${EVIDENCE_LABELS[inc.evidenceType] || inc.evidenceType || 'Yes (type not specified)'}`;
      } else {
        evidence.textContent = 'Evidence: None recorded';
      }

      const disclosureLine = document.createElement('p');
      disclosureLine.className = 'incident-detail';
      disclosureLine.textContent = formatDisclosure(inc);

      card.appendChild(header);
      card.appendChild(impact);
      card.appendChild(evidence);
      card.appendChild(disclosureLine);

      if (inc.notes) {
        const notes = document.createElement('p');
        notes.className = 'incident-notes';
        notes.textContent = inc.notes;
        card.appendChild(notes);
      }

      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const match = findIncidentById(inc.id);
        if (match) openModal(match.date, match.hour, match.type, match);
      });

      els.incidentList.appendChild(card);
    });
  }

  function openModal(dateStr, hour, typeId, existing) {
    editingId = existing?.id || null;

    els.modalTitle.textContent = existing ? 'Edit incident' : 'Log incident';
    els.formDate.value = dateStr;
    els.formHour.value = String(hour);
    els.formType.value = typeId;
    els.formSeverity.value = existing?.severity || 'moderate';
    els.formNotes.value = existing?.notes || '';
    els.formEvidence.checked = Boolean(existing?.hasEvidence);
    els.formEvidenceType.value = existing?.evidenceType || '';
    setSelectedImpacts(existing?.impact || ['sleep']);
    els.evidenceTypeGroup.hidden = !els.formEvidence.checked;
    els.deleteIncident.hidden = !existing;

    els.modal.showModal();
  }

  function closeModalDialog() {
    els.modal.close();
    editingId = null;
  }

  function openComplaintModal(existing) {
    editingComplaintId = existing?.id || null;

    els.complaintModalTitle.textContent = existing
      ? 'Edit landlord complaint'
      : 'Log landlord complaint';

    const today = formatDateISO(new Date());
    els.formComplaintDate.value = existing?.dateSubmitted || today;
    if (existing) {
      const normalized = normalizeComplaint(existing);
      els.formCoversFrom.value = normalized.coversFromDate;
      els.formCoversThrough.value = normalized.coversThroughDate;
    } else {
      els.formCoversFrom.value = today;
      els.formCoversThrough.value = today;
    }
    els.formComplaintNotes.value = existing?.notes || '';
    els.deleteComplaint.hidden = !existing;

    els.complaintModal.showModal();
  }

  function closeComplaintModalDialog() {
    els.complaintModal.close();
    editingComplaintId = null;
  }

  async function handleSave(event) {
    event.preventDefault();

    const date = els.formDate.value;
    const hour = Number(els.formHour.value);
    const type = els.formType.value;
    const hasEvidence = els.formEvidence.checked;

    const impact = getSelectedImpacts();
    if (!impact.length) {
      window.alert('Please select at least one impact on tenant.');
      return;
    }

    const data = {
      id: editingId || crypto.randomUUID(),
      date,
      hour,
      type,
      severity: els.formSeverity.value,
      notes: els.formNotes.value.trim(),
      hasEvidence,
      evidenceType: hasEvidence ? els.formEvidenceType.value : '',
      impact,
      updatedAt: new Date().toISOString(),
    };

    if (!data.date || Number.isNaN(data.hour) || !data.type) return;

    const duplicateIdx = incidents.findIndex(
      (inc) =>
        inc.date === data.date &&
        inc.hour === data.hour &&
        inc.type === data.type &&
        inc.id !== data.id
    );

    if (duplicateIdx >= 0) {
      incidents[duplicateIdx] = { ...incidents[duplicateIdx], ...data };
    } else if (editingId) {
      const idx = incidents.findIndex((inc) => inc.id === editingId);
      if (idx >= 0) incidents[idx] = { ...incidents[idx], ...data };
      else incidents.push({ ...data, createdAt: new Date().toISOString() });
    } else {
      incidents.push({ ...data, createdAt: new Date().toISOString() });
    }

    await saveData();
    closeModalDialog();
    renderGrid();
    renderList();
    renderComplaints();
  }

  async function handleComplaintSave(event) {
    event.preventDefault();

    const dateSubmitted = els.formComplaintDate.value;
    const coversFromDate = els.formCoversFrom.value;
    const coversThroughDate = els.formCoversThrough.value;
    const notes = els.formComplaintNotes.value.trim();

    if (!dateSubmitted || !coversFromDate || !coversThroughDate) return;

    if (coversFromDate > coversThroughDate) {
      window.alert('The "from" date cannot be after the "through" date.');
      return;
    }

    const data = {
      id: editingComplaintId || crypto.randomUUID(),
      dateSubmitted,
      coversFromDate,
      coversThroughDate,
      notes,
      updatedAt: new Date().toISOString(),
    };

    if (editingComplaintId) {
      const idx = complaints.findIndex((c) => c.id === editingComplaintId);
      if (idx >= 0) {
        complaints[idx] = { ...complaints[idx], ...data };
      } else {
        complaints.push({ ...data, createdAt: new Date().toISOString() });
      }
    } else {
      complaints.push({ ...data, createdAt: new Date().toISOString() });
    }

    await saveData();
    closeComplaintModalDialog();
    renderGrid();
    renderList();
    renderComplaints();
  }

  async function handleDelete() {
    if (!editingId) return;
    incidents = incidents.filter((inc) => inc.id !== editingId);
    await saveData();
    closeModalDialog();
    renderGrid();
    renderList();
    renderComplaints();
  }

  async function handleComplaintDelete() {
    if (!editingComplaintId) return;
    complaints = complaints.filter((c) => c.id !== editingComplaintId);
    await saveData();
    closeComplaintModalDialog();
    renderGrid();
    renderList();
    renderComplaints();
  }

  function getFilterSummary() {
    const parts = [];
    if (els.filterType.value) parts.push(`Type: ${getTypeLabel(els.filterType.value)}`);
    if (els.filterSeverity.value) parts.push(`Severity: ${SEVERITY_LABELS[els.filterSeverity.value]}`);
    if (els.filterDateFrom.value) parts.push(`From: ${els.filterDateFrom.value}`);
    if (els.filterDateTo.value) parts.push(`To: ${els.filterDateTo.value}`);
    if (els.filterLateNight.checked) parts.push('Late night only (10pm – 7am)');
    if (els.filterDisclosed.checked) parts.push('Disclosed to landlord');
    return parts.length ? parts.join(' · ') : 'All incidents (no filters applied)';
  }

  function buildComplaintsPrintSection() {
    const sorted = [...complaints].sort((a, b) =>
      a.dateSubmitted.localeCompare(b.dateSubmitted)
    );

    if (!sorted.length) {
      return '<p class="print-empty">No landlord complaints logged.</p>';
    }

    const rows = sorted
      .map((complaint) => {
        const covered = countIncidentsCovered(complaint);
        const { coversFromDate, coversThroughDate } = normalizeComplaint(complaint);
        return `<tr>
          <td>${formatDisplayDate(complaint.dateSubmitted)}</td>
          <td>${formatDisplayDate(coversFromDate)}</td>
          <td>${formatDisplayDate(coversThroughDate)}</td>
          <td>${covered}</td>
          <td>${escapeHtml(complaint.notes || '—')}</td>
        </tr>`;
      })
      .join('');

    return `
      <div class="print-complaints-section">
        <h2>Landlord complaint history</h2>
        <table class="print-report-table">
          <thead>
            <tr>
              <th>Date submitted</th>
              <th>Covers from</th>
              <th>Covers through</th>
              <th>Incidents covered</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function buildPrintReport(filtered) {
    const generated = new Date().toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const rows = filtered
      .map((inc) => {
        const d = parseDateISO(inc.date);
        const evidence = inc.hasEvidence
          ? (EVIDENCE_LABELS[inc.evidenceType] || inc.evidenceType || 'Yes')
          : 'None';
        return `<tr>
          <td>${formatDisplayDate(inc.date)}</td>
          <td>${DAY_NAMES[d.getDay()]}</td>
          <td>${getHourLabel(inc.hour)}</td>
          <td>${escapeHtml(getTypeLabel(inc.type))}</td>
          <td>${SEVERITY_LABELS[inc.severity]}</td>
          <td>${escapeHtml(formatImpactList(inc.impact))}</td>
          <td>${escapeHtml(formatDisclosure(inc))}</td>
          <td>${escapeHtml(evidence)}</td>
          <td>${escapeHtml(inc.notes || '—')}</td>
        </tr>`;
      })
      .join('');

    els.printReport.innerHTML = `
      <div class="print-report-header">
        <h1>Building Incident Log — Report</h1>
        <p class="print-report-meta">Generated: ${generated}</p>
        <p class="print-report-meta">Filters: ${escapeHtml(getFilterSummary())}</p>
        <p class="print-report-meta">Total incidents in report: ${filtered.length}</p>
        <p class="print-report-meta">Total landlord complaints on record: ${complaints.length}</p>
      </div>
      ${buildComplaintsPrintSection()}
      <h2>Incident log</h2>
      <table class="print-report-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Hour</th>
            <th>Incident type</th>
            <th>Severity</th>
            <th>Impact</th>
            <th>Landlord disclosure</th>
            <th>Evidence</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="print-report-footer">
        This report was exported from the Building Incident Log. Entries reflect nuisance incidents
        documented across each day from 12am through 11pm. Landlord complaints record when filings
        were submitted and which incidents they cover.
      </p>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function exportPdf() {
    const filtered = getFilteredIncidents();
    if (filtered.length === 0 && complaints.length === 0) {
      window.alert('No incidents or complaints to export. Log data first or adjust filters.');
      return;
    }

    buildPrintReport(filtered);
    els.printReport.removeAttribute('hidden');
    els.printReport.setAttribute('aria-hidden', 'false');

    const cleanup = () => {
      els.printReport.setAttribute('hidden', '');
      els.printReport.setAttribute('aria-hidden', 'true');
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  function exportBackup() {
    const payload = {
      app: 'Building Incident Log',
      version: 2,
      exportedAt: new Date().toISOString(),
      incidents,
      complaints,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `building-incident-backup-${formatDateISO(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const importedIncidents = Array.isArray(data) ? data : data.incidents;
        if (!Array.isArray(importedIncidents)) throw new Error('Invalid backup format');

        const importedComplaints = Array.isArray(data) ? [] : data.complaints || [];
        const incidentCount = importedIncidents.length;
        const complaintCount = importedComplaints.length;

        const replace = window.confirm(
          `Restore ${incidentCount} incident${incidentCount === 1 ? '' : 's'}` +
            (complaintCount
              ? ` and ${complaintCount} complaint${complaintCount === 1 ? '' : 's'}`
              : '') +
            '?\n\nOK replaces all current data. Cancel keeps your existing log.'
        );
        if (!replace) return;

        incidents = importedIncidents.map((incident) => ({
          ...stripIncidentLandlordFields(incident),
          impact: normalizeImpacts(incident.impact),
        }));
        complaints = importedComplaints.map(normalizeComplaint);

        if (Array.isArray(data) && data.some((inc) => inc.landlordComplaintSubmitted)) {
          complaints = migrateLandlordFieldsToComplaints(data).map(normalizeComplaint);
        }

        await saveData();
        renderGrid();
        renderList();
        renderComplaints();
        window.alert(
          `Restored ${incidents.length} incident${incidents.length === 1 ? '' : 's'}` +
            (complaints.length
              ? ` and ${complaints.length} complaint${complaints.length === 1 ? '' : 's'}`
              : '') +
            '.'
        );
      } catch {
        window.alert('Could not read that file. Please choose a valid backup JSON file.');
      }
    };
    reader.readAsText(file);
  }

  async function enterAppAfterLogin() {
    showAppShell();
    try {
      await loadDataFromCloud();
    } catch (error) {
      console.error(error);
      window.alert(
        error.message ||
          'Signed in, but could not load your log. Check that supabase-setup.sql was run in Supabase.'
      );
      loadDataLocal();
    }
    initApp();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    const submitBtn = els.authForm.querySelector('button[type="submit"]');

    if (!email || !password) {
      setAuthError('Enter your email and password.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        window.alert(`Sign in failed: ${error.message}`);
        return;
      }

      if (data.session) {
        await enterAppAfterLogin();
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
    }
  }

  async function handleAuthSignUp() {
    setAuthError('');

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;

    if (!email || password.length < 8) {
      setAuthError('Use an email and a password with at least 8 characters.');
      return;
    }

    els.authSignUp.disabled = true;
    els.authSignUp.textContent = 'Creating account…';

    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setAuthError(error.message);
        window.alert(`Could not create account: ${error.message}`);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        const message =
          'Account may be created. If email confirmation is enabled in Supabase, check your email first.';
        setAuthError(message);
        window.alert(message);
      }
    } finally {
      els.authSignUp.disabled = false;
      els.authSignUp.textContent = 'Create household account';
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function refreshAppData() {
    await loadDataFromCloud();
    renderGrid();
    renderComplaints();
    renderList();
    updateSaveStatus(cloudEnabled ? 'cloud' : 'local');
  }

  function initApp() {
    if (appInitialized) return;
    buildImpactOptions();
    populateSelects();
    buildHourHeaders();
    bindEvents();
    appInitialized = true;
    renderGrid();
    renderComplaints();
    renderList();
    updateSaveStatus(cloudEnabled ? 'cloud' : 'local');
  }

  function exportCsv() {
    const filtered = getFilteredIncidents();
    const incidentHeaders = [
      'Date',
      'Day',
      'Hour block',
      'Incident type',
      'Severity',
      'Notes',
      'Evidence exists',
      'Evidence type',
      'Impact on tenant',
      'Disclosed to landlord',
      'Disclosure complaint date',
      'Created at',
      'Updated at',
    ];

    const incidentRows = filtered.map((inc) => {
      const d = parseDateISO(inc.date);
      const disclosure = getDisclosureComplaint(inc);
      return [
        inc.date,
        DAY_NAMES[d.getDay()],
        getHourLabel(inc.hour),
        getTypeLabel(inc.type),
        SEVERITY_LABELS[inc.severity],
        inc.notes,
        inc.hasEvidence ? 'Yes' : 'No',
        inc.hasEvidence ? (EVIDENCE_LABELS[inc.evidenceType] || inc.evidenceType) : '',
        formatImpactList(inc.impact),
        disclosure ? 'Yes' : 'No',
        disclosure?.dateSubmitted || '',
        inc.createdAt || '',
        inc.updatedAt || '',
      ];
    });

    const complaintHeaders = [
      'Date submitted',
      'Covers from',
      'Covers through',
      'Incidents covered',
      'Notes',
      'Created at',
      'Updated at',
    ];

    const complaintRows = [...complaints]
      .sort((a, b) => a.dateSubmitted.localeCompare(b.dateSubmitted))
      .map((complaint) => {
        const { coversFromDate, coversThroughDate } = normalizeComplaint(complaint);
        return [
          complaint.dateSubmitted,
          coversFromDate,
          coversThroughDate,
          countIncidentsCovered(complaint),
          complaint.notes,
          complaint.createdAt || '',
          complaint.updatedAt || '',
        ];
      });

    const escape = (val) => {
      const str = String(val ?? '');
      if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const lines = [
      'Landlord complaints',
      complaintHeaders.map(escape).join(','),
      ...complaintRows.map((row) => row.map(escape).join(',')),
      '',
      'Incidents',
      incidentHeaders.map(escape).join(','),
      ...incidentRows.map((row) => row.map(escape).join(',')),
    ];

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `building-incidents-${formatDateISO(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function bindAuthEvents() {
    if (authEventsBound) return;
    authEventsBound = true;

    if (els.authForm) {
      els.authForm.addEventListener('submit', handleAuthSubmit);
    }
    if (els.authSignUp) {
      els.authSignUp.addEventListener('click', handleAuthSignUp);
    }
  }

  function bindEvents() {
    els.prevWeek.addEventListener('click', () => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() - 7);
      currentWeekStart = d;
      renderGrid();
    });

    els.nextWeek.addEventListener('click', () => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + 7);
      currentWeekStart = d;
      renderGrid();
    });

    els.todayWeek.addEventListener('click', () => {
      currentWeekStart = getWeekStart(new Date());
      renderGrid();
    });

    els.formEvidence.addEventListener('change', () => {
      els.evidenceTypeGroup.hidden = !els.formEvidence.checked;
      if (!els.formEvidence.checked) els.formEvidenceType.value = '';
    });

    els.formImpactGroup.addEventListener('change', (event) => {
      const input = event.target;
      if (input.type !== 'checkbox') return;

      if (input.value === 'none' && input.checked) {
        els.formImpactGroup.querySelectorAll('input[type="checkbox"]').forEach((box) => {
          if (box.value !== 'none') box.checked = false;
        });
      } else if (input.checked) {
        const noneBox = els.formImpactGroup.querySelector('input[value="none"]');
        if (noneBox) noneBox.checked = false;
      }
    });

    els.form.addEventListener('submit', handleSave);
    els.closeModal.addEventListener('click', closeModalDialog);
    els.cancelModal.addEventListener('click', closeModalDialog);
    els.deleteIncident.addEventListener('click', handleDelete);

    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModalDialog();
    });

    els.logComplaint.addEventListener('click', () => openComplaintModal());
    els.complaintForm.addEventListener('submit', handleComplaintSave);
    els.closeComplaintModal.addEventListener('click', closeComplaintModalDialog);
    els.cancelComplaintModal.addEventListener('click', closeComplaintModalDialog);
    els.deleteComplaint.addEventListener('click', handleComplaintDelete);

    els.complaintModal.addEventListener('click', (e) => {
      if (e.target === els.complaintModal) closeComplaintModalDialog();
    });

    els.formCoversFrom.addEventListener('change', () => {
      if (els.formCoversThrough.value && els.formCoversThrough.value < els.formCoversFrom.value) {
        els.formCoversThrough.value = els.formCoversFrom.value;
      }
    });

    els.formCoversThrough.addEventListener('change', () => {
      if (els.formCoversFrom.value && els.formCoversFrom.value > els.formCoversThrough.value) {
        els.formCoversFrom.value = els.formCoversThrough.value;
      }
    });

    [
      els.filterType,
      els.filterSeverity,
      els.filterDateFrom,
      els.filterDateTo,
      els.filterLateNight,
      els.filterDisclosed,
    ].forEach((el) => el.addEventListener('change', renderList));

    els.clearFilters.addEventListener('click', () => {
      els.filterType.value = '';
      els.filterSeverity.value = '';
      els.filterDateFrom.value = '';
      els.filterDateTo.value = '';
      els.filterLateNight.checked = false;
      els.filterDisclosed.checked = false;
      renderList();
    });

    els.exportCsv.addEventListener('click', exportCsv);
    els.exportPdf.addEventListener('click', exportPdf);
    els.exportBackup.addEventListener('click', exportBackup);
    els.importBackup.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', () => {
      const file = els.importFile.files[0];
      if (file) importBackup(file);
      els.importFile.value = '';
    });

    if (els.signOut) {
      els.signOut.addEventListener('click', handleSignOut);
    }
  }

  async function boot() {
    supabase = initSupabaseClient();
    cloudEnabled = Boolean(supabase);

    if (els.signOut) {
      els.signOut.hidden = !cloudEnabled;
    }

    if (cloudEnabled) {
      bindAuthEvents();
    }

    if (!cloudEnabled) {
      loadDataLocal();
      showAppShell();
      initApp();
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await enterAppAfterLogin();
    } else {
      showAuthScreen();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session && event === 'SIGNED_IN') {
        await enterAppAfterLogin();
      } else if (event === 'SIGNED_OUT') {
        showAuthScreen();
      }
    });
  }

  boot();
})();

