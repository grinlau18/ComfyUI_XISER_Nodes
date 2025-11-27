/**
 * UI components and utilities for XIS_ImageManager.
 */

/**
 * Create an element with specified class names and attributes.
 * @param {string} tag - HTML tag name.
 * @param {string} className - CSS class name(s).
 * @param {Object} attributes - Additional attributes.
 * @returns {HTMLElement}
 */
export function createElementWithClass(tag, className, attributes = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  Object.keys(attributes).forEach(key => {
    element.setAttribute(key, attributes[key]);
  });
  return element;
}

/**
 * Truncate filename to specified length.
 * @param {string} filename - Original filename.
 * @param {number} maxLength - Maximum length.
 * @returns {string}
 */
export function truncateFilename(filename, maxLength = 20) {
  if (!filename || filename.length <= maxLength) return filename;
  const extension = filename.split('.').pop();
  const name = filename.slice(0, -(extension.length + 1));
  const truncatedName = name.slice(0, maxLength - extension.length - 3) + '...';
  return `${truncatedName}.${extension}`;
}

/**
 * Create a debounced function.
 * @param {Function} func - Function to debounce.
 * @param {number} wait - Wait time in milliseconds.
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a toggle switch element.
 * @param {boolean} checked - Initial checked state.
 * @param {Function} onChange - Change handler.
 * @param {string} label - Label text.
 * @returns {HTMLElement}
 */
export function createToggle(checked, onChange, label = '') {
  const container = createElementWithClass('div', 'xiser-image-manager-control-item');

  const toggle = createElementWithClass('input', 'xiser-image-manager-toggle', {
    type: 'checkbox',
    checked: checked
  });

  if (label) {
    const labelElement = createElementWithClass('label', 'xiser-image-manager-label');
    labelElement.innerText = label;
    container.appendChild(labelElement);
  }

  toggle.addEventListener('change', () => onChange(toggle.checked));
  container.appendChild(toggle);

  return container;
}

/**
 * Create a button element.
 * @param {string} text - Button text.
 * @param {Function} onClick - Click handler.
 * @param {string} className - Additional CSS class.
 * @returns {HTMLElement}
 */
export function createButton(text, onClick, className = '') {
  const button = createElementWithClass('div', `xiser-image-manager-button ${className}`);
  button.innerText = text;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Create an image card component.
 * @param {Object} preview - Image preview data.
 * @param {Function} onEdit - Edit button handler.
 * @param {Function} onDelete - Delete button handler.
 * @param {Function} onToggle - Toggle handler.
 * @param {boolean} isSingleMode - Single mode state.
 * @returns {HTMLElement}
 */
export function createImageCard(preview, onEdit, onDelete, onToggle, isSingleMode = false) {
  const card = createElementWithClass('div', 'xiser-image-manager-image-card', {
    'data-index': preview.index
  });

  if (!preview.enabled) {
    card.classList.add('disabled');
  }

  // Image preview
  const img = createElementWithClass('img', 'xiser-image-manager-preview', {
    src: `data:image/png;base64,${preview.preview}`
  });

  img.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    onEdit(preview);
  });

  card.appendChild(img);

  // Info section
  const info = createElementWithClass('div', 'xiser-image-manager-info');
  const layerSize = createElementWithClass('div', 'xiser-image-manager-layer-size');
  const displayFilename = truncateFilename(preview.originalFilename || preview.filename);

  layerSize.innerText = preview.enabled
    ? `Layer | ${preview.width}x${preview.height}`
    : `Disabled | Size: ${preview.width}x${preview.height}`;

  const filename = createElementWithClass('div', 'xiser-image-manager-filename');
  filename.innerText = displayFilename;

  info.appendChild(layerSize);
  info.appendChild(filename);
  card.appendChild(info);

  // Button container
  const buttonContainer = createElementWithClass('div', 'xiser-image-manager-button-container');

  // Delete button for uploaded images
  if (preview.source === 'uploaded' || preview.filename.startsWith('upload_image_')) {
    const deleteButton = createElementWithClass('div', 'xiser-image-manager-delete-button');
    deleteButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L10 10M2 10L10 2" stroke="#FF5555" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    deleteButton.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete(preview);
    });
    buttonContainer.appendChild(deleteButton);
  }

  // Toggle switch
  const toggle = createElementWithClass('input', 'xiser-image-manager-toggle', {
    type: 'checkbox',
    checked: preview.enabled
  });

  if (isSingleMode && preview.enabled) {
    toggle.disabled = true;
  }

  toggle.addEventListener('change', () => onToggle(preview, toggle.checked));
  buttonContainer.appendChild(toggle);

  card.appendChild(buttonContainer);

  return card;
}