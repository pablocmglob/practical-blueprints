/* Business Blueprints — Canvas UI (T3)
   Plain JavaScript, no frameworks, no external dependencies.

   Architecture (per docs/implementation/ui_spec.md):
   - X axis: time/sequence — phases grouped over steps, single linear path.
   - Y axis: depth — layer categories as rows.
   - Step-column × category-row intersections are drop-zones for text
     sticky notes (layer items).
   - Frontstage steps (is_visible=true) light; backstage dark.
   - Live updates via SSE (GET /api/blueprints/{id}/events).
   - Mutations send If-Match: <version>; responses carry the new version.
   - Text-only: file drag-drop and non-text paste are rejected.

   This module is written so the pure logic (taxonomy, grid model building,
   validation) is testable headlessly without a DOM: everything DOM-related
   lives behind the `render`/`wire` functions and `init()`. */

'use strict';

/* ============ Layer taxonomy (single source for rows, colors, prompts) ============ */

const LAYER_CATEGORIES = [
  { id: 'TOUCHPOINT',        label: 'Touchpoint',       color: '#2563eb',   prompt: 'What does the customer see or interact with here?' },
  { id: 'ROLE',              label: 'Role',             color: '#16a34a',   prompt: 'Who performs this step?' },
  { id: 'TECHNOLOGY',        label: 'Technology',       color: '#7c3aed',   prompt: 'What systems are required here?' },
  { id: 'POLICY',            label: 'Policy',           color: '#ea580c',   prompt: 'What rules govern this?' },
  { id: 'PROCESS',           label: 'Process',          color: '#0d9488',   prompt: 'What procedure or workflow applies here?' },
  { id: 'METRIC',            label: 'Metric',           color: '#0891b2',   prompt: 'How is this step measured?' },
  { id: 'CRITICAL_MOMENT',   label: 'Critical Moment',  color: '#dc2626',   prompt: 'What can go wrong for the customer here?' },
  { id: 'OPPORTUNITY',       label: 'Opportunity',      color: '#eab308',   prompt: 'Where can this step be improved?' },
  { id: 'RATIONALE',         label: 'Rationale',        color: '#64748b',   prompt: 'Why does this step exist?' },
  { id: 'POTENTIAL_PITFALL', label: 'Potential Pitfall', color: '#be185d',  prompt: 'What operational risk hides in this step?' },
];

const CATEGORY_IDS = LAYER_CATEGORIES.map(function (c) { return c.id; });

function categoryById(id) {
  for (var i = 0; i < LAYER_CATEGORIES.length; i++) {
    if (LAYER_CATEGORIES[i].id === id) return LAYER_CATEGORIES[i];
  }
  return null;
}

/* ============ Pure model helpers (headless-testable) ============ */

/* Build the linear grid model from a hierarchical blueprint JSON:
   blueprint → phases → steps → layer_items. Single linear path: phases in
   order, steps in order within each phase. No branching, no variants. */
function buildGridModel(blueprint) {
  var phases = (blueprint && Array.isArray(blueprint.phases)) ? blueprint.phases : [];
  var model = { phases: [], steps: [], itemsByCell: {} };
  phases.forEach(function (phase) {
    var phaseEntry = {
      id: phase.id,
      name: phase.name || phase.title || 'Untitled phase',
      stepIds: [],
    };
    var steps = Array.isArray(phase.steps) ? phase.steps : [];
    steps.forEach(function (step) {
      var stepEntry = {
        id: step.id,
        phaseId: phase.id,
        name: step.name || step.title || 'Untitled step',
        isVisible: step.is_visible !== false, // true = frontstage
        itemCount: 0,
      };
      var items = Array.isArray(step.layer_items) ? step.layer_items : [];
      items.forEach(function (item) {
        var cat = item.layer_category;
        if (CATEGORY_IDS.indexOf(cat) === -1) return; // unknown category: skip
        var key = step.id + '::' + cat;
        if (!model.itemsByCell[key]) model.itemsByCell[key] = [];
        model.itemsByCell[key].push({
          id: item.id,
          content: item.content || '',
          layerCategory: cat,
        });
        stepEntry.itemCount += 1;
      });
      model.steps.push(stepEntry);
      phaseEntry.stepIds.push(step.id);
    });
    // The phase band appears exactly once, even for an empty phase.
    model.phases.push(phaseEntry);
  });
  return model;
}

/* Column width factor for the heat-map effect: base width grows with the
   tallest stack of items in the column. Pure function of item counts. */
function columnWidthFactor(itemCount) {
  if (itemCount <= 3) return 1;
  return 1 + Math.min((itemCount - 3) * 0.15, 1.5); // cap at 2.5× base
}

/* Text-only enforcement: reject anything that is not plain text.
   Returns { ok: true } or { ok: false, reason: string }. */
function validateTextOnly(text) {
  if (typeof text !== 'string') return { ok: false, message: 'Only plain text is accepted.' };
  if (text.trim().length === 0) return { ok: false, message: 'Note text cannot be empty.' };
  if (text.length > 2000) return { ok: false, message: 'Note text is too long (max 2000 characters).' };
  return { ok: true };
}

/* Classify a DataTransfer for drag-drop / paste rejection.
   Returns 'text' when the payload is plain text, 'file' when it carries
   files, 'unknown' otherwise. */
function classifyTransfer(dataTransfer) {
  if (!dataTransfer) return 'unknown';
  if (dataTransfer.files && dataTransfer.files.length > 0) return 'file';
  var types = dataTransfer.types ? Array.prototype.slice.call(dataTransfer.types) : [];
  if (types.indexOf('Files') !== -1) return 'file';
  if (types.indexOf('text/plain') !== -1) return 'text';
  return 'unknown';
}

/* ============ API client ============ */

function createApiClient(baseUrl) {
  var version = 0;

  function fullUrl(path) {
    return baseUrl + path;
  }

  function handleErrorResponse(response) {
    return response.text().then(function (body) {
      var message = 'HTTP ' + response.status;
      try {
        var parsed = JSON.parse(body);
        if (parsed && parsed.error) message += ': ' + parsed.error;
      } catch (e) { /* non-JSON body: keep generic message */ }
      var err = new Error(message);
      err.status = response.status;
      throw err;
    });
  }

  return {
    getVersion: function () { return version; },
    setVersion: function (v) { version = v; },

    listBlueprints: function () {
      return fetch(fullUrl('/api/blueprints')).then(function (r) {
        if (!r.ok) return handleErrorResponse(r);
        return r.json();
      });
    },

    getBlueprint: function (id) {
      return fetch(fullUrl('/api/blueprints/' + encodeURIComponent(id))).then(function (r) {
        if (!r.ok) return handleErrorResponse(r);
        return r.json();
      });
    },

    createLayerItem: function (blueprintId, stepId, layerCategory, content) {
      return fetch(fullUrl('/api/blueprints/' + encodeURIComponent(blueprintId) + '/layer-items'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(version),
        },
        body: JSON.stringify({ step_id: stepId, layer_category: layerCategory, content: content }),
      }).then(function (r) {
        if (!r.ok) return handleErrorResponse(r);
        return r.json();
      }).then(function (body) {
        if (body && typeof body.version === 'number') version = body.version;
        return body;
      });
    },

    openEventStream: function (blueprintId, onEvent, onStatusChange) {
      var source = new EventSource(fullUrl('/api/blueprints/' + encodeURIComponent(blueprintId) + '/events'));
      source.onopen = function () { onStatusChange('live'); };
      source.onerror = function () { onStatusChange('offline'); };
      source.onmessage = function (message) {
        var event = null;
        try { event = JSON.parse(message.data); } catch (e) { return; }
        onEvent(event);
      };
      return source;
    },
  };
}

/* ============ DOM wiring and rendering ============ */

function init(document, window) {
  var api = createApiClient('');
  var state = {
    blueprintId: null,
    blueprint: null,
    model: null,
    selectedStepId: null,
    version: 0,
  };

  var gridEl = document.getElementById('blueprint-grid');
  var scrollEl = document.getElementById('grid-scroll');
  var checklistEl = document.getElementById('checklist');
  var emptyEl = document.getElementById('empty-state');
  var connectionEl = document.getElementById('connection-status');
  var versionEl = document.getElementById('version-label');
  var selectionEl = document.getElementById('selection-label');
  var toastRegion = document.getElementById('toast-region');

  function showToast(message, kind) {
    var toast = document.createElement('div');
    toast.className = 'toast' + (kind ? ' ' + kind : '');
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

  function setConnectionStatus(status) {
    connectionEl.textContent = status;
    connectionEl.className = 'connection ' + status;
  }

  function setVersionLabel() {
    versionEl.textContent = 'version ' + state.version;
  }

  function setSelectionLabel() {
    if (!state.selectedStepId) {
      selectionEl.textContent = 'no step selected';
      return;
    }
    var step = findStep(state.selectedStepId);
    selectionEl.textContent = step ? 'selected: ' + step.name : '';
  }

  function findStep(stepId) {
    if (!state.model) return null;
    for (var i = 0; i < state.model.steps.length; i++) {
      if (state.model.steps[i].id === stepId) return state.model.steps[i];
    }
    return null;
  }

  /* ---- Grid rendering ---- */

  function renderGrid() {
    gridEl.textContent = '';
    if (!state.model || state.model.steps.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    var totalColumns = state.model.steps.length;
    gridEl.style.gridTemplateColumns =
      'var(--row-label-width) repeat(' + totalColumns + ', max-content)';

    // Row 1: phase bands (sticky top). Corner cell spans both header rows.
    var corner = document.createElement('div');
    corner.className = 'grid-header corner';
    corner.style.gridRow = '1 / span 2';
    corner.textContent = 'Layers ↓ / Steps →';
    gridEl.appendChild(corner);

    state.model.phases.forEach(function (phase) {
      var band = document.createElement('div');
      band.className = 'phase-band';
      band.style.gridColumn = 'span ' + Math.max(phase.stepIds.length, 1);
      band.textContent = phase.name;
      gridEl.appendChild(band);
    });

    // Row 2: step headers.
    state.model.steps.forEach(function (step) {
      var header = document.createElement('div');
      header.className = 'grid-header step-header' + (step.isVisible ? '' : ' backstage');
      header.setAttribute('data-step-id', step.id);
      header.textContent = step.name;
      var vis = document.createElement('span');
      vis.className = 'step-visibility';
      vis.textContent = step.isVisible ? 'frontstage' : 'backstage';
      header.appendChild(vis);
      header.addEventListener('click', function () { selectStep(step.id); });
      gridEl.appendChild(header);
    });

    // Data rows: one per category, cells per step.
    LAYER_CATEGORIES.forEach(function (category) {
      var label = document.createElement('div');
      label.className = 'row-label';
      var dot = document.createElement('span');
      dot.className = 'category-dot';
      dot.style.background = category.color;
      label.appendChild(dot);
      label.appendChild(document.createTextNode(category.label));
      gridEl.appendChild(label);

      state.model.steps.forEach(function (step) {
        gridEl.appendChild(buildCell(step, category));
      });
    });
  }

  function buildCell(step, category) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('data-step-id', step.id);
    cell.setAttribute('data-category', category.id);

    var key = step.id + '::' + category.id;
    var items = (state.model && state.model.itemsByCell[key]) || [];
    items.forEach(function (item) {
      cell.appendChild(buildStickyNote(item, category));
    });

    wireDropZone(cell, step, category);
    return cell;
  }

  function buildStickyNote(item, category) {
    var note = document.createElement('div');
    note.className = 'sticky-note';
    note.setAttribute('data-item-id', item.id);
    note.style.borderLeftColor = category.color;
    var catLabel = document.createElement('span');
    catLabel.className = 'note-category';
    catLabel.style.color = category.color;
    catLabel.textContent = category.label;
    note.appendChild(catLabel);
    note.appendChild(document.createTextNode(item.content));
    return note;
  }

  /* Column heat-map width: applied per step column after render. */
  function applyColumnWidths() {
    if (!state.model) return;
    state.model.steps.forEach(function (step) {
      var factor = columnWidthFactor(step.itemCount);
      var cells = gridEl.querySelectorAll('[data-step-id="' + step.id + '"].cell');
      cells.forEach(function (cell) {
        cell.style.minWidth = Math.round(180 * factor) + 'px';
      });
    });
  }

  /* ---- Checklist sidebar ---- */

  function renderChecklist() {
    checklistEl.textContent = '';
    LAYER_CATEGORIES.forEach(function (category) {
      var block = document.createElement('div');
      block.className = 'checklist-category';
      block.setAttribute('data-category', category.id);

      var label = document.createElement('div');
      label.className = 'category-label';
      var dot = document.createElement('span');
      dot.className = 'category-dot';
      dot.style.background = category.color;
      label.appendChild(dot);
      label.appendChild(document.createTextNode(category.label));
      var count = document.createElement('span');
      count.className = 'category-count';
      count.textContent = countItemsForCategory(category.id) + ' notes';
      label.appendChild(count);
      block.appendChild(label);

      var prompt = document.createElement('div');
      prompt.className = 'category-prompt';
      prompt.textContent = category.prompt;
      block.appendChild(prompt);

      var form = document.createElement('form');
      form.className = 'prompt-form';
      var textarea = document.createElement('textarea');
      textarea.setAttribute('placeholder', 'Answer as plain text…');
      textarea.setAttribute('aria-label', category.label + ' note for selected step');
      form.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'prompt-actions';
      var submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'primary';
      submit.textContent = 'Add note';
      submit.disabled = !state.selectedStepId;
      actions.appendChild(submit);
      form.appendChild(actions);

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submitNote(category, textarea);
      });

      block.appendChild(form);
      checklistEl.appendChild(block);
    });
  }

  function countItemsForCategory(categoryId) {
    if (!state.model) return 0;
    var total = 0;
    Object.keys(state.model.itemsByCell).forEach(function (key) {
      if (key.indexOf('::' + categoryId) !== -1) total += state.model.itemsByCell[key].length;
    });
    return total;
  }

  function selectStep(stepId) {
    state.selectedStepId = stepId;
    setSelectionLabel();
    var forms = checklistEl.querySelectorAll('.prompt-form button.primary');
    forms.forEach(function (button) { button.disabled = false; });
    var step = findStep(stepId);
    if (step) {
      showToast('Step selected: ' + step.name + ' — answer a prompt to add a note.', 'success');
    }
  }

  function submitNote(category, textarea) {
    if (!state.selectedStepId) {
      showToast('Select a step on the canvas first.', 'error');
      return;
    }
    var check = validateTextOnly(textarea.value);
    if (!check.ok) {
      showToast(check.message, 'error');
      return;
    }
    var submitButtons = checklistEl.querySelectorAll('.prompt-form button.primary');
    submitButtons.forEach(function (b) { b.disabled = true; });
    api.createLayerItem(state.blueprintId, state.selectedStepId, category.id, textarea.value)
      .then(function () {
        textarea.value = '';
        showToast('Note added to ' + category.label + '.', 'success');
      })
      .catch(function (err) {
        showToast('Could not add note: ' + err.message, 'error');
      })
      .then(function () {
        submitButtons.forEach(function (b) { b.disabled = false; });
      });
  }

  /* ---- Text-only drop zones ---- */

  function wireDropZone(cell, step, category) {
    cell.addEventListener('dragover', function (event) {
      event.preventDefault();
      var kind = classifyTransfer(event.dataTransfer);
      cell.classList.add(kind === 'file' ? 'drag-invalid' : 'drop-target');
    });
    cell.addEventListener('dragleave', function () {
      cell.classList.remove('drop-target', 'drag-invalid');
    });
    cell.addEventListener('drop', function (event) {
      event.preventDefault();
      cell.classList.remove('drop-target', 'drag-invalid');
      var kind = classifyTransfer(event.dataTransfer);
      if (kind === 'file') {
        event.preventDefault();
        event.stopPropagation();
        showToast('Rejected: only plain text is supported — file uploads are disabled.', 'error');
        return;
      }
      var text = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
      var check = validateTextOnly(text);
      if (!check.ok) {
        showToast(check.message, 'error');
        return;
      }
      api.createLayerItem(state.blueprintId, step.id, category.id, text)
        .then(function () { showToast('Note added.', 'success'); })
        .catch(function (err) { showToast('Could not add note: ' + err.message, 'error'); });
    });
  }

  /* Global paste guard: reject non-text paste anywhere. */
  function wirePasteGuard(document) {
    document.addEventListener('paste', function (event) {
      var clipboard = event.clipboardData;
      if (!clipboard) return;
      if (clipboard.files && clipboard.files.length > 0) {
        event.preventDefault();
        showToast('Rejected: pasted content is not plain text.', 'error');
        return;
      }
      var types = clipboard.types ? Array.prototype.slice.call(clipboard.types) : [];
      if (types.indexOf('text/plain') === -1) {
        event.preventDefault();
        showToast('Rejected: only plain text paste is supported.', 'error');
      }
    });
  }

  /* ---- SSE live updates ---- */

  function wireEventStream() {
    api.openEventStream(state.blueprintId, function (event) {
      // Mutation events: re-fetch the blueprint and re-render (no refresh).
      loadBlueprint().then(function () {
        if (event && event.type) {
          showToast('Live update: ' + event.type, 'success');
        }
      });
    }, setConnectionStatus);
  }

  /* ---- Data loading ---- */

  function loadBlueprint() {
    return api.getBlueprint(state.blueprintId).then(function (blueprint) {
      state.blueprint = blueprint;
      state.model = buildGridModel(blueprint);
      if (typeof blueprint.version === 'number') {
        state.version = blueprint.version;
        api.setVersion(blueprint.version);
      }
      var nameEl = document.getElementById('blueprint-name');
      nameEl.textContent = blueprint.name || blueprint.title || state.blueprintId;
      setVersionLabel();
      renderGrid();
      applyColumnWidths();
      renderChecklist();
      setSelectionLabel();
    });
  }

  function boot() {
    api.listBlueprints().then(function (payload) {
      var list = Array.isArray(payload) ? payload : (payload && payload.blueprints) || [];
      if (list.length === 0) {
        emptyEl.hidden = false;
        setConnectionStatus('offline');
        return null;
      }
      state.blueprintId = list[0].id;
      return loadBlueprint().then(function () {
        wireEventStream();
      });
    }).catch(function (err) {
      emptyEl.hidden = false;
      setConnectionStatus('offline');
      showToast('Failed to load blueprint: ' + err.message, 'error');
    });
  }

  wirePasteGuard(document);
  boot();

  return {
    state: state,
    renderGrid: renderGrid,
    renderChecklist: renderChecklist,
    applyColumnWidths: applyColumnWidths,
    selectStep: selectStep,
    loadBlueprint: loadBlueprint,
  };
}

/* Export for headless tests (Node) without breaking the browser global. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LAYER_CATEGORIES: LAYER_CATEGORIES,
    CATEGORY_IDS: CATEGORY_IDS,
    categoryById: categoryById,
    buildGridModel: buildGridModel,
    columnWidthFactor: columnWidthFactor,
    validateTextOnly: validateTextOnly,
    classifyTransfer: classifyTransfer,
    createApiClient: createApiClient,
    init: init,
  };
}
